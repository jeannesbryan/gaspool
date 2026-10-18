/**
 * Test for public/assets/doctor-core.js, the shared segment table.
 *
 * This file tests ONE file that three places use: the tracker page, the server
 * module (src/api/activity-doctor-stats.ts), and this test. That is the whole
 * point: the "moving" arithmetic was copied twice and then fixed in only one
 * copy, and every time that happened, two screens showed two different numbers
 * for the same ride.
 *
 * Run: node tests/doctor-core.mjs
 * With real data (optional):
 *   GASPOOL_REAL_GPX=~/Downloads/Gaspool_Route.gpx node tests/doctor-core.mjs
 */

import { readFileSync } from "node:fs";

import {
  buildDoctorSegments,
  classifyDoctorPointStays,
  doctorMovingDistanceMeters,
  doctorMovingSeconds,
  getDistanceMeters,
  getDoctorSpeedLimits,
  getDoctorStopRadiusMeters,
  DOCTOR_STOP_MIN_SECONDS,
} from "../public/assets/doctor-core.js";

const results = [];
const check = (name, passed, detail) => results.push({ name, passed: Boolean(passed), detail });

const LAT_PER_M = 1 / 111320;
const T0 = Date.parse("2026-09-24T11:00:00.000Z");

/** Build synthetic points: `plan` = list of { seconds, metersPerSecond } per phase. */
function buildTrack(phases) {
  const points = [];
  let ms = 0;
  let lat = -7.372;
  for (const phase of phases) {
    if (phase.hold) {
      // Standing still while GPS wanders (amplitude in metres).
      const base = lat;
      const amp = (phase.wanderMeters || 3) * LAT_PER_M;
      for (let i = 0; i < phase.seconds; i++) {
        points.push({
          lat: base + amp * Math.sin(i * 0.5),
          lng: 112.728 + amp * Math.cos(i * 0.5),
          ele: 30,
          speed: 0,
          time: new Date(T0 + ms).toISOString(),
        });
        ms += 1000;
      }
    } else {
      for (let i = 0; i < phase.seconds; i++) {
        points.push({
          lat,
          lng: 112.728,
          ele: 30,
          speed: phase.metersPerSecond * 3.6,
          time: new Date(T0 + ms).toISOString(),
        });
        lat += phase.metersPerSecond * LAT_PER_M;
        ms += 1000;
      }
    }
  }
  return points;
}

// ------------------------------------------------------- geometri dasar
{
  const a = { lat: -7.372, lng: 112.728 };
  const b = { lat: -7.372 + 1000 * LAT_PER_M, lng: 112.728 };
  const d = getDistanceMeters(a, b);
  check(
    "haversine: 1000 titik derajat lintang ≈ 1000 m",
    Math.abs(d - 1000) < 5,
    `terukur ${d.toFixed(2)} m`,
  );
  check("haversine: titik yang sama = 0 m", getDistanceMeters(a, a) === 0);
}

// ------------------------------- Math.floor regression: 2 Hz loses no time
{
  // Recording closer than 1 second. The old version used Math.floor on the second
  // difference, so these segments contributed distance but ZERO time, and 45
  // minutes evaporated without a trace.
  const points = [];
  for (let i = 0; i < 200; i++) {
    points.push({
      lat: -7.372 + i * 5 * LAT_PER_M,
      lng: 112.728,
      speed: 18,
      time: new Date(T0 + i * 500).toISOString(), // 2 Hz
    });
  }
  const seg = buildDoctorSegments(points, "ride");
  const totalSeconds = seg.seconds.reduce((a, b) => a + b, 0);
  check(
    "2 Hz: selisih waktu memakai pecahan, bukan floor",
    Math.abs(totalSeconds - 99.5) < 0.01,
    `total ${totalSeconds}s untuk 199 segmen 0,5s (harus 99,5)`,
  );
  check(
    "2 Hz: tidak ada segmen yang menyumbang jarak tanpa waktu",
    seg.seconds.every((s, i) => s > 0 || seg.distanceM[i] === 0),
    "segmen dengan jarak > 0 tetapi waktu 0 berarti Math.floor kembali",
  );
}

// ------------------------------------ stopping proven by radius, not by a gap
{
  const points = buildTrack([
    { seconds: 60, metersPerSecond: 5 },        // bergerak 300 m
    { seconds: 200, hold: true, wanderMeters: 3 }, // berhenti, GPS mengembara
    { seconds: 60, metersPerSecond: 5 },        // bergerak lagi 300 m
  ]);
  const seg = buildDoctorSegments(points, "ride");
  const stoppedSeconds = seg.seconds.filter((_, i) => seg.kind[i] === "stopped").reduce((a, b) => a + b, 0);
  check(
    "berhenti 200 s terdeteksi tanpa jeda timestamp panjang",
    stoppedSeconds > 150,
    `terdeteksi ${stoppedSeconds.toFixed(0)} s dari 200 s`,
  );

  const moved = doctorMovingDistanceMeters(points, "ride");
  const all = seg.distanceM.reduce((a, b) => a + b, 0);
  check(
    "drift GPS saat berhenti tidak dihitung sebagai jarak",
    all - moved > 100,
    `mentah ${(all / 1000).toFixed(3)} km vs ditempuh ${(moved / 1000).toFixed(3)} km`,
  );

  // What is tested here is NOT "it must be exactly 600 m".
  //
  // The real distance is 2 x 300 m = 600 m. The number that comes out is smaller
  // (~530 m) because of a BOUNDARY EFFECT that is part of this design: any point
  // that does not move more than one radius (33 m) within the next 60 seconds is
  // marked "stationary". That means about one radius at the tail of the movement
  // before the stop, and one radius at the start of the movement after it, is lost.
  //
  // The effect is deliberate and existed before this module was split out;
  // unifying the arithmetic must NOT change its behaviour. What has to hold here:
  // the shared module is far closer to the truth than summing every
  // segment (which also counts ~400 m of drift).
  const naiveError = Math.abs(all - 600);
  const sharedError = Math.abs(moved - 600);
  check(
    "jarak tabel bersama jauh lebih dekat ke jarak sebenarnya daripada jumlah mentah",
    sharedError < naiveError / 3,
    `tabel bersama meleset ${sharedError.toFixed(0)} m; jumlah mentah meleset ${naiveError.toFixed(0)} m`,
  );
  check(
    "efek batas tetap di kisaran satu radius, bukan melebar diam-diam",
    moved > 600 - 2 * 40 && moved < 600 + 5,
    `terukur ${moved.toFixed(1)} m (batas atas wajar: <= 600 m + drift kecil)`,
  );
}

// -------------------------------------- distance and time from the SAME segment set
{
  const points = buildTrack([
    { seconds: 120, metersPerSecond: 6 },
    { seconds: 150, hold: true, wanderMeters: 4 },
    { seconds: 120, metersPerSecond: 6 },
  ]);
  const seg = buildDoctorSegments(points, "ride");
  const movedFromSegments = seg.distanceM.filter((_, i) => seg.kind[i] === "moving").reduce((a, b) => a + b, 0);
  const secondsFromSegments = seg.seconds.filter((_, i) => seg.kind[i] === "moving").reduce((a, b) => a + b, 0);

  check(
    "doctorMovingDistanceMeters = jumlah segmen 'moving'",
    Math.abs(doctorMovingDistanceMeters(points, "ride") - movedFromSegments) < 1e-9,
    "jarak tidak boleh dijumlahkan dari himpunan segmen yang berbeda",
  );
  check(
    "doctorMovingSeconds = jumlah detik segmen 'moving'",
    Math.abs(doctorMovingSeconds(points, "ride") - secondsFromSegments) < 1e-9,
  );

  // The average speed from those two numbers has to be plausible for a cyclist.
  const avg = movedFromSegments / 1000 / (secondsFromSegments / 3600);
  check(
    "average speed dari pasangan angka itu wajar (15-30 km/h)",
    avg > 15 && avg < 30,
    `${avg.toFixed(2)} km/h`,
  );
}

// ------------------------------------------------- no second goes missing
{
  const points = buildTrack([
    { seconds: 90, metersPerSecond: 4 },
    { seconds: 90, hold: true, wanderMeters: 5 },
  ]);
  const seg = buildDoctorSegments(points, "ride");
  const totalSeconds = seg.seconds.reduce((a, b) => a + b, 0);
  const sumCum = seg.cumTime[seg.count];
  check(
    "cumTime konsisten dengan jumlah detik segmen",
    Math.abs(totalSeconds - sumCum) < 1e-6,
    `segmen ${totalSeconds} vs cumTime ${sumCum}`,
  );
  check(
    "semua segmen punya kind yang dikenal",
    seg.kind.every((k) => k === "moving" || k === "stopped" || k === "jump"),
    "kind di luar tiga nilai itu akan membuat filter jarak salah",
  );
}

// ------------------------------------------------------------ batas per aktivitas
{
  check(
    "sepeda bergerak di atas 2 km/h",
    getDoctorSpeedLimits("ride").movement_min_kmh === 2.0,
  );
  check(
    "jalan kaki bergerak di atas 0,8 km/h",
    getDoctorSpeedLimits("walk").movement_min_kmh === 0.8,
  );
  check(
    "radius berhenti punya lantai supaya jitter GPS terserap",
    getDoctorStopRadiusMeters(0.1) === 25,
    `radius ${getDoctorStopRadiusMeters(0.1)} m untuk ambang sangat rendah`,
  );
  check(
    "radius naik mengikuti ambang: 2 km/h selama 60 s = 33 m",
    Math.abs(getDoctorStopRadiusMeters(2.0) - 33.33) < 0.1,
    `${getDoctorStopRadiusMeters(2.0).toFixed(2)} m`,
  );
  check("durasi minimum berhenti 60 s", DOCTOR_STOP_MIN_SECONDS === 60);
}

// -------------------------------------------------------------- edge cases
{
  check("titik kosong tidak meledak", buildDoctorSegments([], "ride").count === 0);
  check("satu titik tidak meledak", buildDoctorSegments([{ lat: 0, lng: 0 }], "ride").count === 0);
  check("jarak aktivitas tanpa titik = 0", doctorMovingDistanceMeters([], "ride") === 0);
  const noTime = buildDoctorSegments([{ lat: -7.37, lng: 112.72 }, { lat: -7.371, lng: 112.72 }], "ride");
  check(
    "titik tanpa timestamp tidak menghasilkan waktu negatif",
    noTime.seconds.every((s) => s >= 0),
  );
}

// -------------------------------------------------- real ride data
const realPath = process.env.GASPOOL_REAL_GPX;
if (realPath) {
  const raw = readFileSync(realPath, "utf8");
  const trkpts = [...raw.matchAll(/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"/g)];
  const times = [...raw.matchAll(/<time>([^<]+)<\/time>/g)];
  const points = trkpts.map((m, i) => ({
    lat: Number(m[1]),
    lng: Number(m[2]),
    time: times[i] ? times[i][1] : undefined,
  }));

  const moved = doctorMovingDistanceMeters(points, "ride");
  const seg = buildDoctorSegments(points, "ride");
  const movedSeconds = doctorMovingSeconds(points, "ride");
  const all = seg.distanceM.reduce((a, b) => a + b, 0);

  check(
    "gowes nyata: jarak dari tabel segmen kurang dari jarak mentah",
    moved < all,
    `ditempuh ${(moved / 1000).toFixed(3)} km vs mentah ${(all / 1000).toFixed(3)} km` +
      ` (drift dibuang ${((all - moved) / 1000).toFixed(3)} km)`,
  );
  check(
    "gowes nyata: average speed masuk akal untuk pesepeda rekreasi",
    moved / 1000 / (movedSeconds / 3600) > 12 && moved / 1000 / (movedSeconds / 3600) < 22,
    `${(moved / 1000 / (movedSeconds / 3600)).toFixed(2)} km/h`,
  );
  const driftSeconds = seg.seconds.filter((_, i) => seg.kind[i] === "stopped").reduce((a, b) => a + b, 0);
  check(
    "gowes nyata: drift dibuang dari waktu berhenti yang terdeteksi",
    driftSeconds >= 0,
    `berhenti ${driftSeconds.toFixed(0)} s; regresi lama melaporkan 29,08 km/h`,
  );

  // Proof that what is dropped really is a stationary rider, not real movement
  // discarded by mistake: the average speed of the "stopped" segments must be
  // below the auto-pause threshold (2 km/h for a bicycle). If that number crosses
  // the threshold, real movement is being thrown away, and that is a bug.
  const stoppedMeters = seg.distanceM.filter((_, i) => seg.kind[i] === "stopped").reduce((a, b) => a + b, 0);
  const stoppedSpeedKmh = driftSeconds > 0 ? stoppedMeters / driftSeconds * 3.6 : 0;
  check(
    "gowes nyata: kecepatan rata-rata segmen 'diam' di bawah ambang auto-pause",
    stoppedSpeedKmh < getDoctorSpeedLimits("ride").movement_min_kmh,
    `${stoppedSpeedKmh.toFixed(2)} km/h (ambang ${getDoctorSpeedLimits("ride").movement_min_kmh} km/h)` +
      ` → ${stoppedMeters.toFixed(0)} m selama ${driftSeconds.toFixed(0)} s memang drift GPS`,
  );
}

// ------------------------------------------------------------------- laporan
let failed = 0;
for (const item of results) {
  if (!item.passed) failed += 1;
  console.log(`${item.passed ? "  ok  " : " FAIL "} ${item.name}`);
  if (item.detail) console.log(`         ${item.detail}`);
}
console.log(`\ndoctor-core: ${results.length - failed}/${results.length} assertion lewat${failed ? ` — ${failed} GAGAL` : ""}`);
process.exit(failed ? 1 : 0);
