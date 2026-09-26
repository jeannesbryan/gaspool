/**
 * Uji aturan "angka mana yang disimpan" (public/assets/ride-stat-rules.js).
 *
 *   node tests/ride-stat-rules.mjs
 *
 * Angka-angka di sini berasal dari gowes nyata 25 Sep 2026 (11027 titik,
 * 55,130 km dilaporkan, 53,479 km setelah drift GPS dibuang), supaya ujinya
 * menjaga kasus yang benar-benar terjadi, bukan kasus karangan.
 */
import {
  STORED_DISTANCE_MAX_RATIO,
  STORED_DISTANCE_MIN_RATIO,
  chooseStoredDistanceKm,
  chooseStoredElevationGain,
} from "../public/assets/ride-stat-rules.js";

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed });
  console.log(`${passed ? "  ok  " : " FAIL "} ${name}${passed || !detail ? "" : `\n         ${detail}`}`);
};

// ------------------------------------------------------- jarak: tabel bersama
const realRide = chooseStoredDistanceKm({
  declaredKm: 55.129836272592335,
  cleanKm: 53.479,
  sharedTableKm: 53.479,
});
check(
  "gowes 25 Sep: memakai jarak tabel segmen, bukan angka mentah",
  realRide.km === 53.479 && realRide.source === "shared_segment_table",
  JSON.stringify(realRide),
);
check(
  "selisih drift GPS dilaporkan apa adanya",
  realRide.reason.includes("1.651"),
  realRide.reason,
);
check(
  "jarak mentah tetap tercatat untuk ditelusuri",
  realRide.declared_km === 55.129836272592335 && realRide.clean_km === 53.479,
  JSON.stringify(realRide),
);

// Angka lain yang sudah terkurasi sebelumnya.
const curated = chooseStoredDistanceKm({
  declaredKm: 18.805,
  cleanKm: 18.506,
  sharedTableKm: 18.506,
});
check(
  "gowes 24 Sep: 18,506 km yang disimpan, bukan 18,805 km",
  curated.km === 18.506,
  JSON.stringify(curated),
);

// ----------------------------------------------- jarak: tabel bersama tidak ada
const noTable = chooseStoredDistanceKm({
  declaredKm: 55.13,
  cleanKm: 53.479,
  sharedTableKm: null,
});
check(
  "tanpa tabel bersama, angka tracker dipertahankan dan ditandai",
  noTable.km === 55.13 && noTable.source === "tracker" && noTable.clean_km === null,
  JSON.stringify(noTable),
);
check(
  "fallback dijelaskan, bukan didiamkan",
  noTable.reason.includes("tidak tersedia"),
  noTable.reason,
);

// ------------------------------------------------------------- jarak: penjaga
const absurd = chooseStoredDistanceKm({
  declaredKm: 55.13,
  cleanKm: 5.0,
  sharedTableKm: 5.0,
});
check(
  "jarak bersih yang terlalu kecil ditolak, bukan disimpan",
  absurd.km === 55.13 && absurd.source === "tracker",
  JSON.stringify(absurd),
);
check(
  "penolakan itu dijelaskan",
  absurd.reason.includes("menyimpang terlalu jauh"),
  absurd.reason,
);

const biggerThanDeclared = chooseStoredDistanceKm({
  declaredKm: 10,
  cleanKm: 20,
  sharedTableKm: 20,
});
check(
  "jarak bersih yang lebih besar dari yang dilaporkan ditolak",
  biggerThanDeclared.km === 10,
  JSON.stringify(biggerThanDeclared),
);

// Batas rasio diuji tepat di tepinya, supaya penjaganya tidak menyimpang
// diam-diam kalau konstantanya diubah.
const atMin = chooseStoredDistanceKm({ declaredKm: 100, cleanKm: 100 * STORED_DISTANCE_MIN_RATIO, sharedTableKm: 100 * STORED_DISTANCE_MIN_RATIO });
check("tepat di batas bawah masih diterima", atMin.km === 50, JSON.stringify(atMin));
const belowMin = chooseStoredDistanceKm({ declaredKm: 100, cleanKm: 100 * STORED_DISTANCE_MIN_RATIO - 0.01, sharedTableKm: 100 * STORED_DISTANCE_MIN_RATIO - 0.01 });
check("sedikit di bawah batas bawah ditolak", belowMin.km === 100, JSON.stringify(belowMin));
const atMax = chooseStoredDistanceKm({ declaredKm: 100, cleanKm: 100 * STORED_DISTANCE_MAX_RATIO, sharedTableKm: 100 * STORED_DISTANCE_MAX_RATIO });
check("tepat di batas atas masih diterima", atMax.km === 110, JSON.stringify(atMax));

// --------------------------------------------------- jarak: masukan aneh
const noDistance = chooseStoredDistanceKm({ declaredKm: 0, cleanKm: 9.5, sharedTableKm: 9.5 });
check(
  "tracker melaporkan nol: pakai tabel segmen daripada menyimpan nol",
  noDistance.km === 9.5 && noDistance.source === "shared_segment_table",
  JSON.stringify(noDistance),
);
const garbage = chooseStoredDistanceKm({ declaredKm: "abc", cleanKm: Number.NaN, sharedTableKm: undefined });
check(
  "masukan rusak tidak menghasilkan NaN",
  garbage.km === 0 && Number.isFinite(garbage.km) && garbage.source === "tracker",
  JSON.stringify(garbage),
);

// ------------------------------------------------------------------ elevasi
const realElevation = chooseStoredElevationGain({
  liveMeters: 561,
  recalculatedMeters: 485.4,
});
check(
  "elevasi: pengukuran dipertahankan, hitung ulang tidak menimpa",
  realElevation.meters === 561 && realElevation.source === "live_clock",
  JSON.stringify(realElevation),
);
check(
  "kedua angka tetap tercatat untuk dibandingkan",
  realElevation.live_meters === 561 && realElevation.recalculated_meters === 485.4,
  JSON.stringify(realElevation),
);
check(
  "kenapa tidak ditimpa dijelaskan, bukan sekadar dipilih",
  realElevation.reason.includes("tidak bisa ditentukan pasti"),
  realElevation.reason,
);

const filled = chooseStoredElevationGain({ liveMeters: 0, recalculatedMeters: 485.4 });
check(
  "hitung ulang boleh MENGISI kalau live tidak punya angka",
  filled.meters === 485.4 && filled.source === "recalculated",
  JSON.stringify(filled),
);
const none = chooseStoredElevationGain({ liveMeters: 0, recalculatedMeters: 0 });
check("tidak ada angka sama sekali: nol, sumber none", none.meters === 0 && none.source === "none");
const liveWinsOverZero = chooseStoredElevationGain({ liveMeters: 561, recalculatedMeters: 0 });
check(
  "live menang walau hitung ulang nol",
  liveWinsOverZero.meters === 561 && liveWinsOverZero.source === "live_clock",
  JSON.stringify(liveWinsOverZero),
);
const negative = chooseStoredElevationGain({ liveMeters: -5, recalculatedMeters: -3 });
check("elevasi negatif tidak lolos", negative.meters === 0, JSON.stringify(negative));

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length > 0) process.exit(1);
