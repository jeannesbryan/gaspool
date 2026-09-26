/**
 * Akuntansi jam live yang ikut DISIMPAN bersama aktivitas.
 *
 * Kenapa modul ini ada. Halaman tracker sudah mengirim `live_clock` di payload
 * sejak commit dfb3e28, tetapi api.ts tidak pernah membacanya dan metadata
 * aktivitas tidak memuatnya — jadi catatannya hilang begitu layar finish
 * ditutup. Akibatnya, pada gowes 25 Sep 2026 (11027 titik, rentang 7 jam),
 * pertanyaan "apakah jam live kehilangan detik?" hanya bisa dijawab dari
 * ABSENNYA sebuah peringatan, bukan dari angka. Berkas ini membuat angka itu
 * ikut tersimpan, supaya gowes berikutnya bisa dibuktikan dari berkasnya
 * sendiri.
 *
 * Prinsip modul ini:
 *
 *  1. Ia TIDAK menghitung ulang statistik apa pun. Nilai yang tersimpan adalah
 *     pengukuran jam live, dan hitung ulang tetap tugas Activity Doctor.
 *  2. Nol dan "tidak ada data" adalah dua hal berbeda. Kalau instrumentasi
 *     tidak sempat dimuat, hasilnya `null` — bukan angka nol yang bisa
 *     disalahartikan sebagai "tidak ada waktu yang hilang".
 *  3. Angka dari klien dirapikan, bukan dipercaya. Jumlahkan sendiri
 *     keranjangnya, lalu tandai kalau klien mengirim total yang tidak cocok.
 *
 * Modul murni: nol impor runtime, jadi bisa diuji tanpa Worker/D1/network.
 */

export type LiveClockRecord = {
  tick_count: number;
  counted_seconds: number;
  clamped_seconds: number;
  dropped_seconds: number;
  clamped_tick_count: number;
  dropped_tick_count: number;
  /** clamped + dropped, dihitung ulang di sini — bukan disalin dari klien. */
  uncounted_seconds: number;
  /** Salinan apa adanya dari klien; null kalau tidak dikirim. */
  balance_seconds: number | null;
  /**
   * true = angka-angka saling cocok. false = ada keranjang yang tidak
   * menjumlah, jadi catatan ini TIDAK boleh dipakai sebagai bukti.
   */
  consistent: boolean;
  issues: string[];
};

/** Toleransi pembulatan antar-keranjang, dalam detik. */
export const LIVE_CLOCK_CONSISTENCY_TOLERANCE_SECONDS = 1;

const toNonNegativeNumber = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Number(numeric.toFixed(1));
};

const toNonNegativeCount = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
};

/**
 * Rapikan catatan jam live yang dikirim halaman tracker.
 *
 * Mengembalikan `null` kalau memang tidak ada catatan (instrumentasi tidak
 * dimuat, atau aktivitas lama yang direkam sebelum fitur ini ada). Itu
 * disengaja: menyimpannya sebagai nol akan menyamarkan kehilangan data.
 */
export const normalizeLiveClockRecord = (
  value: unknown,
): LiveClockRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const issues: string[] = [];

  const tickCount = toNonNegativeCount(source.tick_count);
  const countedSeconds = toNonNegativeNumber(source.counted_seconds);
  const clampedSeconds = toNonNegativeNumber(source.clamped_seconds);
  const droppedSeconds = toNonNegativeNumber(source.dropped_seconds);
  const clampedTickCount = toNonNegativeCount(source.clamped_tick_count);
  const droppedTickCount = toNonNegativeCount(source.dropped_tick_count);

  const uncountedSeconds = Number((clampedSeconds + droppedSeconds).toFixed(1));

  // Keranjang yang kosong tapi tanpa satu tick pun = catatan yang tidak masuk
  // akal. Ini bukan alasan menolak menyimpan, tapi alasan menandainya.
  if (tickCount === 0) {
    issues.push(
      "tick_count 0: tidak ada tick yang tercatat, angka di sini tidak bisa dipakai sebagai bukti.",
    );
  }

  if (clampedTickCount + droppedTickCount > tickCount) {
    issues.push(
      `tick bermasalah (${clampedTickCount + droppedTickCount}) melebihi total tick (${tickCount}).`,
    );
  }

  // Klien mengirim totalnya sendiri; kalau tidak sama dengan jumlah keranjang,
  // salah satu angkanya berbohong dan kita tidak tahu yang mana.
  const claimedUncounted = Number(source.uncounted_seconds);
  if (Number.isFinite(claimedUncounted)) {
    const drift = Math.abs(claimedUncounted - uncountedSeconds);
    if (drift > LIVE_CLOCK_CONSISTENCY_TOLERANCE_SECONDS) {
      issues.push(
        `uncounted_seconds dari klien (${claimedUncounted.toFixed(1)}) tidak sama dengan clamped + dropped (${uncountedSeconds.toFixed(1)}).`,
      );
    }
  }

  const rawBalance = Number(source.balance_seconds);
  const balanceSeconds = Number.isFinite(rawBalance)
    ? Number(rawBalance.toFixed(1))
    : null;

  // Waktu nyata yang lewat selalu >= waktu yang dihitung bergerak, karena
  // auto-pause hanya bisa MENGURANGI counted. Balapan sebaliknya berarti
  // keranjangnya rusak.
  if (balanceSeconds !== null && balanceSeconds < countedSeconds - LIVE_CLOCK_CONSISTENCY_TOLERANCE_SECONDS) {
    issues.push(
      `balance_seconds (${balanceSeconds.toFixed(1)}) lebih kecil dari counted_seconds (${countedSeconds.toFixed(1)}).`,
    );
  }

  return {
    tick_count: tickCount,
    counted_seconds: countedSeconds,
    clamped_seconds: clampedSeconds,
    dropped_seconds: droppedSeconds,
    clamped_tick_count: clampedTickCount,
    dropped_tick_count: droppedTickCount,
    uncounted_seconds: uncountedSeconds,
    balance_seconds: balanceSeconds,
    consistent: issues.length === 0,
    issues,
  };
};

/**
 * Kalimat siap-baca untuk menjelaskan catatan ini ke manusia.
 *
 * Dipakai supaya pertanyaan "jamnya hilang berapa detik?" tidak lagi dijawab
 * dengan menebak dari absennya peringatan.
 */
export const describeLiveClockRecord = (record: LiveClockRecord | null) => {
  if (!record) {
    return "Instrumentasi jam live tidak tersedia untuk aktivitas ini; kehilangan waktu tidak bisa diukur dari berkas ini.";
  }

  const parts = [
    `Jam live mencatat ${record.counted_seconds.toFixed(1)} detik bergerak dari ${record.tick_count} tick.`,
    `Tidak terhitung ${record.uncounted_seconds.toFixed(1)} detik (${record.clamped_seconds.toFixed(1)} dari tick terlambat, ${record.dropped_seconds.toFixed(1)} dari sistem berhenti).`,
  ];

  if (!record.consistent) {
    parts.push(`Catatan ini TIDAK konsisten dan jangan dipakai sebagai bukti: ${record.issues.join(" ")}`);
  }

  return parts.join(" ");
};
