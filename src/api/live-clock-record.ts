/**
 * Live clock accounting that gets STORED alongside the activity.
 *
 * Why this module exists. The tracker page has been sending `live_clock` in
 * the payload since commit dfb3e28, but api.ts never read it and the activity
 * metadata never carried it, so the record vanished once the finish screen
 * was closed. As a result, on the 25 Sep 2026 gowes (11027 points, 7 hour
 * span), the question "did the live clock lose any seconds?" could only be
 * answered from the ABSENCE of a warning, not from a number. This file makes
 * that number get stored too, so the next gowes can be proven from its own
 * file.
 *
 * Rules this module follows:
 *
 *  1. It does NOT recompute any statistic. The stored value is the live clock
 *     measurement, and recomputation stays Activity Doctor's job.
 *  2. Zero and "no data" are two different things. If instrumentation never
 *     got loaded, the result is `null`, not a zero that could be misread as
 *     "no time was lost".
 *  3. Numbers from the client are cleaned up, not trusted. Sum the buckets
 *     yourself, then flag it when the client sends a total that disagrees.
 *
 * Pure module: zero runtime imports, so it can be tested without Worker/D1/network.
 */

export type LiveClockRecord = {
  tick_count: number;
  counted_seconds: number;
  clamped_seconds: number;
  dropped_seconds: number;
  clamped_tick_count: number;
  dropped_tick_count: number;
  /** clamped + dropped, recomputed here, not copied from the client. */
  uncounted_seconds: number;
  /** Copy taken as is from the client; null when it was not sent. */
  balance_seconds: number | null;
  /**
   * true = the numbers agree with each other. false = some bucket does not add
   * up, so this record must NOT be used as evidence.
   */
  consistent: boolean;
  issues: string[];
};

/** Rounding tolerance between buckets, in seconds. */
export const LIVE_CLOCK_CONSISTENCY_TOLERANCE_SECONDS = 1;

const toNonNegativeNumber = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Number(numeric.toFixed(1));
};

const toNonNegativeCount = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
};

/**
 * Clean up the live clock record sent by the tracker page.
 *
 * Returns `null` when there really is no record (instrumentation never loaded,
 * or an old activity recorded before this feature existed). That is deliberate:
 * storing it as zero would disguise missing data.
 */
export const normalizeLiveClockRecord = (
  value: unknown,
): LiveClockRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const issues: string[] = [];

  const tickCount = toNonNegativeCount(source.tick_count);
  const countedSeconds = toNonNegativeNumber(source.counted_seconds);
  const clampedSeconds = toNonNegativeNumber(source.clamped_seconds);
  const droppedSeconds = toNonNegativeNumber(source.dropped_seconds);
  const clampedTickCount = toNonNegativeCount(source.clamped_tick_count);
  const droppedTickCount = toNonNegativeCount(source.dropped_tick_count);

  const uncountedSeconds = Number((clampedSeconds + droppedSeconds).toFixed(1));

  // An empty bucket with not a single tick = a record that makes no sense.
  // That is not a reason to refuse storing it, but a reason to flag it.
  if (tickCount === 0) {
    issues.push(
      "tick_count 0: tidak ada tick yang tercatat, angka di sini tidak bisa dipakai sebagai bukti.",
    );
  }

  if (clampedTickCount + droppedTickCount > tickCount) {
    issues.push(
      `tick bermasalah (${clampedTickCount + droppedTickCount}) melebihi total tick (${tickCount}).`,
    );
  }

  // The client sends its own total; if it does not match the bucket sum,
  // one of the numbers is lying and we cannot tell which one it is.
  const claimedUncounted = Number(source.uncounted_seconds);
  if (Number.isFinite(claimedUncounted)) {
    const drift = Math.abs(claimedUncounted - uncountedSeconds);
    if (drift > LIVE_CLOCK_CONSISTENCY_TOLERANCE_SECONDS) {
      issues.push(
        `uncounted_seconds dari klien (${claimedUncounted.toFixed(1)}) tidak sama dengan clamped + dropped (${uncountedSeconds.toFixed(1)}).`,
      );
    }
  }

  const rawBalance = Number(source.balance_seconds);
  const balanceSeconds = Number.isFinite(rawBalance)
    ? Number(rawBalance.toFixed(1))
    : null;

  // Real elapsed time is always >= the time counted as moving, because
  // auto-pause can only REDUCE counted. The reverse race means the buckets
  // are corrupt.
  if (balanceSeconds !== null && balanceSeconds < countedSeconds - LIVE_CLOCK_CONSISTENCY_TOLERANCE_SECONDS) {
    issues.push(
      `balance_seconds (${balanceSeconds.toFixed(1)}) lebih kecil dari counted_seconds (${countedSeconds.toFixed(1)}).`,
    );
  }

  return {
    tick_count: tickCount,
    counted_seconds: countedSeconds,
    clamped_seconds: clampedSeconds,
    dropped_seconds: droppedSeconds,
    clamped_tick_count: clampedTickCount,
    dropped_tick_count: droppedTickCount,
    uncounted_seconds: uncountedSeconds,
    balance_seconds: balanceSeconds,
    consistent: issues.length === 0,
    issues,
  };
};

/**
 * Ready-to-read sentence that explains this record to a human.
 *
 * Used so the question "how many seconds did the clock lose?" is no longer
 * answered by guessing from the absence of a warning.
 */
export const describeLiveClockRecord = (record: LiveClockRecord | null) => {
  if (!record) {
    return "Instrumentasi jam live tidak tersedia untuk aktivitas ini; kehilangan waktu tidak bisa diukur dari berkas ini.";
  }

  const parts = [
    `Jam live mencatat ${record.counted_seconds.toFixed(1)} detik bergerak dari ${record.tick_count} tick.`,
    `Tidak terhitung ${record.uncounted_seconds.toFixed(1)} detik (${record.clamped_seconds.toFixed(1)} dari tick terlambat, ${record.dropped_seconds.toFixed(1)} dari sistem berhenti).`,
  ];

  if (!record.consistent) {
    parts.push(`Catatan ini TIDAK konsisten dan jangan dipakai sebagai bukti: ${record.issues.join(" ")}`);
  }

  return parts.join(" ");
};
