import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, loadWeights, popularity, rankPlaces } from "@/lib/ranking";
import { demoPlaces } from "@/lib/providers/demo";

const origin = { lat: 12.9784, lng: 77.6408 };

describe("ranking", () => {
  it("loads weight overrides safely", () => {
    expect(loadWeights(undefined)).toEqual(DEFAULT_WEIGHTS);
    expect(loadWeights("nope")).toEqual(DEFAULT_WEIGHTS);
    expect(loadWeights('{"distance":0.5,"rating":-1}').distance).toBe(0.5);
    expect(loadWeights('{"rating":-1}').rating).toBe(DEFAULT_WEIGHTS.rating);
  });

  it("prefers popular over obscure perfect ratings", () => {
    const base = demoPlaces(origin)[0];
    expect(popularity({ ...base, rating: 4.5, reviewCount: 5000 })).toBeGreaterThan(
      popularity({ ...base, rating: 5, reviewCount: 2 }),
    );
  });

  it("puts closed places below open ones, all else equal", () => {
    const [a] = demoPlaces(origin);
    const open = { ...a, id: "x", currentlyOpen: true };
    const closed = { ...a, id: "y", currentlyOpen: false };
    const ranked = rankPlaces({ origin, places: [closed, open], context: "street", dayPart: "evening", now: { day: 1, minute: 1200 } });
    expect(ranked[0].place.id).toBe("x");
  });

  it("does not let sponsorship change the score", () => {
    const [a] = demoPlaces(origin);
    const args = { origin, context: "street" as const, dayPart: "evening" as const, now: { day: 1, minute: 1200 } };
    const [plain] = rankPlaces({ ...args, places: [a] });
    const [sponsored] = rankPlaces({ ...args, places: [{ ...a, sponsored: true }] });
    expect(sponsored.score).toBe(plain.score);
  });
});
