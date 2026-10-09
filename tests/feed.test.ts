import { describe, expect, it } from "vitest";
import { buildFeed, whatNext } from "@/lib/feed";
import { demoPlaces } from "@/lib/providers/demo";

const origin = { lat: 12.9784, lng: 77.6408 };
// Friday 20:00 in India.
const evening = Date.UTC(2026, 9, 9, 14, 30);
// Friday 08:00 in India.
const morning = Date.UTC(2026, 9, 9, 2, 30);

function feed(nowMs: number, accuracyM = 10) {
  return buildFeed({
    origin: { ...origin, accuracyM },
    places: demoPlaces(origin),
    area: { label: "Indiranagar" },
    nowMs,
    tzOffsetMinutes: -330,
    radiusM: 3000,
    provider: "demo",
  });
}

describe("feed", () => {
  it("pivots to What next? when at a POI", () => {
    const f = feed(evening);
    expect(f.headline).toMatch(/^You're at Third Wave/);
    expect(f.sections[0].subtitle).toBe("While you're here");
    expect(f.sections.some((s) => s.title === "Dinner nearby")).toBe(true);
    expect(f.places.some((p) => p.place.id === f.context.currentPlace!.id)).toBe(false);
  });

  it("uses the area name when no venue is confident", () => {
    const f = feed(evening, 500);
    expect(f.headline).toBe("You're around Indiranagar");
    expect(f.sections.some((s) => s.subtitle === "After this")).toBe(false);
  });

  it("changes with time of day", () => {
    const night = feed(evening, 500);
    const am = feed(morning, 500);
    expect(night.dayPart).toBe("evening");
    expect(am.dayPart).toBe("morning");
    expect(am.sections.map((s) => s.id)).toContain("breakfast");
    expect(am.sections.map((s) => s.id)).not.toContain("tonight");
  });

  it("only shows chips that have places and keeps closed places out of primary sections", () => {
    const f = feed(morning, 500);
    expect(f.chips.every((c) => c.count > 0)).toBe(true);
    const popular = f.sections.find((s) => s.id === "popular")!;
    expect(popular.items.every((i) => i.openNow !== false)).toBe(true);
    // The rooftop bar (opens 5 PM) is closed at 8 AM.
    expect(popular.items.some((i) => i.place.name.startsWith("Skyye"))).toBe(false);
  });

  it("groups by walking time buckets", () => {
    const f = feed(evening, 500);
    expect(f.buckets.map((b) => b.minutes)).toEqual([...f.buckets.map((b) => b.minutes)].sort((a, b) => a - b));
    for (const b of f.buckets) expect(b.items.every((i) => i.walkMinutes <= b.minutes)).toBe(true);
  });

  it("builds What next? for a place detail", () => {
    const places = demoPlaces(origin);
    const restaurant = places.find((p) => p.name.startsWith("Meghana"))!;
    const { sections } = whatNext(restaurant, places, evening, -330);
    expect(sections.map((s) => s.title)).toContain("Dessert");
  });
});
