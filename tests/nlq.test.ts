import { describe, expect, it } from "vitest";
import { answerAsk, parseAskRequest } from "@/lib/ask";
import { hasAny } from "@/lib/categories";
import {
  applyConstraints,
  applyConstraintsWithFallback,
  formatDuration,
  lateWindow,
  loosenTips,
  numberWordsToDigits,
  parseQuery,
  priceLevelForBudget,
  startTime,
  visitMinutes,
  type Constraints,
} from "@/lib/nlq";
import { demoPlaces } from "@/lib/providers/demo";
import { rankPlaces } from "@/lib/ranking";
import { BadRequest } from "@/lib/request";
import { addMinutes, isOpenAt, type LocalTime } from "@/lib/time";
import type { Place, ScoredPlace } from "@/lib/types";

const origin = { lat: 12.9784, lng: 77.6408 };
const places = demoPlaces(origin);
// Friday in India (UTC+5:30, tzo -330).
const FRIDAY_8PM = Date.UTC(2026, 9, 9, 14, 30);
const FRIDAY_10AM = Date.UTC(2026, 9, 9, 4, 30);
const FRI = 5;
const at = (hour: number, minute = 0): LocalTime => ({ day: FRI, minute: hour * 60 + minute });

function ranked(now: LocalTime, from: Place[] = places): ScoredPlace[] {
  return rankPlaces({ origin, places: from, context: "street", dayPart: "evening", now });
}

function named(results: ScoredPlace[]): string[] {
  return results.map((s) => s.place.name.replace(" (demo)", ""));
}

function base(overrides: Partial<Constraints> = {}): Constraints {
  return {
    includeCategories: [],
    explicitCategories: [],
    excludeCategories: [],
    moods: [],
    openNow: true,
    openLate: false,
    explanation: [],
    ...overrides,
  };
}

describe("parseQuery — PRD §20 examples", () => {
  it("I have ₹500 and two hours", () => {
    const c = parseQuery("I have ₹500 and two hours");
    expect(c.budget).toEqual({ amount: 500, currency: "INR", people: 1, perPerson: 500 });
    expect(c.maxPriceLevel).toBe(2);
    expect(c.timeMinutes).toBe(120);
    expect(c.includeCategories).toEqual([]);
    expect(c.excludeCategories).toEqual([]);
    expect(c.openNow).toBe(true);
    expect(c.explanation).toEqual(["Budget ≤ ₹500 (≈ ₹₹)", "2 hours"]);
    expect(c.unknownWords).toBeUndefined();
  });

  it("I want something fun nearby but not food", () => {
    const c = parseQuery("I want something fun nearby but not food");
    expect(c.moods).toEqual(["fun"]);
    expect(c.includeCategories).toEqual(["entertainment", "cinema", "nightlife", "attraction"]);
    expect(c.excludeCategories).toEqual(expect.arrayContaining(["food", "bakery", "dessert"]));
    expect(c.maxWalkMinutes).toBe(10);
    expect(c.walkIsApproximate).toBe(true);
    expect(c.explanation).toEqual(["Fun things", "Nearby (≤ 10 min walk)", "Not food"]);
  });
});

describe("parseQuery — budgets and currencies", () => {
  it.each([
    ["₹250 for a snack", "INR", 250, 1],
    ["Rs. 1,500", "INR", 1500, 3],
    ["rs500", "INR", 500, 2],
    ["500 rupees", "INR", 500, 2],
    ["five hundred rupees", "INR", 500, 2],
    ["INR 5000", "INR", 5000, 4],
    ["₹2k", "INR", 2000, 3],
    ["$12", "USD", 12, 1],
    ["20 bucks", "USD", 20, 2],
    ["50 dollars", "USD", 50, 3],
    ["€30", "EUR", 30, 2],
    ["£10", "GBP", 10, 1],
    ["twenty quid", "GBP", 20, 2],
    ["£100", "GBP", 100, 4],
  ] as const)("%s → %s %d, level %d", (text, currency, amount, level) => {
    const c = parseQuery(text);
    expect(c.budget?.currency).toBe(currency);
    expect(c.budget?.amount).toBe(amount);
    expect(c.maxPriceLevel).toBe(level);
  });

  it("maps per-person amounts to price levels with currency thresholds", () => {
    expect(priceLevelForBudget(300, "INR")).toBe(1);
    expect(priceLevelForBudget(301, "INR")).toBe(2);
    expect(priceLevelForBudget(800, "INR")).toBe(2);
    expect(priceLevelForBudget(2000, "INR")).toBe(3);
    expect(priceLevelForBudget(2001, "INR")).toBe(4);
    expect(priceLevelForBudget(0, "USD")).toBe(0);
    expect(priceLevelForBudget(15, "USD")).toBe(1);
    expect(priceLevelForBudget(35, "EUR")).toBe(2);
    expect(priceLevelForBudget(61, "GBP")).toBe(4);
  });

  it("splits a budget across the party", () => {
    const two = parseQuery("Rs. 1,500 for two people, dinner");
    expect(two.budget).toMatchObject({ amount: 1500, people: 2, perPerson: 750 });
    expect(two.maxPriceLevel).toBe(2);
    expect(two.explanation).toContain("Budget ≤ ₹1,500 for 2 (≈ ₹₹)");

    const four = parseQuery("brunch for 4, ₹3k");
    expect(four.budget).toMatchObject({ amount: 3000, people: 4, perPerson: 750 });

    // A date is two people unless the amount is per person.
    expect(parseQuery("₹2000 for a date").budget?.perPerson).toBe(1000);
    expect(parseQuery("$20 each").budget).toMatchObject({ people: 1, perPerson: 20 });
    expect(parseQuery("$20 each").explanation).toContain("Budget ≤ $20 per person (≈ $$)");
  });

  it("takes the top of a range and understands bare amounts with a money word", () => {
    expect(parseQuery("₹300-500").budget?.amount).toBe(500);
    expect(parseQuery("300 to 600 rupees").budget?.amount).toBe(600);
    const bare = parseQuery("budget of 800 for lunch");
    expect(bare.budget).toMatchObject({ amount: 800, currency: "INR" });
    expect(bare.explanation).toEqual(["Lunch", "Budget ≤ ₹800 (≈ ₹₹)"]);
    expect(parseQuery("budget of 40", { defaultCurrency: "USD" }).budget?.currency).toBe("USD");
    // Durations and walk times are never money.
    expect(parseQuery("under 30 minutes").budget).toBeUndefined();
    expect(parseQuery("2 hours").budget).toBeUndefined();
  });

  it("understands price words", () => {
    expect(parseQuery("something cheap to eat")).toMatchObject({ maxPriceLevel: 1, moods: ["cheap"] });
    expect(parseQuery("on a budget").maxPriceLevel).toBe(1);
    expect(parseQuery("not too expensive").maxPriceLevel).toBe(2);
    expect(parseQuery("nothing fancy, just a bite").maxPriceLevel).toBe(2);
    expect(parseQuery("museum or art gallery, free entry").maxPriceLevel).toBe(0);
    expect(parseQuery("free things to do").maxPriceLevel).toBe(0);
    expect(parseQuery("rooftop bar $$").maxPriceLevel).toBe(2);
    // "Free" that isn't about money.
    expect(parseQuery("free wifi cafe").maxPriceLevel).toBeUndefined();
    expect(parseQuery("I'm free for 90 mins").maxPriceLevel).toBeUndefined();
    expect(parseQuery("feel free to suggest a park").maxPriceLevel).toBeUndefined();
    // The tighter of a budget and a price word wins.
    expect(parseQuery("cheap, ₹1000").maxPriceLevel).toBe(1);
  });

  it("does not let price phrases leak into negation", () => {
    const c = parseQuery("coffee, not too expensive");
    expect(c.excludeCategories).toEqual([]);
    expect(c.includeCategories).toEqual(["coffee"]);
  });
});

describe("parseQuery — time available", () => {
  it.each([
    ["two hours", 120],
    ["2 hrs", 120],
    ["2h", 120],
    ["90 minutes", 90],
    ["45 mins", 45],
    ["half an hour", 30],
    ["an hour", 60],
    ["one hour", 60],
    ["an hour and a half", 90],
    ["1.5 hours", 90],
    ["two and a half hours", 150],
    ["1 hour 30 min", 90],
    ["2h30m", 150],
    ["a couple of hours", 120],
    ["a few hours", 180],
    ["2-3 hours free", 180],
    ["all day", 480],
    ["the whole day with the family", 480],
    ["quarter of an hour", 15],
  ] as const)("%s → %d min", (text, minutes) => {
    expect(parseQuery(text).timeMinutes).toBe(minutes);
  });

  it("formats durations for chips", () => {
    expect(formatDuration(120)).toBe("2 hours");
    expect(formatDuration(60)).toBe("1 hour");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(480)).toBe("All day");
  });

  it("converts number words", () => {
    expect(numberWordsToDigits("five hundred rupees")).toBe("500 rupees");
    expect(numberWordsToDigits("twenty five minutes")).toBe("25 minutes");
    expect(numberWordsToDigits("one hundred and fifty")).toBe("150");
    expect(numberWordsToDigits("two thousand five hundred")).toBe("2500");
    expect(numberWordsToDigits("five five")).toBe("5 5");
    expect(numberWordsToDigits("someone often")).toBe("someone often");
  });
});

describe("parseQuery — walking distance", () => {
  it.each([
    ["nearby", 10, true],
    ["close by", 10, true],
    ["near me", 10, true],
    ["not too far", 10, true],
    ["walking distance", 15, true],
    ["within walking distance", 15, true],
    ["very close", 5, true],
    ["within 5 minutes", 5, false],
    ["within 10 mins", 10, false],
    ["10 min walk", 10, false],
    ["15-minute walk", 15, false],
    ["no more than 15 mins walk", 15, false],
    ["under 20 minutes away", 20, false],
    ["within 10m", 10, false],
    ["within 1 km", 16, false],
    ["500m radius", 8, false],
  ] as const)("%s → %d min", (text, minutes, approximate) => {
    const c = parseQuery(text);
    expect(c.maxWalkMinutes).toBe(minutes);
    expect(c.walkIsApproximate ?? false).toBe(approximate);
    expect(c.timeMinutes).toBeUndefined();
  });

  it("keeps a walk limit and a time budget apart", () => {
    const c = parseQuery("I have an hour, something within 5 minutes");
    expect(c.timeMinutes).toBe(60);
    expect(c.maxWalkMinutes).toBe(5);
  });
});

describe("parseQuery — negation", () => {
  it.each([
    ["not food", ["food"], []],
    ["no food", ["food"], []],
    ["coffee but not food", ["food"], ["coffee"]],
    ["anything but coffee", ["coffee"], []],
    ["anywhere other than bars", ["bar"], []],
    ["except museums", ["museum"], []],
    ["something chill without alcohol", ["bar"], ["park"]],
    ["no bars or clubs", ["bar", "nightlife"], []],
    ["I don't drink, somewhere fun", ["bar"], ["cinema"]],
    ["I'm not hungry, show me something to do", ["food"], ["museum"]],
    ["movies instead of dinner", ["food"], ["cinema"]],
  ] as const)("%s", (text, excluded, included) => {
    const c = parseQuery(text);
    for (const cat of excluded) expect(c.excludeCategories).toContain(cat);
    for (const cat of included) expect(c.includeCategories).toContain(cat);
    for (const cat of excluded) expect(c.includeCategories).not.toContain(cat);
  });

  it("ends the negated phrase at a boundary or a new item", () => {
    expect(parseQuery("no food, just drinks")).toMatchObject({ explicitCategories: ["bar"] });
    expect(parseQuery("no food fun stuff").moods).toEqual(["fun"]);
    expect(parseQuery("not food but a movie").explicitCategories).toEqual(["cinema"]);
  });

  it("ignores negated moods instead of inverting them", () => {
    const c = parseQuery("without kids");
    expect(c.moods).toEqual([]);
    expect(c.excludeCategories).toEqual([]);
  });

  it("lets a named category override an implied exclusion", () => {
    // "not food" implies no desserts, but dessert was asked for by name.
    const c = parseQuery("dessert but not food");
    expect(c.includeCategories).toEqual(["dessert"]);
    expect(c.excludeCategories).toContain("food");
    expect(c.excludeCategories).not.toContain("dessert");
    // Kids exclude bars, unless you ask for one.
    expect(parseQuery("beer with the kids").excludeCategories).not.toContain("bar");
  });

  it("treats 'not crowded' as quiet rather than a negation", () => {
    const c = parseQuery("coffee, not too crowded");
    expect(c.moods).toEqual(["chill"]);
    expect(c.excludeCategories).toEqual([]);
  });
});

describe("parseQuery — moods and categories", () => {
  it("maps moods to categories", () => {
    expect(parseQuery("something fun").includeCategories).toEqual(["entertainment", "cinema", "nightlife", "attraction"]);
    expect(parseQuery("somewhere quiet to relax").moods).toEqual(["chill"]);
    expect(parseQuery("romantic").includeCategories).toEqual(["dessert", "bar", "park", "attraction"]);
    expect(parseQuery("outdoors").includeCategories).toEqual(["park", "outdoors"]);
    expect(parseQuery("with friends").includeCategories).toEqual(["food", "bar", "entertainment"]);
    expect(parseQuery("laptop and wifi").includeCategories).toEqual(["workspace", "coffee"]);
  });

  it("kid-friendly includes family places and excludes bars and nightlife", () => {
    const c = parseQuery("kid-friendly");
    expect(c.moods).toEqual(["kids"]);
    expect(c.includeCategories).toEqual(["park", "attraction", "entertainment", "dessert"]);
    expect(c.excludeCategories).toEqual(["bar", "nightlife"]);
    expect(c.explanation).toEqual(["Kid-friendly"]);
  });

  it.each([
    ["coffee", ["coffee"]],
    ["chai", ["coffee"]],
    ["a cafe", ["coffee"]],
    ["breakfast", ["food", "bakery", "coffee"]],
    ["lunch", ["food"]],
    ["somewhere to eat", ["food"]],
    ["ice cream", ["dessert"]],
    ["cake", ["dessert"]],
    ["bakery", ["bakery"]],
    ["a beer", ["bar"]],
    ["pub", ["bar"]],
    ["club", ["nightlife"]],
    ["a movie", ["cinema"]],
    ["cinemas", ["cinema"]],
    ["bowling", ["entertainment"]],
    ["museum", ["museum"]],
    ["art gallery", ["museum"]],
    ["park", ["park"]],
    ["go for a walk", ["park", "outdoors"]],
    ["shopping", ["shopping", "mall"]],
    ["the mall", ["mall"]],
    ["books", ["shopping"]],
    ["gym", ["gym"]],
    ["work out", ["gym"]],
    ["sights", ["attraction"]],
    ["photo spots", ["attraction"]],
  ] as const)("%s → %j", (text, cats) => {
    expect(parseQuery(text).explicitCategories).toEqual(cats);
  });

  it("parses the other example prompts", () => {
    const work = parseQuery("Quiet place to work with coffee");
    expect(work.moods).toEqual(["chill", "work"]);
    expect(work.explicitCategories).toEqual(["coffee"]);
    expect(work.explanation).toEqual(["Chill & quiet", "Good for working", "Coffee"]);

    const date = parseQuery("Date night, not too expensive");
    expect(date.moods).toEqual(["romantic"]);
    expect(date.maxPriceLevel).toBe(2);
    expect(date.when?.label).toBe("This evening");

    const kids = parseQuery("Something to do with kids this afternoon");
    expect(kids.moods).toEqual(["activity", "kids"]);
    expect(kids.when?.label).toBe("This afternoon");
    expect(kids.excludeCategories).toEqual(["bar", "nightlife"]);

    const late = parseQuery("Late-night food within 10 minutes");
    expect(late).toMatchObject({ explicitCategories: ["food"], maxWalkMinutes: 10, openLate: true, openNow: true });
    expect(late.walkIsApproximate).toBeUndefined();
    expect(late.explanation).toEqual(["Food", "Within a 10-min walk", "Late night"]);
  });

  it("understands opening-time phrases", () => {
    expect(parseQuery("bars open late")).toMatchObject({ openLate: true, explicitCategories: ["bar"] });
    expect(parseQuery("bars that close late").openLate).toBe(true);
    expect(parseQuery("tonight")).toMatchObject({ openLate: true, when: { label: "Tonight" } });
    expect(parseQuery("open 24 hours").openLate).toBe(true);
    expect(parseQuery("open 24 hours").timeMinutes).toBeUndefined();
    expect(parseQuery("coffee right now").explanation).toEqual(["Coffee", "Open now"]);
    expect(parseQuery("museum even if it's closed").openNow).toBe(false);
  });
});

describe("parseQuery — empty and garbage input", () => {
  it.each(["", "   ", "asdf qwerty", "?!?!", "🙂🙂", "the a an of"])("%j gives defaults", (text) => {
    const c = parseQuery(text);
    expect(c.includeCategories).toEqual([]);
    expect(c.excludeCategories).toEqual([]);
    expect(c.moods).toEqual([]);
    expect(c.openNow).toBe(true);
    expect(c.openLate).toBe(false);
    expect(c.budget).toBeUndefined();
    expect(c.timeMinutes).toBeUndefined();
    expect(c.maxWalkMinutes).toBeUndefined();
    expect(c.explanation).toEqual([]);
  });

  it("reports words it did not understand", () => {
    expect(parseQuery("asdf qwerty").unknownWords).toEqual(["asdf", "qwerty"]);
    expect(parseQuery("coffee asdf").unknownWords).toEqual(["asdf"]);
    expect(parseQuery("I want coffee").unknownWords).toBeUndefined();
  });

  it("survives very long and odd input", () => {
    const c = parseQuery(`coffee ${"x ".repeat(2000)}`);
    expect(c.explicitCategories).toEqual(["coffee"]);
    expect(() => parseQuery("₹₹₹₹₹ $ € £ 1e9 -5 rupees NaN hours")).not.toThrow();
    // Not a string at runtime (bad JSON) must not throw either.
    expect(parseQuery(undefined as unknown as string).explanation).toEqual([]);
  });

  it("is deterministic", () => {
    const q = "I want something fun nearby but not food";
    expect(parseQuery(q)).toEqual(parseQuery(q));
  });
});

describe("applyConstraints", () => {
  it("drops excluded categories and keeps included ones", () => {
    const now = at(20);
    const out = applyConstraints(ranked(now), parseQuery("something fun but not food"), now);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(hasAny(s.place, ["food", "bakery", "dessert"])).toBe(false);
      expect(hasAny(s.place, ["entertainment", "cinema", "nightlife", "attraction"])).toBe(true);
    }
  });

  it("caps price but allows unknown prices with a small penalty", () => {
    const now = at(13);
    const noPrice = { ...places.find((p) => p.name.startsWith("Truffles"))!, id: "x", priceLevel: undefined };
    const list = ranked(now, [...places, noPrice]);
    const out = applyConstraints(list, base({ maxPriceLevel: 1 }), now);
    expect(out.every((s) => s.place.priceLevel === undefined || s.place.priceLevel <= 1)).toBe(true);
    const unknown = out.find((s) => s.place.id === "x")!;
    expect(unknown.breakdown.query).toBeLessThan(0);
  });

  it("enforces the walk limit", () => {
    const now = at(13);
    const out = applyConstraints(ranked(now), base({ maxWalkMinutes: 5 }), now);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.walkMinutes <= 5)).toBe(true);
  });

  it("requires open now and drops places closing before you could finish", () => {
    const now = at(21, 50);
    const out = applyConstraints(ranked(now), base(), now);
    expect(out.every((s) => s.openNow !== false)).toBe(true);
    // Cafés close at 22:00: a 15-minute coffee no longer fits after the walk.
    expect(named(out)).not.toContain("Third Wave Coffee");
    expect(named(out)).not.toContain("Glen's Bakehouse");
    // The 24h chai stall is fine.
    expect(named(out)).toContain("Chai Point");
  });

  it("lets the user ignore opening hours", () => {
    const now = at(4);
    const closedToo = applyConstraints(ranked(now), base({ openNow: false }), now);
    expect(closedToo.length).toBe(places.length);
  });

  it("requires open late when asked", () => {
    const now = at(15);
    const out = applyConstraints(ranked(now), parseQuery("food open late"), now);
    expect(out.length).toBeGreaterThan(0);
    const late = addMinutes(now, 22 * 60 + 30 - now.minute);
    for (const s of out) expect(isOpenAt(s.place.openingHours, late)).toBe(true);
    // Cafés close at 22:00, so they never count as late.
    expect(named(out)).not.toContain("Brahmin's Coffee Bar");
  });

  it("drops visits that don't fit the time available", () => {
    const now = at(13);
    const out = applyConstraints(ranked(now), base({ timeMinutes: 120 }), now);
    // A film takes ~2.5 h with ads and the walk.
    expect(named(out)).not.toContain("PVR Cinemas");
    expect(named(out)).toContain("Third Wave Coffee");
    const half = applyConstraints(ranked(now), base({ timeMinutes: 30 }), now);
    expect(half.length).toBeGreaterThan(0);
    for (const s of half) expect(s.walkMinutes + visitMinutes(s.place).min).toBeLessThanOrEqual(30);
  });

  it("boosts named categories above mood-only matches", () => {
    const now = at(10);
    const out = applyConstraints(ranked(now), parseQuery("Quiet place to work with coffee"), now);
    const top = out.slice(0, 3);
    expect(top.every((s) => s.place.categories.includes("coffee"))).toBe(true);
    expect(out[0].breakdown.query).toBeGreaterThan(0);
    // Sorted by the adjusted score.
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });

  it("evaluates opening hours at the requested time of day", () => {
    const now = at(10);
    // Bars that open at 17:00 are closed now but fine "this evening".
    const evening = applyConstraints(ranked(now), parseQuery("drinks this evening"), now);
    expect(named(evening)).toContain("Skyye Rooftop");
    const rightNow = applyConstraints(ranked(now), parseQuery("drinks now"), now);
    expect(named(rightNow)).not.toContain("Skyye Rooftop");
  });

  it("resolves start times and the late window", () => {
    const evening = { label: "x", startMinute: 18 * 60, endMinute: 22 * 60 };
    expect(startTime({ when: evening }, at(10))).toEqual(at(18));
    expect(startTime({ when: evening }, at(19))).toEqual(at(19));
    const tonight = { label: "x", startMinute: 20 * 60, endMinute: 29 * 60 };
    expect(startTime({ when: tonight }, { day: 6, minute: 60 })).toEqual({ day: 6, minute: 60 });
    expect(lateWindow(at(15))).toEqual({ from: at(21), minutes: 120 });
    expect(lateWindow(at(22, 30))).toEqual({ from: at(22, 30), minutes: 60 });
  });
});

describe("applyConstraints with demo places — PRD examples end to end", () => {
  it("I have ₹500 and two hours (Friday 8 PM)", () => {
    const now = at(20);
    const out = applyConstraints(ranked(now), parseQuery("I have ₹500 and two hours"), now);
    expect(out.length).toBeGreaterThan(5);
    for (const s of out) {
      expect(s.place.priceLevel ?? 0).toBeLessThanOrEqual(2);
      expect(s.openNow).not.toBe(false);
      expect(s.walkMinutes + visitMinutes(s.place).min).toBeLessThanOrEqual(120);
    }
    const names = named(out);
    expect(names).not.toContain("Toit Brewpub"); // ₹₹₹
    expect(names).not.toContain("Skyye Rooftop"); // ₹₹₹₹
    expect(names).not.toContain("PVR Cinemas"); // doesn't fit in two hours
  });

  it("I want something fun nearby but not food (Friday 8 PM)", () => {
    const now = at(20);
    const c = parseQuery("I want something fun nearby but not food");
    // Nothing fun is within a 10-minute walk of the demo origin…
    expect(applyConstraints(ranked(now), c, now)).toEqual([]);
    // …so the soft "nearby" is widened, and that's explained.
    const { results, notes } = applyConstraintsWithFallback(ranked(now), c, now);
    expect(named(results).sort()).toEqual(["PVR Cinemas", "Skyye Rooftop", "Smaaash Bowling"]);
    expect(notes).toEqual(["Not much within a 10-min walk, so I looked up to 20 min away."]);
    expect(results.every((s) => !hasAny(s.place, ["food"]))).toBe(true);
  });

  it("never loosens explicit limits", () => {
    const now = at(20);
    const c = parseQuery("bowling within 5 minutes");
    const { results, notes } = applyConstraintsWithFallback(ranked(now), c, now);
    expect(results).toEqual([]);
    expect(notes).toEqual([]);
    expect(loosenTips(c)).toContain("Walk a little further");
  });

  it("adds alternatives after the exact matches when moods find too little", () => {
    const now = at(10);
    const c = parseQuery("something fun nearby but not food");
    const { results, notes } = applyConstraintsWithFallback(ranked(now), c, now);
    expect(notes).toHaveLength(2);
    expect(results[0].place.categories).toContain("cinema");
    expect(results.every((s) => !hasAny(s.place, ["food", "bakery", "dessert"]))).toBe(true);
    expect(results.every((s) => s.walkMinutes <= 20)).toBe(true);
  });

  it("late-night food within 10 minutes (asked in the morning)", () => {
    const now = at(10);
    const out = applyConstraints(ranked(now), parseQuery("Late-night food within 10 minutes"), now);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(s.place.categories).toContain("food");
      expect(s.walkMinutes).toBeLessThanOrEqual(10);
    }
    expect(named(out)).toContain("Late Night Dosa Cart");
  });
});

describe("answerAsk / parseAskRequest", () => {
  it("validates the request body", () => {
    expect(parseAskRequest({ lat: 12.97, lng: 77.64, query: "  coffee  ", tzo: -330 })).toEqual({
      origin: { lat: 12.97, lng: 77.64, accuracyM: 30 },
      query: "coffee",
      radiusM: 2000,
      tzOffsetMinutes: -330,
    });
    expect(parseAskRequest({ lat: "12.97", lng: "77.64", query: "x", radius: 99999, acc: 12 }).radiusM).toBe(5000);
    const bad = [
      null,
      [],
      "coffee",
      { lng: 77, query: "coffee" },
      { lat: 95, lng: 77, query: "coffee" },
      { lat: 12, lng: 77 },
      { lat: 12, lng: 77, query: "   " },
      { lat: 12, lng: 77, query: "x".repeat(301) },
      { lat: 12, lng: 77, query: 42 },
      { lat: 12, lng: 77, query: "coffee", tzo: "soon" },
    ];
    for (const body of bad) expect(() => parseAskRequest(body)).toThrow(BadRequest);
  });

  it("runs the whole pipeline and excludes the venue you're in", () => {
    const res = answerAsk({
      origin: { ...origin, accuracyM: 10 },
      query: "coffee",
      radiusM: 3000,
      tzOffsetMinutes: -330,
      places,
      nowMs: FRIDAY_10AM,
      provider: "demo",
    });
    expect(res.context.type).toBe("cafe");
    expect(res.dayPart).toBe("morning");
    expect(res.constraints.explanation).toEqual(["Coffee"]);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.every((s) => s.place.categories.includes("coffee"))).toBe(true);
    // You're standing in Third Wave Coffee, so it isn't suggested.
    expect(named(res.results)).not.toContain("Third Wave Coffee");
  });

  it("suggests how to loosen the request only when nothing fits", () => {
    const ask = (query: string) =>
      answerAsk({
        origin: { ...origin, accuracyM: 500 },
        query,
        radiusM: 3000,
        tzOffsetMinutes: -330,
        places,
        nowMs: FRIDAY_8PM,
        provider: "demo",
      });
    const none = ask("bowling within 5 minutes under ₹100");
    expect(none.results).toEqual([]);
    expect(none.tips).toEqual(expect.arrayContaining(["Walk a little further", "Stretch the budget a little"]));
    expect(ask("I have ₹500 and two hours").tips).toEqual([]);
  });

  it("caps results at 20", () => {
    const many = Array.from({ length: 3 }, (_, i) => demoPlaces({ lat: origin.lat + i * 0.0001, lng: origin.lng })).flat();
    const res = answerAsk({
      origin: { ...origin, accuracyM: 500 },
      query: "anything",
      radiusM: 5000,
      tzOffsetMinutes: -330,
      places: many,
      nowMs: FRIDAY_8PM,
      provider: "demo",
    });
    expect(res.results).toHaveLength(20);
  });
});
