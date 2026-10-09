import { contextTypeForPlace } from "./categories";
import { distanceMeters } from "./geo";
import type { Category, ContextType, DayPart, DetectedContext, LatLng, Place } from "./types";

/** Below this we say "You're around X", never "You're at Y" (PRD §26). */
export const CONFIDENCE_THRESHOLD = 0.55;
/** GPS fixes worse than this are too coarse to claim any venue. */
const MAX_USABLE_ACCURACY_M = 120;
const DEFAULT_FOOTPRINT_M = 20;
const CONTAINER_TYPES: ContextType[] = ["mall", "park", "campus", "hotel", "attraction"];

interface Candidate {
  place: Place;
  distance: number;
  footprint: number;
  score: number;
}

/**
 * Decide whether the user is at a specific POI. A place is a candidate when
 * the user is within its footprint plus the GPS error. Confidence drops
 * with distance, with poor accuracy, and when a second venue is just as
 * close (two cafes next door to each other).
 */
export function detectContext(origin: LatLng & { accuracyM?: number }, places: Place[]): DetectedContext {
  const accuracy = Math.max(5, origin.accuracyM ?? 30);
  if (accuracy > MAX_USABLE_ACCURACY_M) {
    return {
      type: "street",
      confidence: 0,
      reason: `Location accuracy is ±${Math.round(accuracy)} m, too coarse to tell which venue you're in.`,
    };
  }

  const candidates: Candidate[] = [];
  for (const place of places) {
    if (place.categories.length === 1 && place.categories[0] === "other") continue;
    const distance = distanceMeters(origin, place);
    const footprint = place.footprintM ?? DEFAULT_FOOTPRINT_M;
    const reach = footprint + accuracy;
    if (distance > reach) continue;
    // 1 at the centre, ~0.5 at the footprint edge, 0 at the edge of GPS error.
    const proximity = 1 - distance / reach;
    const accuracyFactor = 1 - Math.min(1, accuracy / MAX_USABLE_ACCURACY_M) * 0.5;
    candidates.push({ place, distance, footprint, score: proximity * accuracyFactor });
  }
  if (candidates.length === 0) {
    return { type: "street", confidence: 0, reason: "No venue close enough to your position." };
  }

  candidates.sort((a, b) => b.score - a.score);
  const containers = candidates.filter(
    (c) => CONTAINER_TYPES.includes(contextTypeForPlace(c.place)) && c.distance <= c.footprint,
  );
  const small = candidates.filter((c) => !containers.includes(c));

  // Prefer a specific small venue when we're clearly inside it.
  const best = small[0];
  if (best) {
    const rival = small[1];
    const ambiguity = rival ? Math.min(1, rival.score / Math.max(best.score, 1e-6)) : 0;
    const confidence = best.score * (1 - 0.6 * ambiguity) + (best.distance <= best.footprint ? 0.25 : 0);
    if (confidence >= CONFIDENCE_THRESHOLD) {
      return {
        type: contextTypeForPlace(best.place),
        currentPlace: best.place,
        confidence: Math.min(1, confidence),
        reason: `${Math.round(best.distance)} m from ${best.place.name} with ±${Math.round(accuracy)} m accuracy.`,
      };
    }
  }

  // Otherwise, are we inside a large venue (mall, park, campus, hotel)?
  const container = containers.sort((a, b) => a.footprint - b.footprint)[0];
  if (container) {
    const confidence = Math.min(1, 0.5 + 0.5 * (1 - container.distance / container.footprint));
    if (confidence >= CONFIDENCE_THRESHOLD) {
      return {
        type: contextTypeForPlace(container.place),
        currentPlace: container.place,
        confidence,
        reason: `Inside the area of ${container.place.name}.`,
      };
    }
  }

  return {
    type: "street",
    confidence: best?.score ?? 0,
    reason: "Several venues nearby; not confident which one you're in.",
  };
}

/* ---------- Context-specific recommendation plans (PRD §6, §15, §18) ---------- */

export interface ContextSectionSpec {
  id: string;
  title: string;
  categories: Category[];
  /** Only places within this walk. */
  maxWalk?: number;
  /** Only places inside the current venue's footprint (malls, campuses). */
  insideVenue?: boolean;
  /** Evaluate open status at this many minutes from now (for "after this"). */
  lookAheadMin?: number;
}

export interface ContextPlan {
  whileHere: ContextSectionSpec[];
  afterThis: ContextSectionSpec[];
  /** Things to try at the current place, by venue type. */
  tips?: string[];
}

function mealFor(dayPart: DayPart): { title: string; cats: Category[] } {
  switch (dayPart) {
    case "morning":
      return { title: "Breakfast nearby", cats: ["bakery", "food", "coffee"] };
    case "lunch":
      return { title: "Lunch nearby", cats: ["food"] };
    case "afternoon":
      return { title: "Snacks nearby", cats: ["bakery", "dessert", "food"] };
    case "evening":
      return { title: "Dinner nearby", cats: ["food"] };
    case "night":
      return { title: "Late-night food", cats: ["food"] };
  }
}

export function contextPlan(type: ContextType, dayPart: DayPart): ContextPlan {
  const meal = mealFor(dayPart);
  const late = dayPart === "evening" || dayPart === "night";
  switch (type) {
    case "cafe":
      return {
        tips: [
          "Ask for the house signature drink or the barista's pick of the day.",
          "Pair it with something fresh from the bakery counter.",
          "Most cafés are fine for an hour of work; look for a plug point.",
        ],
        whileHere: [
          { id: "here-coffee", title: "More coffee spots", categories: ["coffee"], maxWalk: 5 },
          { id: "here-desserts", title: "Desserts", categories: ["dessert", "bakery"], maxWalk: 5 },
          { id: "here-work", title: "Work-friendly spots", categories: ["workspace"], maxWalk: 10 },
        ],
        afterThis: [
          { id: "after-meal", title: meal.title, categories: meal.cats, maxWalk: 15, lookAheadMin: 45 },
          { id: "after-movies", title: "Movies nearby", categories: ["cinema"], maxWalk: 30, lookAheadMin: 45 },
          { id: "after-activities", title: "Activities nearby", categories: ["entertainment", "attraction", "museum"], maxWalk: 30, lookAheadMin: 45 },
          { id: "after-walk", title: "Places to walk", categories: ["park", "outdoors"], maxWalk: 20, lookAheadMin: 45 },
        ],
      };
    case "restaurant":
      return {
        tips: ["Check the specials board or ask what the kitchen is known for."],
        whileHere: [],
        afterThis: [
          { id: "after-dessert", title: "Dessert", categories: ["dessert", "bakery"], maxWalk: 10, lookAheadMin: 60 },
          { id: "after-coffee", title: "Coffee", categories: ["coffee"], maxWalk: 10, lookAheadMin: 60 },
          { id: "after-drinks", title: "Drinks", categories: ["bar", "nightlife"], maxWalk: 15, lookAheadMin: 60 },
          { id: "after-movies", title: "Movies", categories: ["cinema"], maxWalk: 30, lookAheadMin: 60 },
          { id: "after-walk", title: "Walks", categories: ["park", "outdoors"], maxWalk: 20, lookAheadMin: 60 },
          { id: "after-activities", title: "Activities nearby", categories: ["entertainment", "attraction"], maxWalk: 30, lookAheadMin: 60 },
        ],
      };
    case "bar":
      return {
        whileHere: [],
        afterThis: [
          { id: "after-latefood", title: "Late-night food", categories: ["food"], maxWalk: 15, lookAheadMin: 90 },
          { id: "after-nightlife", title: "Nightlife", categories: ["nightlife", "bar"], maxWalk: 20, lookAheadMin: 90 },
          { id: "after-dessert", title: "Something sweet", categories: ["dessert"], maxWalk: 15, lookAheadMin: 90 },
        ],
      };
    case "mall":
      return {
        whileHere: [
          { id: "here-food", title: "Eat here", categories: ["food"], insideVenue: true },
          { id: "here-coffee", title: "Cafés here", categories: ["coffee", "dessert", "bakery"], insideVenue: true },
          { id: "here-cinema", title: "Cinema", categories: ["cinema"], insideVenue: true },
          { id: "here-shopping", title: "Stores", categories: ["shopping"], insideVenue: true },
          { id: "here-fun", title: "Entertainment", categories: ["entertainment"], insideVenue: true },
        ],
        afterThis: [
          { id: "after-meal", title: meal.title, categories: meal.cats, maxWalk: 15, lookAheadMin: 60 },
          { id: "after-activities", title: "Activities nearby", categories: ["entertainment", "attraction", "park"], maxWalk: 30, lookAheadMin: 60 },
        ],
      };
    case "attraction":
      return {
        whileHere: [
          { id: "here-photo", title: "Photo spots", categories: ["attraction", "park", "outdoors"], maxWalk: 10 },
        ],
        afterThis: [
          { id: "after-attractions", title: "Nearby attractions", categories: ["attraction", "museum"], maxWalk: 30, lookAheadMin: 60 },
          { id: "after-meal", title: meal.title, categories: meal.cats, maxWalk: 15, lookAheadMin: 60 },
          { id: "after-coffee", title: "Cafés", categories: ["coffee"], maxWalk: 15, lookAheadMin: 60 },
          { id: "after-shopping", title: "Shopping", categories: ["shopping", "mall"], maxWalk: 20, lookAheadMin: 60 },
          { id: "after-walk", title: "Walking routes", categories: ["park", "outdoors"], maxWalk: 20, lookAheadMin: 60 },
        ],
      };
    case "park":
      return {
        whileHere: [
          { id: "here-walk", title: "Walking options", categories: ["park", "outdoors"], maxWalk: 15 },
        ],
        afterThis: [
          { id: "after-meal", title: meal.title, categories: meal.cats, maxWalk: 15, lookAheadMin: 45 },
          { id: "after-coffee", title: "Cafés", categories: ["coffee", "bakery"], maxWalk: 15, lookAheadMin: 45 },
          { id: "after-attractions", title: "Attractions", categories: ["attraction", "museum"], maxWalk: 30, lookAheadMin: 45 },
          { id: "after-activities", title: "Activities nearby", categories: ["entertainment", "gym"], maxWalk: 30, lookAheadMin: 45 },
        ],
      };
    case "hotel":
      return {
        whileHere: [],
        afterThis: [
          { id: "after-meal", title: meal.title, categories: meal.cats, maxWalk: 15 },
          { id: "after-attractions", title: "Attractions", categories: ["attraction", "museum"], maxWalk: 30 },
          ...(late
            ? [{ id: "after-nightlife", title: "Nightlife", categories: ["bar", "nightlife"] as Category[], maxWalk: 20 }]
            : []),
          { id: "after-shopping", title: "Shopping", categories: ["shopping", "mall"], maxWalk: 30 },
          { id: "after-activities", title: "Activities", categories: ["entertainment", "park", "gym"], maxWalk: 30 },
        ],
      };
    case "campus":
      return {
        whileHere: [
          { id: "here-coffee", title: "Coffee breaks", categories: ["coffee"], maxWalk: 10 },
          { id: "here-work", title: "Study & work spots", categories: ["workspace", "coffee"], maxWalk: 15 },
        ],
        afterThis: [
          { id: "after-meal", title: meal.title, categories: meal.cats, maxWalk: 15 },
          { id: "after-activities", title: "Unwind", categories: ["entertainment", "park", "gym", "cinema"], maxWalk: 30 },
        ],
      };
    case "street":
      return { whileHere: [], afterThis: [] };
  }
}

/** How relevant each category is to a context, 0–1, for the ranking engine. */
export function contextRelevance(type: ContextType, categories: Category[]): number {
  const affinity: Partial<Record<ContextType, Partial<Record<Category, number>>>> = {
    cafe: { dessert: 0.9, bakery: 0.8, food: 0.7, park: 0.7, workspace: 0.7, cinema: 0.6, entertainment: 0.6, attraction: 0.6, coffee: 0.3 },
    restaurant: { dessert: 1, coffee: 0.9, bar: 0.8, cinema: 0.8, park: 0.7, entertainment: 0.7, food: 0.2 },
    bar: { food: 0.9, nightlife: 0.9, dessert: 0.7, bar: 0.6 },
    mall: { food: 0.9, coffee: 0.9, cinema: 0.9, shopping: 0.8, entertainment: 0.8, dessert: 0.8 },
    attraction: { attraction: 1, museum: 0.9, food: 0.8, coffee: 0.8, park: 0.8, shopping: 0.6 },
    park: { park: 0.9, outdoors: 0.9, coffee: 0.8, food: 0.8, attraction: 0.7, entertainment: 0.6 },
    hotel: { food: 0.9, attraction: 0.9, bar: 0.8, nightlife: 0.8, shopping: 0.7, entertainment: 0.7 },
    campus: { coffee: 1, food: 0.9, workspace: 0.9, entertainment: 0.6, park: 0.6 },
    street: {},
  };
  const table = affinity[type] ?? {};
  if (type === "street") return categories.includes("other") ? 0.2 : 0.6;
  return Math.max(0.2, ...categories.map((c) => table[c] ?? 0.3));
}
