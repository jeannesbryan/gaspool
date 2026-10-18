/**
 * Rules for which numbers are STORED into the sport history.
 *
 * This file is deliberately a plain .js in public/assets so that THREE places
 * use it from one source, without copying:
 *
 *   - the tracker page (through <script type="module"> → window.RideStatRules),
 *   - the server (src/api/api.ts imports it when saving an activity),
 *   - tests/ride-stat-rules.mjs.
 *
 * Why it is not written twice: the distance shown by the page and the distance
 * stored by the server MUST be the same number. If the rules get copied, the
 * two will drift again exactly like the earlier "two truths" case (18,741 km on
 * screen vs 18,506 km in the studio), and this time the drift would stay
 * invisible, because one of the two only ever shows up in a file.
 *
 * Two decisions live here:
 *
 * 1. DISTANCE uses the shared segment table. GPS drift while stopped is not
 *    distance travelled: on the 25 Sep 2026 ride, 1651 m of 55,130 km (3.0%)
 *    came from 345 "stopped" segments at an average speed of 0.48 km/h. As
 *    long as the raw number is what gets stored, the lifetime milestone cards
 *    use a number we already know is wrong.
 *
 * 2. ELEVATION keeps the measurement, and its direction is deliberately the
 *    OPPOSITE of distance. There is no basis for claiming one number is more
 *    correct: on real data the elevation estimate for that ride moved from
 *    167 m to 855 m only because of different filter parameters, while the two
 *    numbers differ by just 75 m. When no value is correct, do not swap one
 *    estimate for another. Recalculation may only FILL IN when live has no
 *    number at all.
 */

/** Lower bound for the ratio of clean distance to the distance the tracker reports. */
export const STORED_DISTANCE_MIN_RATIO = 0.5;
/**
 * Upper bound. The segment table only DROPS segments, so the clean distance is
 * normally smaller. The 10 percent tolerance is left for the difference in the
 * definition of "moving" between the live clock (auto-pause) and the segment
 * table, not for accepting a number larger than the one reported.
 */
export const STORED_DISTANCE_MAX_RATIO = 1.1;

const positive = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
};

/**
 * Decide which distance is stored into D1 and the metadata.
 *
 * @param {{declaredKm: unknown, cleanKm?: unknown, sharedTableKm?: unknown}} input
 *   declaredKm    = distance reported by the tracker page (live clock).
 *   cleanKm       = distance from the shared segment table (stats_after).
 *   sharedTableKm = the same distance, but only filled in when the shared table
 *                   is actually loaded on the device. Null means the old
 *                   calculation is used, and a fallback must not quietly
 *                   become the official number.
 */
export const chooseStoredDistanceKm = ({ declaredKm, cleanKm, sharedTableKm }) => {
  const declared = positive(declaredKm);
  const shared = positive(sharedTableKm);
  const clean = positive(cleanKm) || shared;

  if (shared <= 0) {
    return {
      km: declared,
      source: "tracker",
      declared_km: declared,
      clean_km: null,
      reason:
        "Tabel segmen bersama tidak tersedia di perangkat, jadi jarak yang dilaporkan tracker dipertahankan apa adanya.",
    };
  }

  if (declared <= 0) {
    return {
      km: clean,
      source: "shared_segment_table",
      declared_km: declared,
      clean_km: clean,
      reason:
        "Tracker tidak melaporkan jarak, jadi hasil tabel segmen dipakai daripada menyimpan nol.",
    };
  }

  const ratio = clean / declared;
  if (ratio < STORED_DISTANCE_MIN_RATIO || ratio > STORED_DISTANCE_MAX_RATIO) {
    return {
      km: declared,
      source: "tracker",
      declared_km: declared,
      clean_km: clean,
      reason:
        "Jarak tabel segmen (" +
        clean.toFixed(3) +
        " km) menyimpang terlalu jauh dari jarak yang dilaporkan (" +
        declared.toFixed(3) +
        " km); angka tracker dipertahankan dan aktivitas ini perlu diperiksa.",
    };
  }

  return {
    km: Number(clean.toFixed(3)),
    source: "shared_segment_table",
    declared_km: declared,
    clean_km: clean,
    reason:
      "Jarak memakai tabel segmen bersama; " +
      (declared - clean).toFixed(3) +
      " km drift GPS saat berhenti tidak dihitung sebagai jarak yang ditempuh.",
  };
};

/**
 * Decide which elevation is stored. Recalculation only FILLS IN, it never
 * overwrites a measurement.
 */
export const chooseStoredElevationGain = ({ liveMeters, recalculatedMeters }) => {
  const live = Math.max(0, Number(liveMeters) || 0);
  const recalculated = Math.max(0, Number(recalculatedMeters) || 0);

  if (live > 0) {
    return {
      meters: live,
      source: "live_clock",
      live_meters: live,
      recalculated_meters: recalculated,
      reason:
        "Elevasi yang diukur saat gowes dipertahankan; hitung ulang hanya sebagai pemeriksa silang karena angka ini tidak bisa ditentukan pasti dari data.",
    };
  }

  if (recalculated > 0) {
    return {
      meters: recalculated,
      source: "recalculated",
      live_meters: live,
      recalculated_meters: recalculated,
      reason:
        "Tidak ada elevasi dari gowes, jadi hasil hitung ulang dipakai untuk MENGISI kekosongan ini.",
    };
  }

  return {
    meters: 0,
    source: "none",
    live_meters: live,
    recalculated_meters: recalculated,
    reason: "Tidak ada angka elevasi dari sumber mana pun.",
  };
};
