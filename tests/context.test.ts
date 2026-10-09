import { describe, expect, it } from "vitest";
import { detectContext } from "@/lib/context";
import { demoPlaces } from "@/lib/providers/demo";

const origin = { lat: 12.9784, lng: 77.6408 };

describe("context detection", () => {
  it("detects the café the user is standing in", () => {
    const ctx = detectContext({ ...origin, accuracyM: 10 }, demoPlaces(origin));
    expect(ctx.type).toBe("cafe");
    expect(ctx.currentPlace?.name).toMatch(/Third Wave/);
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("does not claim a venue when GPS is coarse", () => {
    const ctx = detectContext({ ...origin, accuracyM: 400 }, demoPlaces(origin));
    expect(ctx.type).toBe("street");
    expect(ctx.currentPlace).toBeUndefined();
  });

  it("falls back to street when nothing is close", () => {
    const far = { lat: origin.lat + 0.01, lng: origin.lng };
    const ctx = detectContext({ ...far, accuracyM: 10 }, demoPlaces(origin));
    expect(ctx.type).toBe("street");
  });

  it("detects being inside a large venue", () => {
    const places = demoPlaces(origin);
    const mall = places.find((p) => p.categories.includes("mall"))!;
    const ctx = detectContext({ lat: mall.lat + 0.0003, lng: mall.lng, accuracyM: 15 }, places);
    expect(ctx.type).toBe("mall");
  });
});
