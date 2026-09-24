/**
 * Akuntansi jam untuk gowes yang sedang berjalan (live).
 *
 * Berkas ini sengaja berupa .js biasa dan tinggal di public/assets supaya
 * dipakai DUA tempat tanpa disalin: halaman tracker memuatnya sebagai modul,
 * dan tests/live-clock.mjs mengimpornya langsung. Satu berkas berarti tidak ada
 * dua implementasi yang bisa saling menyimpang — persis jenis kesalahan yang
 * dulu membuat jam live dan jam hasil repair berbeda.
 *
 * Kenapa ini ada. Jam di layar live dan jam hasil repair pernah berbeda untuk
 * gowes yang sama: 1:41:29 vs 1:44:13, padahal rentang waktunya 1:47:56.
 * Setelah diukur pada berkas asli, selisihnya punya lebih dari satu sebab:
 *
 *   1. auto-pause memakai kecepatan sesaat dari chip GPS, sedangkan statistik
 *      hasil repair memakai perpindahan bersih;
 *   2. dan yang sebelumnya tak terlihat sama sekali: setiap tick yang datang
 *      terlambat DIPOTONG diam-diam. Saat layar mati atau tab di-background,
 *      browser menunda tick, dan potongannya (delta - maxDelta) tidak pernah
 *      dijumlahkan di mana pun.
 *
 * Modul ini menutup lubang kedua. Sifat pentingnya: SETIAP detik yang lewat
 * harus masuk salah satu keranjang, jadi jumlah semua delta mentah =
 * counted + clamped + dropped. Kalau tidak sama, ada detik yang menguap tanpa
 * jejak, dan itu justru yang harus ketahuan.
 */

export function createLiveClockAccounting(maxDeltaSeconds, restGapSeconds) {
  return {
    tick_count: 0,
    counted_seconds: 0,
    clamped_seconds: 0,
    dropped_seconds: 0,
    raw_seconds: 0,
    clamped_tick_count: 0,
    dropped_tick_count: 0,
    max_delta_seconds: maxDeltaSeconds,
    rest_gap_seconds: restGapSeconds,
  };
}

/**
 * Hitung satu tick.
 *
 * `paused` berarti auto-pause sedang aktif: waktunya TIDAK dihitung sebagai
 * bergerak, tetapi tetap tercatat sebagai detik yang nyata lewat, sehingga
 * pembukuan tetap seimbang.
 */
export function recordLiveClockTick(accounting, rawDeltaSeconds, options = {}) {
  const raw = Number(rawDeltaSeconds);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { kind: "counted", counted: 0, lost: 0 };
  }

  const maxDelta = Number(options.maxDeltaSeconds ?? accounting.max_delta_seconds);
  const restGap = Number(options.restGapSeconds ?? accounting.rest_gap_seconds);

  accounting.tick_count += 1;
  accounting.raw_seconds += raw;

  // Gap besar: browser atau sistem berhenti mengirim tick cukup lama sehingga
  // waktunya sudah tidak bisa dipercaya. Dibuang seluruhnya, tetapi jumlahnya
  // tetap diketahui — karena itu ia punya keranjang sendiri, bukan menghilang.
  if (raw > restGap) {
    accounting.dropped_seconds += raw;
    accounting.dropped_tick_count += 1;
    return { kind: "dropped", counted: 0, lost: raw };
  }

  // Tick yang terlambat tetapi masih masuk akal: dipotong di batas atas.
  // Potongan inilah yang dulu tidak pernah tercatat.
  const lost = raw > maxDelta ? raw - maxDelta : 0;
  const countedDelta = raw - lost;

  if (lost > 0) {
    accounting.clamped_seconds += lost;
    accounting.clamped_tick_count += 1;
  }

  if (!options.paused) accounting.counted_seconds += countedDelta;

  return {
    kind: lost > 0 ? "clamped" : "counted",
    counted: options.paused ? 0 : countedDelta,
    lost,
  };
}

/**
 * Detik yang lewat selama aktivitas tetapi tidak masuk moving time. Dipakai di
 * layar supaya pemakainya tahu jamnya tidak hilang, hanya tidak dihitung
 * sebagai bergerak.
 */
export function liveClockUncountedSeconds(accounting) {
  return Number((accounting.clamped_seconds + accounting.dropped_seconds).toFixed(1));
}

/**
 * Selisih pembukuan. Nol berarti tidak ada detik yang menguap tanpa jejak.
 */
export function liveClockBalance(accounting) {
  return Number((accounting.raw_seconds - liveClockUncountedSeconds(accounting)).toFixed(1));
}

export function serializeLiveClockAccounting(accounting) {
  return {
    tick_count: accounting.tick_count,
    counted_seconds: Number(accounting.counted_seconds.toFixed(1)),
    clamped_seconds: Number(accounting.clamped_seconds.toFixed(1)),
    dropped_seconds: Number(accounting.dropped_seconds.toFixed(1)),
    clamped_tick_count: accounting.clamped_tick_count,
    dropped_tick_count: accounting.dropped_tick_count,
  };
}
