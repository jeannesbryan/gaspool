/**
 * Travel trail for the radar.
 *
 * Why this exists: the radar used to keep only the LAST POSITION, so a viewer
 * who opens the link late sees a single dot and has no idea where the owner
 * has already passed. On long gowes rides the trail is exactly the useful
 * part.
 *
 * Important note about where it is stored: the trail rides inside the
 * participant's KV value, NOT as a separate key. The reason: the participant
 * list is read via `list({ prefix: room + ":" })` and the user name is taken
 * from the part after the first colon. A new key like `ROOM:user:trail` would
 * be read as a second participant with the same name, and viewers would see
 * two people where there is only one. Keeping it in the same value avoids that
 * and also makes the trail expire together with the position.
 *
 * This module is pure so it can be tested without a Worker or KV.
 */

export type RadarTrailPoint = {
  lat: number;
  lng: number;
  t: number;
};

/**
 * How many points are kept.
 *
 * The broadcast interval in normal mode is about 15 seconds, so 120 points is
 * roughly the last 30 minutes: enough to show the direction, without letting
 * the KV value grow without bound (the value is rewritten on every sync).
 */
export const RADAR_TRAIL_MAX_POINTS = 120;

/**
 * Minimum distance between trail points.
 *
 * A stationary GPS still wobbles by a few metres. Without a threshold the trail
 * fills with points stacked on top of each other, so the polyline looks like
 * scribble and KV write quota is spent on the same information.
 */
export const RADAR_TRAIL_MIN_METERS = 12;

const EARTH_RADIUS_M = 6371000;

const isValidLat = (value: number) => Number.isFinite(value) && value >= -90 && value <= 90;
const isValidLng = (value: number) => Number.isFinite(value) && value >= -180 && value <= 180;

export const radarDistanceMeters = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * Read a trail from a KV value that may be corrupt.
 * A value that cannot be used yields an empty trail, not a throw.
 */
export const normalizeRadarTrail = (value: unknown): RadarTrailPoint[] => {
  if (!Array.isArray(value)) return [];

  const points: RadarTrailPoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const lat = Number((item as any).lat);
    const lng = Number((item as any).lng);
    const t = Number((item as any).t);
    if (!isValidLat(lat) || !isValidLng(lng)) continue;
    points.push({ lat, lng, t: Number.isFinite(t) && t > 0 ? t : 0 });
  }

  // A trail that somehow grew past the limit is still trimmed right here, so
  // old data cannot bloat the viewer page.
  return points.length > RADAR_TRAIL_MAX_POINTS
    ? points.slice(points.length - RADAR_TRAIL_MAX_POINTS)
    : points;
};

/**
 * Append one position to the trail.
 *
 * Rules:
 *   - coordinates that make no sense are ignored (the old trail is returned);
 *   - a move smaller than the threshold only UPDATES the last point, so the
 *     latest position stays accurate without making the trail longer;
 *   - the trail length is always capped at the old end.
 */
export const appendRadarTrailPoint = (
  trail: unknown,
  point: { lat: unknown; lng: unknown; t?: unknown },
  options: { minMeters?: number; maxPoints?: number } = {},
): RadarTrailPoint[] => {
  const existing = normalizeRadarTrail(trail);
  const minMeters = Number(options.minMeters ?? RADAR_TRAIL_MIN_METERS);
  const maxPoints = Number(options.maxPoints ?? RADAR_TRAIL_MAX_POINTS);

  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!isValidLat(lat) || !isValidLng(lng)) return existing;

  const rawT = Number(point?.t);
  const next: RadarTrailPoint = { lat, lng, t: Number.isFinite(rawT) && rawT > 0 ? rawT : Date.now() };

  if (existing.length === 0) return [next];

  const last = existing[existing.length - 1];
  if (radarDistanceMeters(last, next) < minMeters) {
    // Standing still: just move the last point, do not add a new one.
    return [...existing.slice(0, -1), next];
  }

  const appended = [...existing, next];
  return appended.length > maxPoints ? appended.slice(appended.length - maxPoints) : appended;
};
