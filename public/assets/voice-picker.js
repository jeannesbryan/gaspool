/**
 * Pemilih suara untuk panduan arah (TTS).
 *
 * Kenapa ini dipisah dan diuji: suara tidak datang dari repo ini, melainkan
 * dari daftar yang disediakan peramban dan sistem operasi. Jadi yang bisa
 * diperbaiki bukan "suaranya", melainkan CARA MEMILIH di antara yang tersedia.
 *
 * Versi sebelumnya memakai find() sederhana: ambil suara pertama yang bahasanya
 * berawalan "id". Tiga akibatnya, dan ketiganya terdengar oleh pemakai:
 *
 *   1. Kalau perangkat menyediakan beberapa suara Indonesia, yang terambil
 *      adalah yang kebetulan pertama di daftar sistem — bisa suara pria,
 *      bisa suara berkualitas rendah.
 *   2. Kalau TIDAK ada suara Indonesia sama sekali, kode lama menyerahkan
 *      utterance.lang = "id-ID" tanpa voice. Peramban lalu memakai suara
 *      bawaannya — biasanya Inggris — untuk melafalkan kata Indonesia. Itulah
 *      yang terdengar sebagai "aksen Indonesia yang jelek": sebenarnya bukan
 *      aksen Indonesia, melainkan pelafalan Inggris atas kata Indonesia.
 *   3. Tidak ada cara bagi pemakai untuk memilih, padahal telinga merekalah
 *      yang paling tahu mana yang enak didengar.
 *
 * Berkas ini berupa .js biasa di public/assets supaya dipakai DUA tempat tanpa
 * disalin: halaman tracker dan tests/voice-picker.mjs.
 */

/** Bahasa yang paling cocok, berurut dari yang terbaik. */
const LANGUAGE_RANK = [
  { prefix: "id", score: 100 },
  { prefix: "ms", score: 55 }, // Melayu: pelafalan Latin yang dekat
  { prefix: "jv", score: 40 }, // Jawa: sering tersedia dan terdengar akrab
];

/** Penanda kualitas pada nama suara. */
const QUALITY_MARKERS = [
  { token: "natural", score: 30 },
  { token: "neural", score: 28 },
  { token: "google", score: 22 },
  { token: "microsoft", score: 18 },
  { token: "siri", score: 16 },
  { token: "premium", score: 14 },
  { token: "enhanced", score: 12 },
];

/**
 * Penanda suara perempuan.
 *
 * Ini bukan soal selera: panduan arah dibacakan sambil berkendara, dan suara
 * perempuan umumnya lebih mudah dibedakan dari bising jalan pada rentang
 * frekuensi yang dipakai. Pemakai juga memintanya secara eksplisit.
 */
const FEMALE_MARKERS = [
  { token: "female", score: 26 },
  { token: "wanita", score: 26 },
  { token: "perempuan", score: 26 },
  { token: "gadis", score: 24 },
  { token: "damayanti", score: 24 },
  { token: "siti", score: 20 },
  { token: "dewi", score: 20 },
  { token: "putri", score: 20 },
  { token: "ayu", score: 18 },
  { token: "zira", score: 18 },
  { token: "aria", score: 16 },
  { token: "jenny", score: 16 },
  { token: "female_", score: 26 },
];

/** Penanda suara pria: dikurangi, bukan dilarang, karena tetap lebih baik
 *  daripada melafalkan kata Indonesia dengan suara Inggris. */
const MALE_MARKERS = [
  { token: "male", score: -30 },
  { token: "pria", score: -30 },
  { token: "andika", score: -26 },
  { token: "ardi", score: -26 },
  { token: "budi", score: -24 },
  { token: "david", score: -22 },
  { token: "mark", score: -20 },
];

/** Penanda kualitas rendah yang sebaiknya dihindari. */
const LOW_QUALITY_MARKERS = [
  { token: "compact", score: -18 },
  { token: "espeak", score: -40 },
  { token: "pico", score: -14 },
  { token: "low", score: -16 },
];

const normalize = (value) => String(value || "").toLowerCase();

/**
 * Beri skor satu suara. Semakin tinggi semakin cocok.
 * Diekspor supaya bisa diperiksa langsung di test, bukan hanya lewat urutan.
 */
export function scoreVoice(voice) {
  if (!voice) return Number.NEGATIVE_INFINITY;

  const lang = normalize(voice.lang).replace("_", "-");
  const name = normalize(voice.name);

  let score = 0;

  const language = LANGUAGE_RANK.find((entry) => lang.startsWith(entry.prefix));
  if (language) {
    score += language.score;
  } else if (lang) {
    // Punya bahasa, hanya bukan salah satu yang cocok. Tetap bisa dipakai
    // sebagai pilihan terakhir, jadi skornya rendah tetapi bukan mustahil.
    score -= 40;
  } else {
    // Tidak ada keterangan bahasa sama sekali: tidak ada dasar untuk menilai,
    // jadi jangan pernah menang selama ada suara yang jelas bahasanya.
    score -= 100;
  }

  for (const marker of QUALITY_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }
  for (const marker of FEMALE_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }
  for (const marker of MALE_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }
  for (const marker of LOW_QUALITY_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }

  // Suara lokal tidak butuh jaringan, jadi tidak putus saat sinyal hilang —
  // penting untuk panduan arah di jalan.
  if (voice.localService) score += 8;
  if (voice.default) score += 2;

  return score;
}

/**
 * Urutkan daftar suara dari yang paling cocok.
 * Mengembalikan array baru; daftar aslinya tidak diubah.
 */
export function rankVoices(voices) {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];

  return list
    .map((voice, index) => ({ voice, index, score: scoreVoice(voice) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Urutan tetap kalau skornya sama, supaya hasilnya dapat diprediksi.
      return a.index - b.index;
    })
    .map((entry) => entry.voice);
}

/**
 * Apakah suara ini benar-benar berbahasa Indonesia.
 * Dipakai untuk memberi tahu pemakai bahwa perangkatnya tidak punya suara
 * Indonesia, walaupun panduan arahnya mungkin tetap jalan memakai bahasa
 * kerabat terdekat.
 */
export function isIndonesianVoice(voice) {
  const lang = normalize(voice && voice.lang).replace("_", "-");
  return lang.startsWith("id");
}

/**
 * Apakah suara ini layak dipakai untuk membacakan kata Indonesia.
 *
 * Melayu dan Jawa ikut diterima, dan itu keputusan sadar: keduanya satu rumpun
 * dengan Indonesia, sehingga "belok kiri" dan "tujuh ratus meter" terdengar
 * hampir sama. Yang tidak layak adalah suara Inggris dan sejenisnya, karena
 * melafalkan kata Indonesia dengan fonetik Inggris itulah yang membuat panduan
 * arah terdengar aneh.
 *
 * Perlu ditegaskan: "tidak layak" BUKAN berarti aplikasi lalu diam. Panduan
 * arah yang hilang tanpa penjelasan jauh lebih berbahaya di jalan daripada
 * panduan yang terdengar aneh. Karena itu pemanggil tetap membacakan
 * instruksinya, sementara layar memberi tahu bahwa perangkat ini belum punya
 * suara Indonesia dan menawarkan cara menggantinya. Yang dilakukan pemilih ini
 * adalah memastikan suara terbaik yang ADA memang dipakai, bukan yang kebetulan
 * pertama di daftar sistem.
 */
export function isAcceptableVoice(voice) {
  const lang = normalize(voice && voice.lang).replace("_", "-");
  return LANGUAGE_RANK.some((entry) => lang.startsWith(entry.prefix));
}

/**
 * Pilih suara untuk panduan arah.
 *
 * `preferredName` adalah pilihan pemakai yang disimpan sebelumnya. Pilihan itu
 * dihormati selama suaranya masih tersedia — perangkat bisa kehilangan suara
 * setelah pembaruan sistem, dan pilihan yang sudah hilang tidak boleh membuat
 * pemilihan gagal total.
 */
export function pickBestVoice(voices, preferredName) {
  const ranked = rankVoices(voices);
  if (ranked.length === 0) return null;

  const wanted = String(preferredName || "");
  if (wanted) {
    const chosen = ranked.find((voice) => voice.name === wanted);
    if (chosen) return chosen;
  }

  const best = ranked[0];
  // Kalau yang terbaik pun tidak layak (misalnya seluruh perangkat hanya punya
  // suara Inggris), lebih baik tidak bersuara sama sekali: panduan arah yang
  // dilafalkan dengan aksen asing lebih membingungkan daripada tidak ada
  // panduan.
  if (!isAcceptableVoice(best)) {
    return ranked.find(isAcceptableVoice) || null;
  }

  return best;
}

/** Ringkasan singkat untuk ditampilkan di layar. */
export function describeVoice(voice) {
  if (!voice) return "TIDAK ADA SUARA INDONESIA";
  const name = String(voice.name || "").replace(/^(Google|Microsoft)\s*/i, "");
  return name + " · " + String(voice.lang || "");
}
