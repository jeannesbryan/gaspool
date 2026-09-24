/**
 * Test untuk jejak radar.
 *
 * Kenapa ada: jejak ini disimpan di dalam nilai KV milik peserta dan dikirim ke
 * halaman penonton, jadi kesalahan di sini terlihat langsung oleh orang lain —
 * polyline yang menyeberang laut karena koordinat rusak, atau jejak yang tumbuh
 * tanpa batas sampai nilai KV membengkak.
 *
 *   node tests/radar-trail.mjs
 *
 * Exit code 0 = semua assertion lewat.
 */
import {
  appendRadarTrailPoint,
  normalizeRadarTrail,
  radarDistanceMeters,
  RADAR_TRAIL_MAX_POINTS,
  RADAR_TRAIL_MIN_METERS,
} from "../src/api/radar-trail.ts";

const results = [];
const check = (name, passed, detail = "") => results.push({ name, passed: Boolean(passed), detail });
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

const METER_IN_DEG_LAT = 180 / (Math.PI * 6371000);
const BASE = { lat: -7.3685135, lng: 112.7113094 };
const at = (meters, t) => ({ lat: BASE.lat + meters * METER_IN_DEG_LAT, lng: BASE.lng, t });

// ------------------------------------------------------------- jarak
{
  check(
    "jarak antara dua titik dihitung wajar",
    near(radarDistanceMeters(BASE, at(1000)), 1000, 5),
    `terukur=${radarDistanceMeters(BASE, at(1000)).toFixed(1)} m`,
  );
  check(
    "titik yang sama berjarak nol",
    near(radarDistanceMeters(BASE, BASE), 0, 0.001),
    `jarak=${radarDistanceMeters(BASE, BASE)}`,
  );
}

// ------------------------------------------------------- pembentukan jejak
{
  let trail = appendRadarTrailPoint([], at(0, 1000));
  check("jejak pertama terbentuk dari kosong", trail.length === 1, JSON.stringify(trail));

  trail = appendRadarTrailPoint(trail, at(100, 2000));
  trail = appendRadarTrailPoint(trail, at(200, 3000));
  check(
    "titik yang cukup jauh ditambahkan ke jejak",
    trail.length === 3 && near(trail[2].lat, at(200, 0).lat, 1e-9),
    `${trail.length} titik`,
  );
}

// ------------------------------------------------- diam tidak memanjangkan
{
  let trail = appendRadarTrailPoint([], at(0, 1000));
  trail = appendRadarTrailPoint(trail, at(3, 2000)); // hanya bergoyang 3 m
  trail = appendRadarTrailPoint(trail, at(5, 3000));

  check(
    "goyangan GPS di tempat tidak menambah panjang jejak",
    trail.length === 1,
    `${trail.length} titik (harap 1)`,
  );
  check(
    "posisi terakhir tetap diperbarui walau tidak menambah titik",
    near(trail[0].lat, at(5, 0).lat, 1e-9) && trail[0].t === 3000,
    JSON.stringify(trail),
  );
}

// ------------------------------------------------------------ batas panjang
{
  let trail = [];
  for (let i = 0; i < RADAR_TRAIL_MAX_POINTS + 40; i++) {
    trail = appendRadarTrailPoint(trail, at(i * 30, 1000 + i * 15000));
  }

  check(
    "panjang jejak dibatasi",
    trail.length === RADAR_TRAIL_MAX_POINTS,
    `${trail.length} titik (batas ${RADAR_TRAIL_MAX_POINTS})`,
  );
  check(
    "yang dibuang adalah titik paling lama, bukan yang terbaru",
    near(trail[trail.length - 1].lat, at((RADAR_TRAIL_MAX_POINTS + 39) * 30, 0).lat, 1e-9),
    "titik terakhir bukan posisi terkini",
  );
}

// ------------------------------------------- nilai rusak tidak merusak peta
{
  const dirty = [
    null,
    undefined,
    "bukan array",
    { lat: 1 },
    [null, 42, "x"],
    [{ lat: "abc", lng: 112 }, { lat: NaN, lng: 112 }],
    [{ lat: 999, lng: 999 }, { lat: -7.3, lng: 112.7, t: 5 }],
  ];

  const safe = dirty.every((value) => {
    const trail = normalizeRadarTrail(value);
    return Array.isArray(trail) && trail.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  });

  check(
    "nilai jejak yang rusak tidak menghasilkan koordinat tidak sah",
    safe,
    "ada koordinat tidak sah yang lolos, polyline bisa menyeberang peta",
  );

  check(
    "jejak yang entah bagaimana kepanjangan dipangkas saat dibaca",
    normalizeRadarTrail(Array.from({ length: 500 }, (_, i) => at(i * 30, i))).length ===
      RADAR_TRAIL_MAX_POINTS,
    "batas tidak diterapkan pada data lama",
  );
}

// ------------------------------------------- masukan rusak dari klien
{
  const trail = appendRadarTrailPoint([], { lat: "bukan angka", lng: null });
  check("titik baru yang tidak sah diabaikan", trail.length === 0, JSON.stringify(trail));

  const kept = appendRadarTrailPoint([at(0, 1)], { lat: -999, lng: 500 });
  check(
    "titik di luar jangkauan Bumi tidak masuk jejak",
    kept.length === 1 && near(kept[0].lat, at(0, 0).lat, 1e-9),
    JSON.stringify(kept),
  );

  const noTime = appendRadarTrailPoint([], { lat: BASE.lat, lng: BASE.lng });
  check(
    "titik tanpa timestamp tetap dicatat",
    noTime.length === 1 && noTime[0].t > 0,
    JSON.stringify(noTime),
  );
}

// ---------------------------------------------------------------- laporan
let failed = 0;
for (const item of results) {
  if (!item.passed) failed += 1;
  console.log(`${item.passed ? "  ok  " : " FAIL "} ${item.name}`);
  if (item.detail) console.log(`         ${item.detail}`);
}

console.log(
  `\nradar-trail: ${results.length - failed}/${results.length} assertion lewat${failed ? ` — ${failed} GAGAL` : ""}`,
);

process.exit(failed === 0 ? 0 : 1);
