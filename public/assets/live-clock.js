/**
 * Clock accounting for a ride that is still running (live).
 *
 * This file is deliberately a plain .js living in public/assets so that TWO
 * places use it without copying: the tracker page loads it as a module, and
 * tests/live-clock.mjs imports it directly. One file means there are no two
 * implementations that can drift apart, exactly the kind of mistake that once
 * made the live clock and the repaired clock differ.
 *
 * Why this exists. The clock on the live screen and the clock after repair once
 * differed for the same ride: 1:41:29 vs 1:44:13, even though the time span was
 * 1:47:56. After measuring the original files, that gap had several causes:
 *
 *   1. auto-pause used the instantaneous speed from the GPS chip, while the
 *      repaired statistics used net displacement;
 *   2. and what had been completely invisible before: every tick that arrived
 *      late was CLIPPED silently. When the screen goes off or the tab is in the
 *      background, the browser delays ticks, and the clipped part (delta minus
 *      maxDelta) was never added up anywhere.
 *
 * This module closes the second hole. Its key property: EVERY second that
 * passes must land in one of the buckets, so the sum of all raw deltas =
 * counted + clamped + dropped. If they do not match, some seconds evaporated
 * without a trace, and that is exactly what must be found out.
 */

export function createLiveClockAccounting(maxDeltaSeconds, restGapSeconds) {
  return {
    tick_count: 0,
    counted_seconds: 0,
    clamped_seconds: 0,
    dropped_seconds: 0,
    raw_seconds: 0,
    clamped_tick_count: 0,
    dropped_tick_count: 0,
    max_delta_seconds: maxDeltaSeconds,
    rest_gap_seconds: restGapSeconds,
  };
}

/**
 * Compute one tick.
 *
 * `paused` means auto-pause is active: the time is NOT counted as moving, but
 * it is still recorded as seconds that really passed, so the books stay
 * balanced.
 */
export function recordLiveClockTick(accounting, rawDeltaSeconds, options = {}) {
  const raw = Number(rawDeltaSeconds);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { kind: "counted", counted: 0, lost: 0 };
  }

  const maxDelta = Number(options.maxDeltaSeconds ?? accounting.max_delta_seconds);
  const restGap = Number(options.restGapSeconds ?? accounting.rest_gap_seconds);

  accounting.tick_count += 1;
  accounting.raw_seconds += raw;

  // Large gap: the browser or the system stopped sending ticks long enough that
  // the time can no longer be trusted. Dropped entirely, but the amount is still
  // known, which is why it gets its own bucket instead of simply disappearing.
  if (raw > restGap) {
    accounting.dropped_seconds += raw;
    accounting.dropped_tick_count += 1;
    return { kind: "dropped", counted: 0, lost: raw };
  }

  // A tick that is late but still plausible: clipped at the upper bound.
  // This clipped part is exactly what never got recorded before.
  const lost = raw > maxDelta ? raw - maxDelta : 0;
  const countedDelta = raw - lost;

  if (lost > 0) {
    accounting.clamped_seconds += lost;
    accounting.clamped_tick_count += 1;
  }

  if (!options.paused) accounting.counted_seconds += countedDelta;

  return {
    kind: lost > 0 ? "clamped" : "counted",
    counted: options.paused ? 0 : countedDelta,
    lost,
  };
}

/**
 * Seconds that passed during the activity but did not go into moving time. Shown
 * on screen so the user knows the clock is not lost, it is just not counted as
 * moving.
 */
export function liveClockUncountedSeconds(accounting) {
  return Number((accounting.clamped_seconds + accounting.dropped_seconds).toFixed(1));
}

/**
 * Accounting difference. Zero means no second evaporated without a trace.
 */
export function liveClockBalance(accounting) {
  return Number((accounting.raw_seconds - liveClockUncountedSeconds(accounting)).toFixed(1));
}

export function serializeLiveClockAccounting(accounting) {
  return {
    tick_count: accounting.tick_count,
    counted_seconds: Number(accounting.counted_seconds.toFixed(1)),
    clamped_seconds: Number(accounting.clamped_seconds.toFixed(1)),
    dropped_seconds: Number(accounting.dropped_seconds.toFixed(1)),
    clamped_tick_count: accounting.clamped_tick_count,
    dropped_tick_count: accounting.dropped_tick_count,
  };
}
