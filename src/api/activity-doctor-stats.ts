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

import {
  buildDoctorSegments as buildDoctorSegmentsImpl,
  classifyDoctorPointStays,
  DOCTOR_EXTREME_JUMP_METERS,
  DOCTOR_LONG_GAP_SECONDS,
  DOCTOR_STOP_MIN_SECONDS,
  DOCTOR_STOP_RADIUS_FLOOR_METERS,
  doctorMovingDistanceMeters,
  doctorMovingSeconds,
  getDistanceMeters,
  getDoctorSpeedLimits,
  getDoctorStopRadiusMeters,
} from "../../public/assets/doctor-core.js";

// Aritmatika inti TIDAK didefinisikan di sini lagi. Ia tinggal di
// public/assets/doctor-core.js supaya halaman tracker, modul ini, dan test
// memakai SATU tabel segmen. Simbol di bawah diteruskan apa adanya supaya
// pemakai lama (api.ts, tests/activity-doctor.mjs) tidak perlu diubah.
export {
  classifyDoctorPointStays,
  DOCTOR_EXTREME_JUMP_METERS,
  DOCTOR_LONG_GAP_SECONDS,
  DOCTOR_STOP_MIN_SECONDS,
  DOCTOR_STOP_RADIUS_FLOOR_METERS,
  doctorMovingDistanceMeters,
  doctorMovingSeconds,
  getDistanceMeters,
  getDoctorSpeedLimits,
  getDoctorStopRadiusMeters,
};

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

export const DOCTOR_MOVING_GAP_SECONDS = 5 * 60;
export const DOCTOR_MAX_ANOMALIES = 200;
export const DOCTOR_ELEVATION_SPIKE_METERS = 50;

// Ambang diskontinuitas sengaja jauh di atas DOCTOR_EXTREME_JUMP_METERS: 1,5 km
// masih bisa berupa GPS noise, sedangkan 20 km berarti track ini menempelkan
// dua perjalanan yang berbeda.
export const DOCTOR_DISCONTINUITY_METERS = 20000;
export const DOCTOR_MIN_CLUSTER_POINTS = 5;
export const DOCTOR_MAX_CLUSTERS = 24;

// Aturan "berhenti", radius pemberhentian, jarak haversine, dan batas kecepatan
// per jenis aktivitas semuanya tinggal di public/assets/doctor-core.js dan
// diteruskan di bagian atas berkas ini. Jangan menyalinnya kembali ke sini:
// salinan itulah yang dulu membuat halaman dan server menghitung jarak berbeda.

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
 * Seberapa jauh moving time hasil hitung ulang boleh menyimpang dari D1 sebelum
 * hasilnya ditolak.
 *
 * Kenapa toleransinya ketat (±15%) dan bukan longgar seperti dulu (0,35x-1,35x):
 * doctor dan tracker mengukur hal yang sama, jadi keduanya memang seharusnya
 * berdekatan. Regresi yang membuat 1:41:29 menjadi 1:00:35 hanya menyimpang
 * sekitar 40% — cukup untuk lolos dari ambang lama sambil tetap menulis ulang
 * riwayat seseorang dengan angka yang salah. Ambang longgar itu bukan pengaman,
 * ia hanya memberi ruang bagi bug berikutnya untuk lewat.
 *
 * Arah penyimpangan tetap dibedakan di dalam pesannya, karena "lebih pendek"
 * dan "lebih panjang" punya penyebab yang berbeda dan pemakainya perlu tahu
 * yang mana.
 */
export const DOCTOR_MOVING_TIME_RATIO_TOLERANCE = 0.15;

export type DoctorMovingTimeComparison = {
  ratio: number | null;
  withinTolerance: boolean;
  direction: "shorter" | "longer" | "equal" | "unknown";
  message: string;
};

/**
 * Bandingkan moving time hasil hitung ulang dengan yang sudah ada di D1.
 *
 * Rasio null berarti salah satu sisi tidak punya nilai (misalnya aktivitas lama
 * yang belum pernah punya statistik). Dalam keadaan itu tidak ada yang bisa
 * dibandingkan, dan hasilnya TIDAK dianggap menyimpang — kalau D1 memang kosong,
 * mengisinya adalah perbaikan, bukan risiko.
 */
export const compareDoctorMovingTime = (
  currentSeconds: number,
  proposedSeconds: number,
  tolerance: number = DOCTOR_MOVING_TIME_RATIO_TOLERANCE,
): DoctorMovingTimeComparison => {
  const current = Number(currentSeconds) || 0;
  const proposed = Number(proposedSeconds) || 0;

  if (current <= 0 || proposed <= 0) {
    return {
      ratio: null,
      withinTolerance: true,
      direction: "unknown",
      message: "Moving time D1 tidak ada, jadi tidak ada yang perlu dibandingkan.",
    };
  }

  const ratio = proposed / current;
  const percent = Math.round(Math.abs(1 - ratio) * 100);
  const withinTolerance = Math.abs(1 - ratio) <= tolerance;

  if (withinTolerance) {
    return {
      ratio,
      withinTolerance,
      direction: ratio === 1 ? "equal" : ratio < 1 ? "shorter" : "longer",
      message: `Moving time hasil hitung ulang masih dalam toleransi (${ratio.toFixed(2)}x dari D1).`,
    };
  }

  const direction = ratio < 1 ? "shorter" : "longer";
  const limit = Math.round(tolerance * 100);

  return {
    ratio,
    withinTolerance,
    direction,
    message:
      direction === "shorter"
        ? `Moving time hasil hitung ulang ${percent}% lebih pendek dari D1 (rasio ${ratio.toFixed(2)}), di luar toleransi ±${limit}%. D1 dipertahankan dan aktivitas ditandai MANUAL CHECK.`
        : `Moving time hasil hitung ulang ${percent}% lebih panjang dari D1 (rasio ${ratio.toFixed(2)}), di luar toleransi ±${limit}%. D1 dipertahankan dan aktivitas ditandai MANUAL CHECK.`,
  };
};

export type DoctorSegmentKind = "jump" | "stopped" | "moving";

/**
 * Satu tabel segmen, dipakai oleh SEMUA perhitungan di modul ini.
 *
 * Ini bukan sekadar kerapian. Regresi aslinya lahir justru karena jarak dan
 * waktu dijumlahkan di dua tempat berbeda dengan aturan berbeda. Selama masih
 * ada dua tempat, bug yang sama bisa lahir lagi; dengan satu tabel, "bergerak"
 * hanya punya satu arti.
 */
export type DoctorSegments = {
  count: number;
  distanceM: number[];
  seconds: number[];
  gapSeconds: number[];
  cumTime: number[];
  kind: DoctorSegmentKind[];
  inStay: boolean[];
};

export const buildDoctorSegments = (
  points: DoctorStatPoint[],
  activityType: string,
): DoctorSegments => buildDoctorSegmentsImpl(points, activityType);

export type DoctorRestBlock = {
  type: string;
  label: string;
  start: number;
  end: number;
  duration_s: number;
  distance_km: number;
  moving_time: number;
  note: string;
};

/**
 * Blok istirahat panjang, dipakai untuk analisis bahan bakar (nutrition) dan
 * ringkasan istirahat. Sama seperti statistik utama, blok ini melaporkan
 * `moving_time` KUMULATIF sampai istirahat itu mulai.
 *
 * Ambangnya sengaja tetap DOCTOR_LONG_GAP_SECONDS: ini memang daftar istirahat
 * panjang, bukan setiap lampu merah.
 */
export const collectDoctorRestBlocks = (
  points: DoctorStatPoint[],
  activityType: string,
): DoctorRestBlock[] => {
  const segments = buildDoctorSegments(points, activityType);
  const blocks: DoctorRestBlock[] = [];

  let progressKm = 0;
  let movingSeconds = 0;

  for (let i = 1; i < points.length; i++) {
    const k = i - 1;
    const point = points[i];

    if (segments.kind[k] === "moving") {
      const distanceM = segments.distanceM[k];
      if (distanceM >= 1 && distanceM < DOCTOR_EXTREME_JUMP_METERS) {
        progressKm += distanceM / 1000;
      }
      movingSeconds += segments.seconds[k];
    }

    if (segments.gapSeconds[k] >= DOCTOR_LONG_GAP_SECONDS) {
      // Variabel lokal dipakai supaya TypeScript bisa menyempitkan tipe:
      // penyempitan tidak berlaku pada akses elemen berulang (points[i - 1]).
      const prevTime = points[i - 1].time;
      const pointTime = point.time;
      const prevMs = prevTime ? Date.parse(prevTime) : 0;
      const pointMs = pointTime ? Date.parse(pointTime) : 0;

      blocks.push({
        type: "detected_gap",
        label: "Rest gap terdeteksi",
        start: prevMs,
        end: pointMs,
        duration_s: segments.gapSeconds[k],
        distance_km: Number(progressKm.toFixed(3)),
        moving_time: Math.max(0, Math.floor(movingSeconds)),
        note: "Ditemukan dari jeda timestamp antar titik GPS.",
      });
    }
  }

  return blocks;
};

export const recalculateDoctorStats = (
  points: DoctorStatPoint[],
  activityType: string,
) => {
  const limits = getDoctorSpeedLimits(activityType);
  const plausibleMaxSpeed = limits.calculation_max_kmh;

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

  // ---- Langkah 1: satukan tabel segmen lewat buildDoctorSegments(). Tabel yang
  // sama juga dipakai collectDoctorRestBlocks(), jadi blok istirahat tidak bisa
  // lagi melaporkan jam yang berbeda dari statistik utama.
  const segments = buildDoctorSegments(points, activityType);
  const { distanceM: segmentDistanceM, seconds: segmentSeconds, gapSeconds: segmentGapSeconds, cumTime } =
    segments;

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

    // Klasifikasi dari tabel bersama (lihat buildDoctorSegments): "jump" sudah
    // ditangani di atas, "stopped" berarti jitter GPS di tempat, sisanya
    // "moving". Jarak dan waktu diambil dari cabang yang sama persis.
    if (segments.kind[k] === "stopped") {
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
