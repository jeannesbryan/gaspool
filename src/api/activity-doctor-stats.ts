/**
 * Statistik Activity Doctor — modul murni, tanpa dependensi runtime.
 *
 * Kenapa modul ini dipisah dari src/api/api.ts:
 * angka yang keluar dari sini (jarak, moving time, average speed) dipakai untuk
 * MENULIS ULANG riwayat olahraga seseorang. Angka seperti itu harus
 * deterministik dan bisa diuji tanpa menyalakan Worker, D1, atau R2. Modul ini
 * sengaja tidak mengimpor apa pun supaya test bisa memuatnya langsung lewat
 * TypeScript type stripping Node (lihat tests/activity-doctor.mjs).
 *
 * Tipe di sini adalah kontrak modul ini sendiri (struktural), bukan salinan
 * tipe milik api.ts — api.ts boleh punya tipe yang lebih kaya (misalnya
 * `RoutePoint & {...}`) selama bentuknya cocok dengan yang ada di sini.
 *
 * ATURAN YANG BERLAKU (semuanya pernah dilanggar, lihat tests/activity-doctor.mjs):
 *
 *   1. Satu himpunan segmen. Jarak dan waktu HARUS dijumlahkan dari segmen yang
 *      sama. Versi lama menjumlahkan jarak dari semua segmen tetapi waktu hanya
 *      dari sebagian, lalu membagi keduanya — itu artefak, bukan pengukuran.
 *   2. Waktu memakai selisih nyata (pecahan detik), bukan yang sudah dibulatkan.
 *      Versi lama memakai Math.floor(), sehingga titik yang terekam lebih rapat
 *      dari 1 detik menyumbang jarak tetapi nol waktu.
 *   3. "Bergerak" didefinisikan sama dengan auto-pause di tracker: pergeseran
 *      BERSIH di dalam jendela waktu, bukan kecepatan satu segmen. Kecepatan
 *      satu segmen terlalu berisik pada sampel rapat dan terlalu tumpul pada
 *      sampel jarang.
 *   4. Tidak ada detik yang boleh hilang tanpa penjelasan. Setiap detik di
 *      dalam rentang aktivitas harus muncul sebagai moving_time, stopped_time,
 *      atau excluded_jump_seconds; sisanya dilaporkan sebagai
 *      unaccounted_seconds supaya bisa ditolak, bukan disembunyikan.
 */

export type DoctorStatPoint = {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
  speed?: number;
  _source_index?: number;
};

export type DoctorSeverity = "info" | "warning" | "danger";

export type DoctorAnomalyCode =
  | "extreme_jump"
  | "suspicious_speed"
  | "elevation_spike"
  | "long_gap"
  | "time_reversal"
  | "duplicate_timestamp"
  | "invalid_timestamp";

export type DoctorAnomaly = {
  code: DoctorAnomalyCode;
  severity: DoctorSeverity;
  segment_index: number;
  point_index: number;
  source_index: number;
  at: string;
  lat: number;
  lng: number;
  value: number;
  threshold: number;
  detail: string;
};

export type DoctorTimeIntegrity = {
  invalid_timestamp_count: number;
  time_reversal_count: number;
  duplicate_timestamp_count: number;
  first_ms: number;
  last_ms: number;
  span_seconds: number;
};

export type DoctorCluster = {
  cluster_index: number;
  point_count: number;
  first_point_index: number;
  last_point_index: number;
  lat: number;
  lng: number;
};

export const DOCTOR_LONG_GAP_SECONDS = 20 * 60;
export const DOCTOR_MOVING_GAP_SECONDS = 5 * 60;
export const DOCTOR_EXTREME_JUMP_METERS = 1500;
export const DOCTOR_MAX_ANOMALIES = 200;
export const DOCTOR_ELEVATION_SPIKE_METERS = 50;

// Ambang diskontinuitas sengaja jauh di atas DOCTOR_EXTREME_JUMP_METERS: 1,5 km
// masih bisa berupa GPS noise, sedangkan 20 km berarti track ini menempelkan
// dua perjalanan yang berbeda.
export const DOCTOR_DISCONTINUITY_METERS = 20000;
export const DOCTOR_MIN_CLUSTER_POINTS = 5;
export const DOCTOR_MAX_CLUSTERS = 24;

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
// Kenapa radius, bukan jendela bergulir: jendela yang mengelilingi satu segmen
// ikut menyeret aktivitas di sebelahnya, sehingga ~30 detik pertama sebuah
// istirahat masih terbaca "bergerak" dan jitter GPS di detik-detik itu ikut
// terhitung sebagai jarak. Dengan radius, batasnya jatuh tepat di titik terakhir
// yang masih diam, jadi tajam tanpa perlu dipangkas.
//
// Radiusnya diturunkan dari ambang auto-pause supaya tracker dan doctor memakai
// definisi "bergerak" yang sama: radius = ambang_kmh x durasi. Lantainya ada
// untuk menyerap jitter GPS alat konsumen (beberapa meter) pada aktivitas lambat
// seperti jalan kaki, dan sengaja dipilih konservatif: kalau ragu, lebih baik
// waktu dihitung bergerak (kecepatan tampak lebih rendah) daripada sebaliknya.
export const DOCTOR_STOP_MIN_SECONDS = 60;
export const DOCTOR_STOP_RADIUS_FLOOR_METERS = 25;

const degreesToRadians = (value: number) => (value * Math.PI) / 180;

export const getDistanceMeters = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) => {
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
export const getDoctorSpeedLimits = (activityType: string) => {
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

// Memotong route pada lompatan antar titik BERURUTAN yang melebihi ambang.
// Definisi ini yang benar untuk mencari track gabungan: rute 100 km yang
// di-sample tiap 5 km tetap satu gugus karena tiap langkah kecil, sedangkan
// track yang menempelkan dua perjalanan berbeda terbelah di jahitannya.
// (Mengukur jarak ke centroid akan salah menandai rute panjang sebagai banyak
// gugus, karena centroid menjauh dari titik-titik ujung.)
export const buildDoctorClusters = (points: DoctorStatPoint[]) => {
  const runs: Array<{
    count: number;
    sumLat: number;
    sumLng: number;
    firstIndex: number;
    lastIndex: number;
  }> = [];

  points.forEach((point, index) => {
    const previous = index > 0 ? points[index - 1] : null;
    const startsNewRun =
      !previous || getDistanceMeters(previous, point) >= DOCTOR_DISCONTINUITY_METERS;

    if (startsNewRun) {
      runs.push({ count: 0, sumLat: 0, sumLng: 0, firstIndex: index, lastIndex: index });
    }

    const run = runs[runs.length - 1];
    run.count += 1;
    run.sumLat += point.lat;
    run.sumLng += point.lng;
    run.lastIndex = index;
  });

  return runs.slice(0, DOCTOR_MAX_CLUSTERS).map((run, index) => ({
    cluster_index: index,
    point_count: run.count,
    first_point_index: run.firstIndex,
    last_point_index: run.lastIndex,
    lat: Number((run.sumLat / run.count).toFixed(6)),
    lng: Number((run.sumLng / run.count).toFixed(6)),
  }));
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
  points: DoctorStatPoint[],
  cumTime: number[],
  radiusMeters: number,
  minSeconds: number = DOCTOR_STOP_MIN_SECONDS,
) => {
  const total = points.length;
  const inStay = new Array<boolean>(total).fill(false);
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
export const getDoctorStopRadiusMeters = (movementMinKmh: number) =>
  Math.max(
    DOCTOR_STOP_RADIUS_FLOOR_METERS,
    (movementMinKmh / 3.6) * DOCTOR_STOP_MIN_SECONDS,
  );

export const recalculateDoctorStats = (
  points: DoctorStatPoint[],
  activityType: string,
) => {
  const limits = getDoctorSpeedLimits(activityType);
  const plausibleMaxSpeed = limits.calculation_max_kmh;
  const segmentCount = Math.max(0, points.length - 1);

  let maxSpeed = 0;
  let elevationGain = 0;
  let skippedJumpCount = 0;
  let longGapCount = 0;
  let suspiciousSpeedCount = 0;
  let lastEle: number | null = null;
  const anomalies: DoctorAnomaly[] = [];
  const timeIntegrity: DoctorTimeIntegrity = {
    invalid_timestamp_count: 0,
    time_reversal_count: 0,
    duplicate_timestamp_count: 0,
    first_ms: 0,
    last_ms: 0,
    span_seconds: 0,
  };

  // ---- Langkah 1: bangun tabel segmen sekali, lalu pakai tabel itu untuk
  // SEMUA perhitungan. Tidak ada lagi nilai yang dihitung ulang secara
  // berbeda-beda di dalam loop.
  const segmentDistanceM = new Array<number>(segmentCount).fill(0);
  const segmentSeconds = new Array<number>(segmentCount).fill(0);
  const segmentGapSeconds = new Array<number>(segmentCount).fill(0);
  const cumTime = new Array<number>(segmentCount + 1).fill(0);

  for (let i = 1; i < points.length; i++) {
    const k = i - 1;
    const prev = points[i - 1];
    const point = points[i];

    segmentDistanceM[k] = getDistanceMeters(prev, point);

    const prevMs = prev.time ? Date.parse(prev.time) : 0;
    const pointMs = point.time ? Date.parse(point.time) : 0;

    // Selisih waktu NYATA. Nilai inilah yang dipakai untuk menghitung waktu,
    // bukan versi yang sudah dibulatkan ke bawah.
    const exactSeconds =
      Number.isFinite(prevMs) && Number.isFinite(pointMs) ? (pointMs - prevMs) / 1000 : 0;
    segmentSeconds[k] = exactSeconds > 0 ? exactSeconds : 0;

    // Nilai bulat tetap disimpan karena ambang anomali (long gap / istirahat)
    // memang didefinisikan dalam detik utuh.
    segmentGapSeconds[k] = Math.floor(segmentSeconds[k]);

    cumTime[k + 1] = cumTime[k] + segmentSeconds[k];
  }

  const inStay = classifyDoctorPointStays(
    points,
    cumTime,
    getDoctorStopRadiusMeters(limits.movement_min_kmh),
  );

  const pushAnomaly = (
    code: DoctorAnomalyCode,
    severity: DoctorSeverity,
    segmentIndex: number,
    point: DoctorStatPoint,
    value: number,
    threshold: number,
    detail: string,
  ) => {
    if (anomalies.length >= DOCTOR_MAX_ANOMALIES) return;

    anomalies.push({
      code,
      severity,
      segment_index: segmentIndex,
      point_index: segmentIndex,
      source_index: Number.isFinite(Number(point._source_index))
        ? Number(point._source_index)
        : segmentIndex,
      at: String(point.time || ""),
      lat: Number(Number(point.lat).toFixed(6)),
      lng: Number(Number(point.lng).toFixed(6)),
      value: Number(Number(value).toFixed(3)),
      threshold: Number(Number(threshold).toFixed(3)),
      detail,
    });
  };

  // ---- Langkah 2: klasifikasikan tiap segmen dan jumlahkan. Jarak dan waktu
  // diambil dari cabang yang sama, jadi keduanya tidak mungkin lagi berasal
  // dari himpunan segmen yang berbeda.
  let distanceKm = 0;
  let movingSeconds = 0;
  let stoppedSeconds = 0;
  let excludedJumpSeconds = 0;

  for (let i = 1; i < points.length; i++) {
    const k = i - 1;
    const prev = points[i - 1];
    const point = points[i];
    const distanceM = segmentDistanceM[k];
    const distanceSegmentKm = distanceM / 1000;
    const gapSec = segmentGapSeconds[k];
    const deltaSec = segmentSeconds[k];
    const segmentSpeed = gapSec > 0 ? distanceSegmentKm / (gapSec / 3600) : 0;

    const prevMs = prev.time ? Date.parse(prev.time) : 0;
    const pointMs = point.time ? Date.parse(point.time) : 0;

    // Integritas waktu diperiksa terpisah dari gapSec: gapSec sengaja bernilai 0
    // untuk timestamp yang tidak masuk akal, sehingga timeline yang mundur
    // selama ini lolos tanpa catatan.
    if (Number.isFinite(pointMs) && pointMs > 0) {
      if (timeIntegrity.first_ms === 0 || pointMs < timeIntegrity.first_ms) {
        timeIntegrity.first_ms = pointMs;
      }
      if (pointMs > timeIntegrity.last_ms) timeIntegrity.last_ms = pointMs;
    }

    if (point.time && !Number.isFinite(pointMs)) {
      timeIntegrity.invalid_timestamp_count += 1;
      pushAnomaly(
        "invalid_timestamp",
        "warning",
        i,
        point,
        0,
        0,
        "Timestamp titik ini tidak bisa dibaca sehingga ikut merusak moving time.",
      );
    } else if (Number.isFinite(prevMs) && Number.isFinite(pointMs) && prevMs > 0 && pointMs > 0) {
      if (pointMs < prevMs) {
        timeIntegrity.time_reversal_count += 1;
        pushAnomaly(
          "time_reversal",
          "warning",
          i,
          point,
          (prevMs - pointMs) / 1000,
          0,
          `Waktu mundur ${Math.round((prevMs - pointMs) / 1000)} detik dibanding titik sebelumnya.`,
        );
      } else if (pointMs === prevMs) {
        timeIntegrity.duplicate_timestamp_count += 1;
        pushAnomaly(
          "duplicate_timestamp",
          "info",
          i,
          point,
          0,
          0,
          "Timestamp sama persis dengan titik sebelumnya; kecepatan segmen ini tidak bisa dihitung.",
        );
      }
    }

    if (distanceM >= DOCTOR_EXTREME_JUMP_METERS && (!gapSec || gapSec < DOCTOR_LONG_GAP_SECONDS)) {
      skippedJumpCount += 1;
      excludedJumpSeconds += deltaSec;
      pushAnomaly(
        "extreme_jump",
        "warning",
        i,
        point,
        distanceM,
        DOCTOR_EXTREME_JUMP_METERS,
        `Lompatan ${(distanceM / 1000).toFixed(2)} km tanpa jeda waktu yang menjelaskannya.`,
      );
      continue;
    }

    if (gapSec >= DOCTOR_LONG_GAP_SECONDS) {
      longGapCount += 1;
      pushAnomaly(
        "long_gap",
        "info",
        i,
        point,
        gapSec,
        DOCTOR_LONG_GAP_SECONDS,
        `Jeda ${Math.round(gapSec / 60)} menit antar titik; wajar untuk istirahat, bukan kerusakan data.`,
      );
    }

    if (segmentSpeed > plausibleMaxSpeed && gapSec > 0) {
      suspiciousSpeedCount += 1;
      pushAnomaly(
        "suspicious_speed",
        "warning",
        i,
        point,
        segmentSpeed,
        plausibleMaxSpeed,
        `Kecepatan segmen ${segmentSpeed.toFixed(1)} km/h melewati batas wajar ${plausibleMaxSpeed} km/h.`,
      );
    }

    // Segmen dianggap berhenti kalau KEDUA ujungnya ada di dalam rentetan diam.
    // Memakai kedua ujung (bukan hanya salah satu) menjaga batasnya tetap tajam.
    if (inStay[k] && inStay[k + 1]) {
      // Berhenti: tidak menambah jarak (jitter GPS saat diam bukan rute) dan
      // tidak menambah moving time. Waktunya tetap tercatat, bukan dibuang.
      stoppedSeconds += deltaSec;
      continue;
    }

    if (distanceM >= 1 && distanceM < DOCTOR_EXTREME_JUMP_METERS) {
      distanceKm += distanceSegmentKm;
    }

    movingSeconds += deltaSec;

    if (Number.isFinite(point.speed || NaN)) {
      maxSpeed = Math.max(maxSpeed, Number(point.speed || 0));
    } else if (segmentSpeed > 0 && segmentSpeed <= plausibleMaxSpeed) {
      maxSpeed = Math.max(maxSpeed, segmentSpeed);
    }

    const ele = Number(point.ele);

    if (Number.isFinite(ele)) {
      if (lastEle !== null) {
        const diff = ele - lastEle;
        if (diff > 3 && diff < 50) elevationGain += diff;
        if (Math.abs(diff) >= DOCTOR_ELEVATION_SPIKE_METERS) {
          pushAnomaly(
            "elevation_spike",
            "info",
            i,
            point,
            diff,
            DOCTOR_ELEVATION_SPIKE_METERS,
            `Elevasi berubah ${diff.toFixed(0)} m dalam satu segmen; kemungkinan nilai rusak.`,
          );
        }
      }

      lastEle = ele;
    }
  }

  const movingTime = Math.max(0, Math.floor(movingSeconds));
  const stoppedTime = Math.max(0, Math.floor(stoppedSeconds));

  // Average speed diturunkan dari angka yang benar-benar dilaporkan, supaya
  // "jarak dan moving time" yang tertulis di laporan memang bisa dibagi dan
  // hasilnya persis angka yang ditampilkan.
  const averageSpeed = movingTime > 0 ? distanceKm / (movingTime / 3600) : 0;
  const clusters = buildDoctorClusters(points);
  const spanSeconds =
    timeIntegrity.first_ms > 0 && timeIntegrity.last_ms >= timeIntegrity.first_ms
      ? Math.floor((timeIntegrity.last_ms - timeIntegrity.first_ms) / 1000)
      : 0;

  // Akuntansi waktu: setiap detik di dalam rentang aktivitas harus muncul di
  // salah satu kolom. Sisa yang tak terjelaskan dilaporkan apa adanya supaya
  // pemanggil bisa menolak hasilnya, bukan menampilkannya diam-diam.
  const accountedSeconds = movingSeconds + stoppedSeconds + excludedJumpSeconds;
  const unaccountedSeconds = Math.max(0, Number((spanSeconds - accountedSeconds).toFixed(1)));

  const anomalyCounts = {
    extreme_jump: anomalies.filter((item) => item.code === "extreme_jump").length,
    suspicious_speed: anomalies.filter((item) => item.code === "suspicious_speed").length,
    elevation_spike: anomalies.filter((item) => item.code === "elevation_spike").length,
    long_gap: anomalies.filter((item) => item.code === "long_gap").length,
    time_reversal: timeIntegrity.time_reversal_count,
    duplicate_timestamp: timeIntegrity.duplicate_timestamp_count,
    invalid_timestamp: timeIntegrity.invalid_timestamp_count,
  };

  return {
    distance_km: Number(distanceKm.toFixed(3)),
    moving_time: movingTime,
    stopped_time: stoppedTime,
    excluded_jump_seconds: Number(excludedJumpSeconds.toFixed(1)),
    unaccounted_seconds: unaccountedSeconds,
    average_speed: Number(averageSpeed.toFixed(2)),
    max_speed: Number(maxSpeed.toFixed(2)),
    total_elevation_gain: Number(elevationGain.toFixed(1)),
    skipped_jump_count: skippedJumpCount,
    long_gap_count: longGapCount,
    suspicious_speed_count: suspiciousSpeedCount,
    time_reversal_count: timeIntegrity.time_reversal_count,
    duplicate_timestamp_count: timeIntegrity.duplicate_timestamp_count,
    invalid_timestamp_count: timeIntegrity.invalid_timestamp_count,
    timeline_sound:
      timeIntegrity.time_reversal_count === 0 && timeIntegrity.invalid_timestamp_count === 0,
    anomalies,
    anomaly_counts: anomalyCounts,
    time_integrity: { ...timeIntegrity, span_seconds: spanSeconds },
    clusters,
  };
};
