import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsChoice,
  analyticsEnabled,
  onTrack,
  onTrackWithConsent,
  OPT_OUT_KEY,
  redactPath,
  resetSessionMetrics,
  sanitize,
  sessionMetrics,
  SESSION_KEY,
  setAnalyticsOptOut,
  track,
  type AnalyticsEvent,
  type AnalyticsParams,
} from "@/lib/analytics";

/** Minimal in-memory Web Storage. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

type Seen = { event: AnalyticsEvent; params: AnalyticsParams };

function record(subscribe: typeof onTrack = onTrack) {
  const seen: Seen[] = [];
  const off = subscribe((event, params) => seen.push({ event, params }));
  return { seen, off, names: () => seen.map((s) => s.event) };
}

let local: MemoryStorage;
let session: MemoryStorage;
let unsubscribe: (() => void) | undefined;

beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  resetSessionMetrics();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sanitize", () => {
  it("drops coordinate-like and free-text keys", () => {
    const out = sanitize({
      lat: 12.9784,
      lng: 77.6408,
      latitude: 12.9,
      longitude: 77.6,
      lon: 77.6,
      coords: "x",
      accuracy: 12,
      address: "100 Feet Rd",
      query_text: "coffee",
      originLat: 12.97,
      user_lng: 77.64,
      latLng: "12.97,77.64",
      geohash: "tdr1",
      q: "quiet cafe",
      query: "quiet cafe",
      place_id: "g:ChIJ123",
      placeName: "Third Wave",
      category: "coffee",
      section: "open-now",
      relative_rank: 2,
      day_part: "evening",
      count: 3,
    });
    expect(out).toEqual({
      category: "coffee",
      section: "open-now",
      relative_rank: 2,
      day_part: "evening",
      count: 3,
    });
  });

  it("drops coordinate pairs hidden in values and caps string length", () => {
    const out = sanitize({
      link: "https://www.google.com/maps/dir/?destination=12.9784%2C77.6408",
      where: "12.97841, 77.64082",
      label: "x".repeat(150),
      missing: undefined,
      bad: Number.NaN,
    });
    expect(out).toEqual({ label: "x".repeat(100) });
  });
});

describe("redactPath", () => {
  it("removes ids and query strings from page paths", () => {
    expect(redactPath("/")).toBe("/");
    expect(redactPath("/plan")).toBe("/plan");
    expect(redactPath("/saved?from=nav#top")).toBe("/saved");
    expect(redactPath("/place/g%3AChIJN1t_tDeuEmsRUsoyG83frY4")).toBe("/place/:id");
    expect(redactPath("/somewhere/12.97,77.64")).toBe("/somewhere/:param");
  });
});

describe("recommendation-to-action conversion", () => {
  it("emits recommendation_action after place_opened then directions_clicked", () => {
    const r = record();
    unsubscribe = r.off;
    track("place_opened", { section: "coffee", category: "coffee", provider: "demo" });
    track("directions_clicked", { provider: "demo" });
    expect(r.names()).toEqual(["place_opened", "directions_clicked", "recommendation_action"]);
    expect(r.seen[2].params).toEqual({ action: "directions", section: "coffee", category: "coffee" });
  });

  it("remembers the recommendation in sessionStorage across reloads", async () => {
    track("place_opened", { section: "tonight", category: "bar" });
    expect(session.getItem(SESSION_KEY)).toContain("tonight");

    vi.resetModules();
    const fresh = await import("@/lib/analytics");
    const seen: Seen[] = [];
    unsubscribe = fresh.onTrack((event, params) => seen.push({ event, params }));
    fresh.track("phone_clicked");
    expect(seen.at(-1)).toEqual({
      event: "recommendation_action",
      params: { action: "call", section: "tonight", category: "bar" },
    });
  });

  it("covers call, website and save, and an action's own section wins", () => {
    const r = record();
    unsubscribe = r.off;
    track("place_opened", { section: "food", category: "restaurant" });
    track("phone_clicked");
    track("website_clicked");
    track("place_saved", { saved: true });
    track("directions_clicked", { section: "open-now", category: "cafe" });
    const conversions = r.seen.filter((s) => s.event === "recommendation_action").map((s) => s.params);
    expect(conversions).toEqual([
      { action: "call", section: "food", category: "restaurant" },
      { action: "website", section: "food", category: "restaurant" },
      { action: "save", section: "food", category: "restaurant" },
      { action: "directions", section: "open-now", category: "cafe" },
    ]);
  });

  it("does not convert actions that didn't come from a recommendation", () => {
    const r = record();
    unsubscribe = r.off;
    track("directions_clicked");
    track("place_opened", { section: "coffee", category: "coffee" });
    track("place_opened", { category: "park" }); // e.g. from Saved: breaks the chain
    track("website_clicked");
    track("place_opened", { section: "coffee", category: "coffee" });
    track("place_saved", { saved: false }); // un-saving is not an action
    expect(r.names()).not.toContain("recommendation_action");
  });

  it("treats the detail page re-reporting a card tap as the same view", () => {
    const r = record();
    unsubscribe = r.off;
    track("place_opened", { section: "coffee", category: "coffee" }); // card tap
    track("place_opened", { category: "coffee" }); // detail page on mount
    track("directions_clicked");
    expect(r.seen.at(-1)?.params).toEqual({ action: "directions", section: "coffee", category: "coffee" });
    expect(sessionMetrics().placesViewed).toBe(1);
  });

  it("stops attributing after 30 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    const r = record();
    unsubscribe = r.off;
    track("place_opened", { section: "coffee", category: "coffee" });
    vi.setSystemTime(new Date("2026-10-09T10:31:00Z"));
    track("directions_clicked");
    expect(r.names()).not.toContain("recommendation_action");
  });

  it("collapses an explicit recommendation_action for the same click", () => {
    const r = record();
    unsubscribe = r.off;
    track("place_opened", { section: "coffee", category: "coffee" });
    track("directions_clicked");
    track("recommendation_action", { action: "directions", section: "coffee" });
    expect(r.names().filter((n) => n === "recommendation_action")).toHaveLength(1);
  });
});

describe("consent", () => {
  it("respects the opt-out flag", () => {
    const gaLike = record(onTrackWithConsent);
    const inApp = record();
    unsubscribe = () => {
      gaLike.off();
      inApp.off();
    };

    setAnalyticsOptOut(true);
    expect(local.getItem(OPT_OUT_KEY)).toBe("1");
    expect(analyticsEnabled()).toBe(false);

    track("place_opened", { section: "coffee", category: "coffee" });
    track("directions_clicked");
    expect(gaLike.seen).toHaveLength(0);
    // No conversion is derived and nothing is kept for the session.
    expect(inApp.names()).toEqual(["place_opened", "directions_clicked"]);
    expect(session.getItem(SESSION_KEY)).toBeNull();
    expect(sessionMetrics().placesViewed).toBe(0);

    setAnalyticsOptOut(false);
    track("section_viewed", { section: "coffee" });
    expect(gaLike.names()).toEqual(["section_viewed"]);
  });

  it("forgets the session's bookkeeping when the user opts out", () => {
    track("place_opened", { section: "coffee", category: "coffee" });
    expect(sessionMetrics().placesViewed).toBe(1);
    setAnalyticsOptOut(true);
    expect(session.getItem(SESSION_KEY)).toBeNull();
    expect(sessionMetrics().placesViewed).toBe(0);
  });

  it("treats Do Not Track and Global Privacy Control as opted out by default", () => {
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    expect(analyticsChoice()).toBe("default");
    expect(analyticsEnabled()).toBe(false);

    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    const r = record(onTrackWithConsent);
    unsubscribe = r.off;
    track("discovery_feed_loaded");
    expect(r.seen).toHaveLength(0);

    // An explicit choice on the privacy page wins over the browser default.
    setAnalyticsOptOut(false);
    expect(analyticsEnabled()).toBe(true);
    track("discovery_feed_loaded");
    expect(r.names()).toEqual(["discovery_feed_loaded"]);
  });

  it("keeps working when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    vi.stubGlobal("localStorage", blocked);
    vi.stubGlobal("sessionStorage", blocked);
    const r = record();
    unsubscribe = r.off;
    expect(() => track("place_opened", { section: "coffee" })).not.toThrow();
    expect(() => setAnalyticsOptOut(true)).not.toThrow();
    expect(r.names()).toEqual(["place_opened"]);
  });
});

describe("session metrics (PRD §24)", () => {
  it("counts places, categories, sections and meaningful actions", () => {
    expect(sessionMetrics()).toEqual({
      placesViewed: 0,
      categoriesExplored: 0,
      sectionsViewed: 0,
      meaningfulActions: 0,
      hadMeaningfulAction: false,
      hadLocation: false,
      feedLoaded: false,
    });

    track("location_permission_granted");
    track("discovery_feed_loaded", { context: "street" });
    track("section_viewed", { section: "open-now" });
    track("section_viewed", { section: "coffee" });
    track("section_viewed", { section: "coffee" });
    track("category_selected", { category: "food" });
    track("category_selected", { category: "coffee" });
    track("place_opened", { section: "coffee", category: "coffee" });
    track("place_opened", { section: "tonight", category: "bar" });
    track("directions_clicked");

    expect(sessionMetrics()).toEqual({
      placesViewed: 2,
      categoriesExplored: 3, // food, coffee, bar
      sectionsViewed: 3, // open-now, coffee, tonight
      meaningfulActions: 1,
      hadMeaningfulAction: true,
      hadLocation: true,
      feedLoaded: true,
    });
  });

  it("starts from zero again once the session is reset", () => {
    track("place_opened", { section: "coffee", category: "coffee" });
    resetSessionMetrics();
    expect(sessionMetrics().placesViewed).toBe(0);
  });
});
