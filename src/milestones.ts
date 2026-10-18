/**
 * Lifetime distance milestones: multiples of 1000 km.
 *
 * Why it is split out as a pure module: the numbers on this share card
 * state someone's achievement, and the card will be sent to other people.
 * That kind of calculation should be testable without booting the Worker or
 * reading data from D1, with nothing but numbers.
 *
 * This module imports nothing so the test can load it through Node's TypeScript
 * type stripping (see tests/milestones.mjs).
 */

/** Milestones are counted per 1000 km (owner's decision, 2026-09-24). */
export const MILESTONE_STEP_KM = 1000;

export type MilestoneProgress = {
  step_km: number;
  total_km: number;
  /** How many milestones have been reached. 0 means not yet 1000 km. */
  reached_count: number;
  /** The last milestone reached; 0 when there is none yet. */
  last_reached_km: number;
  /** The next milestone not yet reached. */
  next_km: number;
  /** Remaining distance to the next milestone. */
  remaining_km: number;
  /** Progress inside the segment currently running, 0..1. */
  progress_ratio: number;
};

/**
 * Bring any number into a shape that is safe to use in arithmetic.
 * D1 can return NULL, and the client can send a string; neither may
 * produce a share card that reads "NaN km".
 */
const safeKm = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const normaliseStep = (step: unknown) => {
  const n = Number(step);
  return Number.isFinite(n) && n > 0 ? n : MILESTONE_STEP_KM;
};

export const computeMilestoneProgress = (
  totalKm: unknown,
  stepKm: unknown = MILESTONE_STEP_KM,
): MilestoneProgress => {
  const total = safeKm(totalKm);
  const step = normaliseStep(stepKm);

  const reachedCount = Math.floor(total / step);
  const lastReached = reachedCount * step;
  const next = (reachedCount + 1) * step;
  const remaining = Number((next - total).toFixed(3));
  const withinSegment = total - lastReached;

  return {
    step_km: step,
    total_km: Number(total.toFixed(3)),
    reached_count: reachedCount,
    last_reached_km: lastReached,
    next_km: next,
    remaining_km: remaining,
    // Always inside [0, 1). Rounded so the client does not have to guess precision.
    progress_ratio: Number(Math.min(0.999999, Math.max(0, withinSegment / step)).toFixed(6)),
  };
};

/**
 * Milestones CROSSED between two readings of total distance.
 *
 * Used after an activity is stored: if lifetime distance moves
 * from 2,940 km to 3,050 km, then 3,000 km was just crossed and its card
 * needs to be offered. Comparing "distance before" and "distance after" is
 * more trustworthy than computing on the client, because the save can be replayed
 * or cancelled.
 *
 * Returns an array because a single activity can cross more than one
 * milestone when older payloads are added all at once.
 */
export const crossedMilestones = (
  beforeKm: unknown,
  afterKm: unknown,
  stepKm: unknown = MILESTONE_STEP_KM,
): number[] => {
  const before = safeKm(beforeKm);
  const after = safeKm(afterKm);
  const step = normaliseStep(stepKm);

  if (after <= before) return [];

  const firstCrossed = Math.floor(before / step) + 1;
  const lastCrossed = Math.floor(after / step);
  if (lastCrossed < firstCrossed) return [];

  const crossed: number[] = [];
  for (let index = firstCrossed; index <= lastCrossed; index++) {
    crossed.push(index * step);
  }

  return crossed;
};

/** Format a distance for display, e.g. 2847.3 -> "2.847,3". */
export const formatMilestoneKm = (value: unknown, decimals = 1) => {
  const n = safeKm(value);
  return n.toLocaleString("id-ID", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};
