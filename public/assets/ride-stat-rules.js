/**
 * Aturan angka apa yang DISIMPAN ke riwayat olahraga.
 *
 * Berkas ini sengaja berupa .js biasa di public/assets supaya dipakai TIGA
 * tempat dari satu sumber, tanpa disalin:
 *
 *   - halaman tracker (lewat <script type="module"> → window.RideStatRules),
 *   - server (src/api/api.ts mengimpornya saat menyimpan aktivitas),
 *   - tests/ride-stat-rules.mjs.
 *
 * Kenapa tidak ditulis dua kali: jarak yang ditampilkan halaman dan jarak yang
 * disimpan server HARUS angka yang sama. Kalau aturannya disalin, keduanya akan
 * menyimpang lagi persis seperti kasus "dua kebenaran" sebelumnya (18,741 km di
 * layar vs 18,506 km di studio) — dan kali ini penyimpangannya tidak akan
 * kelihatan, karena yang satu hanya muncul di berkas.
 *
 * Dua keputusan yang hidup di sini:
 *
 * 1. JARAK memakai tabel segmen bersama. Drift GPS saat berhenti bukan jarak
 *    yang ditempuh: pada gowes 25 Sep 2026, 1651 m dari 55,130 km (3,0%)
 *    berasal dari 345 segmen "diam" dengan kecepatan rata-rata 0,48 km/h.
 *    Selama angka mentah yang disimpan, kartu milestone seumur hidup memakai
 *    angka yang kita sendiri sudah tahu salah.
 *
 * 2. ELEVASI mempertahankan pengukuran — arahnya sengaja KEBALIKAN dari jarak.
 *    Tidak ada dasar untuk menyatakan salah satu angka lebih benar: pada data
 *    nyata, taksiran elevasi gowes itu bergerak dari 167 m sampai 855 m hanya
 *    karena beda parameter filter, sementara selisih kedua angka cuma 75 m.
 *    Kalau tidak ada nilai yang benar, jangan menukar satu taksiran dengan
 *    taksiran lain. Hitung ulang hanya boleh MENGISI kalau live tidak punya
 *    angka sama sekali.
 */

/** Batas bawah rasio jarak bersih terhadap jarak yang dilaporkan tracker. */
export const STORED_DISTANCE_MIN_RATIO = 0.5;
/**
 * Batas atas. Tabel segmen hanya MEMBUANG segmen, jadi jarak bersih normalnya
 * lebih kecil. Toleransi 10 persen disisakan untuk perbedaan definisi
 * "bergerak" antara jam live (auto-pause) dan tabel segmen — bukan untuk
 * menerima angka yang lebih besar dari yang dilaporkan.
 */
export const STORED_DISTANCE_MAX_RATIO = 1.1;

const positive = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
};

/**
 * Putuskan jarak mana yang disimpan ke D1 dan metadata.
 *
 * @param {{declaredKm: unknown, cleanKm?: unknown, sharedTableKm?: unknown}} input
 *   declaredKm    = jarak yang dilaporkan halaman tracker (jam live).
 *   cleanKm       = jarak dari tabel segmen bersama (stats_after).
 *   sharedTableKm = jarak yang sama, tetapi hanya terisi kalau tabel bersama
 *                   benar-benar dimuat di perangkat. Null berarti perhitungan
 *                   lama yang dipakai, dan fallback tidak boleh diam-diam
 *                   menjadi angka resmi.
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
 * Putuskan elevasi mana yang disimpan. Hitung ulang hanya MENGISI, tidak
 * pernah menimpa pengukuran.
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
