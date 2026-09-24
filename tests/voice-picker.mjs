/**
 * Test untuk pemilih suara panduan arah.
 *
 * Kenapa ada: suara tidak datang dari repo ini, jadi yang bisa dijamin benar
 * adalah CARA MEMILIH di antara suara yang tersedia di perangkat. Versi lama
 * memakai find() sederhana dan mengambil suara Indonesia pertama — bisa pria,
 * bisa berkualitas rendah — dan yang paling parah: kalau perangkat tidak punya
 * suara Indonesia sama sekali, kata Indonesia tetap dilafalkan memakai suara
 * bawaan peramban, yang biasanya Inggris. Itulah keluhan "aksennya jelek".
 *
 * Daftar suara di bawah adalah tiruan dari yang umum ada di perangkat nyata,
 * jadi test ini berjalan di CI mana pun tanpa peramban.
 *
 *   node tests/voice-picker.mjs
 *
 * Exit code 0 = semua assertion lewat.
 */
import {
  describeVoice,
  isAcceptableVoice,
  isIndonesianVoice,
  pickBestVoice,
  rankVoices,
  scoreVoice,
} from "../public/assets/voice-picker.js";

const results = [];
const check = (name, passed, detail = "") => results.push({ name, passed: Boolean(passed), detail });

// Tiruan daftar suara pada perangkat Android + Chrome.
const ANDROID_VOICES = [
  { name: "English (United States)", lang: "en-US", localService: false, default: true },
  { name: "Google Bahasa Indonesia", lang: "id-ID", localService: false },
  { name: "Bahasa Indonesia", lang: "id-ID", localService: true },
  { name: "Microsoft Andika Online", lang: "id-ID", localService: false },
  { name: "Google Bahasa Melayu", lang: "ms-MY", localService: false },
  { name: "English (United Kingdom)", lang: "en-GB", localService: true },
];

// ------------------------------------------------- pemilihan yang benar
{
  const best = pickBestVoice(ANDROID_VOICES);
  check(
    "suara Indonesia yang berkualitas dipilih lebih dulu",
    best && best.name === "Google Bahasa Indonesia",
    `terpilih=${best ? best.name : "null"}`,
  );
  check(
    "suara berkualitas rendah tidak menang hanya karena lebih dulu",
    rankVoices(ANDROID_VOICES)[0].name === "Google Bahasa Indonesia",
    `urutan teratas=${rankVoices(ANDROID_VOICES)[0].name}`,
  );
  check(
    "suara Melayu jadi cadangan kalau tidak ada suara Indonesia",
    pickBestVoice([{ name: "English", lang: "en-US" }, { name: "Google Bahasa Melayu", lang: "ms-MY" }])
      ?.name === "Google Bahasa Melayu",
    "suara Melayu tidak dipakai sebagai cadangan",
  );
}

// ------------------------------------ yang paling penting: tidak ada suara ID
{
  const onlyForeign = [
    { name: "English (United States)", lang: "en-US", localService: true, default: true },
    { name: "Deutsch", lang: "de-DE", localService: true },
  ];

  check(
    "tanpa suara Indonesia, tidak ada suara yang dipilih sama sekali",
    pickBestVoice(onlyForeign) === null,
    `terpilih=${JSON.stringify(pickBestVoice(onlyForeign))}`,
  );
  check(
    "melafalkan kata Indonesia dengan suara Inggris dihindari",
    rankVoices(onlyForeign).every((voice) => !isAcceptableVoice(voice)),
    "ada suara asing yang dianggap layak",
  );
  check(
    "Melayu diterima sebagai kerabat dekat, tetapi tetap ditandai bukan Indonesia",
    isAcceptableVoice({ name: "Google Bahasa Melayu", lang: "ms-MY" }) &&
      !isIndonesianVoice({ name: "Google Bahasa Melayu", lang: "ms-MY" }),
    "Melayu seharusnya layak dipakai tetapi tidak disebut Indonesia",
  );
  check(
    "penjelasan ke pemakai menyebut tidak ada suara Indonesia",
    describeVoice(null) === "TIDAK ADA SUARA INDONESIA",
    describeVoice(null),
  );
}

// ------------------------------------------------- preferensi pemakai
{
  // Pemakai sebelumnya memilih suara pria karena suaranya lebih jelas di
  // perangkatnya. Pilihan itu harus dihormati, bukan ditimpa oleh skor.
  const preferred = pickBestVoice(ANDROID_VOICES, "Microsoft Andika Online");
  check(
    "pilihan pemakai dihormati walau skornya lebih rendah",
    preferred && preferred.name === "Microsoft Andika Online",
    `terpilih=${preferred ? preferred.name : "null"}`,
  );

  // Perangkat bisa kehilangan suara setelah pembaruan sistem.
  const gone = pickBestVoice(ANDROID_VOICES, "Suara Yang Sudah Tidak Ada");
  check(
    "pilihan yang sudah hilang jatuh kembali ke pemilihan otomatis",
    gone && gone.name === "Google Bahasa Indonesia",
    `terpilih=${gone ? gone.name : "null"}`,
  );

  check(
    "daftar kosong menghasilkan null, bukan lemparan",
    pickBestVoice([]) === null && pickBestVoice(null) === null && pickBestVoice(undefined) === null,
    "daftar kosong tidak tertangani",
  );
}

// ------------------------------------------------------------ skor
{
  check(
    "suara Indonesia mengalahkan suara asing",
    scoreVoice({ name: "Suara Biasa", lang: "id-ID" }) >
      scoreVoice({ name: "Natural Male Premium", lang: "en-US" }),
    "bahasa tidak cukup berpengaruh",
  );
  check(
    "penanda kualitas menaikkan skor",
    scoreVoice({ name: "Google Bahasa Indonesia", lang: "id-ID" }) >
      scoreVoice({ name: "Bahasa Indonesia", lang: "id-ID" }),
    "penanda kualitas diabaikan",
  );
  check(
    "suara pria diturunkan skornya",
    scoreVoice({ name: "Microsoft Andika Online", lang: "id-ID" }) <
      scoreVoice({ name: "Google Bahasa Indonesia", lang: "id-ID" }),
    "penanda pria tidak berpengaruh",
  );
  check(
    "suara lokal lebih dipilih karena tidak butuh jaringan",
    scoreVoice({ name: "Bahasa Indonesia", lang: "id-ID", localService: true }) >
      scoreVoice({ name: "Bahasa Indonesia", lang: "id-ID", localService: false }),
    "localService diabaikan",
  );
  check(
    "suara tanpa info bahasa diberi skor sangat rendah",
    scoreVoice({ name: "Mystery Voice" }) < scoreVoice({ name: "English", lang: "en-US" }),
    "suara tanpa bahasa bisa menang",
  );
}

// ------------------------------------------------------------ ketahanan
{
  const weird = [null, undefined, {}, { name: null, lang: null }, { lang: "id" }];
  const survived = rankVoices(weird).length === weird.filter((v) => v).length;

  check(
    "daftar suara yang aneh tidak menjatuhkan pemilihan",
    survived && rankVoices("bukan array").length === 0,
    "daftar aneh tidak tertangani",
  );
  check(
    "urutan stabil untuk skor yang sama",
    (() => {
      const a = { name: "Bahasa Indonesia", lang: "id-ID" };
      const b = { name: "Bahasa Indonesia", lang: "id-ID" };
      return rankVoices([a, b])[0] === a;
    })(),
    "urutan berubah untuk skor yang setara",
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
  `\nvoice-picker: ${results.length - failed}/${results.length} assertion lewat${failed ? ` — ${failed} GAGAL` : ""}`,
);

process.exit(failed === 0 ? 0 : 1);
