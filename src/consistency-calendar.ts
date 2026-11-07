/**
 * Consistency calendar: one cell per day, GitHub contribution style.
 *
 * Why a separate pure module: the existing /heatmap answers "where do I ride",
 * this answers "when do I ride". The two are easy to confuse, and the numbers
 * (streaks especially) are the kind people screenshot, so they should be
 * testable with nothing but an array of rides and no database.
 *
 * The timezone is the part most likely to be wrong, so it is explicit input
 * rather than something read from the machine. A ride stored at 23:30 UTC is
 * 06:30 the next morning in Jakarta and belongs to that morning. Grouping by
 * the UTC date would push it back a day and quietly break every streak.
 *
 * This module imports nothing so the test can load it through Node's
 * TypeScript type stripping.
 */

/** One ride, reduced to the fields the calendar needs. */
export type RideDayInput = {
  start_date: unknown;
  distance?: unknown;
};

export type DayCell = {
  /** Local date, always YYYY-MM-DD. */
  date: string;
  distance_km: number;
  ride_count: number;
  /** 0 means no ride that day. 1..4 are increasing intensity. */
  level: number;
};

export type CalendarWeek = {
  /** Local date of the Sunday that starts this column. */
  week_start: string;
  /** Exactly 7 entries, Sunday first. null means "outside the rendered range". */
  cells: (DayCell | null)[];
};

export type ConsistencyStats = {
  /** Days that have at least one ride. */
  active_days: number;
  /** Days in the rendered window, not counting days after today. */
  tracked_days: number;
  /** Consecutive active days ending today, or ending yesterday when today is
   *  still empty. Zero when the run is broken before that. */
  current_streak: number;
  /** Longest run of consecutive active days anywhere in the data. */
  longest_streak: number;
  total_km: number;
  max_day_km: number;
  /** Mean distance over active days only, so rest days do not drag it down. */
  average_active_day_km: number;
  /** Weeks inside the window that contain at least one ride. */
  active_weeks: number;
};

export type CalendarResult = {
  weeks: CalendarWeek[];
  stats: ConsistencyStats;
  /** Upper bound of the lowest non-zero level, for the legend. */
  level_thresholds_km: number[];
};

const DAY_MS = 86400000;

/** Noon-based day number, so a 23:59 timestamp cannot round into the next day. */
const toDayNumber = (utcMs: number, offsetMinutes: number) =>
  Math.floor((utcMs + offsetMinutes * 60000) / DAY_MS);

const dayNumberToISO = (dayNumber: number) =>
  new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);

/** Date -> day number for an ISO date string, avoiding local-time parsing. */
const isoToDayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
};

const safeKm = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Intensity thresholds. Absolute distances rather than quartiles, because a
 * calendar has to stay readable when a single 120 km day appears next to a
 * month of 5 km spins: quartiles would rescale every week and make two
 * screenshots impossible to compare.
 */
export const LEVEL_THRESHOLDS_KM = [1, 15, 35, 70];

const levelForKm = (km: number) => {
  if (km <= 0) return 0;
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS_KM.length; i++) {
    if (km >= LEVEL_THRESHOLDS_KM[i]) level = i + 1;
  }
  return Math.min(level, 4);
};

export type BuildCalendarOptions = {
  /** Minutes east of UTC. Jakarta is 420. Defaults to 420. */
  utc_offset_minutes?: number;
  /** "Today" as a UTC instant, injected so tests are not clock-dependent. */
  now_utc_ms?: number;
  /** How many weeks to render, ending with the current week. Defaults to 53. */
  weeks?: number;
};

export const buildConsistencyCalendar = (
  rides: RideDayInput[],
  options: BuildCalendarOptions = {},
): CalendarResult => {
  const offset = Number.isFinite(Number(options.utc_offset_minutes))
    ? Number(options.utc_offset_minutes)
    : 420;
  const nowMs = Number.isFinite(Number(options.now_utc_ms))
    ? Number(options.now_utc_ms)
    : Date.now();
  // `|| 53` would swallow a deliberate 0 and silently render 53 weeks, so the
  // default is applied only when the option is genuinely absent or unusable.
  const requestedWeeks = Number(options.weeks);
  const weekCount = Math.min(
    Math.max(Number.isFinite(requestedWeeks) ? Math.trunc(requestedWeeks) : 53, 1),
    106,
  );

  const todayNumber = toDayNumber(nowMs, offset);

  // Aggregate rides into local days. A ride whose date cannot be parsed is
  // skipped rather than counted as today, because silently crediting it to
  // today would inflate the current streak.
  const perDay = new Map<number, { km: number; count: number }>();
  for (const ride of rides) {
    if (!ride) continue;
    const raw = ride.start_date;
    const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw ?? ""));
    if (!Number.isFinite(ms)) continue;
    const dayNumber = toDayNumber(ms, offset);
    const entry = perDay.get(dayNumber) ?? { km: 0, count: 0 };
    entry.km += safeKm(ride.distance);
    entry.count += 1;
    perDay.set(dayNumber, entry);
  }

  // The grid ends with the week containing today, and starts on a Sunday.
  // Sundays are day number multiples of 7 (day 0 is 1970-01-01, a Thursday),
  // so shift by 4 to make the week start on Sunday.
  const sundayIndex = (dayNumber: number) => {
    const weekday = (((dayNumber + 4) % 7) + 7) % 7; // 0 = Sunday
    return dayNumber - weekday;
  };

  const lastSunday = sundayIndex(todayNumber);
  const firstSunday = lastSunday - (weekCount - 1) * 7;

  const weeks: CalendarWeek[] = [];
  let activeDays = 0;
  let trackedDays = 0;
  let totalKm = 0;
  let maxDayKm = 0;
  let activeWeeks = 0;

  for (let w = 0; w < weekCount; w++) {
    const weekStartNumber = firstSunday + w * 7;
    const cells: (DayCell | null)[] = [];
    let weekHasRide = false;

    for (let d = 0; d < 7; d++) {
      const dayNumber = weekStartNumber + d;
      if (dayNumber > todayNumber) {
        // Future day: blank, not a zero. A zero would read as "rest day" and
        // claim knowledge about days that have not happened yet.
        cells.push(null);
        continue;
      }
      const entry = perDay.get(dayNumber);
      const km = entry ? entry.km : 0;
      if (entry) {
        activeDays += 1;
        totalKm += km;
        if (km > maxDayKm) maxDayKm = km;
        weekHasRide = true;
      }
      trackedDays += 1;
      cells.push({
        date: dayNumberToISO(dayNumber),
        distance_km: Math.round(km * 100) / 100,
        ride_count: entry ? entry.count : 0,
        level: levelForKm(km),
      });
    }

    if (weekHasRide) activeWeeks += 1;
    weeks.push({ week_start: dayNumberToISO(weekStartNumber), cells });
  }

  // Longest streak over the whole dataset, not only the rendered window, so the
  // personal best does not disappear when an old run scrolls out of view.
  const sortedDays = [...perDay.keys()].sort((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  let previous: number | null = null;
  for (const dayNumber of sortedDays) {
    run = previous !== null && dayNumber === previous + 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    previous = dayNumber;
  }

  // Current streak walks backwards from today. When today is still empty the
  // run may start yesterday, because the day is not over; once yesterday is
  // also empty the streak is broken and must read zero rather than carrying
  // an old run forward.
  let currentStreak = 0;
  let cursor = perDay.has(todayNumber) ? todayNumber : todayNumber - 1;
  while (perDay.has(cursor)) {
    currentStreak += 1;
    cursor -= 1;
  }

  const stats: ConsistencyStats = {
    active_days: activeDays,
    tracked_days: trackedDays,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    total_km: Math.round(totalKm * 100) / 100,
    max_day_km: Math.round(maxDayKm * 100) / 100,
    average_active_day_km:
      activeDays > 0 ? Math.round((totalKm / activeDays) * 100) / 100 : 0,
    active_weeks: activeWeeks,
  };

  return { weeks, stats, level_thresholds_km: LEVEL_THRESHOLDS_KM };
};

/** Short label for a streak, because "1 hari" reads better than "1 hari berturut". */
export const formatStreak = (days: unknown) => {
  const n = Math.max(0, Math.trunc(Number(days) || 0));
  if (n === 0) return "Belum ada";
  if (n === 1) return "1 hari";
  return `${n} hari`;
};
