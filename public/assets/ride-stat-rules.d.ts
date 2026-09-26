/**
 * Deklarasi tipe untuk public/assets/ride-stat-rules.js.
 *
 * Diperlukan karena tsconfig tidak mengaktifkan `allowJs`, jadi TypeScript
 * tidak bisa membaca tipe dari berkas .js-nya. Isinya harus mengikuti
 * ride-stat-rules.js — kalau keduanya menyimpang, typecheck akan membiarkan
 * kesalahan lewat, jadi ubah keduanya bersamaan.
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
