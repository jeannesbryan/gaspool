/**
 * Type declaration for public/assets/ride-stat-rules.js.
 *
 * Needed because tsconfig does not enable `allowJs`, so TypeScript cannot read
 * the types from its .js file. The content must follow ride-stat-rules.js: if
 * the two drift apart, typecheck will let mistakes through, so change both
 * together.
 */

export type StoredDistanceSource = "shared_segment_table" | "tracker";

export type StoredDistanceDecision = {
  km: number;
  source: StoredDistanceSource;
  declared_km: number;
  clean_km: number | null;
  reason: string;
};

export type StoredElevationSource = "live_clock" | "recalculated" | "none";

export type StoredElevationDecision = {
  meters: number;
  source: StoredElevationSource;
  live_meters: number;
  recalculated_meters: number;
  reason: string;
};

export declare const STORED_DISTANCE_MIN_RATIO: number;
export declare const STORED_DISTANCE_MAX_RATIO: number;

export declare const chooseStoredDistanceKm: (input: {
  declaredKm: unknown;
  cleanKm?: unknown;
  sharedTableKm?: unknown;
}) => StoredDistanceDecision;

export declare const chooseStoredElevationGain: (input: {
  liveMeters: unknown;
  recalculatedMeters: unknown;
}) => StoredElevationDecision;
