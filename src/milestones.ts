/**
 * Milestone jarak tempuh seumur hidup — kelipatan 1000 km.
 *
 * Kenapa dipisah jadi modul murni: angka yang dipakai di kartu bagikan ini
 * menyatakan pencapaian seseorang, dan kartunya akan dikirim ke orang lain.
 * Perhitungan seperti itu sebaiknya bisa diuji tanpa menyalakan Worker atau
 * mengambil data dari D1 — cukup dengan angka.
 *
 * Modul ini tidak mengimpor apa pun supaya test bisa memuatnya lewat TypeScript
 * type stripping Node (lihat tests/milestones.mjs).
 */

/** Milestone dihitung per 1000 km (keputusan pemilik, 2026-09-24). */
export const MILESTONE_STEP_KM = 1000;

export type MilestoneProgress = {
  step_km: number;
  total_km: number;
  /** Berapa milestone yang sudah tercapai. 0 berarti belum sampai 1000 km. */
  reached_count: number;
  /** Milestone terakhir yang tercapai; 0 kalau belum ada. */
  last_reached_km: number;
  /** Milestone berikutnya yang belum tercapai. */
  next_km: number;
  /** Sisa jarak menuju milestone berikutnya. */
  remaining_km: number;
  /** Kemajuan di dalam segmen yang sedang berjalan, 0..1. */
  progress_ratio: number;
};

/**
 * Bawa angka apa pun ke bentuk yang aman dipakai berhitung.
 * D1 bisa mengembalikan NULL, dan klien bisa mengirim string; keduanya tidak
 * boleh menghasilkan kartu bagikan yang berisi "NaN km".
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
    // Selalu di dalam [0, 1). Dibulatkan agar klien tidak perlu menebak presisi.
    progress_ratio: Number(Math.min(0.999999, Math.max(0, withinSegment / step)).toFixed(6)),
  };
};

/**
 * Milestone yang DILEWATI antara dua pembacaan jarak total.
 *
 * Dipakai setelah sebuah aktivitas disimpan: kalau jarak seumur hidup berpindah
 * dari 2.940 km ke 3.050 km, maka 3.000 km baru saja terlewati dan kartunya
 * perlu ditawarkan. Membandingkan "jarak sebelum" dan "jarak sesudah" lebih
 * dapat dipercaya daripada menghitung di klien, karena penyimpanan bisa diulang
 * atau dibatalkan.
 *
 * Mengembalikan array karena satu aktivitas bisa melewati lebih dari satu
 * milestone ketika muatan lama ditambahkan sekaligus.
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

/** Format jarak untuk ditampilkan, mis. 2847.3 -> "2.847,3". */
export const formatMilestoneKm = (value: unknown, decimals = 1) => {
  const n = safeKm(value);
  return n.toLocaleString("id-ID", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};
