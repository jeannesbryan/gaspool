import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { Bindings } from "../index";
import { verify } from "hono/jwt";

const api = new Hono<{ Bindings: Bindings }>();

// ==========================================
// MIDDLEWARE PERTAHANAN API
// ==========================================
// Perisai Anti-CSRF: Mencegah serangan pemalsuan permintaan silang.
// Memastikan aksi POST/DELETE murni dikirim dari dalam markas Gaspool.
api.use("*", csrf());

// Middleware untuk mem-proteksi API (hanya Kapten yang bisa Save, Edit, Delete)
const protectAPI = async (c: any, next: any) => {
  const token = getCookie(c, "gaspool_session");

  if (!token) {
    return c.json(
      {
        success: false,
        message: "Unauthorized",
      },
      401,
    );
  }

  try {
    await verify(token, c.env.JWT_SECRET, "HS256");

    await next();
  } catch {
    return c.json(
      {
        success: false,
        message: "Invalid session",
      },
      401,
    );
  }
};

// 1. Tarik Data Dashboard
api.get("/rides", protectAPI, async (c) => {
  const f = c.req.query("filter") || "all";
  const p = parseInt(c.req.query("page") || "1");
  const lim = 10;
  const off = (p - 1) * lim;

  let qStats =
    "SELECT COUNT(*) as total_count, COALESCE(SUM(distance),0) as total_dist, COALESCE(SUM(moving_time),0) as total_time, COALESCE(SUM(total_elevation_gain),0) as total_elev FROM rides";
  let qData = "SELECT * FROM rides";

  if (f !== "all") {
    qStats += " WHERE activity_type = ?";
    qData += " WHERE activity_type = ?";
  }
  qData += " ORDER BY start_date DESC LIMIT ? OFFSET ?";

  try {
    const stats =
      f === "all"
        ? await c.env.DB.prepare(qStats).first()
        : await c.env.DB.prepare(qStats).bind(f).first();
    const rides =
      f === "all"
        ? await c.env.DB.prepare(qData).bind(lim, off).all()
        : await c.env.DB.prepare(qData).bind(f, lim, off).all();
    return c.json({ stats, rides: rides.results });
  } catch (e) {
    return c.json({ error: "Database error" }, 500);
  }
});

// 2. Simpan Rekaman Baru (Save Ride Chunking) ke R2 dan D1
api.post("/save_ride", protectAPI, async (c) => {
  try {
    const b = await c.req.json();
    const {
      uuid,
      chunk_index,
      total_chunks,
      points,
      name,
      distance,
      duration,
      activity_type,
      avg_temp,
      total_elevation,
    } = b;

    if (!uuid || chunk_index === undefined) {
      return c.json(
        { success: false, message: "Format chunk tidak valid!" },
        400,
      );
    }

    // Simpan potongan (chunk) ke ruang transit KV sementara. Beri batas kedaluwarsa 1 hari (86400 detik)
    await c.env.GASPOOL_RADAR.put(
      `CHUNK:${uuid}:${chunk_index}`,
      JSON.stringify(points || []),
      { expirationTtl: 86400 },
    );

    // Cek apakah ini potongan terakhir yang dikirim
    if (chunk_index === total_chunks - 1) {
      // Pastikan semua chunk sudah tiba
      for (let i = 0; i < total_chunks; i++) {
        const exists = await c.env.GASPOOL_RADAR.get(`CHUNK:${uuid}:${i}`);

        if (!exists) {
          return c.json({
            success: true,
            waiting: true,
            message: "Menunggu chunk lain tiba...",
          });
        }
      }

      let fullPolyline: any[] = [];
      const mergedChunks: any[] = [];

      // Tarik semua potongan dari KV dan satukan
      for (let i = 0; i < total_chunks; i++) {
        const chunkData = await c.env.GASPOOL_RADAR.get(`CHUNK:${uuid}:${i}`);

        if (chunkData) {
          mergedChunks.push(...JSON.parse(chunkData));

          // Bersihkan potongan dari KV
          await c.env.GASPOOL_RADAR.delete(`CHUNK:${uuid}:${i}`);
        }
      }

      // Hardening: buang titik korup
      fullPolyline = mergedChunks.filter(
        (p) => p && typeof p.lat === "number" && typeof p.lng === "number",
      );

      if (fullPolyline.length === 0) {
        return c.json(
          {
            success: false,
            message: "Rute kosong setelah digabung!",
          },
          400,
        );
      }

      let avgSpeed = 0;

      if (duration > 0 && distance > 0) {
        avgSpeed = distance / (duration / 3600);
      }

      const fileName = `gaspool/gaspool_ride_${Date.now()}_${Math.floor(Math.random() * 1000)}.json`;

      // Upload Rute Utuh ke R2
      await c.env.R2_BUCKET.put(fileName, JSON.stringify(fullPolyline), {
        httpMetadata: {
          contentType: "application/json",
        },
      });

      const publicUrl = `https://pub-13cc00374110455e9437c511bcbdf007.r2.dev/${fileName}`;

      const query = `INSERT INTO rides (
      name,
      distance,
      moving_time,
      average_speed,
      max_speed,
      total_elevation_gain,
      avg_temp,
      participants,
      start_date,
      polyline,
      activity_type,
      source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      await c.env.DB.prepare(query)
        .bind(
          name || "Aktivitas",
          distance || 0,
          duration || 0,
          avgSpeed,
          b.max_speed || 0,
          total_elevation || 0,
          avg_temp || 0,
          b.participants ? JSON.stringify(b.participants) : "[]",
          b.start_date || new Date().toISOString(),
          publicUrl,
          activity_type || "ride",
          b.source || "GASPOOL",
        )
        .run();

      return c.json({
        success: true,
        message: "Data rute utuh berhasil mendarat di awan!",
      });
    }

    // Jika bukan chunk terakhir, kirim status aman
    return c.json({
      success: true,
      message: `Chunk ${chunk_index + 1}/${total_chunks} aman direkam.`,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message,
      },
      500,
    );
  }
});

// 3. Edit Judul Aktivitas
api.post("/edit_ride/:id", protectAPI, async (c) => {
  const { name } = await c.req.json();
  await c.env.DB.prepare("UPDATE rides SET name = ? WHERE id = ?")
    .bind(name, c.req.param("id"))
    .run();
  return c.json({ success: true });
});

// 4. Hapus Aktivitas
api.delete("/delete_ride/:id", protectAPI, async (c) => {
  try {
    const ride: any = await c.env.DB.prepare(
      "SELECT polyline FROM rides WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan",
        },
        404,
      );
    }

    if (ride.polyline && ride.polyline.includes(".r2.dev/")) {
	  try {
		const url = new URL(ride.polyline);
		const objectKey = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

		if (objectKey) {
		  await c.env.R2_BUCKET.delete(objectKey);
		}
	  } catch (e) {
		console.warn("R2 cleanup gagal:", e);
	  }
	}

    await c.env.DB.prepare("DELETE FROM rides WHERE id = ?")
      .bind(c.req.param("id"))
      .run();

    return c.json({
      success: true,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message,
      },
      500,
    );
  }
});

// 5. RADAR SYNC (Cloudflare KV) - Terbuka untuk Tamu (Bebas Token)
api.post("/radar_sync", async (c) => {
  try {
    const { room, user, lat, lng, speed } = await c.req.json();
    if (!room || !user || room === "SINGLE_MODE")
      return c.json({ success: true, participants: [], radios: [] });

    // Simpan koordinat lokasi ke Radar
    await c.env.GASPOOL_RADAR.put(
      `${room}:${user}`,
      JSON.stringify({ lat, lng, speed, time: Date.now() }),
      { expirationTtl: 60 },
    );

    // Ambil daftar teman satu room
    const list = await c.env.GASPOOL_RADAR.list({ prefix: room + ":" });
    const participants = await Promise.all(
      list.keys.map(async (k) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[1], ...JSON.parse(val || "{}") };
      }),
    );

    // Telinga Satelit: Dengarkan apakah ada file radio (suara) baru di room ini
    const radioList = await c.env.GASPOOL_RADAR.list({
      prefix: `RADIO:${room}:`,
    });
    const radios = await Promise.all(
      radioList.keys.map(async (k) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[2], ...JSON.parse(val || "{}") };
      }),
    );

    return c.json({ success: true, participants, radios });
  } catch (e) {
    return c.json({ success: false }, 500);
  }
});

// 6. RADIO PTT (Voice Sync) - REAL R2 & KV UPLOAD
api.post("/radio", async (c) => {
  try {
    const body = await c.req.parseBody();
    const room = body["room"] as string;
    const user = body["user"] as string;
    const audioFile = body["audio"] as File;

    if (!room || !user || !audioFile) {
      return c.json(
        { success: false, message: "Data transmisi tidak lengkap" },
        400,
      );
    }

    // Generate nama file unik agar tidak bertabrakan
    const fileName = `radio_${room}_${user.replace(/[^a-zA-Z0-9]/g, "")}_${Date.now()}.webm`;

    // Konversi file suara menjadi ArrayBuffer untuk diunggah
    const arrayBuffer = await audioFile.arrayBuffer();

    // Tembakkan file suara ke Satelit R2
    await c.env.R2_BUCKET.put(fileName, arrayBuffer, {
      httpMetadata: { contentType: audioFile.type || "audio/webm" },
    });

    // URL Publik file suara
    const publicUrl = `https://pub-13cc00374110455e9437c511bcbdf007.r2.dev/${fileName}`;

    // Catat link suara ke Radar KV agar teman di room bisa mendengarnya
    await c.env.GASPOOL_RADAR.put(
      `RADIO:${room}:${user}`,
      JSON.stringify({
        url: publicUrl,
        time: Date.now(),
      }),
      { expirationTtl: 60 },
    );

    return c.json({ success: true, url: publicUrl });
  } catch (e: any) {
    return c.json({ success: false, message: e.message }, 500);
  }
});

// 7. PUBLIC RIDES FETCH (Hanya untuk Jeannes Bryan)
api.get("/public_rides/:username", async (c) => {
  const username = c.req.param("username").toLowerCase();
  const p = parseInt(c.req.query("page") || "1");
  const lim = 10;
  const off = (p - 1) * lim;

  if (username !== "jeannesbryan")
    return c.json({ error: "Unauthorized" }, 401);

  try {
    const { results: rides } = await c.env.DB.prepare(
      "SELECT * FROM rides ORDER BY start_date DESC LIMIT ? OFFSET ?",
    )
      .bind(lim, off)
      .all();
    return c.json({ rides });
  } catch (e) {
    return c.json({ error: "Database error" }, 500);
  }
});

// 8. RADAR SPECTATOR (Hanya Membaca Data Peleton untuk Keluarga)
api.get("/radar_view/:room", async (c) => {
  const room = c.req.param("room").toUpperCase();
  try {
    const list = await c.env.GASPOOL_RADAR.list({ prefix: room + ":" });
    const participants = await Promise.all(
      list.keys.map(async (k) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[1], ...JSON.parse(val || "{}") };
      }),
    );
    return c.json({ success: true, participants });
  } catch (e) {
    return c.json({ success: false }, 500);
  }
});

// 9. SATELIT CUACA (Open-Meteo Proxy)
api.get("/weather", async (c) => {
  const lat = c.req.query("lat");
  const lng = c.req.query("lng");
  if (!lat || !lng) return c.json({ temp: null });

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`,
    );
    const data: any = await res.json();
    return c.json({ temp: data.current_weather?.temperature || null });
  } catch (e) {
    return c.json({ temp: null });
  }
});

export default api;
