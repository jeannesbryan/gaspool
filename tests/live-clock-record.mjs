/**
 * Uji modul pencatat jam live (src/api/live-clock-record.ts).
 *
 * Modulnya murni, jadi bisa dijalankan tanpa Worker/D1/network:
 *
 *   node tests/live-clock-record.mjs
 *
 * Yang dijaga di sini adalah sifat-sifat yang membuat catatannya layak dipakai
 * sebagai bukti: nol != tidak ada data, keranjang dijumlah ulang (klien tidak
 * dipercaya), dan catatan yang tidak konsisten ditandai alih-alih dibuang
 * diam-diam.
 */
import {
  describeLiveClockRecord,
  normalizeLiveClockRecord,
} from "../src/api/live-clock-record.ts";

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed });
  console.log(`${passed ? "  ok  " : " FAIL "} ${name}${passed || !detail ? "" : `\n         ${detail}`}`);
};
const checkEqual = (name, actual, expected) =>
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

// ------------------------------------------------------- nol vs tidak ada data
checkEqual("catatan kosong jadi null, bukan nol", normalizeLiveClockRecord(null), null);
checkEqual("undefined jadi null", normalizeLiveClockRecord(undefined), null);
checkEqual("string jadi null", normalizeLiveClockRecord("580"), null);
checkEqual("array jadi null", normalizeLiveClockRecord([1, 2]), null);

// ------------------------------------------------------------ catatan normal
const normal = normalizeLiveClockRecord({
  tick_count: 12534,
  counted_seconds: 12534,
  clamped_seconds: 0,
  dropped_seconds: 0,
  clamped_tick_count: 0,
  dropped_tick_count: 0,
  uncounted_seconds: 0,
  balance_seconds: 12534,
});
check("catatan bersih dianggap konsisten", normal?.consistent === true);
checkEqual("keranjang bersih tetap nol", normal?.uncounted_seconds, 0);
checkEqual("tidak ada issue pada catatan bersih", normal?.issues, []);

// Gowes 25 Sep 2026: tidak ada peringatan live_clock_gap, artinya uncounted 0.
checkEqual(
  "gowes 25 Sep (0 detik hilang) terbaca apa adanya",
  normal?.counted_seconds,
  12534,
);

// -------------------------------------------------- jumlah keranjang dihitung
const withLoss = normalizeLiveClockRecord({
  tick_count: 600,
  counted_seconds: 580.5,
  clamped_seconds: 15.2,
  dropped_seconds: 0.3,
  clamped_tick_count: 2,
  dropped_tick_count: 1,
  uncounted_seconds: 15.5,
  balance_seconds: 580.8,
});
checkEqual(
  "uncounted dihitung ulang dari clamped + dropped",
  withLoss?.uncounted_seconds,
  15.5,
);
check("catatan dengan kehilangan tetap konsisten", withLoss?.consistent === true);

const lyingClient = normalizeLiveClockRecord({
  tick_count: 600,
  counted_seconds: 580.5,
  clamped_seconds: 15.2,
  dropped_seconds: 0.3,
  uncounted_seconds: 0,
  balance_seconds: 580.8,
});
check(
  "total dari klien yang tidak menjumlah ditandai, bukan dipercaya",
  lyingClient?.consistent === false &&
    lyingClient.uncounted_seconds === 15.5 &&
    lyingClient.issues.some((issue) => issue.includes("uncounted_seconds")),
);
checkEqual(
  "angka keranjang tetap disimpan walau klien berbohong",
  lyingClient?.uncounted_seconds,
  15.5,
);

// -------------------------------------------------------- nilai tidak masuk akal
const garbage = normalizeLiveClockRecord({
  tick_count: -5,
  counted_seconds: "abc",
  clamped_seconds: Number.NaN,
  dropped_seconds: -12,
  uncounted_seconds: 3,
});
check(
  "angka negatif dan NaN tidak lolos jadi nilai negatif",
  garbage?.tick_count === 0 &&
    garbage?.counted_seconds === 0 &&
    garbage?.clamped_seconds === 0 &&
    garbage?.dropped_seconds === 0,
);
checkEqual("tick_count 0 ditandai", garbage?.consistent, false);

const impossible = normalizeLiveClockRecord({
  tick_count: 10,
  counted_seconds: 100,
  clamped_seconds: 0,
  dropped_seconds: 0,
  uncounted_seconds: 0,
  balance_seconds: 5,
});
check(
  "balance lebih kecil dari counted ditandai",
  impossible?.consistent === false &&
    impossible.issues.some((issue) => issue.includes("balance_seconds")),
);

const tooManyProblemTicks = normalizeLiveClockRecord({
  tick_count: 10,
  counted_seconds: 10,
  clamped_seconds: 0,
  dropped_seconds: 0,
  clamped_tick_count: 8,
  dropped_tick_count: 8,
  uncounted_seconds: 0,
  balance_seconds: 10,
});
check(
  "tick bermasalah lebih banyak dari total tick ditandai",
  tooManyProblemTicks?.consistent === false,
);

// balance tidak dikirim = null, bukan 0 (0 adalah nilai yang sah).
const noBalance = normalizeLiveClockRecord({
  tick_count: 10,
  counted_seconds: 10,
  clamped_seconds: 0,
  dropped_seconds: 0,
  uncounted_seconds: 0,
});
checkEqual("balance yang tidak dikirim jadi null", noBalance?.balance_seconds, null);
check("tanpa balance catatan tetap konsisten", noBalance?.consistent === true);

// ------------------------------------------------------------------ deskripsi
const text = describeLiveClockRecord(withLoss);
check(
  "deskripsi menyebut detik bergerak dan keranjang kehilangan",
  text.includes("580.5") && text.includes("15.5") && text.includes("15.2") && text.includes("0.3"),
  text,
);
const nullText = describeLiveClockRecord(null);
check(
  "deskripsi untuk catatan yang tidak ada tidak mengarang angka nol",
  nullText.includes("tidak tersedia") && !nullText.includes("0.0 detik"),
  nullText,
);
check(
  "deskripsi memperingatkan kalau catatan tidak konsisten",
  describeLiveClockRecord(lyingClient).includes("TIDAK konsisten"),
);

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length > 0) process.exit(1);
