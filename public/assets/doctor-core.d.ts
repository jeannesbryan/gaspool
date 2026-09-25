/**
 * Deklarasi tipe untuk public/assets/doctor-core.js.
 *
 * Berkas itu sengaja .js biasa supaya bisa dimuat browser tanpa build; berkas
 * ini yang memberi tahu TypeScript bentuknya. `allowJs` tidak diaktifkan di
 * tsconfig, jadi tanpa deklarasi ini `import ... from "....js"` akan ditolak.
 */

export type DoctorCorePoint = {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
  speed?: number;
  _source_index?: number;
};

export type DoctorCoreSegmentKind = "jump" | "stopped" | "moving";

export type DoctorCoreSegments = {
  count: number;
  distanceM: number[];
  seconds: number[];
  gapSeconds: number[];
  cumTime: number[];
  kind: DoctorCoreSegmentKind[];
  inStay: boolean[];
};

export type DoctorCoreSpeedLimits = {
  calculation_max_kmh: number;
  trusted_max_kmh: number;
  suspicious_ratio: number;
  movement_min_kmh: number;
};

export declare const DOCTOR_LONG_GAP_SECONDS: number;
export declare const DOCTOR_EXTREME_JUMP_METERS: number;
export declare const DOCTOR_STOP_MIN_SECONDS: number;
export declare const DOCTOR_STOP_RADIUS_FLOOR_METERS: number;

export declare const getDistanceMeters: (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) => number;

export declare const getDoctorSpeedLimits: (activityType: string) => DoctorCoreSpeedLimits;

export declare const classifyDoctorPointStays: (
  points: DoctorCorePoint[],
  cumTime: number[],
  radiusMeters: number,
  minSeconds?: number,
) => boolean[];

export declare const getDoctorStopRadiusMeters: (movementMinKmh: number) => number;

export declare const buildDoctorSegments: (
  points: DoctorCorePoint[],
  activityType: string,
) => DoctorCoreSegments;

export declare const doctorMovingDistanceMeters: (
  points: DoctorCorePoint[],
  activityType: string,
) => number;

export declare const doctorMovingSeconds: (
  points: DoctorCorePoint[],
  activityType: string,
) => number;
