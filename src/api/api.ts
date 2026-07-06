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

type PlannedRoutePayload = {
  version: 1;
  provider: "ors" | "gpx";
  profile: string;
  name: string;
  distance_km: number;
  distance_m: number;
  duration_s: number;
  waypoints: RoutePoint[];
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
  if (value?.path) return extractCoordinateList(value.path);
  if (value?.data) return extractCoordinateList(value.data);
  if (value?.polyline) return extractCoordinateList(value.polyline);
  if (value?.coordinates) return extractCoordinateList(value.coordinates);

  return [];
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

    const data = await orsRes.json();
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
  const p = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const lim = 10;
  const off = (p - 1) * lim;
  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01 00:00:00`;
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01 00:00:00`;
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

    const qStats = statsSelect + mainWhere.sql;
    const qData =
      "SELECT * FROM rides" +
      mainWhere.sql +
      ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const first = (sql: string, params: any[]) =>
      params.length
        ? c.env.DB.prepare(sql)
            .bind(...params)
            .first()
        : c.env.DB.prepare(sql).first();

    const [stats, monthStats, yearStats, rides] = await Promise.all([
      first(qStats, mainWhere.params),
      first(statsSelect + monthWhere.sql, monthWhere.params),
      first(statsSelect + yearWhere.sql, yearWhere.params),
      c.env.DB.prepare(qData)
        .bind(...mainWhere.params, lim, off)
        .all(),
    ]);

    return c.json({
      success: true,
      stats,
      period_stats: {
        month: monthStats,
        year: yearStats,
      },
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
          route,
        },
        502,
      );
    }

    const data = await routeRes.json();

    return c.json({
      success: true,
      route: {
        ...route,
        data,
      },
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

      // Upload Rute Utuh ke R2
      await c.env.R2_BUCKET.put(fileName, JSON.stringify(fullPolyline), {
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
          b.start_date || new Date().toISOString(),
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
      list.keys.map(async (k) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[1], ...JSON.parse(val || "{}") };
      }),
    );

    // Telinga Satelit: Dengarkan apakah ada file radio (suara) baru di room ini
    const radioList = await c.env.GASPOOL_RADAR.list({
      prefix: `RADIO:${room}:`,
    });
    const radios = await Promise.all(
      radioList.keys.map(async (k) => {
        const val = await c.env.GASPOOL_RADAR.get(k.name);
        return { user: k.name.split(":")[2], ...JSON.parse(val || "{}") };
      }),
    );

    return c.json({ success: true, participants, radios });
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
      radioList.keys.map((key) => c.env.GASPOOL_RADAR.delete(key.name)),
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
      list.keys.map(async (k) => {
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
