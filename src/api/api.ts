import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { Bindings } from "../index";
import { verify } from "hono/jwt";

const api = new Hono<{ Bindings: Bindings }>();
const R2_PUBLIC_BASE_URL =
  "https://pub-13cc00374110455e9437c511bcbdf007.r2.dev";
const DEFAULT_PUBLIC_PROFILE_SLUG = "rider";

const normalizePublicProfileSlug = (value?: string) => {
  const slug = String(value || DEFAULT_PUBLIC_PROFILE_SLUG)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);

  return slug || DEFAULT_PUBLIC_PROFILE_SLUG;
};

const getPublicProfileSlug = (env: Bindings) =>
  normalizePublicProfileSlug(env.PUBLIC_PROFILE_SLUG);

const sanitizeRoomId = (value: string) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 48);

const sanitizeRadioUser = (value: string) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32) || "user";

const normalizeIsoDate = (value: any, fallback: string) => {
  const parsed = Date.parse(String(value || ""));

  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  return fallback;
};

const normalizeTimezoneOffset = (value: any) => {
  const offset = Number(value);

  if (Number.isFinite(offset) && Math.abs(offset) <= 14 * 60) {
    return Math.round(offset);
  }

  return null;
};

const normalizeTimezoneName = (value: any) =>
  String(value || "")
    .trim()
    .slice(0, 80);

type RoutePoint = {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
};

type RouteInstruction = {
  text: string;
  distance_m: number;
  duration_s: number;
  type?: number;
  way_points?: [number, number];
  point?: RoutePoint | null;
};

type RouteCheckpoint = RoutePoint & {
  name: string;
  type: string;
  reminder_m: number;
};

type PlannedRoutePayload = {
  version: 1;
  provider: "ors" | "gpx";
  profile: string;
  name: string;
  distance_km: number;
  distance_m: number;
  duration_s: number;
  waypoints: RoutePoint[];
  checkpoints?: RouteCheckpoint[];
  coordinates: RoutePoint[];
  instructions: RouteInstruction[];
  created_at: string;
};

type GeocodeResult = {
  label: string;
  name: string;
  lat: number;
  lng: number;
  confidence: number | null;
  layer: string;
  source: string;
  country: string;
  region: string;
  locality: string;
};

const normalizeProfile = (activityType: string = "ride") => {
  const type = activityType.toLowerCase();

  if (type === "run" || type === "walk") return "foot-walking";
  if (type === "hike") return "foot-hiking";

  return "cycling-regular";
};

const formatRecordDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

const formatRecordPace = (secondsPerKm: number) => {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "--";
  return formatRecordDuration(secondsPerKm);
};

const summarizeRecordRide = (ride: any) => {
  if (!ride) return "";

  const name = String(ride.name || "Aktivitas");
  const date = ride.start_date
    ? new Date(ride.start_date).toISOString().slice(0, 10)
    : "";

  return date ? `${name} • ${date}` : name;
};

const normalizeRoutePoint = (point: any): RoutePoint | null => {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng ?? point?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
};

const normalizeRouteCheckpoint = (checkpoint: any): RouteCheckpoint | null => {
  const point = normalizeRoutePoint(checkpoint);

  if (!point) return null;

  const allowedTypes = new Set([
    "food",
    "water",
    "minimarket",
    "fuel",
    "mosque",
    "camp",
    "medical",
    "other",
  ]);
  const type = allowedTypes.has(String(checkpoint?.type || ""))
    ? String(checkpoint.type)
    : "other";
  const reminderM = Number(checkpoint?.reminder_m ?? checkpoint?.reminderM ?? 1000);

  return {
    ...point,
    name: String(checkpoint?.name || "Checkpoint").trim().slice(0, 80) || "Checkpoint",
    type,
    reminder_m: Number.isFinite(reminderM)
      ? Math.max(0, Math.min(10000, Math.round(reminderM)))
      : 1000,
  };
};

const normalizeImportedRoutePoint = (point: any): RoutePoint | null => {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng ?? point?.lon);
  const ele = Number(point?.ele ?? point?.elevation);
  const time = String(point?.time || "").trim();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const normalized: RoutePoint = { lat, lng };

  if (Number.isFinite(ele)) normalized.ele = ele;
  if (time && !Number.isNaN(Date.parse(time))) {
    normalized.time = new Date(time).toISOString();
  }

  return normalized;
};

const degreesToRadians = (value: number) => (value * Math.PI) / 180;

const getDistanceMeters = (from: RoutePoint, to: RoutePoint) => {
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

const calculateRouteDistanceMeters = (coordinates: RoutePoint[]) =>
  coordinates.reduce((total, point, index) => {
    if (index === 0) return total;
    return total + getDistanceMeters(coordinates[index - 1], point);
  }, 0);

const estimateRouteDurationSeconds = (distanceM: number, profile: string) => {
  const speedKmh =
    profile === "foot-hiking"
      ? 3.5
      : profile === "foot-running"
        ? 9.5
        : profile === "foot-walking"
          ? 5
          : 18;
  const duration = (distanceM / 1000 / speedKmh) * 3600;

  return Math.max(60, Math.round(duration));
};

const getImportedRouteDurationSeconds = (
  coordinates: RoutePoint[],
  distanceM: number,
  profile: string,
) => {
  const start = coordinates[0]?.time
    ? Date.parse(String(coordinates[0].time))
    : NaN;
  const finish = coordinates[coordinates.length - 1]?.time
    ? Date.parse(String(coordinates[coordinates.length - 1].time))
    : NaN;

  if (Number.isFinite(start) && Number.isFinite(finish) && finish > start) {
    return Math.round((finish - start) / 1000);
  }

  return estimateRouteDurationSeconds(distanceM, profile);
};

const readPlannedRouteWithData = async (env: Bindings, routeId: number) => {
  const route: any = await env.DB.prepare(
    "SELECT * FROM planned_routes WHERE id = ?",
  )
    .bind(routeId)
    .first();

  if (!route) return null;

  const routeRes = await fetch(route.route_url);

  if (!routeRes.ok) {
    throw new Error("Metadata ada, tapi file rute gagal dibaca dari R2.");
  }

  const data = await routeRes.json();

  return {
    ...route,
    data,
  };
};

const normalizeGPXRoute = (body: any): PlannedRoutePayload => {
  const rawPoints = Array.isArray(body?.points)
    ? body.points
    : Array.isArray(body?.coordinates)
      ? body.coordinates
      : [];
  const coordinates = (rawPoints
    .map(normalizeImportedRoutePoint)
    .filter(Boolean) as RoutePoint[]).filter((point, index, list) => {
    if (index === 0) return true;
    const prev = list[index - 1];
    return point.lat !== prev.lat || point.lng !== prev.lng;
  });

  if (coordinates.length < 2) {
    throw new Error("GPX harus punya minimal dua titik koordinat valid.");
  }

  if (coordinates.length > 25000) {
    throw new Error("GPX terlalu besar. Maksimal 25.000 titik rute.");
  }

  const allowedProfiles = new Set([
    "cycling-regular",
    "cycling-road",
    "cycling-mountain",
    "cycling-electric",
    "foot-running",
    "foot-walking",
    "foot-hiking",
  ]);
  const requestedProfile = String(body?.profile || "");
  const activityType = String(body?.activity_type || "ride").toLowerCase();
  const profile = allowedProfiles.has(requestedProfile)
    ? requestedProfile
    : activityType === "run"
      ? "foot-running"
      : normalizeProfile(activityType);
  const name =
    String(body?.name || "").trim().slice(0, 80) ||
    "Import GPX " + new Date().toLocaleDateString("id-ID");
  const checkpoints = Array.isArray(body?.checkpoints)
    ? (body.checkpoints
        .map(normalizeRouteCheckpoint)
        .filter(Boolean) as RouteCheckpoint[])
    : [];
  const distanceM = calculateRouteDistanceMeters(coordinates);
  const durationS = getImportedRouteDurationSeconds(
    coordinates,
    distanceM,
    profile,
  );

  return {
    version: 1,
    provider: "gpx",
    profile,
    name,
    distance_km: distanceM / 1000,
    distance_m: distanceM,
    duration_s: durationS,
    waypoints: [coordinates[0], coordinates[coordinates.length - 1]],
    checkpoints,
    coordinates,
    instructions: [],
    created_at: new Date().toISOString(),
  };
};

const decodePolyline = (str: string, precision = 5): RoutePoint[] => {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: RoutePoint[] = [];
  const factor = Math.pow(10, precision);

  while (index < str.length) {
    let byte = 0;
    let shift = 0;
    let result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);

    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);

    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }

  return coordinates.filter((point) => normalizeRoutePoint(point));
};

const extractCoordinateList = (value: any): any[] => {
  if (Array.isArray(value)) return value;

  if (value?.type === "FeatureCollection" && Array.isArray(value.features)) {
    return value.features.flatMap((feature: any) => extractCoordinateList(feature));
  }

  if (value?.type === "Feature") {
    return extractCoordinateList(value.geometry);
  }

  if (value?.type === "LineString" && Array.isArray(value.coordinates)) {
    return value.coordinates;
  }

  if (value?.type === "MultiLineString" && Array.isArray(value.coordinates)) {
    return value.coordinates.flat();
  }

  if (value?.geometry) return extractCoordinateList(value.geometry);
  if (value?.points) return extractCoordinateList(value.points);
  if (value?.path) return extractCoordinateList(value.path);
  if (value?.data) return extractCoordinateList(value.data);
  if (value?.polyline) return extractCoordinateList(value.polyline);
  if (value?.coordinates) return extractCoordinateList(value.coordinates);

  return [];
};

const normalizeActivityStages = (value: any) => {
  const stages = Array.isArray(value) ? value : [];

  return stages
    .map((stage: any, index: number) => {
      const startDistance = Math.max(0, Number(stage?.start_distance_km || 0));
      const endDistanceRaw =
        stage?.end_distance_km === undefined || stage?.end_distance_km === null
          ? startDistance
          : Number(stage.end_distance_km);
      const startMoving = Math.max(0, Math.floor(Number(stage?.start_moving_time || 0)));
      const endMovingRaw =
        stage?.end_moving_time === undefined || stage?.end_moving_time === null
          ? startMoving
          : Math.floor(Number(stage.end_moving_time));

      return {
        index: Math.max(1, Math.floor(Number(stage?.index || index + 1))),
        name: String(stage?.name || `Etape ${index + 1}`).trim().slice(0, 80) || `Etape ${index + 1}`,
        reason: String(stage?.reason || "manual").trim().slice(0, 40) || "manual",
        start_time: String(stage?.start_time || "").slice(0, 40),
        end_time: String(stage?.end_time || "").slice(0, 40),
        start_distance_km: Number(startDistance.toFixed(3)),
        end_distance_km: Number(Math.max(startDistance, Number.isFinite(endDistanceRaw) ? endDistanceRaw : startDistance).toFixed(3)),
        start_moving_time: startMoving,
        end_moving_time: Math.max(startMoving, Number.isFinite(endMovingRaw) ? endMovingRaw : startMoving),
        start_point_index: Math.max(0, Math.floor(Number(stage?.start_point_index || 0))),
        end_point_index: Math.max(0, Math.floor(Number(stage?.end_point_index || 0))),
      };
    })
    .filter((stage) => stage.start_time || stage.end_time || stage.end_distance_km > stage.start_distance_km)
    .slice(0, 100);
};

const normalizeSignalLogs = (value: any) => {
  const logs = Array.isArray(value) ? value : [];

  return logs
    .map((log: any) => {
      const start = Number(log?.start || 0);
      const end =
        log?.end === undefined || log?.end === null ? null : Number(log.end);
      const duration = Number(
        log?.duration_s || (end && start ? (end - start) / 1000 : 0),
      );

      return {
        type: String(log?.type || "unknown").trim().slice(0, 40) || "unknown",
        label: String(log?.label || "No signal").trim().slice(0, 80) || "No signal",
        start: Number.isFinite(start) && start > 0 ? start : Date.now(),
        end: Number.isFinite(end) && end && end > 0 ? end : null,
        duration_s: Math.max(
          0,
          Math.min(7 * 24 * 3600, Math.floor(Number.isFinite(duration) ? duration : 0)),
        ),
        distance_km: Number(Number(log?.distance_km || 0).toFixed(3)),
        moving_time: Math.max(0, Math.floor(Number(log?.moving_time || 0))),
        detail: String(log?.detail || "").trim().slice(0, 160),
      };
    })
    .filter((log) => log.duration_s >= 5 || log.type === "network_offline")
    .slice(-120);
};

const summarizeSignalLogs = (logs: ReturnType<typeof normalizeSignalLogs>) => {
  const totalSeconds = logs.reduce(
    (sum, log) => sum + Number(log.duration_s || 0),
    0,
  );
  const byType = logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.type] = (acc[log.type] || 0) + 1;
    return acc;
  }, {});

  return {
    count: logs.length,
    total_seconds: totalSeconds,
    by_type: byType,
  };
};

const normalizeRestBlocks = (value: any) => {
  const blocks = Array.isArray(value) ? value : [];

  return blocks
    .map((block: any) => {
      const start = Number(block?.start || 0);
      const end =
        block?.end === undefined || block?.end === null ? null : Number(block.end);
      const duration = Number(
        block?.duration_s || (end && start ? (end - start) / 1000 : 0),
      );

      return {
        type: String(block?.type || "rest").trim().slice(0, 40) || "rest",
        label: String(block?.label || "Rest block").trim().slice(0, 80) || "Rest block",
        start: Number.isFinite(start) && start > 0 ? start : Date.now(),
        end: Number.isFinite(end) && end && end > 0 ? end : null,
        duration_s: Math.max(
          0,
          Math.min(14 * 24 * 3600, Math.floor(Number.isFinite(duration) ? duration : 0)),
        ),
        distance_km: Number(Number(block?.distance_km || 0).toFixed(3)),
        moving_time: Math.max(0, Math.floor(Number(block?.moving_time || 0))),
        note: String(block?.note || "").trim().slice(0, 160),
      };
    })
    .filter((block) => block.duration_s >= 20 * 60)
    .slice(-80);
};

const summarizeRestBlocks = (blocks: ReturnType<typeof normalizeRestBlocks>) => ({
  count: blocks.length,
  total_seconds: blocks.reduce(
    (sum, block) => sum + Number(block.duration_s || 0),
    0,
  ),
});

type NutritionSummaryEvent = {
  type: string;
  time: number;
  moving_time: number;
  distance_km: number;
};

const normalizeNutritionSummary = (value: any) => {
  const rawEvents: any[] = Array.isArray(value?.events) ? value.events : [];
  const events: NutritionSummaryEvent[] = rawEvents
    .map((event: any): NutritionSummaryEvent => ({
      type: String(event?.type || "water").trim().slice(0, 20),
      time: Number(event?.time || Date.now()),
      moving_time: Math.max(0, Math.floor(Number(event?.moving_time || 0))),
      distance_km: Number(Number(event?.distance_km || 0).toFixed(3)),
    }))
    .filter(
      (event: NutritionSummaryEvent) =>
        event.type === "water" ||
        event.type === "food" ||
        event.type === "water_food",
    )
    .slice(-120);

  const waterFromEvents = events.filter(
    (event: NutritionSummaryEvent) =>
      event.type === "water" || event.type === "water_food",
  ).length;
  const foodFromEvents = events.filter(
    (event: NutritionSummaryEvent) =>
      event.type === "food" || event.type === "water_food",
  ).length;

  return {
    enabled: value?.enabled !== false,
    water_count: Math.max(
      waterFromEvents,
      Math.floor(Number(value?.water_count || 0)),
    ),
    food_count: Math.max(
      foodFromEvents,
      Math.floor(Number(value?.food_count || 0)),
    ),
    events,
  };
};


const normalizeFinishReview = (value: any) => {
  const rawIssues: any[] = Array.isArray(value?.issues) ? value.issues : [];
  const rawChanges: any[] = Array.isArray(value?.changes) ? value.changes : [];

  return {
    status: String(value?.status || "unknown").trim().slice(0, 40),
    auto_repair_applied:
      value?.auto_repair_applied === true || value?.auto_repair_applied === 1,
    generated_at: normalizeIsoDate(value?.generated_at, new Date().toISOString()),
    counts:
      value?.counts && typeof value.counts === "object"
        ? {
            raw: Math.max(0, Math.floor(Number(value.counts.raw || 0))),
            valid: Math.max(0, Math.floor(Number(value.counts.valid || 0))),
            invalid: Math.max(0, Math.floor(Number(value.counts.invalid || 0))),
            duplicate: Math.max(0, Math.floor(Number(value.counts.duplicate || 0))),
            swapped: Math.max(0, Math.floor(Number(value.counts.swapped || 0))),
            gps_jumps: Math.max(0, Math.floor(Number(value.counts.gps_jumps || 0))),
            suspicious_speed: Math.max(
              0,
              Math.floor(Number(value.counts.suspicious_speed || 0)),
            ),
            long_gaps: Math.max(0, Math.floor(Number(value.counts.long_gaps || 0))),
          }
        : {},
    issues: rawIssues
      .map((issue: any) => ({
        severity: String(issue?.severity || "info").trim().slice(0, 20),
        code: String(issue?.code || "unknown").trim().slice(0, 60),
        message: String(issue?.message || "").trim().slice(0, 180),
        auto_fix: issue?.auto_fix === true || issue?.autoFix === true,
      }))
      .filter((issue: { message: string }) => issue.message)
      .slice(0, 30),
    changes: rawChanges
      .map((change: any) => String(change || "").trim().slice(0, 180))
      .filter(Boolean)
      .slice(0, 30),
    stats_before:
      value?.stats_before && typeof value.stats_before === "object"
        ? value.stats_before
        : {},
    stats_after:
      value?.stats_after && typeof value.stats_after === "object"
        ? value.stats_after
        : {},
  };
};

const normalizeCoordinateList = (value: any): RoutePoint[] => {
  const raw = extractCoordinateList(value);

  if (!Array.isArray(raw)) return [];

  return raw
    .map((point: any) => {
      if (Array.isArray(point)) {
        const first = Number(point[0]);
        const second = Number(point[1]);

        if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
          return normalizeRoutePoint({ lat: second, lng: first });
        }

        return normalizeRoutePoint({ lat: first, lng: second });
      }

      return normalizeRoutePoint(point);
    })
    .filter(Boolean) as RoutePoint[];
};

const loadRideCoordinates = async (polyline: string): Promise<RoutePoint[]> => {
  const raw = String(polyline || "").trim();

  if (!raw) return [];

  try {
    if (raw.startsWith("[") || raw.startsWith("{")) {
      return normalizeCoordinateList(JSON.parse(raw));
    }

    if (raw.startsWith("http")) {
      const response = await fetch(raw);
      if (!response.ok) return [];
      return normalizeCoordinateList(await response.json());
    }

    return decodePolyline(raw);
  } catch {
    return [];
  }
};


type ActivityDoctorSeverity = "info" | "warning" | "danger";

type ActivityDoctorIssue = {
  code: string;
  severity: ActivityDoctorSeverity;
  title: string;
  detail: string;
  fixable: boolean;
  action?: string;
  count?: number;
};

type ActivityDoctorChange = {
  field: string;
  before: any;
  after: any;
  reason: string;
};

type ActivityDoctorPoint = RoutePoint & {
  speed?: number;
  _source_index?: number;
  _swapped?: boolean;
};

type ActivityDoctorPayloadInfo = {
  source: "r2" | "fetch" | "inline_json" | "encoded_polyline" | "missing";
  object_key: string;
  raw_payload: any;
  error?: string;
};

const DOCTOR_LONG_GAP_SECONDS = 20 * 60;
const DOCTOR_MOVING_GAP_SECONDS = 5 * 60;
const DOCTOR_EXTREME_JUMP_METERS = 1500;
const DOCTOR_MAX_RAW_POINTS = 100000;
const DOCTOR_SCAN_VERSION = 4;
const DOCTOR_MIN_STATS_POINTS = 100;
const DOCTOR_MIN_TIMED_POINT_RATIO = 0.55;
const DOCTOR_MIN_ELEVATION_POINT_RATIO = 0.12;

const getR2PublicHostname = () => {
  try {
    return new URL(R2_PUBLIC_BASE_URL).hostname;
  } catch {
    return "";
  }
};

const normalizeActivityDoctorR2Key = (value: any) =>
  decodeURIComponent(String(value || "").trim())
    .replace(/^\/+/, "")
    .split(/[?#]/)[0]
    .replace(/\\+/g, "/")
    .slice(0, 300);

const isActivityDoctorR2ObjectKeyAllowed = (value: any) => {
  const key = normalizeActivityDoctorR2Key(value);

  if (!key || key.length > 300) return false;
  if (!key.endsWith(".json")) return false;
  if (key.includes("..") || key.includes("//")) return false;
  if (key.includes("repair-backups/")) return false;

  if (key.startsWith("gaspool/")) return true;

  // Legacy Gaspool activity JSON used to be stored in the R2 bucket root.
  // Example: gaspool_ride_1783092976455_572.json
  return /^gaspool_(ride|node)_[a-zA-Z0-9_-]+\.json$/.test(key);
};

const isActivityDoctorFetchUrlAllowed = (raw: string, objectKey = "") => {
  try {
    const url = new URL(raw);
    const allowedHost = getR2PublicHostname();
    const pathKey = normalizeActivityDoctorR2Key(url.pathname || "");
    const key = objectKey || pathKey;

    return (
      url.protocol === "https:" &&
      Boolean(allowedHost) &&
      url.hostname === allowedHost &&
      isActivityDoctorR2ObjectKeyAllowed(key)
    );
  } catch {
    return false;
  }
};

const normalizeDoctorActionList = (value: any) => {
  const list = Array.isArray(value) ? value : [];

  return Array.from(
    new Set(
      list
        .map((action: any) =>
          String(action || "")
            .trim()
            .replace(/[^a-z0-9_:-]/gi, "")
            .slice(0, 80),
        )
        .filter(Boolean),
    ),
  ).sort();
};

const sameDoctorActionList = (left: string[], right: string[]) =>
  JSON.stringify(normalizeDoctorActionList(left)) ===
  JSON.stringify(normalizeDoctorActionList(right));

const getRideObjectKeyFromPolyline = (value: any) => {
  const raw = String(value || "").trim();

  if (!raw) return "";

  const directKey = normalizeActivityDoctorR2Key(raw);
  if (isActivityDoctorR2ObjectKeyAllowed(directKey)) return directKey;

  try {
    const url = new URL(raw);
    const allowedHost = getR2PublicHostname();

    if (url.protocol !== "https:" || !allowedHost || url.hostname !== allowedHost) {
      return "";
    }

    const pathKey = normalizeActivityDoctorR2Key(url.pathname || "");
    if (isActivityDoctorR2ObjectKeyAllowed(pathKey)) return pathKey;
  } catch {}

  return "";
};

const loadActivityDoctorPayload = async (
  env: Bindings,
  polyline: any,
): Promise<ActivityDoctorPayloadInfo> => {
  const raw = String(polyline || "").trim();

  if (!raw) {
    return {
      source: "missing",
      object_key: "",
      raw_payload: null,
      error: "Polyline kosong.",
    };
  }

  const objectKey = getRideObjectKeyFromPolyline(raw);

  if (objectKey) {
    try {
      const object = await env.R2_BUCKET.get(objectKey);

      if (object) {
        return {
          source: "r2",
          object_key: objectKey,
          raw_payload: JSON.parse(await object.text()),
        };
      }
    } catch (e: any) {
      return {
        source: "r2",
        object_key: objectKey,
        raw_payload: null,
        error: e?.message || "Gagal membaca JSON R2.",
      };
    }

    const legacyFolderKey = !objectKey.startsWith("gaspool/") && /^gaspool_(ride|node)_[a-zA-Z0-9_-]+\.json$/.test(objectKey)
      ? `gaspool/${objectKey}`
      : "";

    if (legacyFolderKey && isActivityDoctorR2ObjectKeyAllowed(legacyFolderKey)) {
      try {
        const folderObject = await env.R2_BUCKET.get(legacyFolderKey);

        if (folderObject) {
          return {
            source: "r2",
            object_key: legacyFolderKey,
            raw_payload: JSON.parse(await folderObject.text()),
          };
        }
      } catch (e: any) {
        return {
          source: "r2",
          object_key: legacyFolderKey,
          raw_payload: null,
          error: e?.message || "Gagal membaca JSON R2 fallback folder.",
        };
      }
    }

    if (!raw.startsWith("http")) {
      return {
        source: "r2",
        object_key: objectKey,
        raw_payload: null,
        error: "Object route tidak ditemukan di R2.",
      };
    }
  }

  if (raw.startsWith("http")) {
    if (!isActivityDoctorFetchUrlAllowed(raw, objectKey)) {
      return {
        source: "fetch",
        object_key: objectKey,
        raw_payload: null,
        error: "Activity Doctor menolak fetch URL eksternal. Scan hanya memakai object R2 bucket atau URL publik R2 yang valid.",
      };
    }

    try {
      const response = await fetch(raw, {
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        return {
          source: "fetch",
          object_key: objectKey,
          raw_payload: null,
          error: `Fetch route gagal (${response.status}).`,
        };
      }

      return {
        source: "fetch",
        object_key: objectKey,
        raw_payload: await response.json(),
      };
    } catch (e: any) {
      return {
        source: "fetch",
        object_key: objectKey,
        raw_payload: null,
        error: e?.message || "Gagal fetch route JSON.",
      };
    }
  }

  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      return {
        source: "inline_json",
        object_key: "",
        raw_payload: JSON.parse(raw),
      };
    } catch (e: any) {
      return {
        source: "inline_json",
        object_key: "",
        raw_payload: null,
        error: e?.message || "Polyline JSON tidak valid.",
      };
    }
  }

  return {
    source: "encoded_polyline",
    object_key: "",
    raw_payload: raw,
  };
};

const normalizeDoctorPointTime = (value: any) => {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : 0;

    if (ms > 0) return new Date(ms).toISOString();
  }

  const parsed = Date.parse(String(value));

  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();

  return "";
};

const normalizeDoctorPoint = (
  point: any,
  sourceIndex: number,
): ActivityDoctorPoint | null => {
  let lat = NaN;
  let lng = NaN;
  let ele = NaN;
  let speed = NaN;
  let time = "";
  let swapped = false;

  if (Array.isArray(point)) {
    const first = Number(point[0]);
    const second = Number(point[1]);

    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
      lat = second;
      lng = first;
      swapped = true;
    } else {
      lat = first;
      lng = second;
    }

    ele = Number(point[2]);
    time = normalizeDoctorPointTime(point[3]);
  } else {
    lat = Number(point?.lat ?? point?.latitude);
    lng = Number(point?.lng ?? point?.lon ?? point?.longitude);

    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
      const originalLat = lat;
      lat = lng;
      lng = originalLat;
      swapped = true;
    }

    ele = Number(point?.ele ?? point?.elevation ?? point?.altitude);
    speed = Number(point?.speed ?? point?.speed_kmh ?? point?.speedKmh);
    time = normalizeDoctorPointTime(
      point?.time ?? point?.timestamp ?? point?.created_at ?? point?.t ?? point?.ts,
    );
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const normalized: ActivityDoctorPoint = {
    lat,
    lng,
    _source_index: sourceIndex,
  };

  if (Number.isFinite(ele)) normalized.ele = ele;
  if (Number.isFinite(speed)) normalized.speed = speed;
  if (time) normalized.time = time;
  if (swapped) normalized._swapped = true;

  return normalized;
};

const extractActivityDoctorRawPoints = (payload: any) => {
  if (typeof payload === "string") {
    const raw = payload.trim();

    if (!raw) return [];
    if (raw.startsWith("[") || raw.startsWith("{")) {
      try {
        return extractCoordinateList(JSON.parse(raw));
      } catch {
        return [];
      }
    }

    return decodePolyline(raw);
  }

  return extractCoordinateList(payload);
};

const dedupeDoctorPoints = (points: ActivityDoctorPoint[]) => {
  const clean: ActivityDoctorPoint[] = [];
  let removed = 0;

  for (const point of points) {
    const last = clean[clean.length - 1];

    if (last && getDistanceMeters(last, point) < 1) {
      const lastTime = last.time ? Date.parse(last.time) : 0;
      const pointTime = point.time ? Date.parse(point.time) : 0;

      if (!lastTime || !pointTime || Math.abs(pointTime - lastTime) <= 2000) {
        removed += 1;
        continue;
      }
    }

    clean.push(point);
  }

  return { points: clean, removed };
};

const detectDoctorRestBlocks = (points: ActivityDoctorPoint[]) => {
  const blocks: ReturnType<typeof normalizeRestBlocks> = [];
  let progressKm = 0;
  let movingTime = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    const distanceKm = getDistanceMeters(prev, point) / 1000;
    const prevMs = prev.time ? Date.parse(prev.time) : 0;
    const pointMs = point.time ? Date.parse(point.time) : 0;
    const gapSec = prevMs && pointMs ? Math.floor((pointMs - prevMs) / 1000) : 0;

    if (distanceKm > 0 && distanceKm < DOCTOR_EXTREME_JUMP_METERS / 1000) {
      progressKm += distanceKm;
    }

    if (gapSec > 0 && gapSec <= DOCTOR_MOVING_GAP_SECONDS) {
      movingTime += gapSec;
    }

    if (gapSec >= DOCTOR_LONG_GAP_SECONDS) {
      blocks.push({
        type: "detected_gap",
        label: "Rest gap terdeteksi",
        start: prevMs,
        end: pointMs,
        duration_s: gapSec,
        distance_km: Number(progressKm.toFixed(3)),
        moving_time: movingTime,
        note: "Ditemukan dari jeda timestamp antar titik GPS.",
      });
    }
  }

  return normalizeRestBlocks(blocks);
};

const getDoctorSpeedLimits = (activityType: string) => {
  const type = String(activityType || "ride").toLowerCase();

  if (type === "ride") {
    return {
      calculation_max_kmh: 120,
      trusted_max_kmh: 65,
      suspicious_ratio: 1.75,
    };
  }

  if (type === "run") {
    return {
      calculation_max_kmh: 45,
      trusted_max_kmh: 32,
      suspicious_ratio: 1.65,
    };
  }

  return {
    calculation_max_kmh: 25,
    trusted_max_kmh: 18,
    suspicious_ratio: 1.6,
  };
};

const getDoctorCurrentStats = (ride: any) => ({
  distance_km: Number(Number(ride?.distance || 0).toFixed(3)),
  moving_time: Math.max(0, Math.floor(Number(ride?.moving_time || 0))),
  average_speed: Number(Number(ride?.average_speed || 0).toFixed(2)),
  max_speed: Number(Number(ride?.max_speed || 0).toFixed(2)),
  total_elevation_gain: Number(Number(ride?.total_elevation_gain || 0).toFixed(1)),
});

const countDoctorTimedSegments = (points: ActivityDoctorPoint[]) => {
  let count = 0;

  for (let i = 1; i < points.length; i++) {
    const prevMs = points[i - 1]?.time ? Date.parse(String(points[i - 1].time)) : 0;
    const pointMs = points[i]?.time ? Date.parse(String(points[i].time)) : 0;

    if (prevMs && pointMs && pointMs > prevMs) count += 1;
  }

  return count;
};

const countDoctorElevationSamples = (points: ActivityDoctorPoint[]) =>
  points.filter((point) => Number.isFinite(Number(point.ele))).length;

const doctorStatTrustItem = (
  trusted: boolean,
  reason: string,
  raw: any,
  proposed: any,
  current: any,
) => ({ trusted, reason, raw, proposed, current });

const buildDoctorStatTrust = (
  ride: any,
  points: ActivityDoctorPoint[],
  activityType: string,
  rawStats: any,
) => {
  const current = getDoctorCurrentStats(ride);
  const pointCount = points.length;
  const segmentCount = Math.max(0, pointCount - 1);
  const timestampCount = points.filter((point) => Boolean(point.time)).length;
  const timedSegmentCount = countDoctorTimedSegments(points);
  const elevationSampleCount = countDoctorElevationSamples(points);
  const limits = getDoctorSpeedLimits(activityType);
  const isSparseRoute = pointCount > 0 && pointCount < DOCTOR_MIN_STATS_POINTS;
  const hasEnoughDistancePoints = pointCount >= DOCTOR_MIN_STATS_POINTS;
  const hasEnoughTimedPoints =
    pointCount > 0 &&
    timestampCount >= Math.max(20, Math.ceil(pointCount * DOCTOR_MIN_TIMED_POINT_RATIO)) &&
    timedSegmentCount >= Math.max(10, Math.ceil(segmentCount * 0.35));
  const hasEnoughElevationSamples =
    elevationSampleCount >= Math.max(
      20,
      Math.ceil(Math.max(pointCount, 1) * DOCTOR_MIN_ELEVATION_POINT_RATIO),
    );
  const distanceRatio =
    current.distance_km > 0 && rawStats.distance_km > 0
      ? rawStats.distance_km / current.distance_km
      : null;
  const movingRatio =
    current.moving_time > 0 && rawStats.moving_time > 0
      ? rawStats.moving_time / current.moving_time
      : null;
  const jumpRatio = segmentCount > 0 ? rawStats.skipped_jump_count / segmentCount : 0;
  const distanceMismatchExtreme =
    distanceRatio !== null && (distanceRatio < 0.65 || distanceRatio > 1.35);
  const movingMismatchExtreme =
    movingRatio !== null && (movingRatio < 0.35 || movingRatio > 1.35);
  const maxSpeedRatio =
    current.max_speed > 0 && rawStats.max_speed > 0
      ? rawStats.max_speed / current.max_speed
      : null;
  const maxSpeedLooksLikeSpike =
    rawStats.max_speed > limits.trusted_max_kmh ||
    (maxSpeedRatio !== null &&
      current.max_speed >= 8 &&
      maxSpeedRatio > limits.suspicious_ratio);

  const distanceTrusted =
    hasEnoughDistancePoints &&
    rawStats.distance_km > 0 &&
    !distanceMismatchExtreme &&
    jumpRatio <= 0.03;
  const movingTrusted =
    !isSparseRoute &&
    hasEnoughTimedPoints &&
    rawStats.moving_time > 0 &&
    !movingMismatchExtreme;
  const averageTrusted = distanceTrusted && movingTrusted && rawStats.average_speed > 0;
  const maxSpeedTrusted =
    !isSparseRoute &&
    hasEnoughTimedPoints &&
    rawStats.max_speed > 0 &&
    !maxSpeedLooksLikeSpike;
  const elevationTrusted =
    hasEnoughElevationSamples &&
    (rawStats.total_elevation_gain > 0 || current.total_elevation_gain <= 0);

  const safeStats = {
    distance_km: distanceTrusted ? rawStats.distance_km : current.distance_km,
    moving_time: movingTrusted ? rawStats.moving_time : current.moving_time,
    average_speed: averageTrusted ? rawStats.average_speed : current.average_speed,
    max_speed: maxSpeedTrusted ? rawStats.max_speed : current.max_speed,
    total_elevation_gain: elevationTrusted
      ? rawStats.total_elevation_gain
      : current.total_elevation_gain,
    skipped_jump_count: rawStats.skipped_jump_count,
    long_gap_count: rawStats.long_gap_count,
    suspicious_speed_count: rawStats.suspicious_speed_count,
  };

  const trust = {
    distance_km: doctorStatTrustItem(
      distanceTrusted,
      distanceTrusted
        ? "Point route cukup padat dan selisih jarak masih wajar."
        : isSparseRoute
          ? `Route hanya punya ${pointCount} titik; jarak D1 lebih aman dipertahankan.`
          : distanceMismatchExtreme
            ? `Selisih jarak terlalu besar (${distanceRatio ? distanceRatio.toFixed(2) + "x" : "n/a"}); D1 dipertahankan.`
            : jumpRatio > 0.03
              ? "Terlalu banyak GPS jump untuk update jarak otomatis."
              : "Jarak hasil hitung ulang belum cukup dipercaya.",
      rawStats.distance_km,
      safeStats.distance_km,
      current.distance_km,
    ),
    moving_time: doctorStatTrustItem(
      movingTrusted,
      movingTrusted
        ? "Timestamp GPS cukup lengkap untuk moving-time oriented stats."
        : isSparseRoute
          ? `Route hanya punya ${pointCount} titik; moving time D1 dipertahankan.`
          : !hasEnoughTimedPoints
            ? `Timestamp valid belum cukup (${timestampCount}/${pointCount} titik, ${timedSegmentCount}/${segmentCount} segmen).`
            : rawStats.moving_time <= 0 && current.moving_time > 0
              ? "Hasil repair moving time menjadi 0; D1 dipertahankan."
              : movingMismatchExtreme
                ? "Selisih moving time terlalu ekstrem; D1 dipertahankan."
                : "Moving time hasil hitung ulang belum cukup dipercaya.",
      rawStats.moving_time,
      safeStats.moving_time,
      current.moving_time,
    ),
    average_speed: doctorStatTrustItem(
      averageTrusted,
      averageTrusted
        ? "Average speed dihitung dari jarak dan moving time yang sama-sama trusted."
        : "Average speed dipertahankan karena jarak atau moving time tidak trusted.",
      rawStats.average_speed,
      safeStats.average_speed,
      current.average_speed,
    ),
    max_speed: doctorStatTrustItem(
      maxSpeedTrusted,
      maxSpeedTrusted
        ? "Max speed masih dalam batas wajar untuk tipe aktivitas."
        : maxSpeedLooksLikeSpike
          ? `Max speed repair ${rawStats.max_speed.toFixed(1)} km/h terlihat seperti spike; nilai D1 dipertahankan.`
          : !hasEnoughTimedPoints
            ? "Timestamp tidak cukup untuk max speed yang bisa dipercaya."
            : "Max speed hasil hitung ulang belum cukup dipercaya.",
      rawStats.max_speed,
      safeStats.max_speed,
      current.max_speed,
    ),
    total_elevation_gain: doctorStatTrustItem(
      elevationTrusted,
      elevationTrusted
        ? "Sample elevasi cukup untuk update elevation gain."
        : !hasEnoughElevationSamples
          ? `Sample elevasi tidak cukup (${elevationSampleCount}/${pointCount} titik); nilai D1 dipertahankan.`
          : rawStats.total_elevation_gain <= 0 && current.total_elevation_gain > 0
            ? "Hasil repair elevasi menjadi 0; nilai D1 dipertahankan."
            : "Elevation gain hasil hitung ulang belum cukup dipercaya.",
      rawStats.total_elevation_gain,
      safeStats.total_elevation_gain,
      current.total_elevation_gain,
    ),
  };

  const untrustedFields = Object.entries(trust)
    .filter(([, value]: any) => !value.trusted && JSON.stringify(value.raw ?? null) !== JSON.stringify(value.current ?? null))
    .map(([field]) => field);

  return {
    current,
    raw: rawStats,
    safe: safeStats,
    trust,
    quality: {
      point_count: pointCount,
      segment_count: segmentCount,
      timestamp_points: timestampCount,
      timed_segments: timedSegmentCount,
      elevation_samples: elevationSampleCount,
      skipped_jump_count: rawStats.skipped_jump_count,
      suspicious_speed_count: rawStats.suspicious_speed_count,
      distance_ratio: distanceRatio,
      moving_ratio: movingRatio,
      max_speed_ratio: maxSpeedRatio,
      is_sparse_route: isSparseRoute,
      has_enough_timed_points: hasEnoughTimedPoints,
      has_enough_elevation_samples: hasEnoughElevationSamples,
    },
    untrusted_fields: untrustedFields,
  };
};

const recalculateDoctorStats = (
  points: ActivityDoctorPoint[],
  activityType: string,
) => {
  let distanceKm = 0;
  let movingTime = 0;
  let maxSpeed = 0;
  let elevationGain = 0;
  let skippedJumpCount = 0;
  let longGapCount = 0;
  let suspiciousSpeedCount = 0;
  let lastEle: number | null = null;
  const plausibleMaxSpeed = getDoctorSpeedLimits(activityType).calculation_max_kmh;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    const distanceM = getDistanceMeters(prev, point);
    const distanceSegmentKm = distanceM / 1000;
    const prevMs = prev.time ? Date.parse(prev.time) : 0;
    const pointMs = point.time ? Date.parse(point.time) : 0;
    const gapSec = prevMs && pointMs ? Math.floor((pointMs - prevMs) / 1000) : 0;
    const segmentSpeed = gapSec > 0 ? distanceSegmentKm / (gapSec / 3600) : 0;

    if (distanceM >= DOCTOR_EXTREME_JUMP_METERS && (!gapSec || gapSec < DOCTOR_LONG_GAP_SECONDS)) {
      skippedJumpCount += 1;
      continue;
    }

    if (gapSec >= DOCTOR_LONG_GAP_SECONDS) {
      longGapCount += 1;
    }

    if (segmentSpeed > plausibleMaxSpeed && gapSec > 0) {
      suspiciousSpeedCount += 1;
    }

    if (distanceM >= 1 && distanceM < DOCTOR_EXTREME_JUMP_METERS) {
      distanceKm += distanceSegmentKm;
    }

    if (gapSec > 0 && gapSec <= DOCTOR_MOVING_GAP_SECONDS && segmentSpeed <= plausibleMaxSpeed) {
      movingTime += gapSec;
    }

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
      }

      lastEle = ele;
    }
  }

  const averageSpeed = movingTime > 0 ? distanceKm / (movingTime / 3600) : 0;

  return {
    distance_km: Number(distanceKm.toFixed(3)),
    moving_time: Math.max(0, Math.floor(movingTime)),
    average_speed: Number(averageSpeed.toFixed(2)),
    max_speed: Number(maxSpeed.toFixed(2)),
    total_elevation_gain: Number(elevationGain.toFixed(1)),
    skipped_jump_count: skippedJumpCount,
    long_gap_count: longGapCount,
    suspicious_speed_count: suspiciousSpeedCount,
  };
};

const pushDoctorIssue = (
  issues: ActivityDoctorIssue[],
  issue: ActivityDoctorIssue,
) => {
  if (!issues.some((existing) => existing.code === issue.code)) {
    issues.push(issue);
  }
};

const pushDoctorChange = (
  changes: ActivityDoctorChange[],
  field: string,
  before: any,
  after: any,
  reason: string,
) => {
  const beforeString = JSON.stringify(before ?? null);
  const afterString = JSON.stringify(after ?? null);

  if (beforeString === afterString) return;

  changes.push({ field, before, after, reason });
};

const getDoctorPayloadObject = (payload: any): any =>
  payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};

const getDoctorAcknowledgedActions = (metadata: any) => {
  const actions = new Set<string>();

  if (Array.isArray(metadata?.repair_acknowledged_actions)) {
    metadata.repair_acknowledged_actions.forEach((action: any) => {
      const normalized = String(action || "").trim();
      if (normalized) actions.add(normalized);
    });
  }

  if (Array.isArray(metadata?.repair_history)) {
    metadata.repair_history.slice(-10).forEach((entry: any) => {
      if (!Array.isArray(entry?.actions)) return;
      entry.actions.forEach((action: any) => {
        const normalized = String(action || "").trim();
        if (normalized) actions.add(normalized);
      });
    });
  }

  return actions;
};

const cleanDoctorRepairPoint = (point: ActivityDoctorPoint) => {
  const cleaned: any = {
    lat: Number(Number(point.lat).toFixed(7)),
    lng: Number(Number(point.lng).toFixed(7)),
  };

  if (Number.isFinite(Number(point.ele))) {
    cleaned.ele = Number(Number(point.ele).toFixed(1));
  }

  if (Number.isFinite(Number(point.speed))) {
    cleaned.speed = Number(Number(point.speed).toFixed(2));
  }

  if (point.time) cleaned.time = point.time;

  return cleaned;
};

const mergeDoctorRestBlocks = (
  existing: ReturnType<typeof normalizeRestBlocks>,
  detected: ReturnType<typeof normalizeRestBlocks>,
) => {
  const merged: ReturnType<typeof normalizeRestBlocks> = [];
  const seen = new Set<string>();

  [...existing, ...detected].forEach((block) => {
    const start = Math.floor(Number(block.start || 0) / 1000);
    const end = Math.floor(Number(block.end || 0) / 1000);
    const key = `${block.type}:${start}:${end}:${Math.floor(Number(block.duration_s || 0) / 60)}`;

    if (seen.has(key)) return;
    seen.add(key);
    merged.push(block);
  });

  return merged
    .sort((a, b) => Number(a.start || 0) - Number(b.start || 0))
    .slice(-80);
};

const getDoctorRepairTargetKey = (rideId: number, payloadInfo: ActivityDoctorPayloadInfo) => {
  const currentKey = String(payloadInfo.object_key || "").trim();

  if (currentKey.startsWith("gaspool/") && !currentKey.includes("repair-backups/")) {
    return currentKey;
  }

  return `gaspool/gaspool_ride_repaired_${rideId}_${Date.now()}_${Math.floor(
    Math.random() * 1000,
  )}.json`;
};

const buildDoctorBackupKey = (rideId: number) =>
  `gaspool/repair-backups/ride_${rideId}_${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;

const buildActivityDoctorRepair = (
  ride: any,
  payloadInfo: ActivityDoctorPayloadInfo,
  scan: ReturnType<typeof buildActivityDoctorScan>,
) => {
  const payload = payloadInfo.raw_payload;
  const payloadObject = getDoctorPayloadObject(payload);
  const metadata = payloadObject.metadata || {};
  const rawPoints = extractActivityDoctorRawPoints(payload);
  const boundedRawPoints = rawPoints.slice(0, DOCTOR_MAX_RAW_POINTS);
  const normalizedRecords = boundedRawPoints.map((point: any, index: number) =>
    normalizeDoctorPoint(point, index),
  );
  const validPoints = normalizedRecords.filter(Boolean) as ActivityDoctorPoint[];
  const points = dedupeDoctorPoints(validPoints).points;
  const cleanPoints = points.map(cleanDoctorRepairPoint);
  const activityType = String(
    ride?.activity_type || metadata?.activity_type || "ride",
  ).toLowerCase();
  const rawRecalculated = recalculateDoctorStats(points, activityType);
  const safeStats = scan?.stats?.recalculated || rawRecalculated;
  const existingRestBlocks = normalizeRestBlocks(payloadObject.rest_blocks);
  const detectedRestBlocks = scan?.stats?.trust?.moving_time?.trusted
    ? detectDoctorRestBlocks(points)
    : existingRestBlocks;
  const restBlocks = mergeDoctorRestBlocks(existingRestBlocks, detectedRestBlocks);
  const restSummary = summarizeRestBlocks(restBlocks);
  const stages = normalizeActivityStages(payloadObject.stages);
  const signalLogs = normalizeSignalLogs(payloadObject.signal_logs);
  const signalSummary = summarizeSignalLogs(signalLogs);
  const nutritionSummary = normalizeNutritionSummary(payloadObject.nutrition_summary);
  const nowIso = new Date().toISOString();
  const currentTimeContext = metadata?.time_context || {};
  const firstPointTime = cleanPoints.find((point: any) => point.time)?.time || "";
  const startDateIso = normalizeIsoDate(
    currentTimeContext.start_date || firstPointTime || ride?.start_date,
    nowIso,
  );
  const finishPointTime = [...cleanPoints].reverse().find((point: any) => point.time)?.time || "";
  const finishDateIso = normalizeIsoDate(
    currentTimeContext.finish_date || finishPointTime || nowIso,
    nowIso,
  );
  const previousHistory = Array.isArray(metadata?.repair_history)
    ? metadata.repair_history.slice(-30)
    : [];
  const previousAcknowledged = Array.from(getDoctorAcknowledgedActions(metadata));
  const appliedActions = Array.from(
    new Set([...previousAcknowledged, ...scan.repair_plan]),
  ).slice(-80);
  const repairEntry = {
    at: nowIso,
    version: 1,
    mode: "auto",
    actions: scan.repair_plan,
    changes: scan.changes.map((change) => ({
      field: change.field,
      before: change.before,
      after: change.after,
    })),
    stats_before: scan.stats.current,
    stats_after: safeStats,
    raw_stats_after: rawRecalculated,
  };
  const basePayload =
    payloadObject && !payloadObject.type && !payloadObject.features
      ? { ...payloadObject }
      : {};

  delete (basePayload as any).coordinates;
  delete (basePayload as any).path;
  delete (basePayload as any).data;
  delete (basePayload as any).polyline;
  delete (basePayload as any).geometry;

  const repairedPayload = {
    ...basePayload,
    points: cleanPoints,
    stages,
    rest_blocks: restBlocks,
    nutrition_summary: nutritionSummary,
    signal_logs: signalLogs,
    metadata: {
      ...metadata,
      activity_type: activityType,
      distance_km: safeStats.distance_km,
      moving_time: safeStats.moving_time,
      average_speed: safeStats.average_speed,
      max_speed: safeStats.max_speed,
      total_elevation_gain: safeStats.total_elevation_gain,
      time_context: {
        ...currentTimeContext,
        start_date: startDateIso,
        finish_date: finishDateIso,
        start_timezone_offset_min: normalizeTimezoneOffset(
          currentTimeContext.start_timezone_offset_min,
        ),
        finish_timezone_offset_min: normalizeTimezoneOffset(
          currentTimeContext.finish_timezone_offset_min,
        ),
        start_timezone_name: normalizeTimezoneName(
          currentTimeContext.start_timezone_name,
        ),
        finish_timezone_name: normalizeTimezoneName(
          currentTimeContext.finish_timezone_name,
        ),
      },
      rest_summary: restSummary,
      nutrition_summary: {
        enabled: nutritionSummary.enabled,
        water_count: nutritionSummary.water_count,
        food_count: nutritionSummary.food_count,
      },
      signal_summary: signalSummary,
      source: metadata?.source || ride?.source || "GASPOOL",
      exported_at: metadata?.exported_at || nowIso,
      repaired_at: nowIso,
      doctor_guard_version: DOCTOR_SCAN_VERSION,
      stat_trust: scan?.stats?.trust || {},
      raw_recalculated_stats: rawRecalculated,
      repair_acknowledged_actions: appliedActions,
      repair_history: [...previousHistory, repairEntry].slice(-30),
    },
  };

  return {
    payload: repairedPayload,
    points,
    stats: safeStats,
    start_date: startDateIso,
    applied_actions: scan.repair_plan,
  };
};

const buildActivityDoctorScan = (
  ride: any,
  payloadInfo: ActivityDoctorPayloadInfo,
) => {
  const issues: ActivityDoctorIssue[] = [];
  const changes: ActivityDoctorChange[] = [];
  const payload = payloadInfo.raw_payload;
  const rawPoints = extractActivityDoctorRawPoints(payload);
  const boundedRawPoints = rawPoints.slice(0, DOCTOR_MAX_RAW_POINTS);
  const normalizedRecords = boundedRawPoints.map((point: any, index: number) =>
    normalizeDoctorPoint(point, index),
  );
  const validPoints = normalizedRecords.filter(Boolean) as ActivityDoctorPoint[];
  const invalidPointCount = normalizedRecords.length - validPoints.length;
  const swappedPointCount = validPoints.filter((point) => point._swapped).length;
  const deduped = dedupeDoctorPoints(validPoints);
  const points = deduped.points;
  const payloadObject = getDoctorPayloadObject(payload);
  const metadata = payloadObject.metadata || {};
  const acknowledgedActions = getDoctorAcknowledgedActions(metadata);
  const activityType = String(ride?.activity_type || metadata?.activity_type || "ride");
  const rawRecalculated = recalculateDoctorStats(points, activityType);
  const statTrust = buildDoctorStatTrust(ride, points, activityType, rawRecalculated);
  const currentStats = statTrust.current;
  const proposedStats = statTrust.safe;
  const timestampCount = statTrust.quality.timestamp_points;
  const existingRestBlocks = normalizeRestBlocks(payloadObject.rest_blocks);
  const detectedRestBlocks = statTrust.trust.moving_time.trusted
    ? detectDoctorRestBlocks(points)
    : existingRestBlocks;
  const timeContext = metadata?.time_context || {};
  const rawShape = Array.isArray(payload)
    ? "legacy_array"
    : payload && typeof payload === "object"
      ? payload.points
        ? "wrapped_points"
        : payload.coordinates
          ? "coordinates_object"
          : "object"
      : typeof payload === "string"
        ? "encoded_polyline"
        : "missing";

  if (payloadInfo.error) {
    pushDoctorIssue(issues, {
      code: "payload_read_error",
      severity: "danger",
      title: "Route JSON tidak bisa dibaca",
      detail: payloadInfo.error,
      fixable: false,
    });
  }

  if (rawPoints.length > DOCTOR_MAX_RAW_POINTS) {
    pushDoctorIssue(issues, {
      code: "too_many_points",
      severity: "danger",
      title: "Route terlalu besar untuk auto repair",
      detail: `Activity Doctor membatasi scan ke ${DOCTOR_MAX_RAW_POINTS} titik agar Worker tetap aman. Aktivitas ini punya ${rawPoints.length} titik.`,
      fixable: false,
      count: rawPoints.length,
    });
  }

  if (rawShape === "legacy_array" || rawShape === "encoded_polyline") {
    pushDoctorIssue(issues, {
      code: "legacy_route_format",
      severity: "info",
      title: "Format route lama terdeteksi",
      detail: "Route bisa dinormalisasi ke format wrapper baru agar metadata, rest block, dan repair history bisa tersimpan rapi.",
      fixable: true,
      action: "normalize_route_wrapper",
    });
    pushDoctorChange(changes, "route_format", rawShape, "wrapped_points", "Normalisasi route lama ke struktur JSON baru.");
  }

  if (rawPoints.length < 2 || points.length < 2) {
    pushDoctorIssue(issues, {
      code: "route_points_missing",
      severity: "danger",
      title: "Route point tidak cukup",
      detail: "Aktivitas butuh minimal dua titik GPS valid untuk dihitung ulang.",
      fixable: false,
      count: points.length,
    });
  }

  if (
    points.length >= 2 &&
    (statTrust.quality.is_sparse_route || !statTrust.quality.has_enough_timed_points)
  ) {
    const reasons: string[] = [];
    if (statTrust.quality.is_sparse_route) {
      reasons.push(`${points.length} titik terlalu sedikit untuk statistik penuh`);
    }
    if (!statTrust.quality.has_enough_timed_points) {
      reasons.push(`${timestampCount}/${points.length} titik punya timestamp valid`);
    }

    pushDoctorIssue(issues, {
      code: "stats_repair_limited",
      severity: "warning",
      title: "Repair statistik dibatasi",
      detail: `${reasons.join("; ")}. Doctor boleh menormalkan JSON/metadata, tetapi statistik D1 yang tidak trusted akan dipertahankan.`,
      fixable: false,
      count: points.length,
    });
  }

  if (invalidPointCount > 0) {
    pushDoctorIssue(issues, {
      code: "invalid_points",
      severity: "warning",
      title: "Titik GPS invalid ditemukan",
      detail: `${invalidPointCount} titik tanpa koordinat valid bisa dibuang otomatis dari route JSON.`,
      fixable: true,
      action: "drop_invalid_points",
      count: invalidPointCount,
    });
    pushDoctorChange(changes, "points.invalid_removed", invalidPointCount, 0, "Buang titik GPS korup.");
  }

  if (swappedPointCount > 0) {
    pushDoctorIssue(issues, {
      code: "swapped_coordinates",
      severity: "info",
      title: "Koordinat terbalik terdeteksi",
      detail: `${swappedPointCount} titik terlihat memakai urutan lng/lat dan bisa dinormalisasi ke lat/lng.`,
      fixable: true,
      action: "normalize_coordinate_order",
      count: swappedPointCount,
    });
    pushDoctorChange(changes, "points.swapped_coordinates", swappedPointCount, 0, "Normalisasi urutan koordinat.");
  }

  if (deduped.removed > 0) {
    pushDoctorIssue(issues, {
      code: "duplicate_points",
      severity: "info",
      title: "Titik GPS duplikat ditemukan",
      detail: `${deduped.removed} titik duplikat berurutan bisa dibersihkan otomatis.`,
      fixable: true,
      action: "dedupe_points",
      count: deduped.removed,
    });
    pushDoctorChange(changes, "points.duplicate_removed", deduped.removed, 0, "Hapus duplikat berurutan.");
  }

  if (rawRecalculated.skipped_jump_count > 0 && !acknowledgedActions.has("ignore_extreme_gps_jumps")) {
    const canUseJumpGuard = statTrust.trust.distance_km.trusted || statTrust.trust.moving_time.trusted;
    pushDoctorIssue(issues, {
      code: "gps_jumps",
      severity: "warning",
      title: "GPS jump ekstrem terdeteksi",
      detail: canUseJumpGuard
        ? `${rawRecalculated.skipped_jump_count} segmen terlihat seperti lompatan GPS dan bisa diabaikan dari statistik repair.`
        : `${rawRecalculated.skipped_jump_count} segmen terlihat seperti lompatan GPS. Statistik D1 dipertahankan karena data belum cukup trusted.`,
      fixable: canUseJumpGuard,
      action: canUseJumpGuard ? "ignore_extreme_gps_jumps" : undefined,
      count: rawRecalculated.skipped_jump_count,
    });
  }

  if (
    rawRecalculated.suspicious_speed_count > 0 &&
    !acknowledgedActions.has("recalculate_stats_with_speed_guard")
  ) {
    const canUseSpeedGuard = statTrust.trust.moving_time.trusted || statTrust.trust.max_speed.trusted;
    pushDoctorIssue(issues, {
      code: "suspicious_speed",
      severity: "warning",
      title: "Kecepatan segmen tidak wajar",
      detail: canUseSpeedGuard
        ? `${rawRecalculated.suspicious_speed_count} segmen melampaui batas wajar untuk tipe aktivitas ini dan akan diabaikan dari statistik repair.`
        : `${rawRecalculated.suspicious_speed_count} segmen melampaui batas wajar. Statistik terkait speed dipertahankan.`,
      fixable: canUseSpeedGuard,
      action: canUseSpeedGuard ? "recalculate_stats_with_speed_guard" : undefined,
      count: rawRecalculated.suspicious_speed_count,
    });
  }

  if (statTrust.trust.moving_time.trusted && detectedRestBlocks.length > existingRestBlocks.length) {
    pushDoctorIssue(issues, {
      code: "missing_rest_blocks",
      severity: "info",
      title: "Rest block bisa ditambahkan",
      detail: `${detectedRestBlocks.length} jeda panjang ditemukan dari timestamp GPS.`,
      fixable: true,
      action: "add_detected_rest_blocks",
      count: detectedRestBlocks.length,
    });
    pushDoctorChange(
      changes,
      "rest_blocks.count",
      existingRestBlocks.length,
      detectedRestBlocks.length,
      "Tambahkan rest block dari gap timestamp.",
    );
  }

  const missingMetadata: string[] = [];
  if (!metadata?.source) missingMetadata.push("source");
  if (!metadata?.activity_type) missingMetadata.push("activity_type");
  if (!metadata?.time_context) missingMetadata.push("time_context");
  if (!metadata?.rest_summary) missingMetadata.push("rest_summary");
  if (!metadata?.repair_history) missingMetadata.push("repair_history");

  if (missingMetadata.length > 0) {
    pushDoctorIssue(issues, {
      code: "missing_metadata",
      severity: "info",
      title: "Metadata belum lengkap",
      detail: `Field metadata kosong: ${missingMetadata.join(", ")}.`,
      fixable: true,
      action: "fill_missing_metadata",
      count: missingMetadata.length,
    });
    pushDoctorChange(changes, "metadata.missing_fields", missingMetadata, [], "Isi metadata dasar dari D1 dan payload aktivitas.");
  }

  const statChanged = (field: keyof typeof currentStats, threshold = 0) =>
    Math.abs(Number(currentStats[field] || 0) - Number(proposedStats[field] || 0)) > threshold;
  const rawChanged = (field: keyof typeof currentStats, threshold = 0) =>
    Math.abs(Number(currentStats[field] || 0) - Number(rawRecalculated[field] || 0)) > threshold;

  if (statChanged("distance_km", 0.02)) {
    pushDoctorIssue(issues, {
      code: "distance_mismatch",
      severity: "warning",
      title: "Jarak D1 beda dari route GPS",
      detail: `D1 ${currentStats.distance_km.toFixed(2)} km, hasil trusted repair ${proposedStats.distance_km.toFixed(2)} km.`,
      fixable: true,
      action: "recalculate_distance",
    });
    pushDoctorChange(changes, "distance", currentStats.distance_km, proposedStats.distance_km, "Hitung ulang jarak dari titik GPS valid yang trusted.");
  } else if (!statTrust.trust.distance_km.trusted && rawChanged("distance_km", 0.3)) {
    pushDoctorIssue(issues, {
      code: "distance_repair_untrusted",
      severity: "warning",
      title: "Jarak repair tidak trusted",
      detail: statTrust.trust.distance_km.reason,
      fixable: false,
    });
    pushDoctorChange(changes, "distance.preserved", rawRecalculated.distance_km, currentStats.distance_km, "Jarak D1 dipertahankan karena hasil hitung ulang belum trusted.");
  }

  if (statChanged("moving_time", 60)) {
    pushDoctorIssue(issues, {
      code: "moving_time_mismatch",
      severity: "warning",
      title: "Moving time perlu dicek",
      detail: `D1 ${formatRecordDuration(currentStats.moving_time)}, hasil trusted repair ${formatRecordDuration(proposedStats.moving_time)}.`,
      fixable: true,
      action: "recalculate_moving_time",
    });
    pushDoctorChange(changes, "moving_time", currentStats.moving_time, proposedStats.moving_time, "Estimasi ulang moving time dengan guard long gap dan timestamp trusted.");
  } else if (!statTrust.trust.moving_time.trusted && rawChanged("moving_time", 5 * 60)) {
    pushDoctorIssue(issues, {
      code: "moving_time_repair_untrusted",
      severity: "warning",
      title: "Moving time repair tidak trusted",
      detail: statTrust.trust.moving_time.reason,
      fixable: false,
    });
    pushDoctorChange(changes, "moving_time.preserved", rawRecalculated.moving_time, currentStats.moving_time, "Moving time D1 dipertahankan karena timestamp tidak cukup trusted.");
  }

  if (statChanged("average_speed", 0.2)) {
    pushDoctorIssue(issues, {
      code: "average_speed_recalculated",
      severity: "info",
      title: "Average speed akan dihitung ulang",
      detail: "Average speed mengikuti jarak dan moving time trusted.",
      fixable: true,
      action: "recalculate_average_speed",
    });
    pushDoctorChange(changes, "average_speed", currentStats.average_speed, proposedStats.average_speed, "Hitung ulang average speed dari statistik trusted.");
  } else if (!statTrust.trust.average_speed.trusted && rawChanged("average_speed", 0.5)) {
    pushDoctorIssue(issues, {
      code: "average_speed_repair_untrusted",
      severity: "warning",
      title: "Average speed repair tidak trusted",
      detail: statTrust.trust.average_speed.reason,
      fixable: false,
    });
    pushDoctorChange(changes, "average_speed.preserved", rawRecalculated.average_speed, currentStats.average_speed, "Average speed D1 dipertahankan karena jarak atau moving time tidak trusted.");
  }

  if (statChanged("max_speed", 0.5)) {
    pushDoctorIssue(issues, {
      code: "max_speed_recalculated",
      severity: "info",
      title: "Max speed akan dihitung ulang",
      detail: "Max speed repair masih dalam batas wajar untuk tipe aktivitas.",
      fixable: true,
      action: "recalculate_max_speed",
    });
    pushDoctorChange(changes, "max_speed", currentStats.max_speed, proposedStats.max_speed, "Hitung ulang max speed dari titik GPS trusted.");
  } else if (!statTrust.trust.max_speed.trusted && rawChanged("max_speed", 1)) {
    pushDoctorIssue(issues, {
      code: "max_speed_repair_untrusted",
      severity: "warning",
      title: "Max speed repair ditahan",
      detail: statTrust.trust.max_speed.reason,
      fixable: false,
    });
    pushDoctorChange(changes, "max_speed.preserved", rawRecalculated.max_speed, currentStats.max_speed, "Max speed D1 dipertahankan karena hasil repair terlihat seperti spike atau timestamp kurang.");
  }

  if (statChanged("total_elevation_gain", 1)) {
    pushDoctorIssue(issues, {
      code: "elevation_gain_recalculated",
      severity: "info",
      title: "Elevasi akan dihitung ulang",
      detail: "Sample elevasi cukup untuk update total elevation gain.",
      fixable: true,
      action: "recalculate_elevation_gain",
    });
    pushDoctorChange(changes, "total_elevation_gain", currentStats.total_elevation_gain, proposedStats.total_elevation_gain, "Hitung ulang elevation gain dari sample elevasi trusted.");
  } else if (!statTrust.trust.total_elevation_gain.trusted && rawChanged("total_elevation_gain", 1)) {
    pushDoctorIssue(issues, {
      code: "elevation_gain_repair_untrusted",
      severity: "warning",
      title: "Elevasi repair ditahan",
      detail: statTrust.trust.total_elevation_gain.reason,
      fixable: false,
    });
    pushDoctorChange(changes, "total_elevation_gain.preserved", rawRecalculated.total_elevation_gain, currentStats.total_elevation_gain, "Elevasi D1 dipertahankan karena sample elevasi tidak cukup atau hasil repair menjadi nol.");
  }

  const repairPlan = Array.from(
    new Set(
      issues
        .filter((issue) => issue.fixable && issue.action)
        .map((issue) => String(issue.action)),
    ),
  );
  const dangerCount = issues.filter((issue) => issue.severity === "danger").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const hasUntrustedStatDelta = statTrust.untrusted_fields.length > 0;
  const status = dangerCount > 0 ? "broken" : warningCount > 0 ? "needs_attention" : issues.length > 0 ? "repairable" : "healthy";
  const canAutoRepair = dangerCount === 0 && repairPlan.length > 0;
  const recommendation = (() => {
    if (issues.length === 0) {
      return {
        level: "healthy",
        label: "SEHAT",
        summary: "Tidak perlu repair",
        detail: "Route JSON, metadata, dan statistik terlihat konsisten.",
        can_apply: false,
      };
    }

    if (dangerCount > 0) {
      return {
        level: "danger",
        label: "MANUAL CHECK",
        summary: "Tidak aman untuk auto repair",
        detail: "Doctor menemukan masalah fatal seperti route tidak terbaca atau point valid kurang. Jangan apply auto repair.",
        can_apply: false,
      };
    }

    if (canAutoRepair && hasUntrustedStatDelta) {
      return {
        level: "warning",
        label: "AMAN SEBAGIAN",
        summary: "Repair aman, statistik rawan dipertahankan",
        detail: "Doctor hanya akan menerapkan perbaikan yang trusted. Statistik yang berpotensi merusak data, seperti elevasi kosong atau max speed spike, akan tetap memakai nilai D1 lama.",
        can_apply: true,
      };
    }

    if (canAutoRepair) {
      return {
        level: warningCount > 0 ? "warning" : "safe",
        label: warningCount > 0 ? "AMAN DENGAN BACKUP" : "AMAN DIREPAIR",
        summary: "Auto repair tersedia",
        detail: "Gaspool akan membuat backup R2 dulu, lalu menerapkan perbaikan aman dan update D1 terakhir.",
        can_apply: true,
      };
    }

    if (hasUntrustedStatDelta) {
      return {
        level: "danger",
        label: "JANGAN REPAIR STATISTIK",
        summary: "Hasil hitung ulang berisiko merusak data",
        detail: "Doctor tidak menemukan perbaikan aman untuk diterapkan. Pertahankan statistik D1 sampai ada raw GPS lengkap atau metadata yang lebih baik.",
        can_apply: false,
      };
    }

    return {
      level: "info",
      label: "INFO SAJA",
      summary: "Tidak ada auto repair yang perlu diterapkan",
      detail: "Doctor hanya menemukan catatan informatif atau perubahan yang belum didukung auto repair.",
      can_apply: false,
    };
  })();

  return {
    status,
    healthy: issues.length === 0,
    can_auto_repair: canAutoRepair,
    recommendation,
    stats_repair_allowed: !hasUntrustedStatDelta,
    partial_stat_repair: hasUntrustedStatDelta,
    dry_run: true,
    source: payloadInfo.source,
    object_key: payloadInfo.object_key,
    raw_shape: rawShape,
    counts: {
      raw_points: rawPoints.length,
      scanned_points: boundedRawPoints.length,
      valid_points: validPoints.length,
      normalized_points: points.length,
      timestamp_points: timestampCount,
      timed_segments: statTrust.quality.timed_segments,
      elevation_samples: statTrust.quality.elevation_samples,
      invalid_points: invalidPointCount,
      duplicate_points: deduped.removed,
      swapped_points: swappedPointCount,
    },
    stats: {
      current: currentStats,
      recalculated: proposedStats,
      raw_recalculated: rawRecalculated,
      trust: statTrust.trust,
      quality: statTrust.quality,
    },
    rest_blocks: {
      existing_count: existingRestBlocks.length,
      detected_count: detectedRestBlocks.length,
      detected_total_seconds: detectedRestBlocks.reduce(
        (sum, block) => sum + Number(block.duration_s || 0),
        0,
      ),
    },
    issues,
    changes,
    repair_plan: repairPlan,
    guardrails: {
      version: DOCTOR_SCAN_VERSION,
      max_raw_points: DOCTOR_MAX_RAW_POINTS,
      apply_confirmation_required: true,
      backup_required: true,
      external_fetch_policy: "r2_bucket_or_configured_r2_public_url_only_with_legacy_root_activity_json",
      sparse_or_untimed_route_blocks_stat_repair: true,
      partial_stat_trust_enabled: true,
      untrusted_stats_are_preserved: true,
    },
    route_sample: sampleRoutePoints(points, 12).map((point) => ({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
    })),
  };
};

const sampleRoutePoints = (points: RoutePoint[], size = 24) => {
  if (points.length <= size) return points;

  const sampled: RoutePoint[] = [];
  const maxIndex = points.length - 1;

  for (let i = 0; i < size; i++) {
    sampled.push(points[Math.round((i / (size - 1)) * maxIndex)]);
  }

  return sampled;
};

const nearestAverageDistanceKm = (
  source: RoutePoint[],
  target: RoutePoint[],
) => {
  if (!source.length || !target.length) return Number.POSITIVE_INFINITY;

  const total = source.reduce((sum, point) => {
    const nearest = target.reduce((best, candidate) => {
      const distance = getDistanceMeters(point, candidate) / 1000;
      return Math.min(best, distance);
    }, Number.POSITIVE_INFINITY);

    return sum + nearest;
  }, 0);

  return total / source.length;
};

const routeDirectionScore = (
  current: RoutePoint[],
  candidate: RoutePoint[],
) => {
  const currentSample = sampleRoutePoints(current);
  const candidateSample = sampleRoutePoints(candidate);
  const startDistanceKm =
    getDistanceMeters(current[0], candidate[0]) / 1000;
  const finishDistanceKm =
    getDistanceMeters(current[current.length - 1], candidate[candidate.length - 1]) /
    1000;
  const nearestKm = nearestAverageDistanceKm(currentSample, candidateSample);
  const endpointScore =
    Math.max(0, 1 - startDistanceKm / 1.5) * 0.5 +
    Math.max(0, 1 - finishDistanceKm / 1.5) * 0.5;
  const shapeScore = Math.max(0, 1 - nearestKm / 0.75);

  return {
    endpointScore,
    shapeScore,
    nearestKm,
    startDistanceKm,
    finishDistanceKm,
  };
};

const compareRouteSimilarity = (
  current: RoutePoint[],
  candidate: RoutePoint[],
  currentDistanceKm: number,
  candidateDistanceKm: number,
) => {
  if (current.length < 2 || candidate.length < 2) return null;

  const distanceScore = Math.max(
    0,
    1 -
      Math.abs(currentDistanceKm - candidateDistanceKm) /
        Math.max(currentDistanceKm, candidateDistanceKm, 0.1),
  );
  const forward = routeDirectionScore(current, candidate);
  const reversed = routeDirectionScore(current, [...candidate].reverse());
  const best = reversed.shapeScore > forward.shapeScore ? reversed : forward;
  const score =
    best.shapeScore * 0.5 + best.endpointScore * 0.25 + distanceScore * 0.25;

  return {
    score,
    distanceScore,
    endpointScore: best.endpointScore,
    shapeScore: best.shapeScore,
    nearestKm: best.nearestKm,
    startDistanceKm: best.startDistanceKm,
    finishDistanceKm: best.finishDistanceKm,
  };
};

const formatMatchDelta = (currentValue: number, previousValue: number) => {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return 0;
  }

  return currentValue - previousValue;
};

type PersonalSegmentRecord = {
  id: number;
  name: string;
  activity_type: string;
  source_ride_id: number | null;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  start_index: number | null;
  end_index: number | null;
  distance_km: number;
  created_at?: string;
};

const ensurePersonalSegmentsTable = async (db: D1Database) => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS personal_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        activity_type TEXT NOT NULL DEFAULT 'ride',
        source_ride_id INTEGER,
        start_lat REAL NOT NULL,
        start_lng REAL NOT NULL,
        end_lat REAL NOT NULL,
        end_lng REAL NOT NULL,
        start_index INTEGER,
        end_index INTEGER,
        distance_km REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_personal_segments_activity
       ON personal_segments(activity_type, created_at)`,
    )
    .run();
};

const ensureRideNotesColumn = async (db: D1Database) => {
  const { results } = await db.prepare("PRAGMA table_info(rides)").all();
  const hasNotes = (results || []).some(
    (column: any) => String(column?.name || "").toLowerCase() === "notes",
  );

  if (hasNotes) return;

  try {
    await db
      .prepare("ALTER TABLE rides ADD COLUMN notes TEXT DEFAULT ''")
      .run();
  } catch (e: any) {
    if (!String(e?.message || "").toLowerCase().includes("duplicate column")) {
      throw e;
    }
  }
};

const ensurePlannedRouteFavoriteColumn = async (db: D1Database) => {
  const { results } = await db.prepare("PRAGMA table_info(planned_routes)").all();
  const hasFavorite = (results || []).some(
    (column: any) => String(column?.name || "").toLowerCase() === "is_favorite",
  );

  if (hasFavorite) return;

  try {
    await db
      .prepare(
        "ALTER TABLE planned_routes ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  } catch (e: any) {
    if (!String(e?.message || "").toLowerCase().includes("duplicate column")) {
      throw e;
    }
  }
};

const sanitizeSegmentName = (value: any) =>
  String(value || "")
    .trim()
    .slice(0, 80) || "Personal Segment";

const clampIndex = (value: number, max: number) =>
  Math.max(0, Math.min(max, Math.round(Number(value || 0))));

const escapeXML = (value: any) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const routePointToGPX = (point: any) => {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng ?? point?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";

  const ele = Number(point?.ele ?? point?.elevation);
  const time = point?.time && !Number.isNaN(Date.parse(String(point.time)))
    ? new Date(String(point.time)).toISOString()
    : "";

  return [
    `    <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}">`,
    Number.isFinite(ele) ? `      <ele>${ele.toFixed(1)}</ele>` : "",
    time ? `      <time>${escapeXML(time)}</time>` : "",
    "    </trkpt>",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildRoutePlanGPX = (route: any, data: any) => {
  const rawCoordinates = Array.isArray(data?.coordinates)
    ? data.coordinates
    : Array.isArray(data?.points)
      ? data.points
      : [];
  const trackPoints = rawCoordinates.map(routePointToGPX).filter(Boolean);
  const routeName = String(route?.name || data?.name || "Gaspool Route").slice(
    0,
    120,
  );
  const createdAt =
    data?.created_at && !Number.isNaN(Date.parse(String(data.created_at)))
      ? new Date(String(data.created_at)).toISOString()
      : new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Gaspool" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXML(routeName)}</name>
    <time>${escapeXML(createdAt)}</time>
  </metadata>
  <trk>
    <name>${escapeXML(routeName)}</name>
    <type>${escapeXML(data?.profile || route?.profile || "cycling-regular")}</type>
    <trkseg>
${trackPoints.join("\n")}
    </trkseg>
  </trk>
</gpx>`;
};

const pointTimeMs = (point: RoutePoint | undefined) => {
  if (!point?.time) return null;
  const time = Date.parse(point.time);
  return Number.isFinite(time) ? time : null;
};

const buildSegmentEffort = (
  segment: PersonalSegmentRecord,
  ride: any,
  points: RoutePoint[],
) => {
  if (!Array.isArray(points) || points.length < 2) return null;

  const segmentStart = { lat: segment.start_lat, lng: segment.start_lng };
  const segmentEnd = { lat: segment.end_lat, lng: segment.end_lng };
  const maxEndpointKm = Math.max(
    0.2,
    Math.min(0.75, Number(segment.distance_km || 0) * 0.25),
  );
  let startIndex = -1;
  let startDistanceKm = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length - 1; i++) {
    const distanceKm = getDistanceMeters(points[i], segmentStart) / 1000;

    if (distanceKm < startDistanceKm) {
      startDistanceKm = distanceKm;
      startIndex = i;
    }
  }

  if (startIndex < 0 || startDistanceKm > maxEndpointKm) return null;

  let endIndex = -1;
  let endDistanceKm = Number.POSITIVE_INFINITY;

  for (let i = startIndex + 1; i < points.length; i++) {
    const distanceKm = getDistanceMeters(points[i], segmentEnd) / 1000;

    if (distanceKm < endDistanceKm) {
      endDistanceKm = distanceKm;
      endIndex = i;
    }
  }

  if (endIndex <= startIndex || endDistanceKm > maxEndpointKm) return null;

  const routeSlice = points.slice(startIndex, endIndex + 1);
  const actualDistanceKm = calculateRouteDistanceMeters(routeSlice) / 1000;
  const segmentDistanceKm = Number(segment.distance_km || 0);

  if (
    segmentDistanceKm > 0 &&
    (actualDistanceKm < segmentDistanceKm * 0.5 ||
      actualDistanceKm > segmentDistanceKm * 1.8)
  ) {
    return null;
  }

  const startTime = pointTimeMs(points[startIndex]);
  const endTime = pointTimeMs(points[endIndex]);
  const rideMoving = Number(ride.moving_time || 0);
  const rideDistance = Number(ride.distance || 0);
  let elapsedSeconds =
    startTime !== null && endTime !== null && endTime > startTime
      ? Math.round((endTime - startTime) / 1000)
      : 0;

  if (elapsedSeconds <= 0 && rideMoving > 0 && rideDistance > 0) {
    elapsedSeconds = Math.round(rideMoving * (actualDistanceKm / rideDistance));
  }

  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;

  return {
    segment_id: Number(segment.id),
    ride_id: Number(ride.id),
    ride_name: String(ride.name || "Aktivitas"),
    activity_type: String(ride.activity_type || segment.activity_type || "ride"),
    start_date: ride.start_date,
    elapsed_seconds: elapsedSeconds,
    elapsed_label: formatRecordDuration(elapsedSeconds),
    distance_km: Number(actualDistanceKm.toFixed(3)),
    average_speed: Number((actualDistanceKm / (elapsedSeconds / 3600)).toFixed(2)),
    endpoint_error_m: Math.round((startDistanceKm + endDistanceKm) * 500),
    start_index: startIndex,
    end_index: endIndex,
    is_source: Number(ride.id) === Number(segment.source_ride_id || 0),
  };
};

const getSegmentEfforts = async (
  db: D1Database,
  segment: PersonalSegmentRecord,
  limit = 10,
) => {
  const { results } = await db
    .prepare(
      `SELECT id, name, activity_type, distance, moving_time, start_date, polyline
       FROM rides
       WHERE activity_type = ?
         AND moving_time > 0
         AND polyline IS NOT NULL
         AND polyline != ''
       ORDER BY start_date DESC
       LIMIT 160`,
    )
    .bind(segment.activity_type)
    .all();
  const efforts: any[] = [];

  for (const ride of results || []) {
    const points = await loadRideCoordinates(String((ride as any).polyline || ""));
    const effort = buildSegmentEffort(segment, ride, points);
    if (effort) efforts.push(effort);
  }

  efforts.sort((a, b) => a.elapsed_seconds - b.elapsed_seconds);

  return efforts.slice(0, limit);
};

const normalizeGeocodeFeature = (feature: any): GeocodeResult | null => {
  const coordinates = feature?.geometry?.coordinates || [];
  const lng = Number(coordinates?.[0]);
  const lat = Number(coordinates?.[1]);
  const props = feature?.properties || {};

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const label = String(
    props.label || props.name || props.locality || "Lokasi tanpa nama",
  );
  const name = String(props.name || label);
  const confidence = Number(props.confidence);

  return {
    label,
    name,
    lat,
    lng,
    confidence: Number.isFinite(confidence) ? confidence : null,
    layer: String(props.layer || ""),
    source: String(props.source || ""),
    country: String(props.country || ""),
    region: String(props.region || props.region_a || ""),
    locality: String(props.locality || props.county || ""),
  };
};

const normalizeORSRoute = (data: any, options: {
  name: string;
  profile: string;
  waypoints: RoutePoint[];
}): PlannedRoutePayload => {
  const feature = data?.features?.[0];
  const coordinatesRaw = feature?.geometry?.coordinates || [];
  const properties = feature?.properties || {};
  const summary = properties.summary || {};

  const coordinates = coordinatesRaw
    .map((coord: any[]) => {
      const lng = Number(coord?.[0]);
      const lat = Number(coord?.[1]);
      const ele = Number(coord?.[2]);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return Number.isFinite(ele) ? { lat, lng, ele } : { lat, lng };
    })
    .filter(Boolean) as RoutePoint[];

  if (coordinates.length < 2) {
    throw new Error("Routing provider tidak mengembalikan koordinat rute.");
  }

  const instructions = (properties.segments || [])
    .flatMap((segment: any) => segment?.steps || [])
    .map((step: any) => {
      const wayPoints = Array.isArray(step?.way_points)
        ? step.way_points
        : undefined;
      const pointIndex = wayPoints ? Number(wayPoints[0]) : NaN;
      const point =
        Number.isFinite(pointIndex) && coordinates[pointIndex]
          ? coordinates[pointIndex]
          : null;

      return {
        text: String(step?.instruction || "Lanjutkan rute"),
        distance_m: Number(step?.distance || 0),
        duration_s: Number(step?.duration || 0),
        type:
          step?.type === undefined || step?.type === null
            ? undefined
            : Number(step.type),
        way_points: wayPoints
          ? [Number(wayPoints[0]), Number(wayPoints[1])]
          : undefined,
        point,
      };
    });

  const distanceM = Number(summary.distance || 0);
  const durationS = Number(summary.duration || 0);

  return {
    version: 1,
    provider: "ors",
    profile: options.profile,
    name: options.name,
    distance_km: distanceM / 1000,
    distance_m: distanceM,
    duration_s: durationS,
    waypoints: options.waypoints,
    coordinates,
    instructions,
    created_at: new Date().toISOString(),
  };
};

// ==========================================
// MIDDLEWARE PERTAHANAN API
// ==========================================
// Perisai Anti-CSRF: Mencegah serangan pemalsuan permintaan silang.
// Memastikan aksi POST/DELETE murni dikirim dari dalam markas Gaspool.
api.use("*", csrf());

// Middleware untuk mem-proteksi API (hanya Kapten yang bisa Save, Edit, Delete)
const protectAPI = async (c: any, next: any) => {
  const token = getCookie(c, "gaspool_session");

  if (!token) {
    return c.json(
      {
        success: false,
        message: "Unauthorized",
      },
      401,
    );
  }

  try {
    await verify(token, c.env.JWT_SECRET, "HS256");

    await next();
  } catch {
    return c.json(
      {
        success: false,
        message: "Invalid session",
      },
      401,
    );
  }
};

// 1a. Geocoding: cari lokasi via OpenRouteService, API key tetap di server
api.get("/geocode", protectAPI, async (c) => {
  try {
    if (!c.env.ORS_API_KEY) {
      return c.json(
        {
          success: false,
          message: "ORS_API_KEY belum dipasang di Worker secret.",
        },
        500,
      );
    }

    const q = String(c.req.query("q") || "").trim().slice(0, 120);

    if (q.length < 2) {
      return c.json(
        {
          success: false,
          message: "Kata kunci lokasi minimal 2 karakter.",
        },
        400,
      );
    }

    const lat = Number(c.req.query("lat"));
    const lng = Number(c.req.query("lng"));
    const params = new URLSearchParams({
      api_key: c.env.ORS_API_KEY,
      text: q,
      size: "8",
      "boundary.country": "ID",
    });

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      params.set("focus.point.lat", String(lat));
      params.set("focus.point.lon", String(lng));
    }

    const orsRes = await fetch(
      "https://api.openrouteservice.org/geocode/search?" + params.toString(),
      {
        headers: {
          Authorization: c.env.ORS_API_KEY,
        },
      },
    );

    if (!orsRes.ok) {
      const details = await orsRes.text();

      return c.json(
        {
          success: false,
          message: "Geocoder gagal mencari lokasi.",
          status: orsRes.status,
          details: details.slice(0, 500),
        },
        502,
      );
    }

    const data: any = await orsRes.json();
    const results = (data?.features || [])
      .map(normalizeGeocodeFeature)
      .filter(Boolean) as GeocodeResult[];

    return c.json({
      success: true,
      results,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e?.message || "Geocoder error.",
      },
      500,
    );
  }
});

// 1. Tarik Data Dashboard
api.get("/rides", protectAPI, async (c) => {
  const f = c.req.query("filter") || "all";
  const visibility = String(c.req.query("visibility") || "all").toLowerCase();
  const sort = String(c.req.query("sort") || "latest").toLowerCase();
  const period = String(c.req.query("period") || "all").toLowerCase();
  const search = String(c.req.query("q") || "").trim().slice(0, 80);
  const calendarMonthRaw = String(c.req.query("calendar_month") || "").trim();
  const p = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const lim = 10;
  const off = (p - 1) * lim;
  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01 00:00:00`;
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01 00:00:00`;
  const safeCalendarMonth = /^\d{4}-\d{2}$/.test(calendarMonthRaw)
    ? calendarMonthRaw
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [calendarYear, calendarMonth] = safeCalendarMonth
    .split("-")
    .map((item) => parseInt(item, 10));
  const calendarStartDate = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1));
  const calendarEndDate = new Date(Date.UTC(calendarYear, calendarMonth, 1));
  const calendarStart = calendarStartDate.toISOString();
  const calendarEnd = calendarEndDate.toISOString();
  const allowedTypes = new Set(["ride", "run", "walk", "hike"]);
  const sortMap: Record<string, string> = {
    latest: "start_date DESC",
    oldest: "start_date ASC",
    distance_desc: "distance DESC, start_date DESC",
    duration_desc: "moving_time DESC, start_date DESC",
    speed_desc: "average_speed DESC, start_date DESC",
    elev_desc: "total_elevation_gain DESC, start_date DESC",
  };
  const orderBy = sortMap[sort] || sortMap.latest;

  const buildWhere = (extra: string[] = [], includePeriod = true) => {
    const parts: string[] = [];
    const params: any[] = [];

    if (f !== "all" && allowedTypes.has(f)) {
      parts.push("activity_type = ?");
      params.push(f);
    }

    if (visibility === "public") {
      parts.push("is_public = 1");
    } else if (visibility === "private") {
      parts.push("(is_public IS NULL OR is_public = 0)");
    }

    if (search) {
      parts.push("LOWER(name) LIKE ?");
      params.push(`%${search.toLowerCase()}%`);
    }

    if (includePeriod && period === "month") {
      parts.push("start_date >= ?");
      params.push(monthStart);
    } else if (includePeriod && period === "year") {
      parts.push("start_date >= ?");
      params.push(yearStart);
    }

    for (const item of extra) parts.push(item);

    return {
      sql: parts.length ? ` WHERE ${parts.join(" AND ")}` : "",
      params,
    };
  };

  const statsSelect =
    "SELECT COUNT(*) as total_count, COALESCE(SUM(distance),0) as total_dist, COALESCE(SUM(moving_time),0) as total_time, COALESCE(SUM(total_elevation_gain),0) as total_elev FROM rides";

  try {
    const mainWhere = buildWhere();
    const monthWhere = buildWhere(["start_date >= ?"], false);
    monthWhere.params.push(monthStart);
    const yearWhere = buildWhere(["start_date >= ?"], false);
    yearWhere.params.push(yearStart);
    const calendarWhere = buildWhere(["start_date >= ?", "start_date < ?"], false);
    calendarWhere.params.push(calendarStart, calendarEnd);

    const qStats = statsSelect + mainWhere.sql;
    const qData =
      "SELECT * FROM rides" +
      mainWhere.sql +
      ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const qCalendar =
      `SELECT id, name, activity_type, distance, moving_time, start_date, is_public
       FROM rides` +
      calendarWhere.sql +
      ` ORDER BY start_date ASC LIMIT 220`;
    const first = (sql: string, params: any[]) =>
      params.length
        ? c.env.DB.prepare(sql)
            .bind(...params)
            .first()
        : c.env.DB.prepare(sql).first();

    const [stats, monthStats, yearStats, rides, calendar] = await Promise.all([
      first(qStats, mainWhere.params),
      first(statsSelect + monthWhere.sql, monthWhere.params),
      first(statsSelect + yearWhere.sql, yearWhere.params),
      c.env.DB.prepare(qData)
        .bind(...mainWhere.params, lim, off)
        .all(),
      c.env.DB.prepare(qCalendar)
        .bind(...calendarWhere.params)
        .all(),
    ]);

    return c.json({
      success: true,
      stats,
      period_stats: {
        month: monthStats,
        year: yearStats,
      },
      calendar_month: safeCalendarMonth,
      calendar: calendar.results || [],
      rides: rides.results || [],
    });
  } catch (e) {
    return c.json({ success: false, error: "Database error" }, 500);
  }
});

api.get("/personal_bests", protectAPI, async (c) => {
  try {
    const [
      longestDistance,
      longestDuration,
      biggestElevation,
      fastestRide,
      bestRunPace,
      bestWalkPace,
      bestHikePace,
      estimated5k,
      estimated10k,
    ] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, start_date
         FROM rides
         WHERE distance > 0
         ORDER BY distance DESC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, start_date
         FROM rides
         WHERE moving_time > 0
         ORDER BY moving_time DESC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, total_elevation_gain, start_date
         FROM rides
         WHERE total_elevation_gain > 0
         ORDER BY total_elevation_gain DESC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, average_speed, start_date
         FROM rides
         WHERE activity_type = 'ride' AND distance > 0 AND moving_time > 0
         ORDER BY average_speed DESC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, start_date
         FROM rides
         WHERE activity_type = 'run' AND distance >= 1 AND moving_time > 0
         ORDER BY (moving_time / distance) ASC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, start_date
         FROM rides
         WHERE activity_type = 'walk' AND distance >= 1 AND moving_time > 0
         ORDER BY (moving_time / distance) ASC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, start_date
         FROM rides
         WHERE activity_type = 'hike' AND distance >= 1 AND moving_time > 0
         ORDER BY (moving_time / distance) ASC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, start_date,
          ((moving_time / distance) * 5.0) as estimated_time
         FROM rides
         WHERE activity_type = 'run' AND distance >= 5 AND moving_time > 0
         ORDER BY (moving_time / distance) ASC
         LIMIT 1`,
      ).first(),
      c.env.DB.prepare(
        `SELECT id, name, activity_type, distance, moving_time, start_date,
          ((moving_time / distance) * 10.0) as estimated_time
         FROM rides
         WHERE activity_type = 'run' AND distance >= 10 AND moving_time > 0
         ORDER BY (moving_time / distance) ASC
         LIMIT 1`,
      ).first(),
    ]);

    const records: any[] = [];

    if (longestDistance) {
      records.push({
        key: "longest_distance",
        label: "JARAK TERJAUH",
        value: Number((longestDistance as any).distance || 0).toFixed(2),
        unit: "KM",
        meta: summarizeRecordRide(longestDistance),
        ride_id: (longestDistance as any).id,
        activity_type: (longestDistance as any).activity_type,
      });
    }

    if (longestDuration) {
      records.push({
        key: "longest_duration",
        label: "DURASI TERLAMA",
        value: formatRecordDuration(Number((longestDuration as any).moving_time || 0)),
        unit: "",
        meta: summarizeRecordRide(longestDuration),
        ride_id: (longestDuration as any).id,
        activity_type: (longestDuration as any).activity_type,
      });
    }

    if (biggestElevation) {
      records.push({
        key: "biggest_elevation",
        label: "ELEVASI TERBESAR",
        value: String(Math.round(Number((biggestElevation as any).total_elevation_gain || 0))),
        unit: "M",
        meta: summarizeRecordRide(biggestElevation),
        ride_id: (biggestElevation as any).id,
        activity_type: (biggestElevation as any).activity_type,
      });
    }

    if (fastestRide) {
      records.push({
        key: "fastest_ride",
        label: "RIDE TERCEPAT",
        value: Number((fastestRide as any).average_speed || 0).toFixed(1),
        unit: "KM/H",
        meta: summarizeRecordRide(fastestRide),
        ride_id: (fastestRide as any).id,
        activity_type: "ride",
      });
    }

    [
      ["best_run_pace", "PACE RUN TERBAIK", bestRunPace],
      ["best_walk_pace", "PACE WALK TERBAIK", bestWalkPace],
      ["best_hike_pace", "PACE HIKE TERBAIK", bestHikePace],
    ].forEach(([key, label, ride]) => {
      if (!ride) return;
      const distance = Number((ride as any).distance || 0);
      const moving = Number((ride as any).moving_time || 0);

      records.push({
        key,
        label,
        value: formatRecordPace(moving / distance),
        unit: "/KM",
        meta: summarizeRecordRide(ride),
        ride_id: (ride as any).id,
        activity_type: (ride as any).activity_type,
      });
    });

    [
      ["estimated_5k", "ESTIMASI 5K", estimated5k],
      ["estimated_10k", "ESTIMASI 10K", estimated10k],
    ].forEach(([key, label, ride]) => {
      if (!ride) return;

      records.push({
        key,
        label,
        value: formatRecordDuration(Number((ride as any).estimated_time || 0)),
        unit: "",
        meta: `${summarizeRecordRide(ride)} • dari pace rata-rata`,
        ride_id: (ride as any).id,
        activity_type: "run",
      });
    });

    return c.json({
      success: true,
      records,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal memuat rekor pribadi.",
      },
      500,
    );
  }
});

// 2. Route Planner: generate rute via OpenRouteService, simpan JSON ke R2, metadata ke D1
api.post("/route_plan", protectAPI, async (c) => {
  try {
    if (!c.env.ORS_API_KEY) {
      return c.json(
        {
          success: false,
          message: "ORS_API_KEY belum dipasang di Worker secret.",
        },
        500,
      );
    }

    const body = await c.req.json();
    const rawWaypoints = Array.isArray(body?.waypoints)
      ? body.waypoints
      : Array.isArray(body?.points)
        ? body.points
        : [];
    const waypoints = rawWaypoints
      .map(normalizeRoutePoint)
      .filter(Boolean) as RoutePoint[];

    if (waypoints.length < 2) {
      return c.json(
        {
          success: false,
          message: "Minimal butuh titik start dan tujuan.",
        },
        400,
      );
    }

    if (waypoints.length > 50) {
      return c.json(
        {
          success: false,
          message: "Waypoint terlalu banyak. Maksimal 50 titik.",
        },
        400,
      );
    }

    const allowedProfiles = new Set([
      "cycling-regular",
      "cycling-road",
      "cycling-mountain",
      "cycling-electric",
      "foot-walking",
      "foot-hiking",
    ]);
    const requestedProfile = String(body?.profile || "");
    const profile = allowedProfiles.has(requestedProfile)
      ? requestedProfile
      : normalizeProfile(String(body?.activity_type || "ride"));
    const name =
      String(body?.name || "").trim().slice(0, 80) ||
      "Route Plan " + new Date().toLocaleDateString("id-ID");
    const checkpoints = Array.isArray(body?.checkpoints)
      ? (body.checkpoints
          .map(normalizeRouteCheckpoint)
          .filter(Boolean) as RouteCheckpoint[])
      : [];

    const orsRes = await fetch(
      `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
      {
        method: "POST",
        headers: {
          Authorization: c.env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: waypoints.map((p) => [p.lng, p.lat]),
          elevation: true,
          instructions: true,
        }),
      },
    );

    if (!orsRes.ok) {
      const details = await orsRes.text();

      return c.json(
        {
          success: false,
          message: "Routing provider gagal membuat rute.",
          status: orsRes.status,
          details: details.slice(0, 500),
        },
        502,
      );
    }

    const orsData = await orsRes.json();
    const routeData = normalizeORSRoute(orsData, {
      name,
      profile,
      waypoints,
    });
    routeData.checkpoints = checkpoints;
    const fileName = `gaspool/routes/route_${Date.now()}_${Math.floor(
      Math.random() * 1000,
    )}.json`;

    await c.env.R2_BUCKET.put(fileName, JSON.stringify(routeData), {
      httpMetadata: {
        contentType: "application/json",
      },
    });

    const publicUrl = `${R2_PUBLIC_BASE_URL}/${fileName}`;
    const inserted = await c.env.DB.prepare(
      `INSERT INTO planned_routes (
        name,
        distance,
        duration,
        route_url,
        provider,
        profile,
        waypoints
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        name,
        routeData.distance_km,
        Math.round(routeData.duration_s),
        publicUrl,
        routeData.provider,
        routeData.profile,
        JSON.stringify(waypoints),
      )
      .run();
    const routeId = Number((inserted.meta as any)?.last_row_id || 0);

    return c.json({
      success: true,
      route: {
        id: routeId,
        name,
        distance: routeData.distance_km,
        duration: Math.round(routeData.duration_s),
        route_url: publicUrl,
        provider: routeData.provider,
        profile: routeData.profile,
        coordinates_count: routeData.coordinates.length,
        instructions_count: routeData.instructions.length,
        data: routeData,
      },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Route planner gagal diproses.",
      },
      500,
    );
  }
});

api.post("/route_plan_gpx", protectAPI, async (c) => {
  try {
    const body = await c.req.json();
    const routeData = normalizeGPXRoute(body);
    const fileName = `gaspool/routes/route_gpx_${Date.now()}_${Math.floor(
      Math.random() * 1000,
    )}.json`;

    await c.env.R2_BUCKET.put(fileName, JSON.stringify(routeData), {
      httpMetadata: {
        contentType: "application/json",
      },
    });

    const publicUrl = `${R2_PUBLIC_BASE_URL}/${fileName}`;
    const inserted = await c.env.DB.prepare(
      `INSERT INTO planned_routes (
        name,
        distance,
        duration,
        route_url,
        provider,
        profile,
        waypoints
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        routeData.name,
        routeData.distance_km,
        Math.round(routeData.duration_s),
        publicUrl,
        routeData.provider,
        routeData.profile,
        JSON.stringify(routeData.waypoints),
      )
      .run();
    const routeId = Number((inserted.meta as any)?.last_row_id || 0);

    return c.json({
      success: true,
      message: "GPX berhasil dijadikan route plan.",
      route: {
        id: routeId,
        name: routeData.name,
        distance: routeData.distance_km,
        duration: Math.round(routeData.duration_s),
        route_url: publicUrl,
        provider: routeData.provider,
        profile: routeData.profile,
        coordinates_count: routeData.coordinates.length,
        instructions_count: routeData.instructions.length,
        data: routeData,
      },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "GPX route gagal diproses.",
      },
      400,
    );
  }
});

api.get("/route_plans", protectAPI, async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const offset = Math.max(parseInt(c.req.query("offset") || "0"), 0);

  try {
    await ensurePlannedRouteFavoriteColumn(c.env.DB);

    const { results } = await c.env.DB.prepare(
      `SELECT
        id,
        name,
        distance,
        duration,
        route_url,
        provider,
        profile,
        is_favorite,
        created_at
      FROM planned_routes
      ORDER BY is_favorite DESC, created_at DESC
      LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all();

    return c.json({ success: true, routes: results });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message,
      },
      500,
    );
  }
});

api.post("/route_plan/:id/favorite", protectAPI, async (c) => {
  try {
    await ensurePlannedRouteFavoriteColumn(c.env.DB);

    const body = await c.req.json().catch(() => ({}));
    const isFavorite =
      body?.is_favorite === true ||
      body?.is_favorite === 1 ||
      body?.is_favorite === "1"
        ? 1
        : 0;
    const route: any = await c.env.DB.prepare(
      "SELECT id FROM planned_routes WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    await c.env.DB.prepare(
      "UPDATE planned_routes SET is_favorite = ? WHERE id = ?",
    )
      .bind(isFavorite, c.req.param("id"))
      .run();

    return c.json({
      success: true,
      id: Number(c.req.param("id")),
      is_favorite: isFavorite,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal mengubah status favorit rute.",
      },
      500,
    );
  }
});

api.get("/route_plan/:id/gpx", protectAPI, async (c) => {
  try {
    const route: any = await c.env.DB.prepare(
      "SELECT * FROM planned_routes WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    const routeRes = await fetch(route.route_url);

    if (!routeRes.ok) {
      return c.json(
        {
          success: false,
          message: "Metadata ada, tapi file rute gagal dibaca dari R2.",
        },
        502,
      );
    }

    const data = await routeRes.json();
    const gpx = buildRoutePlanGPX(route, data);
    const safeName =
      String(route.name || "gaspool-route")
        .trim()
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70) || "gaspool-route";

    return c.body(gpx, 200, {
      "Content-Type": "application/gpx+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.gpx"`,
      "Cache-Control": "no-store",
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal export GPX rute.",
      },
      500,
    );
  }
});

api.get("/route_plan/:id", protectAPI, async (c) => {
  try {
    const routeId = Number(c.req.param("id"));
    const route = Number.isFinite(routeId)
      ? await readPlannedRouteWithData(c.env, routeId)
      : null;

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    return c.json({
      success: true,
      route,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message,
      },
      500,
    );
  }
});

api.post("/peleton_route", protectAPI, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const room = sanitizeRoomId(body?.room);
    const routeId = Number(body?.route_id || body?.routeId || 0);

    if (!room || room === "SINGLE_MODE") {
      return c.json(
        {
          success: false,
          message: "Room peleton tidak valid.",
        },
        400,
      );
    }

    if (!Number.isFinite(routeId) || routeId <= 0) {
      return c.json(
        {
          success: false,
          message: "Route ID tidak valid.",
        },
        400,
      );
    }

    const route = await readPlannedRouteWithData(c.env, routeId);

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    const key = `PELETON_ROUTE:${room}`;
    const currentRaw = await c.env.GASPOOL_RADAR.get(key);
    const current = currentRaw ? JSON.parse(currentRaw) : null;
    const version =
      current && Number(current.route_id) === routeId
        ? Number(current.version || 1)
        : Number(current?.version || 0) + 1;
    const payload = {
      room,
      route_id: routeId,
      route_name: route.name || route.data?.name || "Route Plan",
      version,
      updated_at: Date.now(),
    };

    await c.env.GASPOOL_RADAR.put(key, JSON.stringify(payload), {
      expirationTtl: 12 * 60 * 60,
    });

    return c.json({
      success: true,
      peleton_route: payload,
      route,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal publish rute peleton.",
      },
      500,
    );
  }
});

api.get("/peleton_route/:room", async (c) => {
  try {
    const room = sanitizeRoomId(c.req.param("room"));

    if (!room || room === "SINGLE_MODE") {
      return c.json({ success: true, route: null, peleton_route: null });
    }

    const key = `PELETON_ROUTE:${room}`;
    const payloadRaw = await c.env.GASPOOL_RADAR.get(key);

    if (!payloadRaw) {
      return c.json({ success: true, route: null, peleton_route: null });
    }

    const payload = JSON.parse(payloadRaw);
    const routeId = Number(payload?.route_id || 0);
    const route = Number.isFinite(routeId)
      ? await readPlannedRouteWithData(c.env, routeId)
      : null;

    if (!route) {
      await c.env.GASPOOL_RADAR.delete(key);
      return c.json({ success: true, route: null, peleton_route: null });
    }

    return c.json({
      success: true,
      peleton_route: payload,
      route,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal membaca rute peleton.",
      },
      500,
    );
  }
});

api.put("/route_plan/:id", protectAPI, async (c) => {
  try {
    const body = await c.req.json();
    const name = String(body?.name || "").trim().slice(0, 80);

    if (!name) {
      return c.json(
        {
          success: false,
          message: "Nama rute tidak boleh kosong.",
        },
        400,
      );
    }

    const route: any = await c.env.DB.prepare(
      "SELECT id FROM planned_routes WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    await c.env.DB.prepare("UPDATE planned_routes SET name = ? WHERE id = ?")
      .bind(name, c.req.param("id"))
      .run();

    return c.json({
      success: true,
      route: {
        id: Number(c.req.param("id")),
        name,
      },
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal rename route plan.",
      },
      500,
    );
  }
});

api.delete("/route_plan/:id", protectAPI, async (c) => {
  try {
    const route: any = await c.env.DB.prepare(
      "SELECT id, route_url FROM planned_routes WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!route) {
      return c.json(
        {
          success: false,
          message: "Route plan tidak ditemukan.",
        },
        404,
      );
    }

    if (typeof route.route_url === "string" && route.route_url.startsWith(R2_PUBLIC_BASE_URL + "/")) {
      const key = route.route_url.slice(R2_PUBLIC_BASE_URL.length + 1);
      if (key) await c.env.R2_BUCKET.delete(key);
    }

    await c.env.DB.prepare("DELETE FROM planned_routes WHERE id = ?")
      .bind(c.req.param("id"))
      .run();

    return c.json({
      success: true,
      id: Number(c.req.param("id")),
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal menghapus route plan.",
      },
      500,
    );
  }
});

// 2. Simpan Rekaman Baru (Save Ride Chunking) ke R2 dan D1
api.post("/save_ride", protectAPI, async (c) => {
  try {
    const b = await c.req.json();
    const {
      uuid,
      chunk_index,
      total_chunks,
      points,
      name,
      distance,
      duration,
      activity_type,
      avg_temp,
      total_elevation,
    } = b;
    const stages = normalizeActivityStages(b.stages);
    const restBlocks = normalizeRestBlocks(b.rest_blocks);
    const restSummary = summarizeRestBlocks(restBlocks);
    const nutritionSummary = normalizeNutritionSummary(b.nutrition_summary);
    const signalLogs = normalizeSignalLogs(b.signal_logs);
    const signalSummary = summarizeSignalLogs(signalLogs);
    const finishReview = normalizeFinishReview(b.finish_review);
    const skippedClockGapSeconds = Math.max(
      0,
      Math.floor(Number(b.skipped_clock_gap_seconds || 0)),
    );
    const savedAtIso = new Date().toISOString();
    const startDateIso = normalizeIsoDate(b.start_date, savedAtIso);
    const finishDateIso = normalizeIsoDate(b.finish_date, savedAtIso);
    const timeContext = {
      start_date: startDateIso,
      finish_date: finishDateIso,
      start_timezone_offset_min: normalizeTimezoneOffset(
        b.start_timezone_offset_min,
      ),
      finish_timezone_offset_min: normalizeTimezoneOffset(
        b.finish_timezone_offset_min,
      ),
      start_timezone_name: normalizeTimezoneName(b.start_timezone_name),
      finish_timezone_name: normalizeTimezoneName(b.finish_timezone_name),
    };
    const plannedRouteId =
      b.planned_route_id === undefined || b.planned_route_id === null
        ? null
        : Number(b.planned_route_id);
    const isPublic =
      b.is_public === true ||
      b.is_public === 1 ||
      b.is_public === "1"
        ? 1
        : 0;

    if (!uuid || chunk_index === undefined) {
      return c.json(
        { success: false, message: "Format chunk tidak valid!" },
        400,
      );
    }

    // Simpan potongan (chunk) ke ruang transit KV sementara. Beri batas kedaluwarsa 1 hari (86400 detik)
    await c.env.GASPOOL_RADAR.put(
      `CHUNK:${uuid}:${chunk_index}`,
      JSON.stringify(points || []),
      { expirationTtl: 86400 },
    );

    // Cek apakah ini potongan terakhir yang dikirim
    if (chunk_index === total_chunks - 1) {
      // Pastikan semua chunk sudah tiba
      for (let i = 0; i < total_chunks; i++) {
        const exists = await c.env.GASPOOL_RADAR.get(`CHUNK:${uuid}:${i}`);

        if (!exists) {
          return c.json({
            success: true,
            waiting: true,
            message: "Menunggu chunk lain tiba...",
          });
        }
      }

      let fullPolyline: any[] = [];
      const mergedChunks: any[] = [];

      // Tarik semua potongan dari KV dan satukan
      for (let i = 0; i < total_chunks; i++) {
        const chunkData = await c.env.GASPOOL_RADAR.get(`CHUNK:${uuid}:${i}`);

        if (chunkData) {
          mergedChunks.push(...JSON.parse(chunkData));

          // Bersihkan potongan dari KV
          await c.env.GASPOOL_RADAR.delete(`CHUNK:${uuid}:${i}`);
        }
      }

      // Hardening: buang titik korup
      fullPolyline = mergedChunks.filter(
        (p) => p && typeof p.lat === "number" && typeof p.lng === "number",
      );

      if (fullPolyline.length === 0) {
        return c.json(
          {
            success: false,
            message: "Rute kosong setelah digabung!",
          },
          400,
        );
      }

      let avgSpeed = 0;

      if (duration > 0 && distance > 0) {
        avgSpeed = distance / (duration / 3600);
      }

      const fileName = `gaspool/gaspool_ride_${Date.now()}_${Math.floor(Math.random() * 1000)}.json`;
      const routePayload = {
        points: fullPolyline,
        stages,
        rest_blocks: restBlocks,
        nutrition_summary: nutritionSummary,
        signal_logs: signalLogs,
        metadata: {
          activity_type: activity_type || "ride",
          distance_km: distance || 0,
          moving_time: duration || 0,
          time_context: timeContext,
          rest_summary: restSummary,
          skipped_clock_gap_seconds: skippedClockGapSeconds,
          nutrition_summary: {
            enabled: nutritionSummary.enabled,
            water_count: nutritionSummary.water_count,
            food_count: nutritionSummary.food_count,
          },
          signal_summary: signalSummary,
          finish_review: finishReview,
          source: b.source || "GASPOOL",
          exported_at: savedAtIso,
        },
      };

      // Upload Rute Utuh ke R2
      await c.env.R2_BUCKET.put(fileName, JSON.stringify(routePayload), {
        httpMetadata: {
          contentType: "application/json",
        },
      });

      const publicUrl = `${R2_PUBLIC_BASE_URL}/${fileName}`;

      const query = `INSERT INTO rides (
      name,
      distance,
      moving_time,
      average_speed,
      max_speed,
      total_elevation_gain,
      avg_temp,
      participants,
      start_date,
      polyline,
      activity_type,
      source,
      planned_route_id,
      is_public
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      await c.env.DB.prepare(query)
        .bind(
          name || "Aktivitas",
          distance || 0,
          duration || 0,
          avgSpeed,
          b.max_speed || 0,
          total_elevation || 0,
          avg_temp || 0,
          b.participants ? JSON.stringify(b.participants) : "[]",
          startDateIso,
          publicUrl,
          activity_type || "ride",
          b.source || "GASPOOL",
          Number.isFinite(plannedRouteId) ? plannedRouteId : null,
          isPublic,
        )
        .run();

      return c.json({
        success: true,
        message: "Data rute utuh berhasil mendarat di awan!",
      });
    }

    // Jika bukan chunk terakhir, kirim status aman
    return c.json({
      success: true,
      message: `Chunk ${chunk_index + 1}/${total_chunks} aman direkam.`,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message,
      },
      500,
    );
  }
});


// 3. Activity Doctor scan (dry-run)
api.get("/activity_doctor/:id", protectAPI, async (c) => {
  const id = Number(c.req.param("id"));

  if (!Number.isFinite(id) || id <= 0) {
    return c.json(
      {
        success: false,
        message: "ID aktivitas tidak valid.",
      },
      400,
    );
  }

  try {
    const ride: any = await c.env.DB.prepare("SELECT * FROM rides WHERE id = ?")
      .bind(id)
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan.",
        },
        404,
      );
    }

    const payloadInfo = await loadActivityDoctorPayload(
      c.env,
      String(ride.polyline || ""),
    );
    const doctor = buildActivityDoctorScan(ride, payloadInfo);

    return c.json({
      success: true,
      dry_run: true,
      message:
        doctor.status === "healthy"
          ? "Aktivitas terlihat sehat. Tidak ada repair yang diperlukan."
          : doctor.can_auto_repair
            ? "Activity Doctor menemukan perbaikan otomatis yang aman. Gunakan endpoint apply untuk menerapkannya."
            : "Activity Doctor menemukan masalah yang perlu perhatian.",
      ride: {
        id: ride.id,
        name: ride.name,
        activity_type: ride.activity_type || "ride",
        start_date: ride.start_date,
      },
      doctor,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e?.message || "Activity Doctor gagal memeriksa aktivitas.",
      },
      500,
    );
  }
});

// 3b. Activity Doctor v4 apply auto repair
api.post("/activity_doctor/:id/apply", protectAPI, async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const confirmed =
    body?.confirm_auto_repair === true ||
    body?.confirm === true ||
    body?.confirm_auto_repair === "true" ||
    body?.confirm === "true";
  const expectedActions = normalizeDoctorActionList(
    body?.expected_actions || body?.expectedActions || [],
  );

  if (!confirmed) {
    return c.json(
      {
        success: false,
        applied: false,
        message: "Auto repair butuh konfirmasi eksplisit dari UI.",
      },
      400,
    );
  }

  if (!Number.isFinite(id) || id <= 0) {
    return c.json(
      {
        success: false,
        message: "ID aktivitas tidak valid.",
      },
      400,
    );
  }

  try {
    const ride: any = await c.env.DB.prepare("SELECT * FROM rides WHERE id = ?")
      .bind(id)
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan.",
        },
        404,
      );
    }

    const payloadInfo = await loadActivityDoctorPayload(
      c.env,
      String(ride.polyline || ""),
    );
    const doctor = buildActivityDoctorScan(ride, payloadInfo);

    if (doctor.healthy) {
      return c.json({
        success: true,
        applied: false,
        message: "Aktivitas sudah sehat. Tidak ada auto repair yang perlu diterapkan.",
        ride: {
          id: ride.id,
          name: ride.name,
          activity_type: ride.activity_type || "ride",
          start_date: ride.start_date,
        },
        doctor,
      });
    }

    if (!doctor.can_auto_repair) {
      return c.json(
        {
          success: false,
          applied: false,
          message: "Activity Doctor menemukan masalah yang belum aman untuk auto repair.",
          doctor,
        },
        409,
      );
    }

    if (expectedActions.length > 0 && !sameDoctorActionList(expectedActions, doctor.repair_plan)) {
      return c.json(
        {
          success: false,
          applied: false,
          message: "Rencana repair berubah sejak scan terakhir. Scan ulang sebelum apply.",
          doctor,
        },
        409,
      );
    }

    const repair = buildActivityDoctorRepair(ride, payloadInfo, doctor);

    if (repair.points.length < 2) {
      return c.json(
        {
          success: false,
          applied: false,
          message: "Auto repair dibatalkan karena titik GPS valid kurang dari dua.",
          doctor,
        },
        409,
      );
    }

    const targetKey = getDoctorRepairTargetKey(id, payloadInfo);
    const backupKey = buildDoctorBackupKey(id);
    const backupPayload = {
      ride: {
        id: ride.id,
        name: ride.name,
        start_date: ride.start_date,
        distance: ride.distance,
        moving_time: ride.moving_time,
        average_speed: ride.average_speed,
        max_speed: ride.max_speed,
        total_elevation_gain: ride.total_elevation_gain,
        polyline: ride.polyline,
        activity_type: ride.activity_type,
      },
      payload_source: payloadInfo.source,
      object_key: payloadInfo.object_key,
      raw_payload: payloadInfo.raw_payload,
      backed_up_at: new Date().toISOString(),
    };

    await c.env.R2_BUCKET.put(backupKey, JSON.stringify(backupPayload), {
      httpMetadata: {
        contentType: "application/json",
      },
    });

    await c.env.R2_BUCKET.put(targetKey, JSON.stringify(repair.payload), {
      httpMetadata: {
        contentType: "application/json",
      },
    });

    const publicUrl = `${R2_PUBLIC_BASE_URL}/${targetKey}`;

    const updateResult = await c.env.DB.prepare(
      `UPDATE rides
       SET distance = ?,
           moving_time = ?,
           average_speed = ?,
           max_speed = ?,
           total_elevation_gain = ?,
           start_date = ?,
           polyline = ?
       WHERE id = ?`,
    )
      .bind(
        repair.stats.distance_km,
        repair.stats.moving_time,
        repair.stats.average_speed,
        repair.stats.max_speed,
        repair.stats.total_elevation_gain,
        repair.start_date,
        publicUrl,
        id,
      )
      .run();

    const updateResultStatus = updateResult as { success?: boolean } | null | undefined;

    if (!updateResultStatus || updateResultStatus.success === false) {
      throw new Error("R2 repair berhasil ditulis, tetapi update D1 gagal.");
    }

    const repairedRide = {
      ...ride,
      distance: repair.stats.distance_km,
      moving_time: repair.stats.moving_time,
      average_speed: repair.stats.average_speed,
      max_speed: repair.stats.max_speed,
      total_elevation_gain: repair.stats.total_elevation_gain,
      start_date: repair.start_date,
      polyline: publicUrl,
    };
    const postDoctor = buildActivityDoctorScan(repairedRide, {
      source: "r2",
      object_key: targetKey,
      raw_payload: repair.payload,
    });

    return c.json({
      success: true,
      applied: true,
      message: "Auto repair diterapkan. Backup R2 dibuat lebih dulu, lalu JSON dan D1 diperbarui.",
      ride: {
        id: ride.id,
        name: ride.name,
        activity_type: ride.activity_type || "ride",
        start_date: repair.start_date,
      },
      repair: {
        backup_key: backupKey,
        object_key: targetKey,
        public_url: publicUrl,
        applied_actions: repair.applied_actions,
        stats: {
          before: doctor.stats.current,
          after: repair.stats,
        },
      },
      doctor: postDoctor,
      previous_doctor: doctor,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e?.message || "Activity Doctor gagal menerapkan auto repair.",
      },
      500,
    );
  }
});

// 3. Edit Judul dan Catatan Aktivitas
api.post("/edit_ride/:id", protectAPI, async (c) => {
  const body = await c.req.json();
  const updates: string[] = [];
  const values: any[] = [];

  if (body?.name !== undefined) {
    updates.push("name = ?");
    values.push(
      String(body.name || "Aktivitas").trim().slice(0, 80) || "Aktivitas",
    );
  }

  if (body?.notes !== undefined) {
    await ensureRideNotesColumn(c.env.DB);
    updates.push("notes = ?");
    values.push(String(body.notes || "").trim().slice(0, 1200));
  }

  if (updates.length === 0) {
    return c.json(
      {
        success: false,
        message: "Tidak ada perubahan yang dikirim.",
      },
      400,
    );
  }

  await c.env.DB.prepare(`UPDATE rides SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, c.req.param("id"))
    .run();
  return c.json({ success: true });
});

api.post("/ride_visibility/:id", protectAPI, async (c) => {
  try {
    const body = await c.req.json();
    const isPublic =
      body?.is_public === true ||
      body?.is_public === 1 ||
      body?.is_public === "1"
        ? 1
        : 0;
    const ride: any = await c.env.DB.prepare("SELECT id FROM rides WHERE id = ?")
      .bind(c.req.param("id"))
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan.",
        },
        404,
      );
    }

    await c.env.DB.prepare("UPDATE rides SET is_public = ? WHERE id = ?")
      .bind(isPublic, c.req.param("id"))
      .run();

    return c.json({
      success: true,
      id: Number(c.req.param("id")),
      is_public: isPublic,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal mengubah status publik aktivitas.",
      },
      500,
    );
  }
});

api.get("/matched_activities/:id", protectAPI, async (c) => {
  try {
    const id = Number(c.req.param("id"));

    if (!Number.isFinite(id) || id <= 0) {
      return c.json(
        {
          success: false,
          message: "ID aktivitas tidak valid.",
        },
        400,
      );
    }

    const current: any = await c.env.DB.prepare(
      `SELECT id, name, activity_type, distance, moving_time, average_speed,
        total_elevation_gain, start_date, polyline
       FROM rides
       WHERE id = ?`,
    )
      .bind(id)
      .first();

    if (!current) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan.",
        },
        404,
      );
    }

    const currentDistanceKm = Number(current.distance || 0);
    const currentPoints = await loadRideCoordinates(current.polyline);

    if (currentDistanceKm <= 0 || currentPoints.length < 2) {
      return c.json({
        success: true,
        matches: [],
        message: "Koordinat aktivitas belum cukup untuk mencari rute mirip.",
      });
    }

    const minDistance = currentDistanceKm * 0.75;
    const maxDistance = currentDistanceKm * 1.25;
    const { results } = await c.env.DB.prepare(
      `SELECT id, name, activity_type, distance, moving_time, average_speed,
        total_elevation_gain, start_date, polyline
       FROM rides
       WHERE id != ?
         AND activity_type = ?
         AND distance BETWEEN ? AND ?
         AND moving_time > 0
         AND polyline IS NOT NULL
         AND polyline != ''
       ORDER BY start_date DESC
       LIMIT 80`,
    )
      .bind(
        id,
        String(current.activity_type || "ride"),
        minDistance,
        maxDistance,
      )
      .all();

    const matches: any[] = [];

    for (const candidate of results || []) {
      const candidateDistanceKm = Number((candidate as any).distance || 0);
      const candidatePoints = await loadRideCoordinates(
        String((candidate as any).polyline || ""),
      );
      const similarity = compareRouteSimilarity(
        currentPoints,
        candidatePoints,
        currentDistanceKm,
        candidateDistanceKm,
      );

      if (!similarity || similarity.score < 0.68) continue;

      const currentMoving = Number(current.moving_time || 0);
      const candidateMoving = Number((candidate as any).moving_time || 0);
      const currentElev = Number(current.total_elevation_gain || 0);
      const candidateElev = Number((candidate as any).total_elevation_gain || 0);
      const currentSpeed =
        currentMoving > 0 ? currentDistanceKm / (currentMoving / 3600) : 0;
      const candidateSpeed =
        candidateMoving > 0
          ? candidateDistanceKm / (candidateMoving / 3600)
          : 0;

      matches.push({
        id: Number((candidate as any).id),
        name: String((candidate as any).name || "Aktivitas"),
        activity_type: String((candidate as any).activity_type || "ride"),
        distance: candidateDistanceKm,
        moving_time: candidateMoving,
        average_speed: Number((candidate as any).average_speed || candidateSpeed),
        total_elevation_gain: candidateElev,
        start_date: (candidate as any).start_date,
        score: Number(similarity.score.toFixed(3)),
        similarity_percent: Math.round(similarity.score * 100),
        nearest_average_km: Number(similarity.nearestKm.toFixed(3)),
        time_delta_seconds: formatMatchDelta(currentMoving, candidateMoving),
        distance_delta_km: Number(
          formatMatchDelta(currentDistanceKm, candidateDistanceKm).toFixed(3),
        ),
        speed_delta_kmh: Number(
          formatMatchDelta(currentSpeed, candidateSpeed).toFixed(2),
        ),
        elevation_delta_m: Math.round(
          formatMatchDelta(currentElev, candidateElev),
        ),
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Math.abs(a.time_delta_seconds) - Math.abs(b.time_delta_seconds);
    });

    return c.json({
      success: true,
      current: {
        id: Number(current.id),
        name: String(current.name || "Aktivitas"),
        activity_type: String(current.activity_type || "ride"),
        distance: currentDistanceKm,
        moving_time: Number(current.moving_time || 0),
        total_elevation_gain: Number(current.total_elevation_gain || 0),
      },
      matches: matches.slice(0, 5),
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal mencari aktivitas rute mirip.",
      },
      500,
    );
  }
});

api.get("/segments", protectAPI, async (c) => {
  try {
    await ensurePersonalSegmentsTable(c.env.DB);

    const activityType = String(c.req.query("activity_type") || "").trim();
    const queryBase = `
      SELECT
        personal_segments.*,
        rides.name as source_ride_name,
        rides.start_date as source_start_date
      FROM personal_segments
      LEFT JOIN rides ON rides.id = personal_segments.source_ride_id
    `;
    const queryEnd = ` ORDER BY personal_segments.created_at DESC, personal_segments.id DESC LIMIT 80`;
    const { results } = activityType
      ? await c.env.DB
          .prepare(
            queryBase + ` WHERE personal_segments.activity_type = ?` + queryEnd,
          )
          .bind(activityType)
          .all()
      : await c.env.DB.prepare(queryBase + queryEnd).all();

    return c.json({
      success: true,
      segments: results || [],
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal memuat personal segment.",
      },
      500,
    );
  }
});

api.post("/segments", protectAPI, async (c) => {
  try {
    await ensurePersonalSegmentsTable(c.env.DB);

    const body = await c.req.json();
    const sourceRideId = Number(body?.source_ride_id || body?.ride_id);

    if (!Number.isFinite(sourceRideId) || sourceRideId <= 0) {
      return c.json(
        {
          success: false,
          message: "source_ride_id wajib diisi.",
        },
        400,
      );
    }

    const ride: any = await c.env.DB.prepare(
      `SELECT id, name, activity_type, distance, moving_time, start_date, polyline
       FROM rides
       WHERE id = ?`,
    )
      .bind(sourceRideId)
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas sumber tidak ditemukan.",
        },
        404,
      );
    }

    const points = await loadRideCoordinates(String(ride.polyline || ""));

    if (points.length < 3) {
      return c.json(
        {
          success: false,
          message: "Koordinat aktivitas tidak cukup untuk membuat segmen.",
        },
        400,
      );
    }

    const maxIndex = points.length - 1;
    const startIndex = clampIndex(Number(body?.start_index), maxIndex);
    const endIndex = clampIndex(Number(body?.end_index), maxIndex);

    if (endIndex <= startIndex) {
      return c.json(
        {
          success: false,
          message: "Titik akhir segmen harus setelah titik awal.",
        },
        400,
      );
    }

    const segmentPoints = points.slice(startIndex, endIndex + 1);
    const distanceKm = calculateRouteDistanceMeters(segmentPoints) / 1000;

    if (!Number.isFinite(distanceKm) || distanceKm < 0.05) {
      return c.json(
        {
          success: false,
          message: "Segmen terlalu pendek. Minimal sekitar 50 meter.",
        },
        400,
      );
    }

    const name = sanitizeSegmentName(body?.name);
    const startPoint = points[startIndex];
    const endPoint = points[endIndex];
    const inserted = await c.env.DB.prepare(
      `INSERT INTO personal_segments (
        name,
        activity_type,
        source_ride_id,
        start_lat,
        start_lng,
        end_lat,
        end_lng,
        start_index,
        end_index,
        distance_km
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        name,
        String(ride.activity_type || "ride"),
        Number(ride.id),
        startPoint.lat,
        startPoint.lng,
        endPoint.lat,
        endPoint.lng,
        startIndex,
        endIndex,
        distanceKm,
      )
      .run();
    const segmentId = Number((inserted.meta as any)?.last_row_id || 0);
    const segment: PersonalSegmentRecord = {
      id: segmentId,
      name,
      activity_type: String(ride.activity_type || "ride"),
      source_ride_id: Number(ride.id),
      start_lat: startPoint.lat,
      start_lng: startPoint.lng,
      end_lat: endPoint.lat,
      end_lng: endPoint.lng,
      start_index: startIndex,
      end_index: endIndex,
      distance_km: distanceKm,
    };
    const efforts = await getSegmentEfforts(c.env.DB, segment, 5);

    return c.json({
      success: true,
      message: "Personal segment berhasil dibuat.",
      segment: {
        ...segment,
        distance_km: Number(distanceKm.toFixed(3)),
      },
      efforts,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal membuat personal segment.",
      },
      500,
    );
  }
});

api.put("/segments/:id", protectAPI, async (c) => {
  try {
    await ensurePersonalSegmentsTable(c.env.DB);

    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const name = sanitizeSegmentName(body?.name);

    if (!Number.isFinite(id) || id <= 0) {
      return c.json(
        {
          success: false,
          message: "ID personal segment tidak valid.",
        },
        400,
      );
    }

    const existing: any = await c.env.DB.prepare(
      `SELECT id FROM personal_segments WHERE id = ?`,
    )
      .bind(id)
      .first();

    if (!existing) {
      return c.json(
        {
          success: false,
          message: "Personal segment tidak ditemukan.",
        },
        404,
      );
    }

    await c.env.DB.prepare(`UPDATE personal_segments SET name = ? WHERE id = ?`)
      .bind(name, id)
      .run();

    return c.json({
      success: true,
      id,
      name,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal rename personal segment.",
      },
      500,
    );
  }
});

api.get("/segments/:id/efforts", protectAPI, async (c) => {
  try {
    await ensurePersonalSegmentsTable(c.env.DB);

    const segment: any = await c.env.DB.prepare(
      `SELECT * FROM personal_segments WHERE id = ?`,
    )
      .bind(c.req.param("id"))
      .first();

    if (!segment) {
      return c.json(
        {
          success: false,
          message: "Personal segment tidak ditemukan.",
        },
        404,
      );
    }

    const efforts = await getSegmentEfforts(
      c.env.DB,
      segment as PersonalSegmentRecord,
      20,
    );

    return c.json({
      success: true,
      segment,
      efforts,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal memuat effort segment.",
      },
      500,
    );
  }
});

api.get("/activity_segments/:id", protectAPI, async (c) => {
  try {
    await ensurePersonalSegmentsTable(c.env.DB);

    const ride: any = await c.env.DB.prepare(
      `SELECT id, name, activity_type, distance, moving_time, start_date, polyline
       FROM rides
       WHERE id = ?`,
    )
      .bind(c.req.param("id"))
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan.",
        },
        404,
      );
    }

    const points = await loadRideCoordinates(String(ride.polyline || ""));
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM personal_segments
       WHERE activity_type = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
    )
      .bind(String(ride.activity_type || "ride"))
      .all();
    const matches: any[] = [];

    for (const segment of results || []) {
      const currentEffort = buildSegmentEffort(
        segment as PersonalSegmentRecord,
        ride,
        points,
      );

      if (!currentEffort) continue;

      const bestEfforts = await getSegmentEfforts(
        c.env.DB,
        segment as PersonalSegmentRecord,
        1,
      );
      const best = bestEfforts[0] || null;

      matches.push({
        segment,
        effort: currentEffort,
        best,
        delta_seconds: best
          ? currentEffort.elapsed_seconds - best.elapsed_seconds
          : 0,
      });
    }

    matches.sort((a, b) => a.effort.elapsed_seconds - b.effort.elapsed_seconds);

    return c.json({
      success: true,
      matches,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal memuat segment aktivitas.",
      },
      500,
    );
  }
});

api.delete("/segments/:id", protectAPI, async (c) => {
  try {
    await ensurePersonalSegmentsTable(c.env.DB);

    const existing: any = await c.env.DB.prepare(
      `SELECT id FROM personal_segments WHERE id = ?`,
    )
      .bind(c.req.param("id"))
      .first();

    if (!existing) {
      return c.json(
        {
          success: false,
          message: "Personal segment tidak ditemukan.",
        },
        404,
      );
    }

    await c.env.DB.prepare(`DELETE FROM personal_segments WHERE id = ?`)
      .bind(c.req.param("id"))
      .run();

    return c.json({
      success: true,
      id: Number(c.req.param("id")),
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal menghapus personal segment.",
      },
      500,
    );
  }
});

// 4. Hapus Aktivitas
api.delete("/delete_ride/:id", protectAPI, async (c) => {
  try {
    const ride: any = await c.env.DB.prepare(
      "SELECT polyline FROM rides WHERE id = ?",
    )
      .bind(c.req.param("id"))
      .first();

    if (!ride) {
      return c.json(
        {
          success: false,
          message: "Aktivitas tidak ditemukan",
        },
        404,
      );
    }

    if (ride.polyline && ride.polyline.includes(".r2.dev/")) {
	  try {
		const url = new URL(ride.polyline);
		const objectKey = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

		if (objectKey) {
		  await c.env.R2_BUCKET.delete(objectKey);
		}
	  } catch (e) {
		console.warn("R2 cleanup gagal:", e);
	  }
	}

    await c.env.DB.prepare("DELETE FROM rides WHERE id = ?")
      .bind(c.req.param("id"))
      .run();

    return c.json({
      success: true,
    });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message,
      },
      500,
    );
  }
});

// 5. RADAR SYNC (Cloudflare KV) - Terbuka untuk Tamu (Bebas Token)
api.post("/radar_sync", async (c) => {
  try {
    const { room, user, lat, lng, speed } = await c.req.json();
    if (!room || !user || room === "SINGLE_MODE")
      return c.json({ success: true, participants: [], radios: [] });

    // Simpan koordinat lokasi ke Radar
    await c.env.GASPOOL_RADAR.put(
      `${room}:${user}`,
      JSON.stringify({ lat, lng, speed, time: Date.now() }),
      { expirationTtl: 60 },
    );

    // Ambil daftar teman satu room
    const list = await c.env.GASPOOL_RADAR.list({ prefix: room + ":" });
    const participants = await Promise.all(
      list.keys.map(async (k: { name: string }) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[1], ...JSON.parse(val || "{}") };
      }),
    );

    // Telinga Satelit: Dengarkan apakah ada file radio (suara) baru di room ini
    const radioList = await c.env.GASPOOL_RADAR.list({
      prefix: `RADIO:${room}:`,
    });
    const radios = await Promise.all(
      radioList.keys.map(async (k: { name: string }) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[2], ...JSON.parse(val || "{}") };
      }),
    );
    const peletonRouteRaw = await c.env.GASPOOL_RADAR.get(
      `PELETON_ROUTE:${room}`,
    );
    const peletonRoute = peletonRouteRaw ? JSON.parse(peletonRouteRaw) : null;

    return c.json({
      success: true,
      participants,
      radios,
      peleton_route: peletonRoute,
    });
  } catch (e) {
    return c.json({ success: false }, 500);
  }
});

// 6. RADIO PTT (Voice Sync) - REAL R2 & KV UPLOAD
api.post("/radio", async (c) => {
  try {
    const body = await c.req.parseBody();
    const room = sanitizeRoomId(body["room"] as string);
    const user = body["user"] as string;
    const audioFile = body["audio"] as File;

    if (!room || room === "SINGLE_MODE" || !user || !audioFile) {
      return c.json(
        { success: false, message: "Data transmisi tidak lengkap" },
        400,
      );
    }

    // Generate nama file unik agar tidak bertabrakan
    const objectKey = `gaspool/audio/${room}/radio_${sanitizeRadioUser(user)}_${Date.now()}.webm`;

    // Konversi file suara menjadi ArrayBuffer untuk diunggah
    const arrayBuffer = await audioFile.arrayBuffer();

    // Tembakkan file suara ke Satelit R2
    await c.env.R2_BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType: audioFile.type || "audio/webm" },
    });

    // URL Publik file suara
    const publicUrl = `${R2_PUBLIC_BASE_URL}/${objectKey}`;

    // Catat link suara ke Radar KV agar teman di room bisa mendengarnya
    await c.env.GASPOOL_RADAR.put(
      `RADIO:${room}:${user}`,
      JSON.stringify({
        objectKey,
        url: publicUrl,
        time: Date.now(),
      }),
      { expirationTtl: 60 },
    );

    return c.json({ success: true, url: publicUrl });
  } catch (e: any) {
    return c.json({ success: false, message: e.message }, 500);
  }
});

api.post("/radio_cleanup", protectAPI, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const room = sanitizeRoomId(body?.room);

    if (!room || room === "SINGLE_MODE") {
      return c.json({ success: true, deleted: 0 });
    }

    let deleted = 0;
    const prefixes = [`gaspool/audio/${room}/`, `radio_${room}_`];

    for (const prefix of prefixes) {
      let cursor: string | undefined;

      do {
        const listed: any = await c.env.R2_BUCKET.list({
          prefix,
          cursor,
        });

        for (const object of listed.objects || []) {
          await c.env.R2_BUCKET.delete(object.key);
          deleted++;
        }

        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    }

    const radioList = await c.env.GASPOOL_RADAR.list({
      prefix: `RADIO:${room}:`,
    });

    await Promise.all(
      radioList.keys.map((key: { name: string }) => c.env.GASPOOL_RADAR.delete(key.name)),
    );

    return c.json({ success: true, deleted });
  } catch (e: any) {
    return c.json(
      {
        success: false,
        message: e.message || "Gagal membersihkan audio peleton.",
      },
      500,
    );
  }
});

// 7. PUBLIC RIDES FETCH (single-owner public profile)
api.get("/public_rides/:username", async (c) => {
  const username = normalizePublicProfileSlug(c.req.param("username"));
  const publicProfileSlug = getPublicProfileSlug(c.env);
  const p = parseInt(c.req.query("page") || "1");
  const lim = 10;
  const off = (p - 1) * lim;

  if (username !== publicProfileSlug)
    return c.json({ error: "Public profile not found" }, 404);

  try {
    const { results: rides } = await c.env.DB.prepare(
      "SELECT * FROM rides WHERE is_public = 1 ORDER BY start_date DESC LIMIT ? OFFSET ?",
    )
      .bind(lim, off)
      .all();
    return c.json({ rides });
  } catch (e) {
    return c.json({ error: "Database error" }, 500);
  }
});

// 8. RADAR SPECTATOR (Hanya Membaca Data Peleton untuk Keluarga)
api.get("/radar_view/:room", async (c) => {
  const room = c.req.param("room").toUpperCase();
  try {
    const list = await c.env.GASPOOL_RADAR.list({ prefix: room + ":" });
    const participants = await Promise.all(
      list.keys.map(async (k: { name: string }) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[1], ...JSON.parse(val || "{}") };
      }),
    );
    return c.json({ success: true, participants });
  } catch (e) {
    return c.json({ success: false }, 500);
  }
});

// 9. SATELIT CUACA (Open-Meteo Proxy)
api.get("/weather", async (c) => {
  const lat = c.req.query("lat");
  const lng = c.req.query("lng");
  if (!lat || !lng) return c.json({ temp: null });

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`,
    );
    const data: any = await res.json();
    return c.json({ temp: data.current_weather?.temperature || null });
  } catch (e) {
    return c.json({ temp: null });
  }
});

export default api;
