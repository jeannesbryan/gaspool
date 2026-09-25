/**
 * Inti aritmatika Activity Doctor — satu tabel segmen untuk semua pemakai.
 *
 * Kenapa berkas ini ada. Aritmatika yang sama sudah DUA KALI disalin ke tempat
 * berbeda lalu diperbaiki hanya di salah satunya:
 *
 *   1. `Math.floor()` pada selisih waktu. Di modul server diperbaiki, tetapi
 *      salinannya di `detectDoctorRestBlocks` tertinggal — gowes 20 menit
 *      dilaporkan 0:00:00.
 *   2. Aturan "segitiga mana yang dianggap bergerak". Finish Review memakai
 *      aturan sendiri (buang segmen mustahil), server memakai
 *      `buildDoctorSegments()`. Hasilnya dua jarak berbeda untuk gowes yang
 *      sama: 18,741 km vs 18,506 km.
 *
 * Karena itu berkas ini adalah SATU-SATUNYA tempat yang memutuskan arti
 * "bergerak". Halaman tracker memuatnya sebagai modul, modul server
 * mengimpornya, dan tests/doctor-core.mjs mengujinya langsung — satu berkas,
 * tidak ada salinan yang bisa menyimpang.
 *
 * Ditulis sebagai .js biasa (bukan .ts) supaya bisa dimuat browser tanpa build
 * dan diimpor Node tanpa kompilasi, sama seperti live-clock.js.
 */

export const DOCTOR_LONG_GAP_SECONDS = 20 * 60;
export const DOCTOR_EXTREME_JUMP_METERS = 1500;

// Bagaimana "berhenti" dibuktikan.
//
// Cara lama memakai panjang jeda antar titik, dan itu salah dua kali: jitter
// GPS tidak pernah menghasilkan jeda panjang, sementara sampel rapat selalu
// menghasilkan jeda nol.
//
// Cara di sini: sebuah titik dianggap bagian dari pemberhentian kalau ada
// rentetan titik selama DOCTOR_STOP_MIN_SECONDS yang semuanya masih di dalam
// radius tertentu dari titik itu. Artinya "orangnya benar-benar diam di satu
// tempat", bukan "kecepatan satu segmen kebetulan rendah".
//
// Radiusnya diturunkan dari ambang auto-pause supaya tracker dan doctor memakai
// definisi "bergerak" yang sama: radius = ambang_kmh x durasi. Lantainya ada
// untuk menyerap jitter GPS alat konsumen (beberapa meter) pada aktivitas lambat
// seperti jalan kaki, dan sengaja dipilih konservatif: kalau ragu, lebih baik
// waktu dihitung bergerak (kecepatan tampak lebih rendah) daripada sebaliknya.
export const DOCTOR_STOP_MIN_SECONDS = 60;
export const DOCTOR_STOP_RADIUS_FLOOR_METERS = 25;

const degreesToRadians = (value) => (value * Math.PI) / 180;

export const getDistanceMeters = (from, to) => {
  const earthRadiusM = 6371000;
  const dLat = degreesToRadians(to.lat - from.lat);
  const dLng = degreesToRadians(to.lng - from.lng);
  const lat1 = degreesToRadians(from.lat);
  const lat2 = degreesToRadians(to.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusM * c;
};

/**
 * `movement_min_kmh` sengaja disamakan dengan `activityAutoPauseSpeedKmh()` di
 * src/routes/tracker.ts. Kalau dua tempat ini berbeda, live tracker dan doctor
 * akan punya dua definisi "bergerak" yang berbeda pula — persis jenis
 * ketidakcocokan yang membuat moving time dulu menyusut 47 menit.
 */
export const getDoctorSpeedLimits = (activityType) => {
  const type = String(activityType || "ride").toLowerCase();

  if (type === "ride") {
    return {
      calculation_max_kmh: 120,
      trusted_max_kmh: 65,
      suspicious_ratio: 1.75,
      movement_min_kmh: 2.0,
    };
  }

  if (type === "run") {
    return {
      calculation_max_kmh: 45,
      trusted_max_kmh: 32,
      suspicious_ratio: 1.65,
      movement_min_kmh: 1.4,
    };
  }

  if (type === "hike") {
    return {
      calculation_max_kmh: 25,
      trusted_max_kmh: 18,
      suspicious_ratio: 1.6,
      movement_min_kmh: 0.7,
    };
  }

  return {
    calculation_max_kmh: 25,
    trusted_max_kmh: 18,
    suspicious_ratio: 1.6,
    movement_min_kmh: 0.8,
  };
};

/**
 * Tandai titik mana yang berada di dalam sebuah pemberhentian.
 *
 * Untuk tiap titik `a`, cari titik terjauh `b` yang masih di dalam radius dari
 * titik `a`. Kalau bentangan waktu a..b mencapai DOCTOR_STOP_MIN_SECONDS, seluruh
 * rentang itu berarti "diam di satu tempat" dan ditandai berhenti.
 *
 * `b` hanya bergerak maju seiring `a` bergerak maju (karena kendala jarak makin
 * longgar), sehingga totalnya O(n) — sama untuk berkas 100 titik maupun 100.000
 * titik. Penandaan rentang juga dijaga O(n) dengan hanya menandai bagian yang
 * belum pernah ditandai.
 */
export const classifyDoctorPointStays = (
  points,
  cumTime,
  radiusMeters,
  minSeconds = DOCTOR_STOP_MIN_SECONDS,
) => {
  const total = points.length;
  const inStay = new Array(total).fill(false);
  if (total < 2 || radiusMeters <= 0 || minSeconds <= 0) return inStay;

  let furthest = 0;
  let markedUntil = -1;

  for (let a = 0; a < total; a++) {
    if (furthest < a) furthest = a;
    while (
      furthest + 1 < total &&
      getDistanceMeters(points[a], points[furthest + 1]) < radiusMeters
    ) {
      furthest += 1;
    }

    if (cumTime[furthest] - cumTime[a] < minSeconds) continue;

    const from = Math.max(a, markedUntil + 1);
    for (let k = from; k <= furthest; k++) inStay[k] = true;
    if (furthest > markedUntil) markedUntil = furthest;
  }

  return inStay;
};

/** Radius pemberhentian untuk satu jenis aktivitas (lihat catatan di atas). */
export const getDoctorStopRadiusMeters = (movementMinKmh) =>
  Math.max(
    DOCTOR_STOP_RADIUS_FLOOR_METERS,
    (movementMinKmh / 3.6) * DOCTOR_STOP_MIN_SECONDS,
  );

/**
 * Satu tabel segmen, dipakai oleh SEMUA perhitungan di modul ini.
 *
 * Ini bukan sekadar kerapian: jarak dan waktu harus dijumlahkan dari HIMPUNAN
 * SEGMEN YANG SAMA. Versi lama menjumlahkan jarak dari semua segmen tetapi
 * waktu hanya dari sebagian, lalu membagi keduanya — itu artefak, bukan
 * pengukuran, dan hasilnya moving time menyusut 47 menit.
 */
export const buildDoctorSegments = (points, activityType) => {
  const limits = getDoctorSpeedLimits(activityType);
  const count = Math.max(0, points.length - 1);

  const distanceM = new Array(count).fill(0);
  const seconds = new Array(count).fill(0);
  const gapSeconds = new Array(count).fill(0);
  const cumTime = new Array(count + 1).fill(0);

  for (let i = 1; i < points.length; i++) {
    const k = i - 1;
    const prev = points[i - 1];
    const point = points[i];

    distanceM[k] = getDistanceMeters(prev, point);

    const prevMs = prev.time ? Date.parse(prev.time) : 0;
    const pointMs = point.time ? Date.parse(point.time) : 0;

    // Selisih waktu NYATA, bukan hasil pembulatan. Ini yang dulu hilang:
    // Math.floor() membuat rekaman lebih rapat dari 1 detik menyumbang jarak
    // tetapi nol waktu, dan 45 menit menguap tanpa jejak.
    const exactSeconds =
      Number.isFinite(prevMs) && Number.isFinite(pointMs) ? (pointMs - prevMs) / 1000 : 0;
    seconds[k] = exactSeconds > 0 ? exactSeconds : 0;

    // Nilai bulat tetap ada karena ambang anomali didefinisikan dalam detik utuh.
    gapSeconds[k] = Math.floor(seconds[k]);
    cumTime[k + 1] = cumTime[k] + seconds[k];
  }

  const inStay = classifyDoctorPointStays(
    points,
    cumTime,
    getDoctorStopRadiusMeters(limits.movement_min_kmh),
  );

  const kind = new Array(count).fill("moving");

  for (let k = 0; k < count; k++) {
    // Urutan ini penting: lompatan GPS mengalahkan segalanya, lalu
    // pemberhentian, sisanya baru dianggap bergerak.
    if (
      distanceM[k] >= DOCTOR_EXTREME_JUMP_METERS &&
      (!gapSeconds[k] || gapSeconds[k] < DOCTOR_LONG_GAP_SECONDS)
    ) {
      kind[k] = "jump";
    } else if (inStay[k] && inStay[k + 1]) {
      kind[k] = "stopped";
    }
  }

  return { count, distanceM, seconds, gapSeconds, cumTime, kind, inStay };
};

/**
 * Jarak yang benar-benar DITEMPUH, dalam meter.
 *
 * Hanya segmen yang ditandai "moving" yang dihitung. Inilah angka yang layak
 * disimpan sebagai jarak aktivitas.
 *
 * Kenapa `jump` dan `stopped` tidak dihitung: pada gowes 24 Sep, 298 meter
 * terbuang dari 59 segmen yang berlangsung selama 570 detik berhenti. GPS yang
 * mengembara saat sepeda diam bukan jarak yang ditempuh siapa pun; menyimpannya
 * berarti mencatat perjalanan yang tidak pernah terjadi. Segmen `jump`
 * (>= 1,5 km) adalah lompatan GPS, bukan gerakan.
 */
export const doctorMovingDistanceMeters = (points, activityType) => {
  const segments = buildDoctorSegments(points, activityType);
  let total = 0;
  for (let k = 0; k < segments.count; k++) {
    if (segments.kind[k] === "moving") total += segments.distanceM[k];
  }
  return total;
};

/**
 * Detik yang dianggap BERGERAK, dari tabel segmen yang sama dengan jaraknya.
 *
 * Sengaja tidak dipakai untuk menimpa jam live secara otomatis — lihat catatan
 * di src/api/api.ts. Jam live adalah pengukuran langsung (ia tahu kapan
 * pesepeda benar-benar berhenti, termasuk saat GPS tidak stabil); angka ini
 * adalah inferensi geometri, jadi perannya memeriksa silang.
 */
export const doctorMovingSeconds = (points, activityType) => {
  const segments = buildDoctorSegments(points, activityType);
  let total = 0;
  for (let k = 0; k < segments.count; k++) {
    if (segments.kind[k] === "moving") total += segments.seconds[k];
  }
  return total;
};
