import { describe, expect, it } from "vitest";
import { distanceMeters, walkMinutes } from "@/lib/geo";
import {
  buildPlan,
  defaultPlanRadius,
  formatDuration,
  isLateHour,
  maxWalkFor,
  mealLabel,
  parsePlanRequest,
  planTemplate,
  PLAN_MINUTES,
  shortClock,
  type BuildPlanInput,
  type Plan,
  type PlanMinutes,
} from "@/lib/planner";
import { demoPlaces } from "@/lib/providers/demo";
import { BadRequest } from "@/lib/request";
import { addMinutes, dayPart, isOpenThrough, localTime } from "@/lib/time";
import type { LatLng, Place } from "@/lib/types";

const origin = { lat: 12.9784, lng: 77.6408 };
const TZ = -330; // India
/** Friday 9 Oct 2026 at local h:m in India. */
const at = (h: number, m = 0) => Date.UTC(2026, 9, 9, h, m) + TZ * 60_000;

const TIMES = {
  dawn: at(6, 30),
  morning: at(8),
  lunch: at(12, 30),
  afternoon: at(15, 30),
  evening: at(20),
  late: at(23, 30),
  night: at(3),
};

const places = demoPlaces(origin);
const byName = (prefix: string) => places.find((p) => p.name.startsWith(prefix))!;

function plan(nowMs: number, budgetMinutes: PlanMinutes, extra: Partial<BuildPlanInput> = {}): Plan {
  return buildPlan({ origin, places, nowMs, tzOffsetMinutes: TZ, budgetMinutes, ...extra });
}

/** Every invariant a plan must hold, whatever the inputs. */
function expectValid(p: Plan, nowMs: number, from: LatLng = origin) {
  const start = localTime(nowMs, TZ);
  expect(p.start).toEqual(start);
  expect(p.dayPart).toBe(dayPart(start));
  expect(p.totalMinutes).toBeLessThanOrEqual(p.budgetMinutes);
  expect(new Set(p.stops.map((s) => s.place.id)).size).toBe(p.stops.length);

  const template = planTemplate(p.budgetMinutes as PlanMinutes, p.dayPart);
  let prev: LatLng = from;
  let elapsed = 0;
  let lastSlot = -1;
  for (const s of p.stops) {
    // Walking is measured from the previous stop, and capped.
    expect(s.walkMinutes).toBe(walkMinutes(distanceMeters(prev, s.place)));
    expect(s.walkMinutes).toBeLessThanOrEqual(maxWalkFor(p.budgetMinutes));
    // Times add up.
    expect(s.startOffset).toBe(elapsed + s.walkMinutes);
    expect(s.arrive).toEqual(addMinutes(start, s.startOffset));
    expect(s.depart).toEqual(addMinutes(s.arrive, s.stayMinutes));
    expect(s.stayMinutes).toBeGreaterThan(0);
    // Open for the whole visit.
    const open = isOpenThrough(s.place.openingHours, s.arrive, s.stayMinutes);
    expect(open).not.toBe(false);
    expect(s.hoursUnknown).toBe(open === null);
    // Slots are filled in template order with a matching category.
    expect(s.slotIndex).toBeGreaterThan(lastSlot);
    expect(template[s.slotIndex].id).toBe(s.slot);
    expect(template[s.slotIndex].categories).toContain(s.category);
    expect(s.place.categories).toContain(s.category);
    // Bars and clubs only in the evening.
    if (s.category === "bar" || s.category === "nightlife") expect(isLateHour(s.arrive)).toBe(true);
    expect(s.why).toMatch(/^(Open until \d{1,2}(:\d\d)? [AP]M|Open 24 hours|Hours unknown) · (\d\.\d★ · )?\d+ min walk$/);

    lastSlot = s.slotIndex;
    elapsed += s.walkMinutes + s.stayMinutes;
    prev = s.place;
  }
  expect(p.totalMinutes).toBe(elapsed);
  expect(p.endsAtMinute).toBe(addMinutes(start, elapsed).minute);
  if (p.stops.length) expect(p.summary.startsWith(p.stops[0].label)).toBe(true);
  else expect(p.summary).toBe("");
}

const ids = (p: Plan) => p.stops.map((s) => s.place.id);

describe("planner", () => {
  it("fits the budget and keeps every stop open, for every budget, time of day and shuffle", () => {
    for (const nowMs of Object.values(TIMES)) {
      for (const minutes of PLAN_MINUTES) {
        for (const seed of [0, 1, 2, 7]) {
          expectValid(plan(nowMs, minutes, { seed }), nowMs);
        }
      }
    }
  });

  it("makes 30 minutes a single coffee or treat stop", () => {
    for (const nowMs of [TIMES.morning, TIMES.lunch, TIMES.afternoon, TIMES.evening]) {
      const p = plan(nowMs, 30);
      expect(p.stops).toHaveLength(1);
      expect(["coffee", "dessert", "bakery"]).toContain(p.stops[0].category);
      expect(p.totalMinutes).toBeGreaterThanOrEqual(15);
    }
    expect(plan(TIMES.morning, 30).stops[0].slot).toBe("coffee");
  });

  it("strings a full day together in template order", () => {
    const p = plan(TIMES.morning, 600);
    expect(p.stops.length).toBeGreaterThanOrEqual(6);
    expect(p.totalMinutes).toBeGreaterThanOrEqual(8 * 60);
    expect(p.stops[0].label).toBe("Breakfast");
    const slots = p.stops.map((s) => s.slot);
    expect(slots.indexOf("sights")).toBeGreaterThan(0);
    expect(slots.indexOf("stroll")).toBeGreaterThan(slots.indexOf("sights"));
    expect(slots.filter((s) => s === "meal").length).toBeGreaterThanOrEqual(2);
    // A full day can afford longer walks than a short plan.
    expect(Math.max(...p.stops.map((s) => s.walkMinutes))).toBeGreaterThan(maxWalkFor(240));
  });

  it("uses most of the time it is given", () => {
    for (const minutes of [60, 120, 240, 600] as const) {
      const p = plan(TIMES.lunch, minutes);
      expect(p.totalMinutes).toBeGreaterThanOrEqual(minutes * 0.8);
    }
  });

  it("adapts the sequence to the time of day", () => {
    expect(planTemplate(120, "morning")).not.toEqual(planTemplate(120, "evening"));

    const morning = plan(TIMES.morning, 120);
    const evening = plan(TIMES.evening, 120);
    expect(morning.stops[0].label).toBe("Breakfast");
    expect(evening.stops.map((s) => s.label)).not.toContain("Breakfast");
    expect(evening.stops[0].slot).toBe("activity");
    expect(ids(morning)).not.toEqual(ids(evening));

    // Nightlife only after dark; breakfast never at night.
    const all = [TIMES.morning, TIMES.lunch].flatMap((t) => PLAN_MINUTES.map((m) => plan(t, m)));
    expect(all.flatMap((p) => p.stops).some((s) => s.category === "nightlife" && !isLateHour(s.arrive))).toBe(false);
    const late = PLAN_MINUTES.map((m) => plan(TIMES.late, m));
    expect(late.flatMap((p) => p.stops).some((s) => s.label === "Breakfast")).toBe(false);
    // An evening out ends with drinks.
    expect(plan(TIMES.evening, 600).stops.some((s) => ["bar", "nightlife"].includes(s.category))).toBe(true);
  });

  it("names meals by when you sit down", () => {
    const t = (h: number, m = 0) => ({ day: 5, minute: h * 60 + m });
    expect(mealLabel("breakfast", t(8))).toBe("Breakfast");
    expect(mealLabel("breakfast", t(11))).toBe("Brunch");
    expect(mealLabel("lunch", t(10, 15))).toBe("Early lunch");
    expect(mealLabel("lunch", t(13))).toBe("Lunch");
    expect(mealLabel("dinner", t(16))).toBe("Early dinner");
    expect(mealLabel("dinner", t(20))).toBe("Dinner");
    expect(mealLabel("dinner", t(23))).toBe("Late dinner");
    expect(mealLabel("late", t(1))).toBe("Late-night food");
  });

  it("never suggests places that are closed when you'd get there", () => {
    // The rooftop bar opens at 5 PM.
    for (const m of PLAN_MINUTES) expect(ids(plan(TIMES.morning, m))).not.toContain(byName("Skyye").id);
    // At 3 AM only the 24-hour chai stall is open.
    for (const m of PLAN_MINUTES) {
      expect(plan(TIMES.night, m).stops.every((s) => s.place.name.startsWith("Chai Point"))).toBe(true);
    }
  });

  it("leaves before closing time", () => {
    const corner = byName("Corner House");
    const closesSoon: Place = {
      ...corner,
      openingHours: {
        periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ openDay: d, openMinute: 8 * 60, closeDay: d, closeMinute: 20 * 60 + 20 })),
      },
    };
    const p = buildPlan({ origin, places: [closesSoon], nowMs: TIMES.evening, tzOffsetMinutes: TZ, budgetMinutes: 60 });
    expect(p.stops).toHaveLength(1);
    const [s] = p.stops;
    expect(s.depart.minute).toBeLessThanOrEqual(20 * 60 + 20);
    expect(s.why).toMatch(/^Open until 8:20 PM/);
  });

  it("never repeats a place and respects exclusions", () => {
    const chai = byName("Chai Point").id;
    for (const nowMs of Object.values(TIMES)) {
      for (const m of PLAN_MINUTES) {
        const p = plan(nowMs, m, { exclude: [chai] });
        expect(ids(p)).not.toContain(chai);
        expect(new Set(ids(p)).size).toBe(p.stops.length);
      }
    }
    expect(ids(plan(TIMES.morning, 600, { exclude: new Set([chai]) }))).not.toContain(chai);
  });

  it("is deterministic and ignores provider order", () => {
    const a = plan(TIMES.afternoon, 240);
    const b = plan(TIMES.afternoon, 240);
    expect(b).toEqual(a);
    const reversed = buildPlan({
      origin,
      places: [...places].reverse(),
      nowMs: TIMES.afternoon,
      tzOffsetMinutes: TZ,
      budgetMinutes: 240,
    });
    expect(ids(reversed)).toEqual(ids(a));
  });

  it("shuffles to a different but equally valid plan", () => {
    const cases: [number, PlanMinutes][] = [
      [TIMES.morning, 120],
      [TIMES.lunch, 120],
      [TIMES.afternoon, 240],
      [TIMES.evening, 240],
      [TIMES.morning, 600],
    ];
    for (const [nowMs, minutes] of cases) {
      const base = plan(nowMs, minutes);
      for (const seed of [1, 2, 3]) {
        const shuffled = plan(nowMs, minutes, { seed });
        expectValid(shuffled, nowMs);
        expect(ids(shuffled)).not.toEqual(ids(base));
        expect(shuffled.stops.length).toBeGreaterThanOrEqual(base.stops.length);
        // Same seed, same plan.
        expect(ids(plan(nowMs, minutes, { seed }))).toEqual(ids(shuffled));
      }
    }
  });

  it("ranks places with unknown hours lower and flags them", () => {
    const corner = byName("Corner House");
    // Same place, same spot, but we don't know when it's open.
    const mystery: Place = { ...corner, id: "demo:mystery", name: "Mystery Desserts", openingHours: undefined };
    const both = [mystery, corner];
    const p = buildPlan({ origin, places: both, nowMs: TIMES.evening, tzOffsetMinutes: TZ, budgetMinutes: 30 });
    expect(p.stops[0].place.id).toBe(corner.id);
    expect(p.stops[0].hoursUnknown).toBe(false);

    const onlyMystery = buildPlan({
      origin,
      places: both,
      nowMs: TIMES.evening,
      tzOffsetMinutes: TZ,
      budgetMinutes: 30,
      exclude: [corner.id],
    });
    expect(onlyMystery.stops[0].place.id).toBe("demo:mystery");
    expect(onlyMystery.stops[0].hoursUnknown).toBe(true);
    expect(onlyMystery.stops[0].why).toMatch(/^Hours unknown · 4\.6★ · \d+ min walk$/);
  });

  it("trusts a live 'closed' flag for the first stop", () => {
    const closedToday = places.map((p) => (p.categories.includes("dessert") ? { ...p, currentlyOpen: false } : p));
    const p = buildPlan({ origin, places: closedToday, nowMs: TIMES.evening, tzOffsetMinutes: TZ, budgetMinutes: 30 });
    expect(p.stops[0].category).not.toBe("dessert");
  });

  it("returns an empty plan when nothing fits", () => {
    const empty = buildPlan({ origin, places: [], nowMs: TIMES.lunch, tzOffsetMinutes: TZ, budgetMinutes: 120 });
    expect(empty.stops).toEqual([]);
    expect(empty.totalMinutes).toBe(0);
    expect(empty.summary).toBe("");
    expect(empty.skipped.length).toBeGreaterThan(0);

    const onlyBar = buildPlan({ origin, places: [byName("Skyye")], nowMs: TIMES.morning, tzOffsetMinutes: TZ, budgetMinutes: 240 });
    expect(onlyBar.stops).toEqual([]);
  });

  it("summarises the plan", () => {
    const p = plan(TIMES.lunch, 120);
    expect(p.summary).toBe(`${p.stops.map((s) => s.label).join(" → ")} · ${formatDuration(p.totalMinutes)}`);
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(115)).toBe("1 h 55 min");
    expect(shortClock(22 * 60)).toBe("10 PM");
    expect(shortClock(21 * 60 + 30)).toBe("9:30 PM");
    expect(shortClock(24 * 60 + 90)).toBe("1:30 AM");
  });
});

describe("plan request validation", () => {
  it("accepts a valid body and fills defaults", () => {
    const r = parsePlanRequest({ lat: 12.97, lng: 77.64, minutes: 120, tzo: -330 });
    expect(r).toEqual({
      lat: 12.97,
      lng: 77.64,
      accuracyM: 30,
      minutes: 120,
      radiusM: 2500,
      seed: 0,
      tzOffsetMinutes: -330,
    });
    expect(parsePlanRequest({ lat: 1, lng: 2, minutes: 600 }).radiusM).toBe(defaultPlanRadius(600));
    expect(defaultPlanRadius(600)).toBe(4000);
    expect(parsePlanRequest({ lat: "1", lng: "2", minutes: "60", seed: 3.7 }).seed).toBe(3);
    expect(parsePlanRequest({ lat: 1, lng: 2, minutes: 60, radius: 99999, tzo: 9999 })).toMatchObject({
      radiusM: 5000,
      tzOffsetMinutes: 720,
    });
  });

  it("rejects bad input", () => {
    expect(() => parsePlanRequest(null)).toThrow(BadRequest);
    expect(() => parsePlanRequest([1, 2])).toThrow(BadRequest);
    expect(() => parsePlanRequest({ lng: 2, minutes: 60 })).toThrow(/Missing lat/);
    expect(() => parsePlanRequest({ lat: 95, lng: 2, minutes: 60 })).toThrow(/Invalid coordinates/);
    expect(() => parsePlanRequest({ lat: 1, lng: 2, minutes: 45 })).toThrow(/minutes must be one of/);
    expect(() => parsePlanRequest({ lat: 1, lng: 2 })).toThrow(/Missing minutes/);
    expect(() => parsePlanRequest({ lat: 1, lng: 2, minutes: 60, acc: "abc" })).toThrow(/Invalid acc/);
  });
});
