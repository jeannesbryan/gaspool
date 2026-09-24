/**
 * Test untuk token siaran live (gowes solo).
 *
 * Kenapa token ini diuji sendiri: /radar/<token> bisa dibuka tanpa login, jadi
 * token adalah satu-satunya yang menghalangi orang asing menemukan lokasi
 * seseorang. Kesalahan kecil di sini — alfabet yang panjangnya bukan pembagi
 * 256, atau token yang bisa berulang — tidak akan terlihat di layar, tetapi
 * langsung menurunkan jumlah tebakan yang dibutuhkan penyerang.
 *
 * Semua fungsi di sini murni, jadi test berjalan tanpa Worker, D1, KV, jaringan.
 *
 *   node tests/live-share.mjs
 *
 * Exit code 0 = semua assertion lewat.
 */
import {
  createLiveShareToken,
  LIVE_SHARE_ALPHABET,
  LIVE_SHARE_SESSION_TTL_SECONDS,
  LIVE_SHARE_TOKEN_LENGTH,
  LIVE_SHARE_TOKEN_PATTERN,
  liveSessionKey,
  readLiveSession,
  saveLiveSession,
} from "../src/api/live-share.ts";

const results = [];
const check = (name, passed, detail = "") => results.push({ name, passed: Boolean(passed), detail });

// ---------------------------------------------------------------- alfabet
check(
  "alfabet berukuran 32 supaya byte acak terbagi rata",
  LIVE_SHARE_ALPHABET.length === 32,
  `panjang=${LIVE_SHARE_ALPHABET.length} (bukan pembagi 256 berarti ada modulo bias)`,
);
check(
  "alfabet tidak memuat karakter yang mudah tertukar",
  !/[IO]/.test(LIVE_SHARE_ALPHABET),
  `alfabet=${LIVE_SHARE_ALPHABET}`,
);
check(
  "alfabet tidak memuat karakter yang dibuang sanitasi room",
  /^[A-Z0-9]+$/.test(LIVE_SHARE_ALPHABET),
  `alfabet=${LIVE_SHARE_ALPHABET}`,
);
check(
  "tidak ada karakter kembar di alfabet",
  new Set(LIVE_SHARE_ALPHABET).size === LIVE_SHARE_ALPHABET.length,
  `unik=${new Set(LIVE_SHARE_ALPHABET).size}`,
);

// ---------------------------------------------------------------- bentuk token
const SAMPLES = 20000;
const tokens = Array.from({ length: SAMPLES }, () => createLiveShareToken());

check(
  "setiap token punya panjang yang dijanjikan",
  tokens.every((t) => t.length === LIVE_SHARE_TOKEN_LENGTH),
  `ada token dengan panjang lain: ${tokens.find((t) => t.length !== LIVE_SHARE_TOKEN_LENGTH)}`,
);
check(
  "setiap token lolos pola yang dipakai klien",
  tokens.every((t) => LIVE_SHARE_TOKEN_PATTERN.test(t)),
  `token yang gagal: ${tokens.find((t) => !LIVE_SHARE_TOKEN_PATTERN.test(t))}`,
);
check(
  "setiap token hanya memakai alfabet yang diizinkan",
  tokens.every((t) => [...t].every((ch) => LIVE_SHARE_ALPHABET.includes(ch))),
  "ada karakter di luar alfabet",
);

const distinct = new Set(tokens).size;
check(
  "token tidak berulang",
  distinct === SAMPLES,
  `${distinct} unik dari ${SAMPLES} token`,
);

// ------------------------------------------------- sebaran karakter (bias)
// Kalau alfabetnya bukan pembagi 256, huruf-huruf awal akan lebih sering muncul.
// Uji ini menangkap kesalahan itu tanpa perlu membaca kodenya.
const counts = Object.fromEntries([...LIVE_SHARE_ALPHABET].map((ch) => [ch, 0]));
for (const token of tokens) for (const ch of token) counts[ch] += 1;

const totalChars = SAMPLES * LIVE_SHARE_TOKEN_LENGTH;
const expected = totalChars / LIVE_SHARE_ALPHABET.length;
const maxDrift = Math.max(...Object.values(counts).map((c) => Math.abs(c - expected) / expected));

check(
  "sebaran karakter merata (tidak ada modulo bias)",
  maxDrift < 0.08,
  `simpangan terbesar ${(maxDrift * 100).toFixed(2)}% dari rata-rata ${expected.toFixed(0)}`,
);

// ---------------------------------------------------------------- kunci sesi
check(
  "kunci sesi tidak bisa bertabrakan dengan posisi peserta",
  liveSessionKey("ABCD2345EFGH6789").includes("~") &&
    !/^[A-Z0-9_-]+:[A-Za-z0-9_-]+$/.test(liveSessionKey("ABCD2345EFGH6789")),
  `kunci=${liveSessionKey("ABCD2345EFGH6789")}`,
);
check(
  "kunci sesi menormalkan token menjadi huruf besar",
  liveSessionKey("abcd2345efgh6789") === liveSessionKey("ABCD2345EFGH6789"),
  `${liveSessionKey("abcd2345efgh6789")} vs ${liveSessionKey("ABCD2345EFGH6789")}`,
);

// --------------------------------------------- catatan sesi (KV tiruan)
const makeKv = () => {
  const store = new Map();
  return {
    store,
    put: (key, value, opts) => {
      store.set(key, value);
      return Promise.resolve({ key, opts });
    },
    get: (key) => Promise.resolve(store.has(key) ? store.get(key) : null),
  };
};

const kv = makeKv();
const token = createLiveShareToken();
await saveLiveSession(kv, token, "jeannes");
const restored = await readLiveSession(kv, token);

check(
  "sesi tersimpan dan bisa dibaca kembali",
  restored !== null && restored.user === "jeannes" && restored.started_ms > 0,
  JSON.stringify(restored),
);
check(
  "sesi memakai masa berlaku yang panjang, bukan 60 detik milik posisi",
  LIVE_SHARE_SESSION_TTL_SECONDS >= 24 * 60 * 60,
  `ttl=${LIVE_SHARE_SESSION_TTL_SECONDS}`,
);
check(
  "token yang tidak pernah dibuat tidak punya sesi",
  (await readLiveSession(kv, "ZZZZZZZZZZZZZZZZ")) === null,
  "token asing seharusnya tidak punya sesi",
);

// Nilai KV yang rusak tidak boleh menjatuhkan halaman penonton.
kv.store.set(liveSessionKey(token), "{bukan json");
check(
  "catatan sesi yang rusak ditolak dengan aman",
  (await readLiveSession(kv, token)) === null,
  "nilai rusak seharusnya menghasilkan null, bukan melempar",
);

// ---------------------------------------------------------------- laporan
let failed = 0;
for (const item of results) {
  if (!item.passed) failed += 1;
  console.log(`${item.passed ? "  ok  " : " FAIL "} ${item.name}`);
  if (item.detail) console.log(`         ${item.detail}`);
}

console.log(
  `\nlive-share: ${results.length - failed}/${results.length} assertion lewat${failed ? ` — ${failed} GAGAL` : ""}`,
);

process.exit(failed === 0 ? 0 : 1);
