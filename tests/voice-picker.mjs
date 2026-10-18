/**
 * Test for the navigation voice picker.
 *
 * Why it exists: the voices do not come from this repo, so what can be
 * guaranteed correct is HOW TO CHOOSE among the voices a device offers.
 * The old version used a plain find() and took the first Indonesian voice, which
 * could be male or low quality, and worst of all: if the device has no Indonesian
 * voice at all, Indonesian words are still spoken with the browser default
 * voice, usually English. That is the "the accent is bad" complaint.
 *
 * The voice list below is a copy of what commonly exists on real devices,
 * so this test runs on any CI without a browser.
 *
 *   node tests/voice-picker.mjs
 *
 * Exit code 0 = all assertions passed.
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

// Copy of the voice list on an Android + Chrome device.
const ANDROID_VOICES = [
  { name: "English (United States)", lang: "en-US", localService: false, default: true },
  { name: "Google Bahasa Indonesia", lang: "id-ID", localService: false },
  { name: "Bahasa Indonesia", lang: "id-ID", localService: true },
  { name: "Microsoft Andika Online", lang: "id-ID", localService: false },
  { name: "Google Bahasa Melayu", lang: "ms-MY", localService: false },
  { name: "English (United Kingdom)", lang: "en-GB", localService: true },
];

// ------------------------------------------------- picking the right voice
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

// ------------------------------------ the crucial one: there is no ID voice
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

// ----------------------------------------------------- user preference
{
  // The user previously picked a male voice because it is clearer on their
  // device. That choice has to be respected, not overridden by the score.
  const preferred = pickBestVoice(ANDROID_VOICES, "Microsoft Andika Online");
  check(
    "pilihan pemakai dihormati walau skornya lebih rendah",
    preferred && preferred.name === "Microsoft Andika Online",
    `terpilih=${preferred ? preferred.name : "null"}`,
  );

  // A device can lose a voice after a system update.
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

// ------------------------------------------------------------ scoring
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

// ------------------------------------------------------------ resilience
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

// ----------------------------------------------------------------- report
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
