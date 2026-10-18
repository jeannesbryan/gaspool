/**
 * Regression test for the Activity Doctor statistics.
 *
 * Why this test exists: `recalculateDoctorStats()` once reported an activity of
 * 29.366 km in 1:00:35 (29.1 km/h) while the real time span was 1:47:58:
 * moving time shrank by 47 minutes and average speed spiked with it. The cause
 * was not broken GPS, but two things inside its own algorithm:
 *
 *   1. `Math.floor((pointMs - prevMs) / 1000)` rounded every gap down.
 *      GPS points recorded closer than 1 second produced a 0 gap, so
 *      the distance was counted while the time was thrown away. In a real
 *      ride file, 2,756 of 5,959 segments (46%) had a 0 second gap and
 *      hid 45 minutes.
 *   2. Distance and time were taken from DIFFERENT sets of segments, then
 *      divided by each other. That is not a measurement, it is an arithmetic artefact.
 *
 * The fixtures here are synthetic and deterministic, so the test can run on any
 * CI without private files. The real GPX file is only tested when supplied via
 * env GASPOOL_REAL_GPX, deliberately not committed because it holds real GPS
 * coordinates while this repository is public.
 *
 *   node tests/activity-doctor.mjs
 *   GASPOOL_REAL_GPX=~/Downloads/Gaspool_Route.gpx node tests/activity-doctor.mjs
 *
 * Exit code 0 = all assertions passed.
 */
import { readFileSync } from "node:fs";
import {
  collectDoctorRestBlocks,
  compareDoctorMovingTime,
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

// 1 metre towards north; uses the same earth radius as getDistanceMeters
const METER_IN_DEG_LAT = 180 / (Math.PI * 6371000);
const START = { lat: -7.3685135, lng: 112.7113094 };
const BASE_MS = Date.parse("2026-09-18T11:53:05.461Z");

/** Repeat one step `count` times. */
const repeat = (count, step) => Array.from({ length: count }, () => ({ ...step }));

/**
 * Build a straight northbound track from a list of { seconds, speedKmh }.
 * `speedKmh: 0` = stopped; optionally GPS still wanders in place (bounded,
 * not a random walk) so it resembles the behaviour of a real device.
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
// Sampling closer than 1 second must NOT erase time.
// The first half is recorded once per second, the second half once per 0.5
// seconds, the same pattern as a real ride file (the browser sometimes provides
// extra samples). The rider moves at a constant 10 km/h for 40 minutes, no stop.
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
// A 30 minute rest has to COUNT as stopped time, not moving time.
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
// No second may go missing without an explanation. Every second has to become
// moving, stopped, or excluded (GPS jump).
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
// A GPS jump must still be dropped, and its time must be recorded as excluded.
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
// The rest blocks reported to the UI use the SAME clock as the main statistics.
// `moving_time` in these blocks is cumulative from the start of the activity, so
// it has to match `recalculateDoctorStats()` at the same point.
//
// Old regression: that value was summed with Math.floor(), so on a 2 Hz
// recording the whole 20 minutes of pedalling before the rest was recorded as 0
// seconds, and the screen read "waktu bergerak sebelum istirahat: 0:00:00".
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
// Fail-closed: if the recomputed moving time diverges far from D1, the doctor
// has to REFUSE to overwrite and hand the decision to a human.
//
// The numbers here come from a real incident: D1 1:41:29, the old doctor
// proposed 1:00:35. That 40% deviation used to PASS because the old threshold
// was 0.35x-1.35x, so ride history was rewritten with the wrong number.
const d1Seconds = 6089; // 1:41:29
const regressionSeconds = 3635; // 1:00:35 <- usulan doctor yang rusak

const regressionComparison = compareDoctorMovingTime(d1Seconds, regressionSeconds);
check(
  "fail-closed: usulan 40% lebih pendek ditolak",
  regressionComparison.withinTolerance === false &&
    regressionComparison.direction === "shorter",
  `withinTolerance=${regressionComparison.withinTolerance} direction=${regressionComparison.direction} ratio=${regressionComparison.ratio?.toFixed(2)}`,
);
check(
  "fail-closed: alasan penolakan menyebut arah dan ambangnya",
  /lebih pendek/.test(regressionComparison.message) &&
    /15%/.test(regressionComparison.message),
  regressionComparison.message,
);

// A repaired result is indeed close to D1, so it has to be accepted.
const fixedComparison = compareDoctorMovingTime(d1Seconds, 6253);
check(
  "fail-closed: usulan yang berdekatan dengan D1 diterima",
  fixedComparison.withinTolerance === true,
  `ratio=${fixedComparison.ratio?.toFixed(3)} (harap diterima)`,
);

// The opposite direction must be rejected too, with a message that names it.
const longerComparison = compareDoctorMovingTime(d1Seconds, d1Seconds * 1.6);
check(
  "fail-closed: usulan 60% lebih panjang juga ditolak",
  longerComparison.withinTolerance === false && longerComparison.direction === "longer",
  longerComparison.message,
);

// A D1 row that has no statistics yet is no reason to block the backfill.
const emptyComparison = compareDoctorMovingTime(0, 6253);
check(
  "fail-closed: D1 kosong tidak dianggap menyimpang",
  emptyComparison.ratio === null && emptyComparison.withinTolerance === true,
  `ratio=${emptyComparison.ratio} withinTolerance=${emptyComparison.withinTolerance}`,
);

// ---------------------------------------------------------------- fixture 7
// average_speed must always equal the reported distance / moving time.
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

// -------------------------------------------------- optional: real ride file
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

  // The threshold is 75%, not 90%.
  //
  // It used to be 90% and that was wrong as an INVARIANT: that number silently
  // assumed the sample ride almost never stops. As soon as the test file was
  // replaced with a ride that really stops (red light, rest), this assertion
  // failed while the doctor was correct, and a red test over healthy product
  // is exactly what makes people stop trusting the test.
  //
  // What is tested here is the severe shrinkage regression: the Math.floor bug
  // used to leave ~56% of the span. The real invariant (every second lands in
  // one of the buckets) is tested separately below through
  // unaccounted_seconds, so this ratio is only a second-layer guard.
  const movingRatio = span > 0 ? real.moving_time / span : 0;
  check(
    "gowes nyata: moving time tidak menyusut karena segmen tanpa waktu",
    real.moving_time > span * 0.75 && real.moving_time <= span,
    `moving_time=${fmtClock(real.moving_time)} dari span=${fmtClock(span)}` +
      ` (${(movingRatio * 100).toFixed(1)}%); regresi lama menyisakan ~56%`,
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
