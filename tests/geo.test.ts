import { describe, expect, it } from "vitest";
import { distanceMeters, formatDistance, movedSignificantly, walkBucket, walkMinutes } from "@/lib/geo";

describe("geo", () => {
  it("measures distance", () => {
    const d = distanceMeters({ lat: 12.9716, lng: 77.5946 }, { lat: 12.9784, lng: 77.6408 });
    expect(d).toBeGreaterThan(4900);
    expect(d).toBeLessThan(5100);
  });
  it("estimates walking time and buckets", () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(320)).toBe(5);
    expect(walkBucket(4)).toBe(5);
    expect(walkBucket(11)).toBe(15);
    expect(walkBucket(31)).toBeNull();
  });
  it("formats distance and movement", () => {
    expect(formatDistance(234)).toBe("230 m");
    expect(formatDistance(1530)).toBe("1.5 km");
    expect(movedSignificantly({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 })).toBe(false);
    expect(movedSignificantly({ lat: 0, lng: 0 }, { lat: 0.002, lng: 0 })).toBe(true);
  });
});
