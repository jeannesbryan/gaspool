/**
 * Jejak perjalanan untuk radar.
 *
 * Kenapa ini ada: radar tadinya hanya menyimpan POSISI TERAKHIR, jadi penonton
 * yang membuka tautannya terlambat cuma melihat satu titik dan tidak tahu
 * pemiliknya sudah lewat mana. Untuk gowes jauh, jejaknya justru bagian yang
 * berguna.
 *
 * Catatan penting soal tempat penyimpanan: jejak ini dititipkan di dalam nilai
 * KV milik peserta, BUKAN sebagai kunci terpisah. Alasannya, daftar peserta
 * dibaca lewat `list({ prefix: room + ":" })` lalu nama pengguna diambil dari
 * bagian setelah titik dua pertama. Kunci baru seperti `ROOM:user:trail` akan
 * terbaca sebagai peserta kedua bernama sama, dan penonton akan melihat dua
 * orang padahal hanya satu. Menitipkan di nilai yang sama menghindari itu
 * sekaligus membuat jejak ikut kedaluwarsa bersama posisinya.
 *
 * Modul ini murni supaya bisa diuji tanpa Worker maupun KV.
 */

export type RadarTrailPoint = {
  lat: number;
  lng: number;
  t: number;
};

/**
 * Berapa titik yang disimpan.
 *
 * Interval siaran di mode normal sekitar 15 detik, jadi 120 titik kira-kira
 * setara 30 menit terakhir — cukup untuk memberi gambaran arah, tanpa membuat
 * nilai KV tumbuh tanpa batas (nilai ditulis ulang setiap kali sync).
 */
export const RADAR_TRAIL_MAX_POINTS = 120;

/**
 * Jarak minimum antar titik jejak.
 *
 * GPS yang diam masih bergoyang beberapa meter. Tanpa ambang, jejak akan penuh
 * titik-titik yang saling menumpuk sehingga polyline-nya terlihat seperti
 * coretan, dan kuota tulis KV terbuang untuk informasi yang sama.
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
 * Baca jejak dari nilai KV yang mungkin rusak.
 * Nilai yang tidak bisa dipakai menghasilkan jejak kosong, bukan lemparan.
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

  // Jejak yang entah bagaimana tumbuh lebih panjang dari batas tetap dipangkas
  // di sini, supaya data lama tidak bisa membengkakkan halaman penonton.
  return points.length > RADAR_TRAIL_MAX_POINTS
    ? points.slice(points.length - RADAR_TRAIL_MAX_POINTS)
    : points;
};

/**
 * Tambahkan satu posisi ke jejak.
 *
 * Aturan:
 *   - koordinat tidak masuk akal diabaikan (jejak lama dikembalikan apa adanya);
 *   - perpindahan lebih kecil dari ambang hanya MEMPERBARUI titik terakhir,
 *     sehingga posisi terakhir tetap akurat tanpa menambah panjang jejak;
 *   - panjang jejak selalu dibatasi di ujung yang lama.
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
    // Diam di tempat: cukup pindahkan titik terakhir, jangan tambah yang baru.
    return [...existing.slice(0, -1), next];
  }

  const appended = [...existing, next];
  return appended.length > maxPoints ? appended.slice(appended.length - maxPoints) : appended;
};
