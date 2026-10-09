import { describe, expect, it } from "vitest";
import { whatNext } from "@/lib/feed";
import {
  displayHost,
  groupWhatNext,
  photoSrc,
  providerFromId,
  safeExternalUrl,
  shareClipboardText,
  shareContent,
  weeklyHours,
  whatNextPlaces,
} from "@/lib/placeDetail";
import { demoPlaces } from "@/lib/providers/demo";
import { parseOsmOpeningHours } from "@/lib/time";
import type { FeedSection, ScoredPlace } from "@/lib/types";

const origin = { lat: 12.9784, lng: 77.6408 };
// Friday 20:00 in India.
const evening = Date.UTC(2026, 9, 9, 14, 30);

function detailFor(index: number) {
  const place = demoPlaces(origin)[index];
  // The API looks around the place itself (src/app/api/place/[id]/route.ts).
  const nearby = demoPlaces({ lat: place.lat, lng: place.lng });
  return { place, ...whatNext(place, nearby, evening, -330) };
}

function section(id: string, ids: string[]): FeedSection {
  const items = ids.map((pid) => ({ place: { id: pid } }) as unknown as ScoredPlace);
  return { id, title: id, items };
}

describe("groupWhatNext", () => {
  it("splits a café's What next? into While you're here and After this, in API order", () => {
    const { sections } = detailFor(0); // Third Wave Coffee (demo)
    const groups = groupWhatNext(sections);
    expect(groups.map((g) => g.title)).toEqual(["While you're here", "After this"]);
    const [here, after] = groups;
    expect(here.sections.every((s) => s.id.startsWith("while-here-"))).toBe(true);
    expect(after.sections.every((s) => s.id.startsWith("after-this-"))).toBe(true);
    expect(after.sections.some((s) => s.title === "Dinner nearby")).toBe(true);
    const flattened = groups.flatMap((g) => g.sections.map((s) => s.id));
    expect(flattened).toEqual(sections.filter((s) => s.items.length).map((s) => s.id));
  });

  it("keeps unknown sections under More nearby and drops empty ones", () => {
    const groups = groupWhatNext([
      section("after-this-after-coffee", ["a"]),
      section("popular", ["b"]),
      section("while-here-here-coffee", []),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["after-this", "more"]);
    expect(groups[1].title).toBe("More nearby");
  });

  it("returns nothing for no sections", () => {
    expect(groupWhatNext([])).toEqual([]);
  });
});

describe("whatNextPlaces", () => {
  it("lists each place once, in first-seen order, without the current place", () => {
    const out = whatNextPlaces(
      [section("while-here-x", ["a", "b"]), section("after-this-y", ["b", "c", "self"])],
      "self",
    );
    expect(out.map((s) => s.place.id)).toEqual(["a", "b", "c"]);
  });

  it("covers every place in a real What next? response", () => {
    const { place, sections } = detailFor(4); // Truffles (demo), a restaurant
    const out = whatNextPlaces(sections, place.id);
    const all = new Set(sections.flatMap((s) => s.items.map((i) => i.place.id)));
    expect(out.length).toBe(all.size);
    expect(out.some((s) => s.place.id === place.id)).toBe(false);
  });
});

describe("photoSrc", () => {
  it("adds a width to our photo proxy", () => {
    expect(photoSrc("/api/photo?name=places%2Fabc%2Fphotos%2Fdef", 800)).toBe(
      "/api/photo?name=places%2Fabc%2Fphotos%2Fdef&w=800",
    );
    expect(photoSrc("/api/photo?name=x&w=160", 800)).toBe("/api/photo?name=x&w=800");
  });

  it("leaves other photo URLs alone", () => {
    expect(photoSrc("https://example.com/a.jpg", 800)).toBe("https://example.com/a.jpg");
  });
});

describe("safeExternalUrl", () => {
  it("accepts http(s), bare domains and protocol-relative URLs", () => {
    expect(safeExternalUrl("https://example.com/menu")).toBe("https://example.com/menu");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl(" www.example.com ")).toBe("https://www.example.com/");
    expect(safeExternalUrl("example.co.in/about")).toBe("https://example.co.in/about");
    expect(safeExternalUrl("//maps.google.com/maps/contrib/123")).toBe("https://maps.google.com/maps/contrib/123");
  });

  it("rejects scripts, other schemes and junk", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,hi")).toBeNull();
    expect(safeExternalUrl("mailto:a@b.c")).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  it("shows a short host for buttons", () => {
    expect(displayHost("https://www.example.com/menu")).toBe("example.com");
  });
});

describe("providerFromId", () => {
  it("recovers the provider from a saved place id", () => {
    expect(providerFromId("g:ChIJ123")).toBe("google");
    expect(providerFromId("demo:3@12.97840,77.64080")).toBe("demo");
    expect(providerFromId("osm:node/123")).toBe("osm");
  });
});

describe("weeklyHours", () => {
  it("builds a Monday-first week from periods and marks today", () => {
    const cafe = demoPlaces(origin)[0]; // 7 AM – 10 PM daily
    const week = weeklyHours(cafe.openingHours, 5)!;
    expect(week.map((d) => d.label)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(week[0].text).toBe("7:00 AM – 10:00 PM");
    expect(week.filter((d) => d.isToday).map((d) => d.label)).toEqual(["Friday"]);
  });

  it("handles past-midnight closing, closed days, split shifts and 24 hours", () => {
    const h = parseOsmOpeningHours("Mo-Fr 12:00-15:00,19:00-23:30; Sa 18:00-02:00")!;
    const week = weeklyHours(h, 1)!;
    const by = Object.fromEntries(week.map((d) => [d.label, d.text]));
    expect(by.Monday).toBe("12:00 PM – 3:00 PM, 7:00 PM – 11:30 PM");
    expect(by.Saturday).toBe("6:00 PM – 2:00 AM");
    expect(by.Sunday).toBe("Closed");

    const always = weeklyHours(parseOsmOpeningHours("24/7"), 0)!;
    expect(always.every((d) => d.text === "Open 24 hours")).toBe(true);

    // Google encodes 24/7 as a single open-ended Sunday period.
    const google247 = weeklyHours({ periods: [{ openDay: 0, openMinute: 0 }] }, 3)!;
    expect(google247.every((d) => d.text === "Open 24 hours")).toBe(true);
  });

  it("prefers the provider's weekday text", () => {
    const text = [
      "Monday: 8:00 AM – 9:00 PM",
      "Tuesday: 8:00 AM – 9:00 PM",
      "Wednesday: 8:00 AM – 9:00 PM",
      "Thursday: 8:00 AM – 9:00 PM",
      "Friday: 8:00 AM – 11:00 PM",
      "Saturday: 9:00 AM – 11:00 PM",
      "Sunday: Closed",
    ];
    const week = weeklyHours({ periods: [], weekdayText: text }, 0)!;
    expect(week[0]).toEqual({ day: 1, label: "Monday", text: "8:00 AM – 9:00 PM", isToday: false });
    expect(week[6]).toEqual({ day: 0, label: "Sunday", text: "Closed", isToday: true });
  });

  it("returns null when there is nothing to show", () => {
    expect(weeklyHours(undefined, 0)).toBeNull();
    expect(weeklyHours({ periods: [], raw: "by appointment" }, 0)).toBeNull();
  });
});

describe("shareContent", () => {
  it("shares the place and a link, never the user's position", () => {
    const place = demoPlaces(origin)[0];
    const s = shareContent(place, "https://nookmaps.app/");
    expect(s.title).toBe(place.name);
    expect(s.text).toBe(`${place.name} (Coffee · ★ 4.4), found on NookMaps`);
    expect(s.url).toBe(`https://nookmaps.app/place/${encodeURIComponent(place.id)}`);
    expect(shareClipboardText(s)).toBe(`${s.text}\n${s.url}`);
    expect(s.text).not.toMatch(/\d+\.\d{3,}/); // no coordinates in the message
  });

  it("works without a rating", () => {
    const s = shareContent({ id: "osm:node/1", name: "Corner Park", categories: ["park"] }, "http://localhost:3000");
    expect(s.text).toBe("Corner Park (Park), found on NookMaps");
    expect(s.url).toBe("http://localhost:3000/place/osm%3Anode%2F1");
  });
});
