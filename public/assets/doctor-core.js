/**
 * Activity Doctor arithmetic core: one segment table for every consumer.
 *
 * Why this file exists. The same arithmetic had been copied TWICE into
 * different places and then fixed in only one of them:
 *
 *   1. `Math.floor()` on the time difference. It was fixed in the server
 *      module, but its copy inside `detectDoctorRestBlocks` was left behind,
 *      so a 20 minute ride was reported as 0:00:00.
 *   2. The rule for "which triangle counts as moving". Finish Review used its
 *      own rule (drop impossible segments), the server used
 *      `buildDoctorSegments()`. The result was two different distances for
 *      the same ride: 18,741 km vs 18,506 km.
 *
 * That is why this file is the ONLY place that decides what "moving" means.
 * The tracker page loads it as a module, the server module imports it, and
 * tests/doctor-core.mjs tests it directly: one file, with no copy left that
 * can drift.
 *
 * Written as plain .js (not .ts) so the browser can load it without a build
 * and Node can import it without compilation, the same as live-clock.js.
 */

export const DOCTOR_LONG_GAP_SECONDS = 20 * 60;
export const DOCTOR_EXTREME_JUMP_METERS = 1500;

// How "stopped" is proven.
//
// The old way measured the gap between points, and that was wrong twice: GPS
// jitter never produces a long gap, while closely spaced samples always
// produce a gap of zero.
//
// The way used here: a point counts as part of a stop when there is a run of
// points spanning DOCTOR_STOP_MIN_SECONDS that all stay inside a certain
// radius of that point. It means "the person really stood still in one place",
// not "one segment happened to have a low speed".
//
// The radius comes from the auto-pause threshold so tracker and doctor share
// one definition of "moving": radius = threshold_kmh x duration. The floor
// absorbs GPS jitter from consumer devices (a few metres) on slow activities
// such as walking, and is deliberately conservative: when in doubt, count the
// time as moving (speed looks lower) rather than the other way around.
export const DOCTOR_STOP_MIN_SECONDS = 60;
export const DOCTOR_STOP_RADIUS_FLOOR_METERS = 25;

const degreesToRadians = (value) => (value * Math.PI) / 180;

export const getDistanceMeters = (from, to) => {
  const earthRadiusM = 6371000;
  const dLat = degreesToRadians(to.lat - from.lat);
  const dLng = degreesToRadians(to.lng - from.lng);
  const lat1 = degreesToRadians(from.lat);
  const lat2 = degreesToRadians(to.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusM * c;
};

/**
 * `movement_min_kmh` is deliberately set equal to `activityAutoPauseSpeedKmh()`
 * in src/routes/tracker.ts. If these two places ever disagree, the live tracker
 * and the doctor will also have two different definitions of "moving", exactly
 * the kind of mismatch that once made moving time shrink by 47 minutes.
 */
export const getDoctorSpeedLimits = (activityType) => {
  const type = String(activityType || "ride").toLowerCase();

  if (type === "ride") {
    return {
      calculation_max_kmh: 120,
      trusted_max_kmh: 65,
      suspicious_ratio: 1.75,
      movement_min_kmh: 2.0,
    };
  }

  if (type === "run") {
    return {
      calculation_max_kmh: 45,
      trusted_max_kmh: 32,
      suspicious_ratio: 1.65,
      movement_min_kmh: 1.4,
    };
  }

  if (type === "hike") {
    return {
      calculation_max_kmh: 25,
      trusted_max_kmh: 18,
      suspicious_ratio: 1.6,
      movement_min_kmh: 0.7,
    };
  }

  return {
    calculation_max_kmh: 25,
    trusted_max_kmh: 18,
    suspicious_ratio: 1.6,
    movement_min_kmh: 0.8,
  };
};

/**
 * Mark which points lie inside a stop.
 *
 * For every point `a`, find the furthest point `b` that is still within the
 * radius of point `a`. If the time span a..b reaches DOCTOR_STOP_MIN_SECONDS,
 * the whole range means "stood still in one place" and is marked as stopped.
 *
 * `b` only moves forward as `a` moves forward (because the distance constraint
 * keeps loosening), so the total is O(n): the same for a file of 100 points or
 * one of 100,000 points. Range marking is also kept O(n) by only marking the
 * part that has never been marked before.
 */
export const classifyDoctorPointStays = (
  points,
  cumTime,
  radiusMeters,
  minSeconds = DOCTOR_STOP_MIN_SECONDS,
) => {
  const total = points.length;
  const inStay = new Array(total).fill(false);
  if (total < 2 || radiusMeters <= 0 || minSeconds <= 0) return inStay;

  let furthest = 0;
  let markedUntil = -1;

  for (let a = 0; a < total; a++) {
    if (furthest < a) furthest = a;
    while (
      furthest + 1 < total &&
      getDistanceMeters(points[a], points[furthest + 1]) < radiusMeters
    ) {
      furthest += 1;
    }

    if (cumTime[furthest] - cumTime[a] < minSeconds) continue;

    const from = Math.max(a, markedUntil + 1);
    for (let k = from; k <= furthest; k++) inStay[k] = true;
    if (furthest > markedUntil) markedUntil = furthest;
  }

  return inStay;
};

/** Stop radius for one activity type (see the note above). */
export const getDoctorStopRadiusMeters = (movementMinKmh) =>
  Math.max(
    DOCTOR_STOP_RADIUS_FLOOR_METERS,
    (movementMinKmh / 3.6) * DOCTOR_STOP_MIN_SECONDS,
  );

/**
 * One segment table, used by EVERY calculation in this module.
 *
 * This is not just tidiness: distance and time must be summed over the SAME
 * SET OF SEGMENTS. The old version summed distance over all segments but time
 * over only some of them, then divided the two, which is an artefact, not a
 * measurement, and it made moving time shrink by 47 minutes.
 */
export const buildDoctorSegments = (points, activityType) => {
  const limits = getDoctorSpeedLimits(activityType);
  const count = Math.max(0, points.length - 1);

  const distanceM = new Array(count).fill(0);
  const seconds = new Array(count).fill(0);
  const gapSeconds = new Array(count).fill(0);
  const cumTime = new Array(count + 1).fill(0);

  for (let i = 1; i < points.length; i++) {
    const k = i - 1;
    const prev = points[i - 1];
    const point = points[i];

    distanceM[k] = getDistanceMeters(prev, point);

    const prevMs = prev.time ? Date.parse(prev.time) : 0;
    const pointMs = point.time ? Date.parse(point.time) : 0;

    // REAL time difference, not a rounded one. This is what used to get lost:
    // Math.floor() made recordings denser than 1 second contribute distance
    // but zero time, and 45 minutes vanished without a trace.
    const exactSeconds =
      Number.isFinite(prevMs) && Number.isFinite(pointMs) ? (pointMs - prevMs) / 1000 : 0;
    seconds[k] = exactSeconds > 0 ? exactSeconds : 0;

    // The rounded value still exists because anomaly thresholds are whole seconds.
    gapSeconds[k] = Math.floor(seconds[k]);
    cumTime[k + 1] = cumTime[k] + seconds[k];
  }

  const inStay = classifyDoctorPointStays(
    points,
    cumTime,
    getDoctorStopRadiusMeters(limits.movement_min_kmh),
  );

  const kind = new Array(count).fill("moving");

  for (let k = 0; k < count; k++) {
    // Order matters here: a GPS jump overrides everything, then a stop, and
    // only what is left is treated as moving.
    if (
      distanceM[k] >= DOCTOR_EXTREME_JUMP_METERS &&
      (!gapSeconds[k] || gapSeconds[k] < DOCTOR_LONG_GAP_SECONDS)
    ) {
      kind[k] = "jump";
    } else if (inStay[k] && inStay[k + 1]) {
      kind[k] = "stopped";
    }
  }

  return { count, distanceM, seconds, gapSeconds, cumTime, kind, inStay };
};

/**
 * Distance actually TRAVELLED, in metres.
 *
 * Only segments marked "moving" are counted. This is the number worth storing
 * as the activity distance.
 *
 * Why `jump` and `stopped` are not counted: on the 24 Sep ride, 298 metres
 * were thrown away from 59 segments spanning 570 seconds of standing still.
 * A GPS signal wandering while the bike is parked is not distance travelled by
 * anyone; storing it means recording a journey that never happened. `jump`
 * segments (>= 1.5 km) are GPS leaps, not movement.
 */
export const doctorMovingDistanceMeters = (points, activityType) => {
  const segments = buildDoctorSegments(points, activityType);
  let total = 0;
  for (let k = 0; k < segments.count; k++) {
    if (segments.kind[k] === "moving") total += segments.distanceM[k];
  }
  return total;
};

/**
 * Seconds considered MOVING, from the same segment table as the distance.
 *
 * Deliberately not used to overwrite the live clock automatically, see the
 * note in src/api/api.ts. The live clock is a direct measurement (it knows when
 * the rider really stopped, including when the GPS is unstable); this number is
 * a geometric inference, so its role is cross-checking.
 */
export const doctorMovingSeconds = (points, activityType) => {
  const segments = buildDoctorSegments(points, activityType);
  let total = 0;
  for (let k = 0; k < segments.count; k++) {
    if (segments.kind[k] === "moving") total += segments.seconds[k];
  }
  return total;
};
