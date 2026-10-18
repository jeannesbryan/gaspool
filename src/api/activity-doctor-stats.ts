/**
 * Activity Doctor statistics: a pure module with no runtime dependencies.
 *
 * Why this module is split out of src/api/api.ts:
 * the numbers that leave this file (distance, moving time, average speed) are
 * used to REWRITE someone's ride history. Numbers like that must be
 * deterministic and testable without booting a Worker, D1 or R2. This module
 * deliberately imports nothing so tests can load it directly through Node's
 * TypeScript type stripping (see tests/activity-doctor.mjs).
 *
 * The types here are this module's own structural contract, not a copy of
 * api.ts's types: api.ts may have richer types (for example
 * `RoutePoint & {...}`) as long as their shape matches what is here.
 *
 * RULES THAT APPLY (all of them were broken once, see tests/activity-doctor.mjs):
 *
 *   1. One set of segments. Distance and time MUST be summed from the same
 *      segments. The old version summed distance from every segment but time
 *      from only some of them: an artefact, not a measurement.
 *   2. Time uses real differences (fractional seconds), not rounded ones.
 *      The old version used Math.floor(), so points recorded closer together
 *      than 1 second contributed distance but zero time.
 *   3. "Moving" is defined the same way as auto-pause in the tracker: NET
 *      displacement inside the time window, not the speed of one segment.
 *      One segment's speed is too noisy on dense samples and too blunt on
 *      sparse ones.
 *   4. No second may disappear without an explanation. Every second inside
 *      the activity span must show up as moving_time, stopped_time or
 *      excluded_jump_seconds; the remainder is reported as
 *      unaccounted_seconds so it can be rejected, not hidden.
 */

import {
  buildDoctorSegments as buildDoctorSegmentsImpl,
  classifyDoctorPointStays,
  DOCTOR_EXTREME_JUMP_METERS,
  DOCTOR_LONG_GAP_SECONDS,
  DOCTOR_STOP_MIN_SECONDS,
  DOCTOR_STOP_RADIUS_FLOOR_METERS,
  doctorMovingDistanceMeters,
  doctorMovingSeconds,
  getDistanceMeters,
  getDoctorSpeedLimits,
  getDoctorStopRadiusMeters,
} from "../../public/assets/doctor-core.js";

// The core arithmetic is NOT defined here any more. It lives in
// public/assets/doctor-core.js so the tracker page, this module and the tests
// all use ONE segment table. The symbols below are re-exported as they are so
// existing callers (api.ts, tests/activity-doctor.mjs) do not need changes.
export {
  classifyDoctorPointStays,
  DOCTOR_EXTREME_JUMP_METERS,
  DOCTOR_LONG_GAP_SECONDS,
  DOCTOR_STOP_MIN_SECONDS,
  DOCTOR_STOP_RADIUS_FLOOR_METERS,
  doctorMovingDistanceMeters,
  doctorMovingSeconds,
  getDistanceMeters,
  getDoctorSpeedLimits,
  getDoctorStopRadiusMeters,
};

export type DoctorStatPoint = {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
  speed?: number;
  _source_index?: number;
};

export type DoctorSeverity = "info" | "warning" | "danger";

export type DoctorAnomalyCode =
  | "extreme_jump"
  | "suspicious_speed"
  | "elevation_spike"
  | "long_gap"
  | "time_reversal"
  | "duplicate_timestamp"
  | "invalid_timestamp";

export type DoctorAnomaly = {
  code: DoctorAnomalyCode;
  severity: DoctorSeverity;
  segment_index: number;
  point_index: number;
  source_index: number;
  at: string;
  lat: number;
  lng: number;
  value: number;
  threshold: number;
  detail: string;
};

export type DoctorTimeIntegrity = {
  invalid_timestamp_count: number;
  time_reversal_count: number;
  duplicate_timestamp_count: number;
  first_ms: number;
  last_ms: number;
  span_seconds: number;
};

export type DoctorCluster = {
  cluster_index: number;
  point_count: number;
  first_point_index: number;
  last_point_index: number;
  lat: number;
  lng: number;
};

export const DOCTOR_MOVING_GAP_SECONDS = 5 * 60;
export const DOCTOR_MAX_ANOMALIES = 200;
export const DOCTOR_ELEVATION_SPIKE_METERS = 50;

// The discontinuity threshold sits deliberately far above
// DOCTOR_EXTREME_JUMP_METERS: 1.5 km can still be GPS noise, while 20 km
// means this track glued together two different rides.
export const DOCTOR_DISCONTINUITY_METERS = 20000;
export const DOCTOR_MIN_CLUSTER_POINTS = 5;
export const DOCTOR_MAX_CLUSTERS = 24;

// The "stopped" rule, the stop radius, the haversine distance and the speed
// limits per activity type all live in public/assets/doctor-core.js and are
// re-exported at the top of this file. Do not copy them back in here:
// that copy is what once made the page and the server compute different distances.

// Split the route on jumps between CONSECUTIVE points that exceed the threshold.
// This definition is the right one for finding glued tracks: a 100 km route
// sampled every 5 km stays one cluster because every step is small, while a
// track that joins two different rides splits at the seam.
// (Measuring distance to the centroid would wrongly flag a long route as many
// clusters, because the centroid drifts away from the end points.)
export const buildDoctorClusters = (points: DoctorStatPoint[]) => {
  const runs: Array<{
    count: number;
    sumLat: number;
    sumLng: number;
    firstIndex: number;
    lastIndex: number;
  }> = [];

  points.forEach((point, index) => {
    const previous = index > 0 ? points[index - 1] : null;
    const startsNewRun =
      !previous || getDistanceMeters(previous, point) >= DOCTOR_DISCONTINUITY_METERS;

    if (startsNewRun) {
      runs.push({ count: 0, sumLat: 0, sumLng: 0, firstIndex: index, lastIndex: index });
    }

    const run = runs[runs.length - 1];
    run.count += 1;
    run.sumLat += point.lat;
    run.sumLng += point.lng;
    run.lastIndex = index;
  });

  return runs.slice(0, DOCTOR_MAX_CLUSTERS).map((run, index) => ({
    cluster_index: index,
    point_count: run.count,
    first_point_index: run.firstIndex,
    last_point_index: run.lastIndex,
    lat: Number((run.sumLat / run.count).toFixed(6)),
    lng: Number((run.sumLng / run.count).toFixed(6)),
  }));
};

/**
 * How far recomputed moving time may drift from D1 before the result is
 * rejected.
 *
 * Why the tolerance is tight (±15%) and not loose like before (0.35x-1.35x):
 * doctor and tracker measure the same thing, so the two should indeed be
 * close. The regression that turned 1:41:29 into 1:00:35 only drifted about
 * 40%, enough to pass the old threshold while still rewriting someone's
 * history with wrong numbers. That loose threshold was not a safety net, it
 * only gave the next bug room to slip through.
 *
 * The direction of the drift is still distinguished in the message, because
 * "shorter" and "longer" have different causes and the user needs to know
 * which one it is.
 */
export const DOCTOR_MOVING_TIME_RATIO_TOLERANCE = 0.15;

export type DoctorMovingTimeComparison = {
  ratio: number | null;
  withinTolerance: boolean;
  direction: "shorter" | "longer" | "equal" | "unknown";
  message: string;
};

/**
 * Compare recomputed moving time against what D1 already holds.
 *
 * A null ratio means one side has no value (for example an old activity that
 * never had statistics). In that state there is nothing to compare, and the
 * result is NOT treated as drift: if D1 really is empty, filling it in is a
 * fix, not a risk.
 */
export const compareDoctorMovingTime = (
  currentSeconds: number,
  proposedSeconds: number,
  tolerance: number = DOCTOR_MOVING_TIME_RATIO_TOLERANCE,
): DoctorMovingTimeComparison => {
  const current = Number(currentSeconds) || 0;
  const proposed = Number(proposedSeconds) || 0;

  if (current <= 0 || proposed <= 0) {
    return {
      ratio: null,
      withinTolerance: true,
      direction: "unknown",
      message: "Moving time D1 tidak ada, jadi tidak ada yang perlu dibandingkan.",
    };
  }

  const ratio = proposed / current;
  const percent = Math.round(Math.abs(1 - ratio) * 100);
  const withinTolerance = Math.abs(1 - ratio) <= tolerance;

  if (withinTolerance) {
    return {
      ratio,
      withinTolerance,
      direction: ratio === 1 ? "equal" : ratio < 1 ? "shorter" : "longer",
      message: `Moving time hasil hitung ulang masih dalam toleransi (${ratio.toFixed(2)}x dari D1).`,
    };
  }

  const direction = ratio < 1 ? "shorter" : "longer";
  const limit = Math.round(tolerance * 100);

  return {
    ratio,
    withinTolerance,
    direction,
    message:
      direction === "shorter"
        ? `Moving time hasil hitung ulang ${percent}% lebih pendek dari D1 (rasio ${ratio.toFixed(2)}), di luar toleransi ±${limit}%. D1 dipertahankan dan aktivitas ditandai MANUAL CHECK.`
        : `Moving time hasil hitung ulang ${percent}% lebih panjang dari D1 (rasio ${ratio.toFixed(2)}), di luar toleransi ±${limit}%. D1 dipertahankan dan aktivitas ditandai MANUAL CHECK.`,
  };
};

export type DoctorSegmentKind = "jump" | "stopped" | "moving";

/**
 * One segment table, used by EVERY calculation in this module.
 *
 * This is not just tidiness. The original regression was born precisely
 * because distance and time were summed in two different places with different
 * rules. As long as two places exist, the same bug can be born again; with one
 * table, "moving" has only one meaning.
 */
export type DoctorSegments = {
  count: number;
  distanceM: number[];
  seconds: number[];
  gapSeconds: number[];
  cumTime: number[];
  kind: DoctorSegmentKind[];
  inStay: boolean[];
};

export const buildDoctorSegments = (
  points: DoctorStatPoint[],
  activityType: string,
): DoctorSegments => buildDoctorSegmentsImpl(points, activityType);

export type DoctorRestBlock = {
  type: string;
  label: string;
  start: number;
  end: number;
  duration_s: number;
  distance_km: number;
  moving_time: number;
  note: string;
};

/**
 * Long rest blocks, used for fuel (nutrition) analysis and the rest summary.
 * Like the main statistics, these blocks report the CUMULATIVE `moving_time`
 * up to the point where that rest starts.
 *
 * The threshold deliberately stays DOCTOR_LONG_GAP_SECONDS: this really is a
 * list of long rests, not every red light.
 */
export const collectDoctorRestBlocks = (
  points: DoctorStatPoint[],
  activityType: string,
): DoctorRestBlock[] => {
  const segments = buildDoctorSegments(points, activityType);
  const blocks: DoctorRestBlock[] = [];

  let progressKm = 0;
  let movingSeconds = 0;

  for (let i = 1; i < points.length; i++) {
    const k = i - 1;
    const point = points[i];

    if (segments.kind[k] === "moving") {
      const distanceM = segments.distanceM[k];
      if (distanceM >= 1 && distanceM < DOCTOR_EXTREME_JUMP_METERS) {
        progressKm += distanceM / 1000;
      }
      movingSeconds += segments.seconds[k];
    }

    if (segments.gapSeconds[k] >= DOCTOR_LONG_GAP_SECONDS) {
      // Local variables are used so TypeScript can narrow the types:
      // narrowing does not apply to repeated element access (points[i - 1]).
      const prevTime = points[i - 1].time;
      const pointTime = point.time;
      const prevMs = prevTime ? Date.parse(prevTime) : 0;
      const pointMs = pointTime ? Date.parse(pointTime) : 0;

      blocks.push({
        type: "detected_gap",
        label: "Rest gap terdeteksi",
        start: prevMs,
        end: pointMs,
        duration_s: segments.gapSeconds[k],
        distance_km: Number(progressKm.toFixed(3)),
        moving_time: Math.max(0, Math.floor(movingSeconds)),
        note: "Ditemukan dari jeda timestamp antar titik GPS.",
      });
    }
  }

  return blocks;
};

export const recalculateDoctorStats = (
  points: DoctorStatPoint[],
  activityType: string,
) => {
  const limits = getDoctorSpeedLimits(activityType);
  const plausibleMaxSpeed = limits.calculation_max_kmh;

  let maxSpeed = 0;
  let elevationGain = 0;
  let skippedJumpCount = 0;
  let longGapCount = 0;
  let suspiciousSpeedCount = 0;
  let lastEle: number | null = null;
  const anomalies: DoctorAnomaly[] = [];
  const timeIntegrity: DoctorTimeIntegrity = {
    invalid_timestamp_count: 0,
    time_reversal_count: 0,
    duplicate_timestamp_count: 0,
    first_ms: 0,
    last_ms: 0,
    span_seconds: 0,
  };

  // ---- Step 1: build one segment table via buildDoctorSegments(). The same
  // table is also used by collectDoctorRestBlocks(), so rest blocks can no
  // longer report a different time from the main statistics.
  const segments = buildDoctorSegments(points, activityType);
  const { distanceM: segmentDistanceM, seconds: segmentSeconds, gapSeconds: segmentGapSeconds, cumTime } =
    segments;

  const pushAnomaly = (
    code: DoctorAnomalyCode,
    severity: DoctorSeverity,
    segmentIndex: number,
    point: DoctorStatPoint,
    value: number,
    threshold: number,
    detail: string,
  ) => {
    if (anomalies.length >= DOCTOR_MAX_ANOMALIES) return;

    anomalies.push({
      code,
      severity,
      segment_index: segmentIndex,
      point_index: segmentIndex,
      source_index: Number.isFinite(Number(point._source_index))
        ? Number(point._source_index)
        : segmentIndex,
      at: String(point.time || ""),
      lat: Number(Number(point.lat).toFixed(6)),
      lng: Number(Number(point.lng).toFixed(6)),
      value: Number(Number(value).toFixed(3)),
      threshold: Number(Number(threshold).toFixed(3)),
      detail,
    });
  };

  // ---- Step 2: classify each segment and sum it up. Distance and time are
  // taken from the same branch, so they can no longer come from a different
  // set of segments.
  let distanceKm = 0;
  let movingSeconds = 0;
  let stoppedSeconds = 0;
  let excludedJumpSeconds = 0;

  for (let i = 1; i < points.length; i++) {
    const k = i - 1;
    const prev = points[i - 1];
    const point = points[i];
    const distanceM = segmentDistanceM[k];
    const distanceSegmentKm = distanceM / 1000;
    const gapSec = segmentGapSeconds[k];
    const deltaSec = segmentSeconds[k];
    const segmentSpeed = gapSec > 0 ? distanceSegmentKm / (gapSec / 3600) : 0;

    const prevMs = prev.time ? Date.parse(prev.time) : 0;
    const pointMs = point.time ? Date.parse(point.time) : 0;

    // Time integrity is checked separately from gapSec: gapSec is deliberately 0
    // for timestamps that make no sense, so until now a backwards timeline
    // slipped through with no record at all.
    if (Number.isFinite(pointMs) && pointMs > 0) {
      if (timeIntegrity.first_ms === 0 || pointMs < timeIntegrity.first_ms) {
        timeIntegrity.first_ms = pointMs;
      }
      if (pointMs > timeIntegrity.last_ms) timeIntegrity.last_ms = pointMs;
    }

    if (point.time && !Number.isFinite(pointMs)) {
      timeIntegrity.invalid_timestamp_count += 1;
      pushAnomaly(
        "invalid_timestamp",
        "warning",
        i,
        point,
        0,
        0,
        "Timestamp titik ini tidak bisa dibaca sehingga ikut merusak moving time.",
      );
    } else if (Number.isFinite(prevMs) && Number.isFinite(pointMs) && prevMs > 0 && pointMs > 0) {
      if (pointMs < prevMs) {
        timeIntegrity.time_reversal_count += 1;
        pushAnomaly(
          "time_reversal",
          "warning",
          i,
          point,
          (prevMs - pointMs) / 1000,
          0,
          `Waktu mundur ${Math.round((prevMs - pointMs) / 1000)} detik dibanding titik sebelumnya.`,
        );
      } else if (pointMs === prevMs) {
        timeIntegrity.duplicate_timestamp_count += 1;
        pushAnomaly(
          "duplicate_timestamp",
          "info",
          i,
          point,
          0,
          0,
          "Timestamp sama persis dengan titik sebelumnya; kecepatan segmen ini tidak bisa dihitung.",
        );
      }
    }

    if (distanceM >= DOCTOR_EXTREME_JUMP_METERS && (!gapSec || gapSec < DOCTOR_LONG_GAP_SECONDS)) {
      skippedJumpCount += 1;
      excludedJumpSeconds += deltaSec;
      pushAnomaly(
        "extreme_jump",
        "warning",
        i,
        point,
        distanceM,
        DOCTOR_EXTREME_JUMP_METERS,
        `Lompatan ${(distanceM / 1000).toFixed(2)} km tanpa jeda waktu yang menjelaskannya.`,
      );
      continue;
    }

    if (gapSec >= DOCTOR_LONG_GAP_SECONDS) {
      longGapCount += 1;
      pushAnomaly(
        "long_gap",
        "info",
        i,
        point,
        gapSec,
        DOCTOR_LONG_GAP_SECONDS,
        `Jeda ${Math.round(gapSec / 60)} menit antar titik; wajar untuk istirahat, bukan kerusakan data.`,
      );
    }

    if (segmentSpeed > plausibleMaxSpeed && gapSec > 0) {
      suspiciousSpeedCount += 1;
      pushAnomaly(
        "suspicious_speed",
        "warning",
        i,
        point,
        segmentSpeed,
        plausibleMaxSpeed,
        `Kecepatan segmen ${segmentSpeed.toFixed(1)} km/h melewati batas wajar ${plausibleMaxSpeed} km/h.`,
      );
    }

    // Classification comes from the shared table (see buildDoctorSegments):
    // "jump" is handled above, "stopped" means GPS jitter in place, the rest
    // is "moving". Distance and time come from exactly the same branch.
    if (segments.kind[k] === "stopped") {
      // Stopped: adds no distance (GPS jitter while standing still is not
      // route) and no moving time. The time is still recorded, not discarded.
      stoppedSeconds += deltaSec;
      continue;
    }

    if (distanceM >= 1 && distanceM < DOCTOR_EXTREME_JUMP_METERS) {
      distanceKm += distanceSegmentKm;
    }

    movingSeconds += deltaSec;

    if (Number.isFinite(point.speed || NaN)) {
      maxSpeed = Math.max(maxSpeed, Number(point.speed || 0));
    } else if (segmentSpeed > 0 && segmentSpeed <= plausibleMaxSpeed) {
      maxSpeed = Math.max(maxSpeed, segmentSpeed);
    }

    const ele = Number(point.ele);

    if (Number.isFinite(ele)) {
      if (lastEle !== null) {
        const diff = ele - lastEle;
        if (diff > 3 && diff < 50) elevationGain += diff;
        if (Math.abs(diff) >= DOCTOR_ELEVATION_SPIKE_METERS) {
          pushAnomaly(
            "elevation_spike",
            "info",
            i,
            point,
            diff,
            DOCTOR_ELEVATION_SPIKE_METERS,
            `Elevasi berubah ${diff.toFixed(0)} m dalam satu segmen; kemungkinan nilai rusak.`,
          );
        }
      }

      lastEle = ele;
    }
  }

  const movingTime = Math.max(0, Math.floor(movingSeconds));
  const stoppedTime = Math.max(0, Math.floor(stoppedSeconds));

  // Average speed is derived from the numbers actually reported, so the
  // "distance and moving time" written in the report really do divide into
  // exactly the number being displayed.
  const averageSpeed = movingTime > 0 ? distanceKm / (movingTime / 3600) : 0;
  const clusters = buildDoctorClusters(points);
  const spanSeconds =
    timeIntegrity.first_ms > 0 && timeIntegrity.last_ms >= timeIntegrity.first_ms
      ? Math.floor((timeIntegrity.last_ms - timeIntegrity.first_ms) / 1000)
      : 0;

  // Time accounting: every second inside the activity span must show up in
  // one of the columns. The unexplained remainder is reported as is so the
  // caller can reject the result, not display it silently.
  const accountedSeconds = movingSeconds + stoppedSeconds + excludedJumpSeconds;
  const unaccountedSeconds = Math.max(0, Number((spanSeconds - accountedSeconds).toFixed(1)));

  const anomalyCounts = {
    extreme_jump: anomalies.filter((item) => item.code === "extreme_jump").length,
    suspicious_speed: anomalies.filter((item) => item.code === "suspicious_speed").length,
    elevation_spike: anomalies.filter((item) => item.code === "elevation_spike").length,
    long_gap: anomalies.filter((item) => item.code === "long_gap").length,
    time_reversal: timeIntegrity.time_reversal_count,
    duplicate_timestamp: timeIntegrity.duplicate_timestamp_count,
    invalid_timestamp: timeIntegrity.invalid_timestamp_count,
  };

  return {
    distance_km: Number(distanceKm.toFixed(3)),
    moving_time: movingTime,
    stopped_time: stoppedTime,
    excluded_jump_seconds: Number(excludedJumpSeconds.toFixed(1)),
    unaccounted_seconds: unaccountedSeconds,
    average_speed: Number(averageSpeed.toFixed(2)),
    max_speed: Number(maxSpeed.toFixed(2)),
    total_elevation_gain: Number(elevationGain.toFixed(1)),
    skipped_jump_count: skippedJumpCount,
    long_gap_count: longGapCount,
    suspicious_speed_count: suspiciousSpeedCount,
    time_reversal_count: timeIntegrity.time_reversal_count,
    duplicate_timestamp_count: timeIntegrity.duplicate_timestamp_count,
    invalid_timestamp_count: timeIntegrity.invalid_timestamp_count,
    timeline_sound:
      timeIntegrity.time_reversal_count === 0 && timeIntegrity.invalid_timestamp_count === 0,
    anomalies,
    anomaly_counts: anomalyCounts,
    time_integrity: { ...timeIntegrity, span_seconds: spanSeconds },
    clusters,
  };
};
