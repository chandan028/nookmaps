import { contextTypeForPlace } from "./categories";
import { distanceMeters, formatWalk, isValidLatLng, walkMinutes } from "./geo";
import { scorePlace, type RankingWeights } from "./ranking";
import { BadRequest, clampRadius } from "./request";
import {
  addMinutes,
  dayPart as dayPartOf,
  formatClock,
  isOpenAt,
  isOpenThrough,
  localTime,
  minutesUntilClose,
  type LocalTime,
} from "./time";
import type { Category, ContextType, DayPart, LatLng, Place } from "./types";

/**
 * Time-based plans (PRD §19, V3): "I have two hours, what should I do?"
 *
 * 1. Pick a template of stop slots for the time budget and the part of the day
 *    (coffee → activity → snack, activity → dinner → dessert…).
 * 2. Fill the slots in order, greedily: for each one take the best-ranked real
 *    place (ranking.ts, scored from the previous stop) that matches the slot,
 *    is reachable on foot, and stays open for the whole visit at the time
 *    you'd actually arrive.
 * 3. Re-plan a few times to drop slots nothing can fill and to squeeze stays
 *    when time runs out, keeping the fullest plan. Never exceed the budget.
 *
 * Deterministic, no AI. A non-zero `seed` ("Shuffle") swaps in 2nd/3rd-best picks.
 */

/* ---------- Budgets ---------- */

export const PLAN_MINUTES = [30, 60, 120, 240, 600] as const;
export type PlanMinutes = (typeof PLAN_MINUTES)[number];

export const PLAN_OPTIONS: { minutes: PlanMinutes; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 600, label: "Full day" },
];

export function isPlanMinutes(v: number): v is PlanMinutes {
  return (PLAN_MINUTES as readonly number[]).includes(v);
}

/**
 * Longest single walk between stops: about a quarter of the time you have,
 * capped at 25 min (40 for a full day, which can afford longer legs).
 */
export function maxWalkFor(budgetMinutes: number): number {
  if (budgetMinutes >= 480) return 40;
  return Math.min(25, Math.max(10, Math.round(budgetMinutes / 4)));
}

/** Search radius for the candidate pool. */
export function defaultPlanRadius(budgetMinutes: number): number {
  return budgetMinutes >= 480 ? 4000 : 2500;
}

/* ---------- How long people typically stay ---------- */

export interface StayRange {
  typical: number;
  min: number;
  max: number;
}

export const STAY_MINUTES: Record<Category, StayRange> = {
  coffee: { typical: 30, min: 15, max: 45 },
  dessert: { typical: 20, min: 10, max: 30 },
  bakery: { typical: 25, min: 15, max: 40 },
  food: { typical: 60, min: 35, max: 90 },
  bar: { typical: 60, min: 30, max: 90 },
  nightlife: { typical: 90, min: 45, max: 120 },
  cinema: { typical: 150, min: 120, max: 160 },
  entertainment: { typical: 75, min: 45, max: 120 },
  attraction: { typical: 60, min: 30, max: 120 },
  museum: { typical: 90, min: 45, max: 150 },
  park: { typical: 40, min: 20, max: 75 },
  outdoors: { typical: 45, min: 20, max: 90 },
  shopping: { typical: 45, min: 20, max: 90 },
  mall: { typical: 75, min: 30, max: 150 },
  hotel: { typical: 30, min: 15, max: 60 },
  gym: { typical: 60, min: 45, max: 90 },
  campus: { typical: 45, min: 20, max: 90 },
  workspace: { typical: 60, min: 30, max: 120 },
  other: { typical: 30, min: 15, max: 60 },
};

/* ---------- Templates ---------- */

export type MealKind = "breakfast" | "lunch" | "dinner" | "late";

export interface PlanSlot {
  /** Kind of stop, e.g. "coffee", "meal", "stroll". */
  id: string;
  /** What we call it. Meal stops are renamed by arrival time ("Early dinner"). */
  label: string;
  categories: Category[];
  /** Meals take about the same time whatever the venue, so they set their own stay. */
  stay?: StayRange;
  meal?: MealKind;
}

function slot(id: string, label: string, categories: Category[], stay?: StayRange): PlanSlot {
  return { id, label, categories, stay };
}

function meal(kind: MealKind, label: string, categories: Category[], stay: StayRange): PlanSlot {
  return { id: "meal", label, categories, stay, meal: kind };
}

const S = {
  coffee: slot("coffee", "Coffee", ["coffee", "bakery"]),
  treat: slot("treat", "Coffee or a treat", ["coffee", "dessert", "bakery"]),
  eveningTreat: slot("treat", "Something sweet", ["dessert", "coffee", "bakery"]),
  lateTreat: slot("treat", "Late-night treat", ["dessert", "food", "coffee"], { typical: 25, min: 15, max: 30 }),
  nightTreat: slot("treat", "Dessert or chai", ["dessert", "coffee", "bakery"]),
  sweet: slot("dessert", "Something sweet", ["dessert", "bakery"]),
  snack: slot("snack", "Snack break", ["bakery", "dessert", "coffee"], { typical: 25, min: 15, max: 35 }),
  bite: slot("bite", "Quick bite", ["food", "bakery"], { typical: 35, min: 20, max: 45 }),
  breakfast: meal("breakfast", "Breakfast", ["bakery", "coffee", "food"], { typical: 45, min: 25, max: 60 }),
  lunch: meal("lunch", "Lunch", ["food"], { typical: 60, min: 35, max: 75 }),
  dinner: meal("dinner", "Dinner", ["food"], { typical: 75, min: 45, max: 90 }),
  lateFood: meal("late", "Late-night food", ["food"], { typical: 45, min: 25, max: 60 }),
  stroll: slot("stroll", "Stroll", ["park", "outdoors"]),
  strollOrSweet: slot("wind-down", "Stroll or dessert", ["park", "outdoors", "dessert"]),
  explore: slot("explore", "Explore", ["park", "outdoors", "attraction", "museum"]),
  sights: slot("sights", "Sightseeing", ["attraction", "museum"]),
  activity: slot("activity", "Something to do", ["entertainment", "museum", "attraction", "shopping"]),
  eveningFun: slot("activity", "Something fun", ["entertainment", "cinema", "attraction"]),
  shopping: slot("shopping", "Browse the shops", ["shopping", "mall"]),
  shopOrPlay: slot("shopping", "Shops or games", ["shopping", "mall", "entertainment"]),
  drinks: slot("drinks", "Drinks", ["bar", "nightlife"]),
  nightlife: slot("nightlife", "Night out", ["nightlife", "bar"]),
  nightcap: slot("nightcap", "Drinks or dessert", ["bar", "nightlife", "dessert"]),
};

/**
 * Stop sequences per budget and part of the day (PRD §19): no breakfast at
 * night, bars only in the evening, a meal where a meal belongs.
 */
const TEMPLATES: Record<PlanMinutes, Record<DayPart, PlanSlot[]>> = {
  30: {
    morning: [S.coffee],
    lunch: [S.treat],
    afternoon: [S.treat],
    evening: [S.eveningTreat],
    night: [S.lateTreat],
  },
  60: {
    morning: [S.coffee, S.stroll],
    lunch: [S.bite, S.sweet],
    afternoon: [S.coffee, S.strollOrSweet],
    evening: [S.bite, S.sweet],
    night: [S.lateFood, S.nightTreat],
  },
  120: {
    morning: [S.breakfast, S.explore, S.snack],
    lunch: [S.lunch, S.activity, S.coffee],
    afternoon: [S.coffee, S.activity, S.snack],
    evening: [S.eveningFun, S.bite, S.sweet],
    night: [S.drinks, S.lateFood, S.nightTreat],
  },
  240: {
    morning: [S.breakfast, S.explore, S.shopping, S.lunch],
    lunch: [S.lunch, S.sights, S.shopping, S.coffee],
    afternoon: [S.activity, S.coffee, S.strollOrSweet, S.dinner],
    evening: [S.eveningFun, S.dinner, S.nightcap],
    night: [S.lateFood, S.drinks, S.nightTreat],
  },
  600: {
    morning: [S.breakfast, S.sights, S.lunch, S.stroll, S.shopOrPlay, S.snack, S.dinner, S.nightcap],
    lunch: [S.lunch, S.sights, S.coffee, S.stroll, S.shopOrPlay, S.dinner, S.nightcap],
    afternoon: [S.coffee, S.sights, S.stroll, S.shopOrPlay, S.dinner, S.eveningFun, S.nightcap],
    evening: [S.eveningFun, S.dinner, S.sweet, S.drinks, S.nightlife, S.lateFood],
    night: [S.lateFood, S.drinks, S.nightlife, S.nightTreat],
  },
};

export function planTemplate(budgetMinutes: PlanMinutes, part: DayPart): PlanSlot[] {
  return TEMPLATES[budgetMinutes][part];
}

/** Meals are named by when you'd actually sit down: lunch at 10:15 is an early lunch. */
export function mealLabel(kind: MealKind, t: LocalTime): string {
  const m = t.minute;
  const afterMidnight = m < 5 * 60;
  switch (kind) {
    case "breakfast":
      if (afterMidnight) return "Late-night food";
      if (m < 10 * 60 + 30) return "Breakfast";
      if (m < 12 * 60) return "Brunch";
      return mealLabel("lunch", t);
    case "lunch":
      if (afterMidnight) return "Late-night food";
      if (m < 11 * 60 + 30) return "Early lunch";
      if (m < 15 * 60 + 30) return "Lunch";
      if (m < 17 * 60) return "Late lunch";
      return mealLabel("dinner", t);
    case "dinner":
      if (afterMidnight || m >= 22 * 60 + 30) return "Late dinner";
      if (m < 17 * 60 + 30) return "Early dinner";
      return "Dinner";
    case "late":
      return "Late-night food";
  }
}

const LATE_ONLY: Category[] = ["bar", "nightlife"];

/** Bars and clubs only count from 5 PM until 5 AM. */
export function isLateHour(t: LocalTime): boolean {
  return t.minute >= 17 * 60 || t.minute < 5 * 60;
}

function slotCategoriesAt(s: PlanSlot, t: LocalTime): Category[] {
  return isLateHour(t) ? s.categories : s.categories.filter((c) => !LATE_ONLY.includes(c));
}

/* ---------- Plan model ---------- */

export interface PlanStop {
  /** Template slot kind, e.g. "coffee", "meal", "stroll". */
  slot: string;
  /** Position of the slot in the template (strictly increasing across stops). */
  slotIndex: number;
  /** "Coffee", "Dinner", "Stroll"… */
  label: string;
  /** The place's category that matched the slot. */
  category: Category;
  place: Place;
  /** Walk from the previous stop (or from the start). */
  walkMinutes: number;
  walkDistanceM: number;
  /** Minutes after the plan starts that you arrive. */
  startOffset: number;
  arrive: LocalTime;
  depart: LocalTime;
  stayMinutes: number;
  /** True when the place has no opening hours we can check. */
  hoursUnknown: boolean;
  /** e.g. "Open until 10 PM · 4.6★ · 6 min walk" */
  why: string;
  score: number;
}

export interface Plan {
  budgetMinutes: number;
  dayPart: DayPart;
  start: LocalTime;
  stops: PlanStop[];
  /** Walking plus time at each stop; never more than the budget. */
  totalMinutes: number;
  /** Local minute of the day (0–1439) when the last stop ends. */
  endsAtMinute: number;
  /** e.g. "Coffee → Stroll → Something sweet · 1 h 50 min" */
  summary: string;
  /** Template slots we couldn't fill with an open, reachable place. */
  skipped: string[];
}

export interface BuildPlanInput {
  origin: LatLng;
  places: Place[];
  nowMs: number;
  tzOffsetMinutes: number;
  budgetMinutes: PlanMinutes;
  /** Where the user is now (from detectContext); shapes the first stop's ranking. */
  context?: ContextType;
  weights?: RankingWeights;
  /** Place ids never to include, e.g. the venue the user is standing in. */
  exclude?: ReadonlySet<string> | readonly string[];
  /** 0 = best plan; any other value deterministically swaps in 2nd/3rd-best picks ("Shuffle"). */
  seed?: number;
}

/** Places with no hours can still be suggested, below ones we know are open. */
const UNKNOWN_HOURS_FACTOR = 0.85;
/** Prefer variety: a second stop of the same category ranks a little lower. */
const REPEAT_CATEGORY_FACTOR = 0.85;
/** Walk we keep in hand for each later slot, and expect per stop when sizing stays. */
const NOMINAL_WALK = 8;
const MIN_STRETCH = 0.6;
const MAX_STRETCH = 1.5;
/** Re-plan at most this many times (drop unfillable slots / squeeze stays). */
const MAX_PASSES = 6;
/** The provider's live open/closed flag only applies to the next few minutes. */
const LIVE_FLAG_WINDOW = 20;
/** Shuffle picks among the top N, if they're at least this good relative to the best. */
const SHUFFLE_POOL = 3;
const SHUFFLE_MIN_RATIO = 0.6;
const SHUFFLE_ATTEMPTS = 6;

/* ---------- Formatting ---------- */

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "10 PM", "10:30 PM" */
export function shortClock(minute: number): string {
  return formatClock(((minute % 1440) + 1440) % 1440).replace(":00 ", " ");
}

function whyText(place: Place, open: boolean | null, arrive: LocalTime, walk: number): string {
  const parts: string[] = [];
  if (open === null) parts.push("Hours unknown");
  else {
    const left = minutesUntilClose(place.openingHours, arrive);
    parts.push(left === null ? "Open 24 hours" : `Open until ${shortClock(arrive.minute + left)}`);
  }
  if (place.rating !== undefined) parts.push(`${place.rating.toFixed(1)}★`);
  parts.push(formatWalk(walk));
  return parts.join(" · ");
}

/* ---------- Planning ---------- */

const round5 = (n: number) => Math.round(n / 5) * 5;
const floor5 = (n: number) => Math.floor(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function stayRangeFor(s: PlanSlot, category: Category): StayRange {
  return s.stay ?? STAY_MINUTES[category];
}

/** Small deterministic PRNG so "Shuffle" is repeatable for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface IndexedSlot {
  s: PlanSlot;
  index: number;
}

interface Pass {
  stops: PlanStop[];
  elapsed: number;
  /** Slots left empty, and whether time (not a lack of open places) was the reason. */
  failed: { index: number; timeLimited: boolean }[];
}

interface Ctx {
  input: BuildPlanInput;
  pool: Place[];
  start: LocalTime;
  budget: number;
  cap: number;
}

/** Stretch or squeeze typical stays so the slots roughly fill the budget. */
function stretchFor(slots: IndexedSlot[], budget: number): number {
  const nominal = slots.reduce((sum, { s }) => sum + stayRangeFor(s, s.categories[0]).typical + NOMINAL_WALK, 0);
  return nominal > 0 ? clamp(budget / nominal, MIN_STRETCH, MAX_STRETCH) : 1;
}

function fillSlots(ctx: Ctx, slots: IndexedSlot[], stretch: number, seed: number): Pass {
  const { input, pool, start, budget, cap } = ctx;
  const rng = mulberry32(seed);
  let varied = false;
  const stops: PlanStop[] = [];
  const failed: Pass["failed"] = [];
  const used = new Set<string>();
  const usedCategories = new Set<Category>();
  let elapsed = 0;
  let prev: LatLng = input.origin;
  let prevContext: ContextType = input.context ?? "street";

  slots.forEach(({ s, index }, i) => {
    const remaining = budget - elapsed;
    // Keep enough time in hand for the shortest version of every later slot.
    const reserve = slots
      .slice(i + 1)
      .reduce((sum, later) => sum + stayRangeFor(later.s, later.s.categories[0]).min + NOMINAL_WALK, 0);

    let timeLimited = false;
    const candidates: {
      place: Place;
      category: Category;
      walk: number;
      distanceM: number;
      stay: number;
      arrive: LocalTime;
      open: boolean | null;
      score: number;
    }[] = [];

    for (const place of pool) {
      if (used.has(place.id)) continue;
      const distanceM = distanceMeters(prev, place);
      const walk = walkMinutes(distanceM);
      if (walk > cap) continue;
      const arrive = addMinutes(start, elapsed + walk);
      const category = place.categories.find((c) => slotCategoriesAt(s, arrive).includes(c));
      if (!category) continue;

      // The provider's live flag beats the weekly schedule for the next few minutes.
      const liveClosed = elapsed + walk <= LIVE_FLAG_WINDOW && place.currentlyOpen === false;
      const openAtArrival = liveClosed ? false : isOpenAt(place.openingHours, arrive);
      if (openAtArrival === false) continue;

      const range = stayRangeFor(s, category);
      const target = clamp(round5(range.typical * stretch), range.min, range.max);
      // Leave before closing time…
      const left = openAtArrival ? minutesUntilClose(place.openingHours, arrive) : null;
      const untilClose = left === null ? Infinity : floor5(left);
      if (untilClose < range.min) continue;
      // …and before the time runs out.
      const affordable = floor5(remaining - walk - reserve);
      if (affordable < range.min) {
        timeLimited = true;
        continue;
      }
      const stay = Math.min(target, untilClose, affordable);
      const open = isOpenThrough(place.openingHours, arrive, stay);
      if (open === false) continue;

      const scored = scorePlace(place, {
        origin: prev,
        context: prevContext,
        dayPart: dayPartOf(arrive),
        now: arrive,
        weights: input.weights,
      });
      const score =
        scored.score *
        (open === null ? UNKNOWN_HOURS_FACTOR : 1) *
        (usedCategories.has(category) ? REPEAT_CATEGORY_FACTOR : 1);
      candidates.push({ place, category, walk, distanceM, stay, arrive, open, score });
    }

    if (candidates.length === 0) {
      failed.push({ index, timeLimited });
      return;
    }
    candidates.sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : 1));

    let pick = 0;
    if (seed) {
      const options = candidates
        .slice(0, SHUFFLE_POOL)
        .filter((c) => c.score >= candidates[0].score * SHUFFLE_MIN_RATIO).length;
      // A shuffle always changes something: the first slot with a real alternative swaps.
      pick = !varied && options > 1 ? 1 + Math.floor(rng() * (options - 1)) : Math.floor(rng() * options);
      if (pick > 0) varied = true;
    }
    const c = candidates[pick];
    stops.push({
      slot: s.id,
      slotIndex: index,
      label: s.meal ? mealLabel(s.meal, c.arrive) : s.label,
      category: c.category,
      place: c.place,
      walkMinutes: c.walk,
      walkDistanceM: Math.round(c.distanceM),
      startOffset: elapsed + c.walk,
      arrive: c.arrive,
      depart: addMinutes(c.arrive, c.stay),
      stayMinutes: c.stay,
      hoursUnknown: c.open === null,
      why: whyText(c.place, c.open, c.arrive, c.walk),
      score: c.score,
    });
    elapsed += c.walk + c.stay;
    prev = c.place;
    prevContext = contextTypeForPlace(c.place);
    used.add(c.place.id);
    usedCategories.add(c.category);
  });

  return { stops, elapsed, failed };
}

/** More stops wins; then more of the budget used. */
function better(a: Pass, b: Pass): boolean {
  if (a.stops.length !== b.stops.length) return a.stops.length > b.stops.length;
  return a.elapsed > b.elapsed;
}

/** Linger at the last stop rather than end early, if it stays open. */
function useSlack(pass: Pass, slots: PlanSlot[], budget: number): Pass {
  const last = pass.stops[pass.stops.length - 1];
  if (!last || last.hoursUnknown) return pass;
  const range = stayRangeFor(slots[last.slotIndex], last.category);
  const left = minutesUntilClose(last.place.openingHours, last.arrive);
  const stay = Math.min(
    range.max,
    floor5(last.stayMinutes + budget - pass.elapsed),
    left === null ? Infinity : floor5(left),
  );
  if (stay <= last.stayMinutes) return pass;
  const extended: PlanStop = { ...last, stayMinutes: stay, depart: addMinutes(last.arrive, stay) };
  return {
    ...pass,
    stops: [...pass.stops.slice(0, -1), extended],
    elapsed: pass.elapsed + stay - last.stayMinutes,
  };
}

function planWithSeed(ctx: Ctx, template: PlanSlot[], seed: number): Pass {
  // Only plan slots something nearby could ever fill, so we don't hold time for them.
  let active: IndexedSlot[] = template
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => ctx.pool.some((p) => p.categories.some((c) => s.categories.includes(c))));
  let stretch = stretchFor(active, ctx.budget);
  let best: Pass | null = null;

  for (let pass = 0; pass < MAX_PASSES && active.length > 0; pass++) {
    const result = fillSlots(ctx, active, stretch, seed);
    if (!best || better(result, best)) best = result;
    if (result.failed.length === 0) break;
    const unfillable = new Set(result.failed.filter((f) => !f.timeLimited).map((f) => f.index));
    if (unfillable.size === 0 && stretch > MIN_STRETCH) {
      // Ran out of time: shorten every stay a little and try again.
      stretch = Math.max(MIN_STRETCH, stretch * 0.8);
      continue;
    }
    // Nothing open and reachable for these (or no time even for the shortest
    // visit): drop them and give their time to the other stops.
    const drop = unfillable.size > 0 ? unfillable : new Set(result.failed.map((f) => f.index));
    active = active.filter((a) => !drop.has(a.index));
    stretch = stretchFor(active, ctx.budget);
  }
  return useSlack(best ?? { stops: [], elapsed: 0, failed: [] }, template, ctx.budget);
}

function sameStops(a: Pass, b: Pass): boolean {
  return a.stops.length === b.stops.length && a.stops.every((s, i) => s.place.id === b.stops[i].place.id);
}

export function buildPlan(input: BuildPlanInput): Plan {
  const budget = input.budgetMinutes;
  const start = localTime(input.nowMs, input.tzOffsetMinutes);
  const part = dayPartOf(start);
  const excluded = new Set(input.exclude ?? []);
  const ctx: Ctx = {
    input,
    // Stable order whatever the provider returned, so plans are reproducible.
    pool: input.places
      .filter((p) => !excluded.has(p.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    start,
    budget,
    cap: maxWalkFor(budget),
  };
  const template = planTemplate(budget, part);

  let result = planWithSeed(ctx, template, 0);
  const seed = Math.abs(Math.floor(input.seed ?? 0));
  if (seed) {
    // Shuffle: the first alternative that differs, preferring one as full as the best plan.
    let fallback: Pass | null = null;
    for (let k = 0; k < SHUFFLE_ATTEMPTS; k++) {
      const alt = planWithSeed(ctx, template, seed + k * 7919);
      if (sameStops(alt, result)) continue;
      if (alt.stops.length >= result.stops.length) {
        fallback = alt;
        break;
      }
      if (!fallback || better(alt, fallback)) fallback = alt;
    }
    if (fallback) result = fallback;
  }

  const filled = new Set(result.stops.map((s) => s.slotIndex));
  const skipped = [...new Set(template.filter((_, i) => !filled.has(i)).map((s) => s.label))];
  return {
    budgetMinutes: budget,
    dayPart: part,
    start,
    stops: result.stops,
    totalMinutes: result.elapsed,
    endsAtMinute: addMinutes(start, result.elapsed).minute,
    summary: result.stops.length
      ? `${result.stops.map((st) => st.label).join(" → ")} · ${formatDuration(result.elapsed)}`
      : "",
    skipped,
  };
}

/* ---------- Request validation for POST /api/plan ---------- */

export interface PlanRequest {
  lat: number;
  lng: number;
  accuracyM: number;
  minutes: PlanMinutes;
  radiusM: number;
  seed: number;
  tzOffsetMinutes: number;
}

export function parsePlanRequest(body: unknown): PlanRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("Expected a JSON object");
  const b = body as Record<string, unknown>;
  const num = (key: string, fallback?: number): number => {
    const raw = b[key];
    if (raw === undefined || raw === null || raw === "") {
      if (fallback !== undefined) return fallback;
      throw new BadRequest(`Missing ${key}`);
    }
    const v = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(v)) throw new BadRequest(`Invalid ${key}`);
    return v;
  };
  const lat = num("lat");
  const lng = num("lng");
  if (!isValidLatLng(lat, lng)) throw new BadRequest("Invalid coordinates");
  const minutes = num("minutes");
  if (!isPlanMinutes(minutes)) throw new BadRequest(`minutes must be one of ${PLAN_MINUTES.join(", ")}`);
  return {
    lat,
    lng,
    accuracyM: clamp(num("acc", 30), 1, 10_000),
    minutes,
    radiusM: clampRadius(num("radius", defaultPlanRadius(minutes))),
    seed: clamp(Math.floor(Math.abs(num("seed", 0))), 0, 1_000_000),
    tzOffsetMinutes: clamp(num("tzo", 0), -14 * 60, 12 * 60),
  };
}

/** Shape returned by POST /api/plan. */
export interface PlanResponse {
  plan: Plan;
  minutes: PlanMinutes;
  seed: number;
  radiusM: number;
  provider: Place["provider"];
  contextType: ContextType;
  /** The venue the plan starts from, when we're confident the user is in one. */
  startingFrom: string | null;
}
