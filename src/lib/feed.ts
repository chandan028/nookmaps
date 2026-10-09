import { CHIP_GROUPS, THINGS_TO_DO, hasAny } from "./categories";
import { contextPlan, detectContext, type ContextSectionSpec } from "./context";
import { distanceMeters, walkBucket, WALK_BUCKETS } from "./geo";
import { rankPlaces, scorePlace, type RankingWeights } from "./ranking";
import { addMinutes, dayPart as dayPartOf, isOpenAt, localTime, openNow, type LocalTime } from "./time";
import type {
  AreaInfo,
  Category,
  CategoryChip,
  DayPart,
  DetectedContext,
  DiscoverResponse,
  FeedSection,
  LatLng,
  Place,
  ProviderName,
  ScoredPlace,
  WalkBucket,
} from "./types";

/** Show a small number of strong options first (PRD §26). */
export const SECTION_SIZE = 8;

export interface BuildFeedInput {
  origin: LatLng & { accuracyM?: number };
  places: Place[];
  area: AreaInfo;
  nowMs: number;
  tzOffsetMinutes: number;
  radiusM: number;
  provider: ProviderName;
  weights?: RankingWeights;
}

function take(items: ScoredPlace[], n = SECTION_SIZE): ScoredPlace[] {
  return items.slice(0, n);
}

/** Primary sections never lead with places we know are closed (PRD §10). */
function notClosed(s: ScoredPlace): boolean {
  return s.openNow !== false;
}

function openTonight(place: Place, now: LocalTime): boolean {
  const tonight: LocalTime = { day: now.day, minute: Math.max(now.minute, 20 * 60 + 30) };
  if (typeof place.currentlyOpen === "boolean" && now.minute >= 18 * 60) return place.currentlyOpen;
  return isOpenAt(place.openingHours, tonight) === true;
}

/** Order the generic sections by what matters at this time of day (PRD §10). */
const SECTION_ORDER: Record<DayPart, string[]> = {
  morning: ["popular", "coffee", "breakfast", "open-now", "explore", "things-to-do", "food"],
  lunch: ["popular", "food", "open-now", "coffee", "explore", "things-to-do"],
  afternoon: ["popular", "coffee", "things-to-do", "open-now", "explore", "food", "tonight"],
  evening: ["popular", "food", "tonight", "things-to-do", "coffee", "open-now", "explore"],
  night: ["tonight", "popular", "food", "open-now", "things-to-do", "explore", "coffee"],
};

export function contextSections(
  specs: ContextSectionSpec[],
  ranked: ScoredPlace[],
  opts: { venue?: Place; now: LocalTime; prefix: string },
): FeedSection[] {
  const out: FeedSection[] = [];
  for (const spec of specs) {
    const later = spec.lookAheadMin ? addMinutes(opts.now, spec.lookAheadMin) : opts.now;
    const items = ranked.filter((s) => {
      if (!hasAny(s.place, spec.categories)) return false;
      if (spec.maxWalk !== undefined && s.walkMinutes > spec.maxWalk) return false;
      if (spec.insideVenue) {
        if (!opts.venue) return false;
        const r = opts.venue.footprintM ?? 50;
        if (distanceMeters(opts.venue, s.place) > r) return false;
      }
      // "After this" should be open when you'd actually get there.
      const openLater =
        typeof s.place.currentlyOpen === "boolean" && !spec.lookAheadMin
          ? s.place.currentlyOpen
          : isOpenAt(s.place.openingHours, later);
      return openLater !== false;
    });
    if (items.length) {
      out.push({
        id: `${opts.prefix}-${spec.id}`,
        title: spec.title,
        category: spec.categories[0],
        items: take(items, 6),
      });
    }
  }
  return out;
}

export function buildChips(ranked: ScoredPlace[]): CategoryChip[] {
  // Only chips that have something behind them (PRD §7).
  return CHIP_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    emoji: g.emoji,
    count: ranked.filter((s) => hasAny(s.place, g.categories)).length,
  })).filter((c) => c.count > 0);
}

export function buildBuckets(ranked: ScoredPlace[]): WalkBucket[] {
  const byDistance = [...ranked].sort((a, b) => a.distanceM - b.distanceM);
  return WALK_BUCKETS.map((minutes, i) => {
    const prev = i === 0 ? 0 : WALK_BUCKETS[i - 1];
    return {
      minutes,
      label: `Within ${minutes} min`,
      items: byDistance.filter((s) => {
        const b = walkBucket(s.walkMinutes);
        return b === minutes && s.walkMinutes > prev && notClosed(s);
      }),
    };
  }).filter((b) => b.items.length > 0);
}

function genericSections(ranked: ScoredPlace[], now: LocalTime, part: DayPart): FeedSection[] {
  const open = ranked.filter(notClosed);
  const of = (cats: Category[]) => open.filter((s) => hasAny(s.place, cats));
  const all: Record<string, FeedSection> = {
    popular: {
      id: "popular",
      title: "Popular around you",
      items: take(
        [...open]
          .filter((s) => s.walkMinutes <= 30)
          .sort((a, b) => b.breakdown.rating + b.breakdown.distance - (a.breakdown.rating + a.breakdown.distance)),
      ),
    },
    "open-now": {
      id: "open-now",
      title: "Open now",
      items: take(ranked.filter((s) => s.openNow === true)),
    },
    food: {
      id: "food",
      title: part === "lunch" ? "Lunch nearby" : part === "night" ? "Late-night food" : "Food nearby",
      category: "food",
      items: take(of(["food", "bakery", "dessert"])),
    },
    breakfast: {
      id: "breakfast",
      title: "Breakfast & bakeries",
      category: "bakery",
      items: take(of(["bakery", "coffee"]).filter((s) => s.walkMinutes <= 15)),
    },
    coffee: { id: "coffee", title: "Coffee nearby", category: "coffee", items: take(of(["coffee"])) },
    "things-to-do": {
      id: "things-to-do",
      title: "Things to do",
      category: "things-to-do",
      items: take(of(THINGS_TO_DO)),
    },
    explore: {
      id: "explore",
      title: "Explore nearby",
      subtitle: "Within a 15 minute walk",
      items: take(
        [...open].filter((s) => s.walkMinutes <= 15).sort((a, b) => a.distanceM - b.distanceM),
        10,
      ),
    },
    tonight: {
      id: "tonight",
      title: "Tonight",
      subtitle: "Open into the evening",
      items: take(
        ranked.filter(
          (s) =>
            hasAny(s.place, ["food", "bar", "nightlife", "cinema", "entertainment", "dessert"]) &&
            openTonight(s.place, now),
        ),
      ),
    },
  };
  return SECTION_ORDER[part].map((id) => all[id]).filter((s) => s && s.items.length > 0);
}

export function headlineFor(context: DetectedContext, area: AreaInfo): string {
  if (context.currentPlace) return `You're at ${context.currentPlace.name}`;
  return `You're around ${area.label}`;
}

export function buildFeed(input: BuildFeedInput): DiscoverResponse {
  const now = localTime(input.nowMs, input.tzOffsetMinutes);
  const part = dayPartOf(now);
  const context = detectContext(input.origin, input.places);
  const exclude = new Set(context.currentPlace ? [context.currentPlace.id] : []);
  const ranked = rankPlaces({
    origin: input.origin,
    places: input.places,
    context: context.type,
    dayPart: part,
    now,
    weights: input.weights,
    exclude,
  }).filter((s) => s.distanceM <= input.radiusM * 1.1);

  const sections: FeedSection[] = [];
  if (context.currentPlace) {
    const plan = contextPlan(context.type, part);
    sections.push(
      ...contextSections(plan.whileHere, ranked, { venue: context.currentPlace, now, prefix: "while-here" }).map(
        (s) => ({ ...s, subtitle: "While you're here" }),
      ),
      ...contextSections(plan.afterThis, ranked, { venue: context.currentPlace, now, prefix: "after-this" }).map(
        (s) => ({ ...s, subtitle: "After this" }),
      ),
    );
  }
  sections.push(...genericSections(ranked, now, part));

  return {
    origin: input.origin,
    area: input.area,
    context,
    dayPart: part,
    headline: headlineFor(context, input.area),
    chips: buildChips(ranked),
    sections,
    buckets: buildBuckets(ranked),
    places: ranked,
    provider: input.provider,
    radiusM: input.radiusM,
  };
}

/** "What next?" for a place detail page (PRD §14, §15). */
export function whatNext(
  place: Place,
  nearby: Place[],
  nowMs: number,
  tzOffsetMinutes: number,
  weights?: RankingWeights,
): { sections: FeedSection[]; current: ScoredPlace } {
  const now = localTime(nowMs, tzOffsetMinutes);
  const part = dayPartOf(now);
  const ctx = detectContext({ lat: place.lat, lng: place.lng, accuracyM: 5 }, [place]);
  const type = ctx.type;
  const ranked = rankPlaces({
    origin: place,
    places: nearby,
    context: type,
    dayPart: part,
    now,
    weights,
    exclude: new Set([place.id]),
  });
  const plan = contextPlan(type === "street" ? "restaurant" : type, part);
  const sections = [
    ...contextSections(plan.whileHere, ranked, { venue: place, now, prefix: "while-here" }),
    ...contextSections(plan.afterThis, ranked, { venue: place, now, prefix: "after-this" }),
  ];
  const current = scorePlace(place, { origin: place, context: type, dayPart: part, now, weights });
  current.openNow = openNow(place, now);
  return { sections, current };
}
