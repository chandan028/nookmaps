import { chipMatches } from "./categories";
import type { AreaInfo, CategoryChip, DayPart, FeedSection, ScoredPlace, WalkBucket } from "./types";

/**
 * Pure helpers for the home feed UI: chip filtering, splitting the
 * context-aware "While you're here" / "After this" sections from the generic
 * ones, "Surprise me" picking and small display strings. No React here so it
 * can be unit tested.
 */

export const WHILE_HERE = "While you're here";
export const AFTER_THIS = "After this";

export type SectionGroup = "while-here" | "after-this" | "general";

export function sectionGroup(section: FeedSection): SectionGroup {
  if (section.id.startsWith("while-here-") || section.subtitle === WHILE_HERE) return "while-here";
  if (section.id.startsWith("after-this-") || section.subtitle === AFTER_THIS) return "after-this";
  return "general";
}

export interface SplitSections {
  whileHere: FeedSection[];
  afterThis: FeedSection[];
  general: FeedSection[];
}

/** Keeps the API's order within each group. */
export function splitSections(sections: FeedSection[]): SplitSections {
  const out: SplitSections = { whileHere: [], afterThis: [], general: [] };
  for (const s of sections) {
    const g = sectionGroup(s);
    if (g === "while-here") out.whileHere.push(s);
    else if (g === "after-this") out.afterThis.push(s);
    else out.general.push(s);
  }
  return out;
}

export function filterPlaces(items: ScoredPlace[], chipId: string | null | undefined): ScoredPlace[] {
  if (!chipId) return items;
  return items.filter((s) => chipMatches(chipId, s.place));
}

/** Narrow every section to the chip's categories and drop the ones left empty (PRD §7). */
export function filterSections(sections: FeedSection[], chipId: string | null | undefined): FeedSection[] {
  const narrowed = chipId ? sections.map((s) => ({ ...s, items: filterPlaces(s.items, chipId) })) : sections;
  return narrowed.filter((s) => s.items.length > 0);
}

export function filterBuckets(buckets: WalkBucket[], chipId: string | null | undefined): WalkBucket[] {
  const narrowed = chipId ? buckets.map((b) => ({ ...b, items: filterPlaces(b.items, chipId) })) : buckets;
  return narrowed.filter((b) => b.items.length > 0);
}

/** The selected chip, or null when it isn't offered for the current feed (e.g. after moving). */
export function activeChip(chips: CategoryChip[], chipId: string | null | undefined): CategoryChip | null {
  if (!chipId) return null;
  return chips.find((c) => c.id === chipId) ?? null;
}

/**
 * "Surprise me": a random pick among the best ~10 places that are open now.
 * Falls back to places with unknown hours (common with OpenStreetMap data),
 * never to places we know are closed.
 */
export function pickSurprise(
  places: ScoredPlace[],
  random: () => number = Math.random,
  topN = 10,
): ScoredPlace | null {
  const ranked = [...places].sort((a, b) => b.score - a.score);
  let pool = ranked.filter((s) => s.openNow === true).slice(0, topN);
  if (pool.length === 0) pool = ranked.filter((s) => s.openNow !== false).slice(0, topN);
  if (pool.length === 0) return null;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[i];
}

/** Above this GPS error we tell the user their position is approximate (PRD §26). */
export const APPROXIMATE_ACCURACY_M = 100;

export function accuracyNotice(accuracyM: number | undefined, thresholdM = APPROXIMATE_ACCURACY_M): string | null {
  if (accuracyM === undefined || !Number.isFinite(accuracyM) || accuracyM <= thresholdM) return null;
  const amount =
    accuracyM < 1000 ? `${Math.round(accuracyM)} m` : `${(accuracyM / 1000).toFixed(accuracyM < 10_000 ? 1 : 0)} km`;
  return `Location is approximate (±${amount})`;
}

export const RADIUS_OPTIONS = [500, 1000, 2000, 5000] as const;
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 5000;

export function formatRadius(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** Sanitise a stored radius preference to something the API accepts. */
export function normalizeRadius(m: unknown, fallback = 2000): number {
  if (typeof m !== "number" || !Number.isFinite(m)) return fallback;
  return Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Math.round(m)));
}

/** "100 Feet Road · Indiranagar, Bengaluru" — skips parts already in the headline. */
export function areaLine(area: AreaInfo, headline = ""): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of [area.street, area.neighborhood ?? area.label, area.city]) {
    const v = p?.trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    parts.push(v);
  }
  // If the headline already says "around Indiranagar", don't repeat it.
  return parts.filter((p) => !headline.toLowerCase().endsWith(p.toLowerCase())).join(", ");
}

export const DAY_PART_TITLE: Record<DayPart, string> = {
  morning: "Morning",
  lunch: "Lunchtime",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Late night",
};
