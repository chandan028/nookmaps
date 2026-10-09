import { describe, expect, it } from "vitest";
import { boundsCenter, boundsOf, isPointLike, showAccuracyCircle, viewKey } from "@/lib/mapView";
import { demoPlaces } from "@/lib/providers/demo";

const origin = { lat: 12.9784, lng: 77.6408 };

describe("map view helpers", () => {
  it("bounds every place and the user", () => {
    const places = demoPlaces(origin);
    const b = boundsOf([origin, ...places])!;
    for (const p of [origin, ...places]) {
      expect(p.lat).toBeGreaterThanOrEqual(b.south);
      expect(p.lat).toBeLessThanOrEqual(b.north);
      expect(p.lng).toBeGreaterThanOrEqual(b.west);
      expect(p.lng).toBeLessThanOrEqual(b.east);
    }
    expect(isPointLike(b)).toBe(false);
    const c = boundsCenter(b);
    expect(c.lat).toBeCloseTo((b.south + b.north) / 2, 10);
  });

  it("treats a single place as a point and ignores bad coordinates", () => {
    expect(boundsOf([])).toBeNull();
    const b = boundsOf([origin, { lat: Number.NaN, lng: 1 }])!;
    expect(b).toEqual({ south: origin.lat, north: origin.lat, west: origin.lng, east: origin.lng });
    expect(isPointLike(b)).toBe(true);
  });

  it("only changes the view key when the set of points changes", () => {
    const a = viewKey([origin, { lat: 1, lng: 2 }]);
    expect(viewKey([{ ...origin }, { lat: 1.000001, lng: 2 }])).toBe(a);
    expect(viewKey([origin])).not.toBe(a);
  });

  it("draws accuracy circles only for sensible GPS fixes", () => {
    expect(showAccuracyCircle(25)).toBe(true);
    expect(showAccuracyCircle(undefined)).toBe(false);
    expect(showAccuracyCircle(0)).toBe(false);
    expect(showAccuracyCircle(5000)).toBe(false);
  });
});
