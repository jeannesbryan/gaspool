/**
 * Test untuk akuntansi jam live.
 *
 * Kenapa ada: jam live dan jam hasil repair pernah berbeda 2:44 untuk gowes yang
 * sama. Salah satu sebabnya adalah potongan diam-diam di setiap tick yang
 * terlambat (Math.min(delta, maxDelta)), yang tidak pernah dijumlahkan di mana
 * pun sehingga tidak bisa dibuktikan. Test ini mengunci dua hal:
 *
 *   1. setiap detik yang lewat masuk salah satu keranjang, tidak ada yang hilang
 *      tanpa jejak;
 *   2. potongan dari tick terlambat memang terhitung, karena itulah angka yang
 *      dicari saat mendiagnosis selisih jam.
 *
 *   node tests/live-clock.mjs
 *
 * Exit code 0 = semua assertion lewat.
 */
import {
  createLiveClockAccounting,
  liveClockBalance,
  liveClockUncountedSeconds,
  recordLiveClockTick,
  serializeLiveClockAccounting,
} from "../public/assets/live-clock.js";

const results = [];
const check = (name, passed, detail = "") => results.push({ name, passed: Boolean(passed), detail });
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// ------------------------------------------------------ tick normal
{
  const acc = createLiveClockAccounting(10, 120);
  for (let i = 0; i < 60; i++) recordLiveClockTick(acc, 1);

  check(
    "tick normal dihitung apa adanya",
    near(acc.counted_seconds, 60, 0.01) && acc.clamped_seconds === 0,
    `counted=${acc.counted_seconds} clamped=${acc.clamped_seconds}`,
  );
  check(
    "tidak ada detik yang menguap",
    near(liveClockBalance(acc), 60, 0.01) && near(liveClockUncountedSeconds(acc), 0, 0.01),
    `balance=${liveClockBalance(acc)} uncounted=${liveClockUncountedSeconds(acc)}`,
  );
}

// ------------------------------------------- tick terlambat (inti masalahnya)
{
  const acc = createLiveClockAccounting(10, 120);
  // Layar mati 25 detik: tick berikutnya datang dengan delta 25, dipotong ke 10.
  const tick = recordLiveClockTick(acc, 25);

  check(
    "tick terlambat dilaporkan sebagai clamped",
    tick.kind === "clamped" && near(tick.counted, 10, 0.01) && near(tick.lost, 15, 0.01),
    `kind=${tick.kind} counted=${tick.counted} lost=${tick.lost}`,
  );
  check(
    "potongan tick terlambat ikut terhitung di total",
    near(acc.clamped_seconds, 15, 0.01) && acc.clamped_tick_count === 1,
    `clamped=${acc.clamped_seconds} dari ${acc.clamped_tick_count} tick`,
  );
  check(
    "detik yang terpotong tidak hilang dari pembukuan",
    near(acc.raw_seconds, 25, 0.01) && near(liveClockBalance(acc), 10, 0.01),
    `raw=${acc.raw_seconds} balance=${liveClockBalance(acc)}`,
  );
}

// ------------------------------------------------------ gap sistem
{
  const acc = createLiveClockAccounting(10, 120);
  recordLiveClockTick(acc, 300);

  check(
    "gap besar dianggap tidak bisa dipercaya dan dibuang",
    acc.dropped_seconds === 300 && acc.counted_seconds === 0 && acc.dropped_tick_count === 1,
    `dropped=${acc.dropped_seconds} counted=${acc.counted_seconds}`,
  );
}

// ------------------------------------------------------ auto-pause
{
  const acc = createLiveClockAccounting(10, 120);
  recordLiveClockTick(acc, 5);
  recordLiveClockTick(acc, 30, { paused: true });
  recordLiveClockTick(acc, 5);

  check(
    "waktu saat auto-pause tidak dihitung bergerak",
    near(acc.counted_seconds, 10, 0.01),
    `counted=${acc.counted_seconds} (harap 10, bukan 40)`,
  );
  check(
    "waktu auto-pause tetap tercatat supaya buku besar seimbang",
    near(acc.clamped_seconds, 20, 0.01) && near(acc.raw_seconds, 40, 0.01),
    `clamped=${acc.clamped_seconds} raw=${acc.raw_seconds}`,
  );
}

// ------------------------------------- pembukuan seimbang (kasus campuran)
{
  const acc = createLiveClockAccounting(10, 120);
  const raw = [];
  for (let i = 0; i < 100; i++) raw.push(1);
  raw.push(25); // layar mati sejenak
  raw.push(1);
  raw.push(1);
  raw.push(42); // layar mati lagi
  raw.push(1);
  raw.push(300); // browser tersedot tidur
  raw.push(1);
  for (const d of raw) recordLiveClockTick(acc, d);

  const totalRaw = raw.reduce((a, b) => a + b, 0);
  // Tick yang wajar menyumbang penuh, tick yang terlambat menyumbang sampai
  // batas atas saja, dan gap besar tidak menyumbang apa pun.
  const MAX_DELTA = 10;
  const REST_GAP = 120;
  const counted = raw.reduce(
    (total, delta) => total + (delta > REST_GAP ? 0 : Math.min(delta, MAX_DELTA)),
    0,
  );
  const clamped = raw
    .filter((d) => d > MAX_DELTA && d <= REST_GAP)
    .reduce((total, delta) => total + delta - MAX_DELTA, 0);

  check(
    "kasus campuran: moving time hanya dari tick yang wajar",
    near(acc.counted_seconds, counted, 0.01),
    `counted=${acc.counted_seconds} harap ${counted}`,
  );
  check(
    "kasus campuran: seluruh potongan terakumulasi",
    near(acc.clamped_seconds, clamped, 0.01),
    `clamped=${acc.clamped_seconds} harap ${clamped}`,
  );
  check(
    "kasus campuran: pembukuan tetap seimbang",
    near(liveClockBalance(acc), counted, 0.01) && near(acc.raw_seconds, totalRaw, 0.01),
    `raw=${acc.raw_seconds} total=${totalRaw} balance=${liveClockBalance(acc)}`,
  );
  check(
    "kasus campuran: jumlah detik tak terhitung melaporkan kehilangan sebenarnya",
    near(liveClockUncountedSeconds(acc), totalRaw - counted, 0.01),
    `uncounted=${liveClockUncountedSeconds(acc)} harap ${totalRaw - counted}`,
  );
}

// ------------------------------------------------- nilai rusak tidak melukai
{
  const acc = createLiveClockAccounting(10, 120);
  const kinds = [NaN, -5, 0, Infinity].map((d) => recordLiveClockTick(acc, d).kind);

  check(
    "delta tidak masuk akal diabaikan tanpa merusak akumulasi",
    kinds.every((k) => k === "counted") &&
      acc.tick_count === 0 &&
      acc.raw_seconds === 0 &&
      liveClockBalance(acc) === 0,
    `kinds=${kinds.join(",")} tick_count=${acc.tick_count} raw=${acc.raw_seconds}`,
  );
}

// ---------------------------------------------------------------- serialisasi
{
  const acc = createLiveClockAccounting(10, 120);
  for (let i = 0; i < 10; i++) recordLiveClockTick(acc, 1);
  recordLiveClockTick(acc, 25);
  const payload = serializeLiveClockAccounting(acc);

  check(
    "payload yang dikirim ke server memuat bukti kehilangan waktu",
    payload.tick_count === 11 &&
      near(payload.counted_seconds, 20, 0.01) &&
      near(payload.clamped_seconds, 15, 0.01),
    JSON.stringify(payload),
  );
  check(
    "payload tidak memuat field internal yang tidak perlu",
    !("raw_seconds" in payload) && !("max_delta_seconds" in payload),
    Object.keys(payload).join(","),
  );
}

// ---------------------------------------------------------------- laporan
let failed = 0;
for (const item of results) {
  if (!item.passed) failed += 1;
  console.log(`${item.passed ? "  ok  " : " FAIL "} ${item.name}`);
  if (item.detail) console.log(`         ${item.detail}`);
}

console.log(
  `\nlive-clock: ${results.length - failed}/${results.length} assertion lewat${failed ? ` — ${failed} GAGAL` : ""}`,
);

process.exit(failed === 0 ? 0 : 1);
