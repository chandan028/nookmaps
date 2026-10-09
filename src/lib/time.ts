import type { DayPart, OpeningHours, OpeningPeriod, Place } from "./types";

const MINUTES_PER_WEEK = 7 * 24 * 60;

/**
 * The user's local wall-clock time. `tzOffsetMinutes` follows
 * `Date#getTimezoneOffset()` (UTC − local, so India is −330).
 */
export interface LocalTime {
  day: number; // 0 = Sunday
  minute: number; // minutes since local midnight
}

export function localTime(nowMs: number, tzOffsetMinutes: number): LocalTime {
  const shifted = new Date(nowMs - tzOffsetMinutes * 60_000);
  return { day: shifted.getUTCDay(), minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/** PRD §10 day parts. */
export function dayPart(t: LocalTime): DayPart {
  const h = t.minute / 60;
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 15 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

export const DAY_PART_LABEL: Record<DayPart, string> = {
  morning: "this morning",
  lunch: "for lunch",
  afternoon: "this afternoon",
  evening: "this evening",
  night: "tonight",
};

function weekMinute(day: number, minute: number): number {
  return day * 24 * 60 + minute;
}

/** Is `t` within the period? Handles periods that wrap past Saturday night. */
function inPeriod(p: OpeningPeriod, wm: number): boolean {
  if (p.closeDay === undefined || p.closeMinute === undefined) return true; // 24h
  const open = weekMinute(p.openDay, p.openMinute);
  let close = weekMinute(p.closeDay, p.closeMinute);
  if (close <= open) close += MINUTES_PER_WEEK;
  const w = wm < open ? wm + MINUTES_PER_WEEK : wm;
  return w >= open && w < close;
}

export function isOpenAt(hours: OpeningHours | undefined, t: LocalTime): boolean | null {
  if (!hours || hours.periods.length === 0) return null;
  const wm = weekMinute(t.day, t.minute);
  return hours.periods.some((p) => inPeriod(p, wm));
}

/** Minutes until the place closes from `t`, or null if unknown / closed / 24h. */
export function minutesUntilClose(hours: OpeningHours | undefined, t: LocalTime): number | null {
  if (!hours) return null;
  const wm = weekMinute(t.day, t.minute);
  for (const p of hours.periods) {
    if (!inPeriod(p, wm)) continue;
    if (p.closeDay === undefined || p.closeMinute === undefined) return null;
    let close = weekMinute(p.closeDay, p.closeMinute);
    let w = wm;
    const open = weekMinute(p.openDay, p.openMinute);
    if (close <= open) close += MINUTES_PER_WEEK;
    if (w < open) w += MINUTES_PER_WEEK;
    return close - w;
  }
  return null;
}

/** Whether the place stays open for the whole window [t, t + durationMin). */
export function isOpenThrough(
  hours: OpeningHours | undefined,
  t: LocalTime,
  durationMin: number,
): boolean | null {
  const open = isOpenAt(hours, t);
  if (open !== true) return open;
  const left = minutesUntilClose(hours, t);
  return left === null ? true : left >= durationMin;
}

export function addMinutes(t: LocalTime, minutes: number): LocalTime {
  const total = (((weekMinute(t.day, t.minute) + minutes) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) %
    MINUTES_PER_WEEK;
  return { day: Math.floor(total / 1440), minute: total % 1440 };
}

/** Prefer the provider's live flag; fall back to computing from hours. */
export function openNow(place: Place, t: LocalTime): boolean | null {
  if (typeof place.currentlyOpen === "boolean") return place.currentlyOpen;
  return isOpenAt(place.openingHours, t);
}

export function formatClock(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

/** "Closes 10:00 PM" / "Opens 8:00 AM" style hint for the detail view. */
export function openStatusText(place: Place, t: LocalTime): string | null {
  const open = openNow(place, t);
  if (open === null) return null;
  const hours = place.openingHours;
  if (open) {
    const left = minutesUntilClose(hours, t);
    if (left === null) return hours?.periods.some((p) => p.closeDay === undefined) ? "Open 24 hours" : "Open now";
    if (left <= 60) return `Closing soon · ${formatClock((t.minute + left) % 1440)}`;
    return `Open · closes ${formatClock((t.minute + left) % 1440)}`;
  }
  const next = nextOpening(hours, t);
  return next === null ? "Closed" : `Closed · opens ${formatClock(next.minute)}${next.day !== t.day ? ` ${DAY_SHORT[next.day]}` : ""}`;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nextOpening(hours: OpeningHours | undefined, t: LocalTime): LocalTime | null {
  if (!hours || hours.periods.length === 0) return null;
  const wm = weekMinute(t.day, t.minute);
  let best: number | null = null;
  for (const p of hours.periods) {
    let o = weekMinute(p.openDay, p.openMinute);
    if (o <= wm) o += MINUTES_PER_WEEK;
    if (best === null || o < best) best = o;
  }
  if (best === null) return null;
  best %= MINUTES_PER_WEEK;
  return { day: Math.floor(best / 1440), minute: best % 1440 };
}

/* ---------- OSM `opening_hours` parsing (common subset) ---------- */

const OSM_DAYS: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

function parseClock(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function expandDays(spec: string): number[] | null {
  const days = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.trim().split("-");
    if (range.length === 1) {
      const d = OSM_DAYS[range[0]];
      if (d === undefined) return null;
      days.add(d);
    } else if (range.length === 2) {
      const a = OSM_DAYS[range[0]];
      const b = OSM_DAYS[range[1]];
      if (a === undefined || b === undefined) return null;
      for (let d = a; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === b) break;
      }
    } else return null;
  }
  return [...days];
}

/**
 * Parses the most common OSM `opening_hours` forms, e.g. `24/7`,
 * `Mo-Fr 08:00-22:00; Sa,Su 09:00-23:30`, `08:00-02:00`. Rules we don't
 * understand (public holidays, months, "off" exceptions) are skipped, and
 * when nothing parses we return undefined so the UI shows "hours unknown"
 * rather than a wrong status.
 */
export function parseOsmOpeningHours(raw: string | undefined): OpeningHours | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (text === "24/7") {
    return { raw, periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ openDay: d, openMinute: 0 })) };
  }
  const periods: OpeningPeriod[] = [];
  for (const rule of text.split(";")) {
    const r = rule.trim();
    if (!r || /\b(PH|SH|off|closed|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(r)) {
      continue;
    }
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)[A-Za-z,\- ]*?)?\s*([\d:,\- +]+)$/.exec(r);
    if (!m) continue;
    const days = m[1] ? expandDays(m[1].replace(/\s+/g, "")) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) continue;
    for (const span of m[2].split(",")) {
      const [a, b] = span.split("-");
      if (!a || !b) continue;
      const open = parseClock(a);
      let close = parseClock(b.replace("+", ""));
      if (open === null || close === null) continue;
      if (close === 24 * 60) close = 0;
      for (const d of days) {
        const closeDay = close <= open ? (d + 1) % 7 : d;
        periods.push({ openDay: d, openMinute: open, closeDay, closeMinute: close });
      }
    }
  }
  return periods.length ? { raw, periods } : undefined;
}
