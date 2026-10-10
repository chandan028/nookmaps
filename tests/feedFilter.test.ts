import { describe, expect, it } from "vitest";
import { chipMatches } from "@/lib/categories";
import { buildFeed } from "@/lib/feed";
import {
  accuracyNotice,
  activeChip,
  areaLine,
  filterBuckets,
  filterPlaces,
  filterSections,
  formatRadius,
  normalizeRadius,
  pickSurprise,
  sectionGroup,
  splitSections,
} from "@/lib/feedFilter";
import { demoPlaces } from "@/lib/providers/demo";
import type { ScoredPlace } from "@/lib/types";

const origin = { lat: 12.9784, lng: 77.6408 };
// Friday 20:00 in India.
const evening = Date.UTC(2026, 9, 9, 14, 30);

function feed(accuracyM = 10) {
  return buildFeed({
    origin: { ...origin, accuracyM },
    places: demoPlaces(origin),
    area: { label: "Indiranagar", street: "100 Feet Road", neighborhood: "Indiranagar", city: "Bengaluru" },
    nowMs: evening,
    tzOffsetMinutes: -330,
    radiusM: 3000,
    provider: "demo",
  });
}

describe("chip filtering", () => {
  it("returns every non-empty section unchanged without a chip", () => {
    const f = feed();
    const out = filterSections(f.sections, null);
    expect(out).toEqual(f.sections.filter((s) => s.items.length > 0));
  });

  it("narrows every section to the chip's categories and drops empty ones", () => {
    const f = feed();
    const out = filterSections(f.sections, "coffee");
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(f.sections.length);
    for (const s of out) {
      expect(s.items.length).toBeGreaterThan(0);
      expect(s.items.every((i) => chipMatches("coffee", i.place))).toBe(true);
    }
    // Sections that had no coffee places are gone, not shown empty.
    expect(out.some((s) => s.id === "things-to-do")).toBe(false);
  });

  it("does not mutate the API response", () => {
    const f = feed();
    const before = f.sections.map((s) => s.items.length);
    filterSections(f.sections, "drinks");
    expect(f.sections.map((s) => s.items.length)).toEqual(before);
  });

  it("filters walk buckets and places the same way", () => {
    const f = feed(500);
    const buckets = filterBuckets(f.buckets, "eat");
    expect(buckets.every((b) => b.items.length > 0)).toBe(true);
    expect(buckets.flatMap((b) => b.items).every((i) => chipMatches("eat", i.place))).toBe(true);
    const places = filterPlaces(f.places, "eat");
    expect(places.length).toBe(f.chips.find((c) => c.id === "eat")!.count);
    expect(filterPlaces(f.places, null)).toBe(f.places);
  });

  it("ignores a selected chip that the current feed doesn't offer", () => {
    const f = feed();
    expect(activeChip(f.chips, "coffee")?.id).toBe("coffee");
    expect(activeChip(f.chips, "not-a-chip")).toBeNull();
    expect(activeChip(f.chips, null)).toBeNull();
  });
});

describe("section grouping", () => {
  it("puts While you're here / After this ahead of the generic sections", () => {
    const f = feed(10);
    expect(f.context.currentPlace).toBeDefined();
    const { whileHere, afterThis, general } = splitSections(f.sections);
    expect(whileHere.length + afterThis.length).toBeGreaterThan(0);
    expect(whileHere.every((s) => s.subtitle === "While you're here")).toBe(true);
    expect(afterThis.every((s) => s.subtitle === "After this")).toBe(true);
    expect(general.every((s) => sectionGroup(s) === "general")).toBe(true);
    expect(whileHere.length + afterThis.length + general.length).toBe(f.sections.length);
  });

  it("has no context sections when only the area is known", () => {
    const { whileHere, afterThis, general } = splitSections(feed(500).sections);
    expect(whileHere).toEqual([]);
    expect(afterThis).toEqual([]);
    expect(general.length).toBeGreaterThan(0);
  });
});

describe("surprise me", () => {
  const f = feed(500);

  it("picks an open place from the top of the ranking", () => {
    const top = [...f.places].filter((p) => p.openNow === true).slice(0, 10);
    for (const r of [0, 0.25, 0.5, 0.99]) {
      const pick = pickSurprise(f.places, () => r)!;
      expect(pick.openNow).toBe(true);
      expect(top.map((t) => t.place.id)).toContain(pick.place.id);
    }
  });

  it("never picks a closed place and returns null when nothing qualifies", () => {
    const closed: ScoredPlace[] = f.places.map((p) => ({ ...p, openNow: false }));
    expect(pickSurprise(closed)).toBeNull();
    expect(pickSurprise([])).toBeNull();
    const unknown = f.places.slice(0, 3).map((p) => ({ ...p, openNow: null }));
    expect(pickSurprise([...closed, ...unknown], () => 0)?.openNow).toBeNull();
  });

  it("is safe with a random() that returns 1", () => {
    expect(pickSurprise(f.places, () => 1)).not.toBeNull();
  });
});

describe("display helpers", () => {
  it("only flags approximate locations above 100 m", () => {
    expect(accuracyNotice(undefined)).toBeNull();
    expect(accuracyNotice(30)).toBeNull();
    expect(accuracyNotice(100)).toBeNull();
    expect(accuracyNotice(140.6)).toBe("Location is approximate (±141 m)");
    expect(accuracyNotice(2400)).toBe("Location is approximate (±2.4 km)");
  });

  it("formats and clamps radius", () => {
    expect(formatRadius(500)).toBe("500 m");
    expect(formatRadius(1000)).toBe("1 km");
    expect(formatRadius(1500)).toBe("1.5 km");
    expect(normalizeRadius(20_000)).toBe(5000);
    expect(normalizeRadius(10)).toBe(100);
    expect(normalizeRadius("x")).toBe(2000);
    expect(normalizeRadius(Number.NaN, 1000)).toBe(1000);
  });

  it("builds an area line without repeating the headline", () => {
    const area = { label: "Indiranagar", street: "100 Feet Road", neighborhood: "Indiranagar", city: "Bengaluru" };
    expect(areaLine(area, "You're around Indiranagar")).toBe("100 Feet Road, Bengaluru");
    expect(areaLine(area, "You're at Third Wave Coffee")).toBe("100 Feet Road, Indiranagar, Bengaluru");
    expect(areaLine({ label: "Indiranagar" }, "You're around Indiranagar")).toBe("");
    expect(areaLine({ label: "Indiranagar" }, "You're at Toit")).toBe("Indiranagar");
  });
});
