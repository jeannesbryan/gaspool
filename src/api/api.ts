import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { Bindings } from "../index";
import { verify } from "hono/jwt";

const api = new Hono<{ Bindings: Bindings }>();
const R2_PUBLIC_BASE_URL =
  "https://pub-13cc00374110455e9437c511bcbdf007.r2.dev";
const DEFAULT_PUBLIC_PROFILE_SLUG = "rider";

const normalizePublicProfileSlug = (value?: string) => {
  const slug = String(value || DEFAULT_PUBLIC_PROFILE_SLUG)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);

  return slug || DEFAULT_PUBLIC_PROFILE_SLUG;
};

const getPublicProfileSlug = (env: Bindings) =>
  normalizePublicProfileSlug(env.PUBLIC_PROFILE_SLUG);

const sanitizeRoomId = (value: string) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 48);

const sanitizeRadioUser = (value: string) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32) || "user";

type RoutePoint = {
  lat: number;
  lng: number;
  ele?: number;
};

type RouteInstruction = {
  text: string;
  distance_m: number;
  duration_s: number;
  type?: number;
  way_points?: [number, number];
  point?: RoutePoint | null;
};

type PlannedRoutePayload = {
  version: 1;
  provider: "ors";
  profile: string;
  name: string;
  distance_km: number;
  distance_m: number;
  duration_s: number;
  waypoints: RoutePoint[];
  coordinates: RoutePoint[];
  instructions: RouteInstruction[];
  created_at: string;
};

type GeocodeResult = {
  label: string;
  name: string;
  lat: number;
  lng: number;
  confidence: number | null;
  layer: string;
  source: string;
  country: string;
  region: string;
  locality: string;
};

const normalizeProfile = (activityType: string = "ride") => {
  const type = activityType.toLowerCase();

  if (type === "run" || type === "walk") return "foot-walking";
  if (type === "hike") return "foot-hiking";

  return "cycling-regular";
};

const normalizeRoutePoint = (point: any): RoutePoint | null => {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng ?? point?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
};

const normalizeGeocodeFeature = (feature: any): GeocodeResult | null => {
  const coordinates = feature?.geometry?.coordinates || [];
  const lng = Number(coordinates?.[0]);
  const lat = Number(coordinates?.[1]);
  const props = feature?.properties || {};

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const label = String(
    props.label || props.name || props.locality || "Lokasi tanpa nama",
  );
  const name = String(props.name || label);
  const confidence = Number(props.confidence);

  return {
    label,
    name,
    lat,
    lng,
    confidence: Number.isFinite(confidence) ? confidence : null,
    layer: String(props.layer || ""),
    source: String(props.source || ""),
    country: String(props.country || ""),
    region: String(props.region || props.region_a || ""),
    locality: String(props.locality || props.county || ""),
  };
};

const normalizeORSRoute = (data: any, options: {
  name: string;
  profile: string;
  waypoints: RoutePoint[];
}): PlannedRoutePayload => {
  const feature = data?.features?.[0];
  const coordinatesRaw = feature?.geometry?.coordinates || [];
  const properties = feature?.properties || {};
  const summary = properties.summary || {};

  const coordinates = coordinatesRaw
    .map((coord: any[]) => {
      const lng = Number(coord?.[0]);
      const lat = Number(coord?.[1]);
      const ele = Number(coord?.[2]);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return Number.isFinite(ele) ? { lat, lng, ele } : { lat, lng };
    })
    .filter(Boolean) as RoutePoint[];

  if (coordinates.length < 2) {
    throw new Error("Routing provider tidak mengembalikan koordinat rute.");
  }

  const instructions = (properties.segments || [])
    .flatMap((segment: any) => segment?.steps || [])
    .map((step: any) => {
      const wayPoints = Array.isArray(step?.way_points)
        ? step.way_points
        : undefined;
      const pointIndex = wayPoints ? Number(wayPoints[0]) : NaN;
      const point =
        Number.isFinite(pointIndex) && coordinates[pointIndex]
          ? coordinates[pointIndex]
          : null;

      return {
        text: String(step?.instruction || "Lanjutkan rute"),
        distance_m: Number(step?.distance || 0),
        duration_s: Number(step?.duration || 0),
        type:
          step?.type === undefined || step?.type === null
            ? undefined
            : Number(step.type),
        way_points: wayPoints
          ? [Number(wayPoints[0]), Number(wayPoints[1])]
          : undefined,
        point,
      };
    });

  const distanceM = Number(summary.distance || 0);
  const durationS = Number(summary.duration || 0);

  return {
    version: 1,
    provider: "ors",
    profile: options.profile,
    name: options.name,
    distance_km: distanceM / 1000,
    distance_m: distanceM,
    duration_s: durationS,
    waypoints: options.waypoints,
    coordinates,
    instructions,
    created_at: new Date().toISOString(),
  };
};

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

// 1a. Geocoding: cari lokasi via OpenRouteService, API key tetap di server
api.get("/geocode", protectAPI, async (c) => {
  try {
    if (!c.env.ORS_API_KEY) {
      return c.json(
        {
          success: false,
          message: "ORS_API_KEY belum dipasang di Worker secret.",
        },
        500,
      );
    }

    const q = String(c.req.query("q") || "").trim().slice(0, 120);

    if (q.length < 2) {
      return c.json(
        {
          success: false,
          message: "Kata kunci lokasi minimal 2 karakter.",
        },
        400,
      );
    }

    const lat = Number(c.req.query("lat"));
    const lng = Number(c.req.query("lng"));
    const params = new URLSearchParams({
      api_key: c.env.ORS_API_KEY,
      text: q,
      size: "8",
      "boundary.country": "ID",
    });

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      params.set("focus.point.lat", String(lat));
      params.set("focus.point.lon", String(lng));
    }

    const orsRes = await fetch(
      "https://api.openrouteservice.org/geocode/search?" + params.toString(),
      {
        headers: {
          Authorization: c.env.ORS_API_KEY,
        },
      },
    );

    if (!orsRes.ok) {
      const details = await orsRes.text();

      return c.json(
        {
          success: false,
          message: "Geocoder gagal mencari lokasi.",
          status: orsRes.status,
          details: details.slice(0, 500),
        },
        502,
      );
    }

    const data = await orsRes.json();
    const results = (data?.features || [])
      .map(normalizeGeocodeFeature)
      .filter(Boolean) as GeocodeResult[];

    return c.json({
      success: true,
      results,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e?.message || "Geocoder error.",
      },
      500,
    );
  }
});

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

// 2. Route Planner: generate rute via OpenRouteService, simpan JSON ke R2, metadata ke D1
api.post("/route_plan", protectAPI, async (c) => {
  try {
    if (!c.env.ORS_API_KEY) {
      return c.json(
        {
          success: false,
          message: "ORS_API_KEY belum dipasang di Worker secret.",
        },
        500,
      );
    }

    const body = await c.req.json();
    const rawWaypoints = Array.isArray(body?.waypoints)
      ? body.waypoints
      : Array.isArray(body?.points)
        ? body.points
        : [];
    const waypoints = rawWaypoints
      .map(normalizeRoutePoint)
      .filter(Boolean) as RoutePoint[];

    if (waypoints.length < 2) {
      return c.json(
        {
          success: false,
          message: "Minimal butuh titik start dan tujuan.",
        },
        400,
      );
    }

    if (waypoints.length > 50) {
      return c.json(
        {
          success: false,
          message: "Waypoint terlalu banyak. Maksimal 50 titik.",
        },
        400,
      );
    }

    const allowedProfiles = new Set([
      "cycling-regular",
      "cycling-road",
      "cycling-mountain",
      "cycling-electric",
      "foot-walking",
      "foot-hiking",
    ]);
    const requestedProfile = String(body?.profile || "");
    const profile = allowedProfiles.has(requestedProfile)
      ? requestedProfile
      : normalizeProfile(String(body?.activity_type || "ride"));
    const name =
      String(body?.name || "").trim().slice(0, 80) ||
      "Route Plan " + new Date().toLocaleDateString("id-ID");

    const orsRes = await fetch(
      `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
      {
        method: "POST",
        headers: {
          Authorization: c.env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: waypoints.map((p) => [p.lng, p.lat]),
          elevation: true,
          instructions: true,
        }),
      },
    );

    if (!orsRes.ok) {
      const details = await orsRes.text();

      return c.json(
        {
          success: false,
          message: "Routing provider gagal membuat rute.",
          status: orsRes.status,
          details: details.slice(0, 500),
        },
        502,
      );
    }

    const orsData = await orsRes.json();
    const routeData = normalizeORSRoute(orsData, {
      name,
      profile,
      waypoints,
    });
    const fileName = `gaspool/routes/route_${Date.now()}_${Math.floor(
      Math.random() * 1000,
    )}.json`;

    await c.env.R2_BUCKET.put(fileName, JSON.stringify(routeData), {
      httpMetadata: {
        contentType: "application/json",
      },
    });

    const publicUrl = `${R2_PUBLIC_BASE_URL}/${fileName}`;
    const inserted = await c.env.DB.prepare(
      `INSERT INTO planned_routes (
        name,
        distance,
        duration,
        route_url,
        provider,
        profile,
        waypoints
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        name,
        routeData.distance_km,
        Math.round(routeData.duration_s),
        publicUrl,
        routeData.provider,
        routeData.profile,
        JSON.stringify(waypoints),
      )
      .run();
    const routeId = Number((inserted.meta as any)?.last_row_id || 0);

    return c.json({
      success: true,
      route: {
        id: routeId,
        name,
        distance: routeData.distance_km,
        duration: Math.round(routeData.duration_s),
        route_url: publicUrl,
        provider: routeData.provider,
        profile: routeData.profile,
        coordinates_count: routeData.coordinates.length,
        instructions_count: routeData.instructions.length,
        data: routeData,
      },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Route planner gagal diproses.",
      },
      500,
    );
  }
});

api.get("/route_plans", protectAPI, async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const offset = Math.max(parseInt(c.req.query("offset") || "0"), 0);

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
        id,
        name,
        distance,
        duration,
        route_url,
        provider,
        profile,
        created_at
      FROM planned_routes
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all();

    return c.json({ success: true, routes: results });
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

api.get("/route_plan/:id", protectAPI, async (c) => {
  try {
    const route: any = await c.env.DB.prepare(
      "SELECT * FROM planned_routes WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    const routeRes = await fetch(route.route_url);

    if (!routeRes.ok) {
      return c.json(
        {
          success: false,
          message: "Metadata ada, tapi file rute gagal dibaca dari R2.",
          route,
        },
        502,
      );
    }

    const data = await routeRes.json();

    return c.json({
      success: true,
      route: {
        ...route,
        data,
      },
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

api.put("/route_plan/:id", protectAPI, async (c) => {
  try {
    const body = await c.req.json();
    const name = String(body?.name || "").trim().slice(0, 80);

    if (!name) {
      return c.json(
        {
          success: false,
          message: "Nama rute tidak boleh kosong.",
        },
        400,
      );
    }

    const route: any = await c.env.DB.prepare(
      "SELECT id FROM planned_routes WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    await c.env.DB.prepare("UPDATE planned_routes SET name = ? WHERE id = ?")
      .bind(name, c.req.param("id"))
      .run();

    return c.json({
      success: true,
      route: {
        id: Number(c.req.param("id")),
        name,
      },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal rename route plan.",
      },
      500,
    );
  }
});

api.delete("/route_plan/:id", protectAPI, async (c) => {
  try {
    const route: any = await c.env.DB.prepare(
      "SELECT id, route_url FROM planned_routes WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    if (typeof route.route_url === "string" && route.route_url.startsWith(R2_PUBLIC_BASE_URL + "/")) {
      const key = route.route_url.slice(R2_PUBLIC_BASE_URL.length + 1);
      if (key) await c.env.R2_BUCKET.delete(key);
    }

    await c.env.DB.prepare("DELETE FROM planned_routes WHERE id = ?")
      .bind(c.req.param("id"))
      .run();

    return c.json({
      success: true,
      id: Number(c.req.param("id")),
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal menghapus route plan.",
      },
      500,
    );
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
    const plannedRouteId =
      b.planned_route_id === undefined || b.planned_route_id === null
        ? null
        : Number(b.planned_route_id);
    const isPublic =
      b.is_public === true ||
      b.is_public === 1 ||
      b.is_public === "1"
        ? 1
        : 0;

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

      const publicUrl = `${R2_PUBLIC_BASE_URL}/${fileName}`;

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
      source,
      planned_route_id,
      is_public
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
          Number.isFinite(plannedRouteId) ? plannedRouteId : null,
          isPublic,
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

api.post("/ride_visibility/:id", protectAPI, async (c) => {
  try {
    const body = await c.req.json();
    const isPublic =
      body?.is_public === true ||
      body?.is_public === 1 ||
      body?.is_public === "1"
        ? 1
        : 0;
    const ride: any = await c.env.DB.prepare("SELECT id FROM rides WHERE id = ?")
      .bind(c.req.param("id"))
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan.",
        },
        404,
      );
    }

    await c.env.DB.prepare("UPDATE rides SET is_public = ? WHERE id = ?")
      .bind(isPublic, c.req.param("id"))
      .run();

    return c.json({
      success: true,
      id: Number(c.req.param("id")),
      is_public: isPublic,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal mengubah status publik aktivitas.",
      },
      500,
    );
  }
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
    const room = sanitizeRoomId(body["room"] as string);
    const user = body["user"] as string;
    const audioFile = body["audio"] as File;

    if (!room || room === "SINGLE_MODE" || !user || !audioFile) {
      return c.json(
        { success: false, message: "Data transmisi tidak lengkap" },
        400,
      );
    }

    // Generate nama file unik agar tidak bertabrakan
    const objectKey = `gaspool/audio/${room}/radio_${sanitizeRadioUser(user)}_${Date.now()}.webm`;

    // Konversi file suara menjadi ArrayBuffer untuk diunggah
    const arrayBuffer = await audioFile.arrayBuffer();

    // Tembakkan file suara ke Satelit R2
    await c.env.R2_BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType: audioFile.type || "audio/webm" },
    });

    // URL Publik file suara
    const publicUrl = `${R2_PUBLIC_BASE_URL}/${objectKey}`;

    // Catat link suara ke Radar KV agar teman di room bisa mendengarnya
    await c.env.GASPOOL_RADAR.put(
      `RADIO:${room}:${user}`,
      JSON.stringify({
        objectKey,
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

api.post("/radio_cleanup", protectAPI, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const room = sanitizeRoomId(body?.room);

    if (!room || room === "SINGLE_MODE") {
      return c.json({ success: true, deleted: 0 });
    }

    let deleted = 0;
    const prefixes = [`gaspool/audio/${room}/`, `radio_${room}_`];

    for (const prefix of prefixes) {
      let cursor: string | undefined;

      do {
        const listed: any = await c.env.R2_BUCKET.list({
          prefix,
          cursor,
        });

        for (const object of listed.objects || []) {
          await c.env.R2_BUCKET.delete(object.key);
          deleted++;
        }

        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    }

    const radioList = await c.env.GASPOOL_RADAR.list({
      prefix: `RADIO:${room}:`,
    });

    await Promise.all(
      radioList.keys.map((key) => c.env.GASPOOL_RADAR.delete(key.name)),
    );

    return c.json({ success: true, deleted });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal membersihkan audio peleton.",
      },
      500,
    );
  }
});

// 7. PUBLIC RIDES FETCH (single-owner public profile)
api.get("/public_rides/:username", async (c) => {
  const username = normalizePublicProfileSlug(c.req.param("username"));
  const publicProfileSlug = getPublicProfileSlug(c.env);
  const p = parseInt(c.req.query("page") || "1");
  const lim = 10;
  const off = (p - 1) * lim;

  if (username !== publicProfileSlug)
    return c.json({ error: "Public profile not found" }, 404);

  try {
    const { results: rides } = await c.env.DB.prepare(
      "SELECT * FROM rides WHERE is_public = 1 ORDER BY start_date DESC LIMIT ? OFFSET ?",
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
