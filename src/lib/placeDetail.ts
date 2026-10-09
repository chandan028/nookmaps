import { CATEGORY_LABEL } from "./categories";
import { placeHref } from "./links";
import { formatClock } from "./time";
import type { FeedSection, OpeningHours, Place, ProviderName, ScoredPlace } from "./types";

/* ---------- "What next?" (PRD §14, §15) ---------- */

export type WhatNextGroupId = "while-here" | "after-this" | "more";

export interface WhatNextGroup {
  id: WhatNextGroupId;
  title: string;
  sections: FeedSection[];
}

const GROUP_TITLES: Record<WhatNextGroupId, string> = {
  "while-here": "While you're here",
  "after-this": "After this",
  more: "More nearby",
};

/**
 * Split the API's What-next sections into "While you're here" and "After
 * this" by their id prefix, keeping the API's order inside each group. Any
 * section without a known prefix lands in "More nearby" so nothing is lost.
 * Empty sections and empty groups are dropped.
 */
export function groupWhatNext(sections: FeedSection[]): WhatNextGroup[] {
  const groups: Record<WhatNextGroupId, FeedSection[]> = { "while-here": [], "after-this": [], more: [] };
  for (const s of sections) {
    if (!s.items.length) continue;
    const id: WhatNextGroupId = s.id.startsWith("while-here-")
      ? "while-here"
      : s.id.startsWith("after-this-")
        ? "after-this"
        : "more";
    groups[id].push(s);
  }
  return (Object.keys(groups) as WhatNextGroupId[])
    .filter((id) => groups[id].length > 0)
    .map((id) => ({ id, title: GROUP_TITLES[id], sections: groups[id] }));
}

/** Every place mentioned in the sections, once, in first-seen order (for the map). */
export function whatNextPlaces(sections: FeedSection[], excludeId?: string): ScoredPlace[] {
  const seen = new Set<string>(excludeId ? [excludeId] : []);
  const out: ScoredPlace[] = [];
  for (const s of sections) {
    for (const item of s.items) {
      if (seen.has(item.place.id)) continue;
      seen.add(item.place.id);
      out.push(item);
    }
  }
  return out;
}

/* ---------- Photos and links ---------- */

/** Our photo proxy takes a width; other photo URLs are used as-is. */
export function photoSrc(url: string, width: number): string {
  if (!url.startsWith("/api/photo")) return url;
  const w = Math.round(width);
  if (/[?&]w=/.test(url)) return url.replace(/([?&])w=\d*/, `$1w=${w}`);
  return `${url}${url.includes("?") ? "&" : "?"}w=${w}`;
}

/**
 * Provider URLs are untrusted (OSM tags are user-edited). Only allow http(s),
 * add a scheme to bare domains ("www.example.com") and to protocol-relative
 * URLs (Google photo attributions use "//maps.google.com/…").
 */
export function safeExternalUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  if (s.startsWith("//")) s = `https:${s}`;
  else if (!/^[a-z][a-z\d+.-]*:/i.test(s)) {
    if (!/^[a-z\d-]+(\.[a-z\d-]+)+([/?#:]|$)/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** "example.com" for a website button caption. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Saved places only keep the id; recover the provider from its prefix. */
export function providerFromId(id: string): ProviderName {
  if (id.startsWith("g:")) return "google";
  if (id.startsWith("demo:")) return "demo";
  return "osm";
}

/* ---------- Opening hours ---------- */

export interface DayHours {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  label: string;
  text: string;
  isToday: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, like Google's weekday descriptions. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * A full week of opening hours for the detail view, Monday first. Uses the
 * provider's own weekday text when it has it; otherwise builds it from the
 * periods. Returns null when there's nothing reliable to show.
 */
export function weeklyHours(hours: OpeningHours | undefined, today: number): DayHours[] | null {
  if (!hours) return null;

  if (hours.weekdayText && hours.weekdayText.length === 7) {
    return hours.weekdayText.map((line, i) => {
      const idx = line.indexOf(":");
      const name = idx > 0 ? line.slice(0, idx).trim() : "";
      const known = DAY_NAMES.findIndex((d) => d.toLowerCase() === name.toLowerCase());
      const day = known >= 0 ? known : WEEK_ORDER[i];
      const text = (idx > 0 ? line.slice(idx + 1) : line).replace(/[  ]/g, " ").trim();
      return { day, label: DAY_NAMES[day], text: text || "Hours unknown", isToday: day === today };
    });
  }

  const periods = hours.periods ?? [];
  if (!periods.length) return null;

  const allDay = (p: (typeof periods)[number]) =>
    (p.closeDay === undefined || p.closeMinute === undefined) ||
    (p.openMinute === 0 && p.closeMinute === 0 && p.closeDay === (p.openDay + 1) % 7);
  // Google encodes "open 24/7" as a single period with no close time.
  const alwaysOpen =
    periods.length === 1 && periods[0].openDay === 0 && periods[0].openMinute === 0 && periods[0].closeDay === undefined;

  return WEEK_ORDER.map((day) => {
    let text: string;
    if (alwaysOpen) text = "Open 24 hours";
    else {
      const todays = periods.filter((p) => p.openDay === day).sort((a, b) => a.openMinute - b.openMinute);
      if (!todays.length) text = "Closed";
      else if (todays.some(allDay)) text = "Open 24 hours";
      else text = todays.map((p) => `${formatClock(p.openMinute)} – ${formatClock(p.closeMinute!)}`).join(", ");
    }
    return { day, label: DAY_NAMES[day], text, isToday: day === today };
  });
}

/* ---------- Sharing ---------- */

export interface ShareContent {
  title: string;
  text: string;
  url: string;
}

/**
 * What we hand to `navigator.share` (or the clipboard). Only public facts
 * about the place: never the user's own position.
 */
export function shareContent(
  place: Pick<Place, "id" | "name" | "categories" | "rating">,
  siteOrigin: string,
): ShareContent {
  const cat = place.categories[0] ?? "other";
  const parts = [CATEGORY_LABEL[cat]];
  if (place.rating !== undefined) parts.push(`★ ${place.rating.toFixed(1)}`);
  return {
    title: place.name,
    text: `${place.name} (${parts.join(" · ")}), found on NookMaps`,
    url: `${siteOrigin.replace(/\/+$/, "")}${placeHref(place.id)}`,
  };
}

/** Single string for the clipboard fallback. */
export function shareClipboardText(s: ShareContent): string {
  return `${s.text}\n${s.url}`;
}
