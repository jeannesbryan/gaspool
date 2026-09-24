/**
 * Test untuk milestone jarak tempuh (kelipatan 1000 km).
 *
 * Kenapa ada: angka dari modul ini masuk ke kartu yang dibagikan ke orang lain,
 * jadi "NaN km" atau milestone yang muncul dua kali akan terlihat oleh pembaca
 * di luar. Test ini mengunci batas-batasnya, terutama kasus tepat di angka
 * bulat dan kasus satu aktivitas yang melewati beberapa milestone sekaligus.
 *
 *   node tests/milestones.mjs
 *
 * Exit code 0 = semua assertion lewat.
 */
import {
  computeMilestoneProgress,
  crossedMilestones,
  formatMilestoneKm,
  MILESTONE_STEP_KM,
} from "../src/milestones.ts";

const results = [];
const check = (name, passed, detail = "") => results.push({ name, passed: Boolean(passed), detail });
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

check(
  "langkah milestone adalah 1000 km",
  MILESTONE_STEP_KM === 1000,
  `step=${MILESTONE_STEP_KM}`,
);

// --------------------------------------------------------- kemajuan dasar
{
  const p = computeMilestoneProgress(2847.3);
  check(
    "2.847 km berarti 2 milestone tercapai, berikutnya 3.000",
    p.reached_count === 2 && p.last_reached_km === 2000 && p.next_km === 3000,
    JSON.stringify(p),
  );
  check(
    "sisa jarak ke milestone berikutnya benar",
    near(p.remaining_km, 152.7, 0.01),
    `remaining=${p.remaining_km} (harap 152,7)`,
  );
  check(
    "kemajuan dalam segmen berjalan benar",
    near(p.progress_ratio, 0.8473, 0.001),
    `ratio=${p.progress_ratio} (harap ~0,8473)`,
  );
}

// ------------------------------------------------- belum sampai 1000 km
{
  const p = computeMilestoneProgress(412.5);
  check(
    "di bawah 1000 km belum ada milestone tercapai",
    p.reached_count === 0 && p.last_reached_km === 0 && p.next_km === 1000,
    JSON.stringify(p),
  );
  check(
    "kemajuan tetap masuk akal sebelum milestone pertama",
    near(p.progress_ratio, 0.4125, 0.001),
    `ratio=${p.progress_ratio}`,
  );
}

// --------------------------------------------- tepat di angka milestone
{
  const p = computeMilestoneProgress(3000);
  check(
    "tepat 3.000 km dihitung sebagai milestone yang SUDAH tercapai",
    p.reached_count === 3 && p.last_reached_km === 3000 && p.next_km === 4000,
    JSON.stringify(p),
  );
  check(
    "kemajuan kembali ke nol setelah milestone tercapai",
    p.progress_ratio === 0 && near(p.remaining_km, 1000, 0.001),
    `ratio=${p.progress_ratio} remaining=${p.remaining_km}`,
  );
}

// ------------------------------------------------------------ deteksi lintas
{
  check(
    "melewati 3000 km terdeteksi",
    JSON.stringify(crossedMilestones(2940, 3050)) === JSON.stringify([3000]),
    JSON.stringify(crossedMilestones(2940, 3050)),
  );
  check(
    "tidak ada milestone kalau belum melewati batas",
    crossedMilestones(2100, 2999).length === 0,
    JSON.stringify(crossedMilestones(2100, 2999)),
  );
  check(
    "tepat menyentuh batas dihitung sebagai terlewati",
    JSON.stringify(crossedMilestones(2500, 3000)) === JSON.stringify([3000]),
    JSON.stringify(crossedMilestones(2500, 3000)),
  );
  check(
    "beberapa milestone sekaligus terdeteksi berurutan",
    JSON.stringify(crossedMilestones(990, 3100)) === JSON.stringify([1000, 2000, 3000]),
    JSON.stringify(crossedMilestones(990, 3100)),
  );
  check(
    "milestone pertama terdeteksi dari nol",
    JSON.stringify(crossedMilestones(0, 1000)) === JSON.stringify([1000]),
    JSON.stringify(crossedMilestones(0, 1000)),
  );
  check(
    "jarak yang tidak bertambah tidak menghasilkan milestone",
    crossedMilestones(3050, 3050).length === 0 && crossedMilestones(3050, 3000).length === 0,
    "menyimpan ulang aktivitas yang sama tidak boleh memicu kartu",
  );
  check(
    "milestone yang sama tidak pernah muncul dua kali",
    (() => {
      const list = crossedMilestones(0, 5000);
      return new Set(list).size === list.length;
    })(),
    JSON.stringify(crossedMilestones(0, 5000)),
  );
}

// -------------------------------------------- nilai rusak tidak melukai
{
  const cases = [null, undefined, NaN, "abc", -50, ""];
  const safe = cases.every((value) => {
    const p = computeMilestoneProgress(value);
    return Number.isFinite(p.total_km) && p.total_km >= 0 && Number.isFinite(p.progress_ratio);
  });

  check(
    "nilai rusak dari D1 tidak menghasilkan NaN di kartu",
    safe,
    cases.map((v) => `${String(v)}->${computeMilestoneProgress(v).total_km}`).join(" "),
  );
  check(
    "jarak negatif tidak dianggap pencapaian",
    computeMilestoneProgress(-5000).reached_count === 0,
    `reached=${computeMilestoneProgress(-5000).reached_count}`,
  );
  check(
    "kemajuan selalu di dalam rentang 0..1",
    [0, 1, 999.9, 1000, 123456].every((km) => {
      const r = computeMilestoneProgress(km).progress_ratio;
      return r >= 0 && r < 1;
    }),
    "ratio keluar dari rentang",
  );
}

// ---------------------------------------------------------------- format
{
  check(
    "jarak diformat memakai pemisah ribuan gaya Indonesia",
    /^2\.847,3$/.test(formatMilestoneKm(2847.3)),
    formatMilestoneKm(2847.3),
  );
  check(
    "nilai rusak diformat sebagai nol, bukan NaN",
    formatMilestoneKm(null) === "0,0" && !formatMilestoneKm("abc").includes("NaN"),
    `${formatMilestoneKm(null)} / ${formatMilestoneKm("abc")}`,
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
  `\nmilestones: ${results.length - failed}/${results.length} assertion lewat${failed ? ` — ${failed} GAGAL` : ""}`,
);

process.exit(failed === 0 ? 0 : 1);
