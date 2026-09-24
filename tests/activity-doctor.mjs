/**
 * Regression test untuk statistik Activity Doctor.
 *
 * Kenapa test ini ada: `recalculateDoctorStats()` sempat melaporkan aktivitas
 * 29,366 km dalam 1:00:35 (29,1 km/h) padahal rentang waktu aslinya 1:47:58 —
 * moving time menyusut 47 menit dan average speed ikut melonjak. Penyebabnya
 * bukan GPS rusak, melainkan dua hal di dalam algoritmanya sendiri:
 *
 *   1. `Math.floor((pointMs - prevMs) / 1000)` membulatkan tiap jeda ke bawah.
 *      Titik GPS yang terekam lebih rapat dari 1 detik menghasilkan jeda 0,
 *      sehingga jaraknya ikut dihitung tetapi waktunya dibuang. Pada berkas
 *      gowes nyata, 2.756 dari 5.959 segmen (46%) punya jeda 0 detik dan
 *      menyembunyikan 45 menit.
 *   2. Jarak dan waktu diambil dari himpunan segmen yang BERBEDA, lalu dibagi
 *      satu sama lain. Itu bukan pengukuran, itu artefak aritmetika.
 *
 * Fixture di sini sintetis dan deterministik, jadi test bisa jalan di CI mana
 * pun tanpa berkas pribadi. Berkas GPX asli hanya diuji kalau disediakan lewat
 * env GASPOOL_REAL_GPX, sengaja tidak di-commit karena berisi koordinat GPS
 * asli sedangkan repo ini publik.
 *
 *   node tests/activity-doctor.mjs
 *   GASPOOL_REAL_GPX=~/Downloads/Gaspool_Route.gpx node tests/activity-doctor.mjs
 *
 * Exit code 0 = semua assertion lewat.
 */
import { readFileSync } from "node:fs";
import {
  collectDoctorRestBlocks,
  recalculateDoctorStats,
} from "../src/api/activity-doctor-stats.ts";

const results = [];

const check = (name, passed, detail = "") => {
  results.push({ name, passed: Boolean(passed), detail });
};

const near = (actual, expected, tolerance) =>
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;

const fmtClock = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// 1 meter ke arah utara; memakai radius bumi yang sama dengan getDistanceMeters
const METER_IN_DEG_LAT = 180 / (Math.PI * 6371000);
const START = { lat: -7.3685135, lng: 112.7113094 };
const BASE_MS = Date.parse("2026-09-18T11:53:05.461Z");

/** Ulangi satu langkah sebanyak `count` kali. */
const repeat = (count, step) => Array.from({ length: count }, () => ({ ...step }));

/**
 * Bangun track lurus ke utara dari daftar { seconds, speedKmh }.
 * `speedKmh: 0` = berhenti; opsional GPS tetap bergoyang di tempat (bounded,
 * bukan random-walk) supaya mirip perilaku alat nyata.
 */
const buildTrack = (steps, { jitterMeters = 0 } = {}) => {
  const points = [{ lat: START.lat, lng: START.lng, time: new Date(BASE_MS).toISOString() }];
  let lat = START.lat;
  let lng = START.lng;
  let anchorLat = lat;
  let anchorLng = lng;
  let elapsed = 0;

  steps.forEach((step, index) => {
    const stopped = Number(step.speedKmh) === 0;

    if (stopped && jitterMeters > 0) {
      const jLat = (((index * 37) % 7) - 3) * jitterMeters * METER_IN_DEG_LAT;
      const jLng = (((index * 53) % 7) - 3) * jitterMeters * METER_IN_DEG_LAT;
      elapsed += Number(step.seconds);
      points.push({
        lat: anchorLat + jLat,
        lng: anchorLng + jLng,
        time: new Date(BASE_MS + elapsed * 1000).toISOString(),
      });
      return;
    }

    lat += (Number(step.speedKmh) / 3.6) * Number(step.seconds) * METER_IN_DEG_LAT;
    anchorLat = lat;
    anchorLng = lng;
    elapsed += Number(step.seconds);
    points.push({ lat, lng, time: new Date(BASE_MS + elapsed * 1000).toISOString() });
  });

  return points;
};

// ---------------------------------------------------------------- fixture 1
// Sampling lebih rapat dari 1 detik TIDAK boleh menghapus waktu.
// Paruh pertama direkam 1 detik sekali, paruh kedua 0,5 detik sekali — pola yang
// sama dengan berkas gowes nyata (browser kadang memberi sampel ekstra).
// Pesepeda melaju konstan 10 km/h selama 40 menit tanpa berhenti.
const fixtureDense = buildTrack([
  ...repeat(1200, { seconds: 1, speedKmh: 10 }), // 20 menit
  ...repeat(2400, { seconds: 0.5, speedKmh: 10 }), // 20 menit, sampel 2 Hz
]);

const denseStats = recalculateDoctorStats(fixtureDense, "ride");
check(
  "sampling rapat: moving time mengikuti waktu nyata",
  near(denseStats.moving_time, 2400, 60),
  `moving_time=${fmtClock(denseStats.moving_time)} (harap ~0:40:00; regresi lama memberi 0:20:00)`,
);
check(
  "sampling rapat: average speed tidak digelembungkan",
  near(denseStats.average_speed, 10, 0.5),
  `average_speed=${denseStats.average_speed} km/h (harap ~10; regresi lama memberi 20)`,
);

// ---------------------------------------------------------------- fixture 2
// Istirahat 30 menit harus MASUK waktu berhenti, bukan waktu bergerak.
const fixtureRest = buildTrack(
  [
    ...repeat(1200, { seconds: 1, speedKmh: 15 }), // 20 menit gowes -> 5 km
    ...repeat(1800, { seconds: 1, speedKmh: 0 }), // 30 menit istirahat
    ...repeat(1200, { seconds: 1, speedKmh: 15 }), // 20 menit gowes -> 5 km
  ],
  { jitterMeters: 3 },
);

const restStats = recalculateDoctorStats(fixtureRest, "ride");
check(
  "istirahat 30 menit tidak dihitung sebagai bergerak",
  near(restStats.moving_time, 2400, 120),
  `moving_time=${fmtClock(restStats.moving_time)} (harap ~0:40:00, bukan 1:10:00)`,
);
check(
  "istirahat 30 menit tercatat sebagai stopped_time",
  near(restStats.stopped_time, 1800, 120),
  `stopped_time=${fmtClock(restStats.stopped_time)} (harap ~0:30:00)`,
);
check(
  "jitter GPS saat berhenti tidak menambah jarak",
  near(restStats.distance_km, 10, 0.3),
  `distance_km=${restStats.distance_km} (harap ~10)`,
);
check(
  "istirahat: average speed tetap wajar",
  near(restStats.average_speed, 15, 1),
  `average_speed=${restStats.average_speed} km/h (harap ~15)`,
);

// ---------------------------------------------------------------- fixture 3
// Tidak boleh ada detik yang hilang tanpa penjelasan. Setiap detik harus jadi
// moving, stopped, atau excluded (lompatan GPS).
for (const [label, stats] of [
  ["sampling rapat", denseStats],
  ["istirahat", restStats],
]) {
  const span = stats.time_integrity?.span_seconds ?? 0;
  const unaccounted = Number(stats.unaccounted_seconds);
  check(
    `${label}: semua detik terjelaskan (tidak ada kehilangan senyap)`,
    Number.isFinite(unaccounted) && unaccounted <= 5,
    `span=${fmtClock(span)} moving=${fmtClock(stats.moving_time)} stopped=${fmtClock(stats.stopped_time)} excluded=${fmtClock(stats.excluded_jump_seconds)} unaccounted=${stats.unaccounted_seconds}`,
  );
}

// ---------------------------------------------------------------- fixture 4
// Lompatan GPS harus tetap dibuang, dan waktunya ikut dicatat sebagai excluded.
const jumpTrack = [
  { lat: START.lat, lng: START.lng, time: "2026-09-18T11:00:00.000Z" },
  { lat: START.lat + 100 * METER_IN_DEG_LAT, lng: START.lng, time: "2026-09-18T11:00:10.000Z" },
  { lat: START.lat + 5100 * METER_IN_DEG_LAT, lng: START.lng, time: "2026-09-18T11:00:11.000Z" },
  { lat: START.lat + 5200 * METER_IN_DEG_LAT, lng: START.lng, time: "2026-09-18T11:00:21.000Z" },
];

const jumpStats = recalculateDoctorStats(jumpTrack, "ride");
check(
  "lompatan GPS 5 km tetap dibuang dari jarak",
  near(jumpStats.distance_km, 0.2, 0.05),
  `distance_km=${jumpStats.distance_km} (harap ~0.2)`,
);
check(
  "lompatan GPS tetap dilaporkan",
  jumpStats.skipped_jump_count === 1,
  `skipped_jump_count=${jumpStats.skipped_jump_count}`,
);
check(
  "lompatan GPS: waktunya ikut dihitung sebagai excluded, bukan hilang",
  near(jumpStats.excluded_jump_seconds, 1, 0.01) && Number(jumpStats.unaccounted_seconds) <= 5,
  `excluded_jump_seconds=${jumpStats.excluded_jump_seconds} unaccounted=${jumpStats.unaccounted_seconds}`,
);

// ---------------------------------------------------------------- fixture 5
// Blok istirahat yang dilaporkan ke UI memakai jam yang SAMA dengan statistik
// utama. `moving_time` di blok ini kumulatif sejak awal aktivitas, jadi ia harus
// cocok dengan `recalculateDoctorStats()` pada titik yang sama.
//
// Regresi lama: nilai itu dijumlahkan dengan Math.floor(), sehingga pada
// perekaman 2 Hz seluruh 20 menit kayuhan sebelum istirahat tercatat sebagai 0
// detik — di layar tertulis "waktu bergerak sebelum istirahat: 0:00:00".
const fixtureRestDense = buildTrack([
  ...repeat(2400, { seconds: 0.5, speedKmh: 15 }), // 20 menit gowes, 2 Hz -> 5 km
  { seconds: 30 * 60, speedKmh: 0 }, // istirahat 30 menit
  ...repeat(2400, { seconds: 0.5, speedKmh: 15 }), // 20 menit gowes -> 5 km lagi
]);

const restDenseBlocks = collectDoctorRestBlocks(fixtureRestDense, "ride");
check(
  "rest block: istirahat 30 menit terdeteksi",
  restDenseBlocks.length === 1 && near(restDenseBlocks[0].duration_s, 1800, 5),
  `blocks=${restDenseBlocks.length}${
    restDenseBlocks[0] ? ` duration_s=${restDenseBlocks[0].duration_s}` : ""
  }`,
);
check(
  "rest block: moving_time kumulatif memakai waktu nyata",
  restDenseBlocks.length === 1 && near(restDenseBlocks[0].moving_time, 1200, 60),
  restDenseBlocks.length
    ? `moving_time=${fmtClock(restDenseBlocks[0].moving_time)} (harap ~0:20:00; regresi lama memberi 0:00:00)`
    : "tidak ada blok untuk diperiksa",
);
check(
  "rest block: jarak kumulatif cocok dengan statistik utama",
  restDenseBlocks.length === 1 && near(restDenseBlocks[0].distance_km, 5, 0.3),
  restDenseBlocks.length
    ? `distance_km=${restDenseBlocks[0].distance_km} (harap ~5)`
    : "tidak ada blok untuk diperiksa",
);

// ---------------------------------------------------------------- fixture 6
// average_speed harus selalu sama dengan jarak / moving time yang dilaporkan.
for (const [label, stats] of [
  ["sampling rapat", denseStats],
  ["istirahat", restStats],
  ["lompatan", jumpStats],
]) {
  const expected =
    stats.moving_time > 0 ? stats.distance_km / (stats.moving_time / 3600) : 0;
  check(
    `${label}: average_speed konsisten dengan jarak/moving time`,
    near(stats.average_speed, expected, 0.05),
    `average_speed=${stats.average_speed} vs hitung ulang=${expected.toFixed(2)}`,
  );
}

// ------------------------------------------------- opsional: berkas gowes nyata
const realPath = process.env.GASPOOL_REAL_GPX;
if (realPath) {
  const raw = readFileSync(realPath, "utf8");
  const points = [];
  const re = /<trkpt lat="([-0-9.]+)" lon="([-0-9.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const time = /<time>([^<]+)<\/time>/.exec(match[3])?.[1];
    const ele = /<ele>([-0-9.eE]+)<\/ele>/.exec(match[3])?.[1];
    points.push({
      lat: Number(match[1]),
      lng: Number(match[2]),
      time: time || undefined,
      ele: ele === undefined ? undefined : Number(ele),
    });
  }

  const real = recalculateDoctorStats(points, "ride");
  const span = real.time_integrity.span_seconds;

  check(
    "gowes nyata: moving time dekat dengan waktu tempuh sebenarnya",
    real.moving_time > span * 0.9 && real.moving_time <= span,
    `moving_time=${fmtClock(real.moving_time)} dari span=${fmtClock(span)}; regresi lama 1:00:35`,
  );
  check(
    "gowes nyata: average speed wajar untuk pesepeda rekreasi",
    real.average_speed > 12 && real.average_speed < 22,
    `average_speed=${real.average_speed} km/h; regresi lama 29,08`,
  );
  check(
    "gowes nyata: tidak ada detik hilang tanpa penjelasan",
    Number(real.unaccounted_seconds) <= 5,
    `unaccounted=${real.unaccounted_seconds} s`,
  );
}

// ------------------------------------------------------------------- laporan
let failed = 0;
for (const item of results) {
  if (!item.passed) failed += 1;
  console.log(`${item.passed ? "  ok  " : " FAIL "} ${item.name}`);
  if (item.detail) console.log(`         ${item.detail}`);
}

console.log(
  `\nactivity-doctor: ${results.length - failed}/${results.length} assertion lewat${failed ? ` — ${failed} GAGAL` : ""}`,
);

process.exit(failed === 0 ? 0 : 1);
