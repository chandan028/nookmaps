import { describe, expect, it } from "vitest";
import { dayPart, isOpenAt, isOpenThrough, localTime, minutesUntilClose, parseOsmOpeningHours } from "@/lib/time";

describe("time", () => {
  it("converts to local time using the browser offset", () => {
    // 2026-10-09T14:30Z is a Friday; India is UTC+5:30 (offset -330) → 20:00.
    const t = localTime(Date.UTC(2026, 9, 9, 14, 30), -330);
    expect(t).toEqual({ day: 5, minute: 20 * 60 });
    expect(dayPart(t)).toBe("evening");
  });

  it("parses common OSM opening_hours", () => {
    const h = parseOsmOpeningHours("Mo-Fr 08:00-22:00; Sa,Su 09:00-23:30")!;
    expect(isOpenAt(h, { day: 1, minute: 8 * 60 })).toBe(true);
    expect(isOpenAt(h, { day: 1, minute: 22 * 60 })).toBe(false);
    expect(isOpenAt(h, { day: 0, minute: 23 * 60 })).toBe(true);
    expect(isOpenAt(parseOsmOpeningHours("24/7"), { day: 3, minute: 200 })).toBe(true);
    expect(parseOsmOpeningHours("PH off")).toBeUndefined();
  });

  it("handles periods past midnight and the week wrap", () => {
    const h = parseOsmOpeningHours("Sa 18:00-02:00")!;
    expect(isOpenAt(h, { day: 6, minute: 23 * 60 })).toBe(true);
    expect(isOpenAt(h, { day: 0, minute: 60 })).toBe(true);
    expect(isOpenAt(h, { day: 0, minute: 3 * 60 })).toBe(false);
    expect(minutesUntilClose(h, { day: 6, minute: 23 * 60 })).toBe(180);
    expect(isOpenThrough(h, { day: 6, minute: 23 * 60 }, 240)).toBe(false);
  });

  it("returns null when hours are unknown", () => {
    expect(isOpenAt(undefined, { day: 1, minute: 0 })).toBeNull();
  });
});
