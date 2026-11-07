/**
 * Tests for src/consistency-calendar.ts.
 *
 * Run with: node tests/consistency-calendar.mjs
 * Node 24 imports the .ts file directly through type stripping, so this
 * exercises the real module rather than a copy of its logic.
 */
import {
  buildConsistencyCalendar,
  formatStreak,
  LEVEL_THRESHOLDS_KM,
} from "../src/consistency-calendar.ts";

let pass = 0;
const failures = [];

const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
  } else {
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
  }
};

const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, want ${e}`);
};

const WIB = 420; // UTC+7, no DST
const NOW = Date.parse("2026-11-07T12:00:00Z"); // 19:00 WIB, Sat 7 Nov 2026

const build = (rides, opts = {}) =>
  buildConsistencyCalendar(rides, { utc_offset_minutes: WIB, now_utc_ms: NOW, ...opts });

/* ---------------------------------------------------------------- timezone */

// 2026-11-06T23:30Z is 06:30 on 7 Nov in Jakarta. Grouping by the UTC date
// would file it under the 6th and break the streak.
{
  const { weeks, stats } = build([
    { start_date: "2026-11-06T23:30:00Z", distance: 20 },
  ]);
  const flat = weeks.flatMap((w) => w.cells).filter(Boolean);
  const sixth = flat.find((c) => c.date === "2026-11-06");
  const seventh = flat.find((c) => c.date === "2026-11-07");
  check("ride near midnight is not filed on the UTC day", !sixth || sixth.ride_count === 0,
    `6 Nov cell: ${JSON.stringify(sixth)}`);
  check("ride near midnight lands on the local day", seventh?.ride_count === 1,
    `7 Nov cell: ${JSON.stringify(seventh)}`);
  eq("overnight ride still counts as today for the streak", stats.current_streak, 1);
}

// The same instant with a UTC offset must land on the 6th instead.
{
  const { weeks } = buildConsistencyCalendar(
    [{ start_date: "2026-11-06T23:30:00Z", distance: 20 }],
    { utc_offset_minutes: 0, now_utc_ms: NOW },
  );
  const flat = weeks.flatMap((w) => w.cells).filter(Boolean);
  check("offset 0 files it on the UTC day",
    flat.find((c) => c.date === "2026-11-06")?.ride_count === 1);
}

/* ------------------------------------------------------------------- grid */

{
  const { weeks } = build([]);
  check("53 weeks rendered by default", weeks.length === 53, `got ${weeks.length}`);
  check("every week has exactly 7 cells", weeks.every((w) => w.cells.length === 7));
  check("last week contains today",
    weeks[weeks.length - 1].cells.some((c) => c?.date === "2026-11-07"));
  check("grid starts on a Sunday", new Date(`${weeks[0].week_start}T00:00:00Z`).getUTCDay() === 0);

  // No cell may carry a date after today. A future cell must be null rather
  // than a zero, because a zero reads as "rest day" and claims knowledge about
  // days that have not happened.
  const allCells = weeks.flatMap((w) => w.cells);
  const futureDated = allCells.filter((c) => c && c.date > "2026-11-07");
  eq("no cell is dated after today", futureDated.length, 0);
  const todayCell = allCells.find((c) => c?.date === "2026-11-07");
  check("today is present and is not null", todayCell != null);
}

// Mid-week "today" leaves real future cells, and they must be null. 4 Nov 2026
// is a Wednesday, so Thursday through Saturday in that column are the future.
{
  const { weeks } = buildConsistencyCalendar([], {
    utc_offset_minutes: WIB,
    now_utc_ms: Date.parse("2026-11-04T12:00:00Z"),
    weeks: 2,
  });
  const lastCells = weeks[weeks.length - 1].cells;
  eq("Wednesday is index 3", lastCells[3]?.date, "2026-11-04");
  check("Thursday to Saturday are null in the current week",
    lastCells.slice(4).every((c) => c === null),
    JSON.stringify(lastCells.map((c) => (c ? c.date : null))));
}

// A custom week count must be honoured and clamped.
{
  eq("4 weeks requested", build([], { weeks: 4 }).weeks.length, 4);
  eq("zero weeks clamped to 1", build([], { weeks: 0 }).weeks.length, 1);
  eq("1000 weeks clamped to 106", build([], { weeks: 1000 }).weeks.length, 106);
}

/* ---------------------------------------------------------------- levels */

{
  const { weeks } = build([
    { start_date: "2026-11-01T02:00:00Z", distance: 5 },
    { start_date: "2026-11-02T02:00:00Z", distance: 20 },
    { start_date: "2026-11-03T02:00:00Z", distance: 50 },
    { start_date: "2026-11-04T02:00:00Z", distance: 120 },
  ]);
  const flat = weeks.flatMap((w) => w.cells).filter(Boolean);
  const level = (d) => flat.find((c) => c.date === d)?.level;
  eq("5 km is level 1", level("2026-11-01"), 1);
  eq("20 km is level 2", level("2026-11-02"), 2);
  eq("50 km is level 3", level("2026-11-03"), 3);
  eq("120 km is level 4", level("2026-11-04"), 4);
  check("thresholds exposed for the legend", LEVEL_THRESHOLDS_KM.length === 4);
}

// Two rides on one day add up, and the day counts once.
{
  const { weeks, stats } = build([
    { start_date: "2026-11-05T01:00:00Z", distance: 10 },
    { start_date: "2026-11-05T09:00:00Z", distance: 15 },
  ]);
  const cell = weeks.flatMap((w) => w.cells).filter(Boolean).find((c) => c.date === "2026-11-05");
  eq("two rides accumulate distance", cell.distance_km, 25);
  eq("two rides count as one day", cell.ride_count, 2);
  eq("active days counts the day once", stats.active_days, 1);
  eq("max day distance uses the sum", stats.max_day_km, 25);
}

/* ---------------------------------------------------------------- streaks */

{
  // Four consecutive days ending today: 4, 5, 6, 7 Nov.
  const days = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"].map((d) => ({
    start_date: `${d}T02:00:00Z`,
    distance: 10,
  }));
  const { stats } = build(days);
  eq("four consecutive days ending today", stats.current_streak, 4);
  eq("longest equals the only run", stats.longest_streak, 4);
}

{
  // Today empty, yesterday active: the streak is still alive, because the day
  // is not over. This is the case a naive implementation reads as zero.
  const days = ["2026-11-05", "2026-11-06"].map((d) => ({
    start_date: `${d}T02:00:00Z`,
    distance: 10,
  }));
  const { stats } = build(days);
  eq("today empty but yesterday active keeps the streak", stats.current_streak, 2);
}

{
  // Gap of two days: today and yesterday both empty, so the run is broken.
  const days = ["2026-11-01", "2026-11-02", "2026-11-03"].map((d) => ({
    start_date: `${d}T02:00:00Z`,
    distance: 10,
  }));
  const { stats } = build(days);
  eq("stale run does not carry forward", stats.current_streak, 0);
  eq("but it still counts as the longest", stats.longest_streak, 3);
}

{
  // Two runs, the longer one in the past.
  const days = [
    "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
    "2026-11-06", "2026-11-07",
  ].map((d) => ({ start_date: `${d}T02:00:00Z`, distance: 10 }));
  const { stats } = build(days);
  eq("longest streak picks the past run", stats.longest_streak, 5);
  eq("current streak is the recent run", stats.current_streak, 2);
}

{
  eq("no rides means no streak", build([]).stats.current_streak, 0);
  eq("no rides means no longest", build([]).stats.longest_streak, 0);
}

/* -------------------------------------------------------------- resilience */

{
  // Bad input must not become "today", which would inflate the streak.
  const { stats } = build([
    { start_date: null, distance: 10 },
    { start_date: "not a date", distance: 10 },
    { start_date: undefined, distance: 10 },
  ]);
  eq("unparseable dates are skipped", stats.active_days, 0);
  eq("unparseable dates do not create a streak", stats.current_streak, 0);
}

{
  // D1 can hand back NULL or a string for distance.
  const { stats } = build([
    { start_date: "2026-11-07T02:00:00Z", distance: null },
    { start_date: "2026-11-07T03:00:00Z", distance: "12.5" },
  ]);
  eq("string distance is parsed", stats.max_day_km, 12.5);
  eq("null distance counts as zero km but still an active day", stats.active_days, 1);
}

{
  // Negative and NaN distances must not subtract from the total.
  const { stats } = build([
    { start_date: "2026-11-07T02:00:00Z", distance: -50 },
    { start_date: "2026-11-06T02:00:00Z", distance: "abc" },
    { start_date: "2026-11-05T02:00:00Z", distance: 10 },
  ]);
  eq("negative distance ignored", stats.total_km, 10);
  eq("nan distance ignored", stats.max_day_km, 10);
}

/* ------------------------------------------------------------------- stats */

{
  const days = ["2026-11-04", "2026-11-06", "2026-11-07"].map((d) => ({
    start_date: `${d}T02:00:00Z`,
    distance: 10,
  }));
  const { stats } = build(days);
  eq("active days", stats.active_days, 3);
  eq("total km", stats.total_km, 30);
  eq("average over active days only", stats.average_active_day_km, 10);
  check("tracked days covers the window", stats.tracked_days > 300, `got ${stats.tracked_days}`);
  check("active weeks counts only weeks with a ride", stats.active_weeks >= 1 && stats.active_weeks <= 2,
    `got ${stats.active_weeks}`);
}

/* ---------------------------------------------------------------- helpers */

{
  eq("streak label zero", formatStreak(0), "Belum ada");
  eq("streak label one", formatStreak(1), "1 hari");
  eq("streak label many", formatStreak(12), "12 hari");
  eq("streak label garbage", formatStreak("abc"), "Belum ada");
  eq("streak label negative", formatStreak(-5), "Belum ada");
}

/* ------------------------------------------------------------------ report */

const total = pass + failures.length;
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(`\n${pass}/${total} assertions passed, ${failures.length} FAILED`);
  process.exit(1);
}
console.log(`${pass}/${total} assertions passed`);
