import { contextRelevance } from "./context";
import { distanceMeters, walkMinutes } from "./geo";
import { openNow, type LocalTime } from "./time";
import type { Category, ContextType, DayPart, LatLng, Place, ScoredPlace } from "./types";

/**
 * Recommendation Score = Distance + Context + Open-now + Rating/popularity + Time-of-day
 * (PRD §13). Deterministic, no AI. Weights are configurable via
 * NOOKMAPS_RANKING_WEIGHTS so they can be tuned from analytics.
 */
export interface RankingWeights {
  distance: number;
  context: number;
  open: number;
  rating: number;
  time: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  distance: 0.3,
  context: 0.2,
  open: 0.2,
  rating: 0.2,
  time: 0.1,
};

export function loadWeights(raw: string | undefined = process.env.NOOKMAPS_RANKING_WEIGHTS): RankingWeights {
  if (!raw) return DEFAULT_WEIGHTS;
  try {
    const parsed = JSON.parse(raw) as Partial<RankingWeights>;
    const merged = { ...DEFAULT_WEIGHTS };
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof RankingWeights)[]) {
      const v = parsed[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[k] = v;
    }
    return merged;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

/** PRD §10: what each part of the day favours. */
const TIME_AFFINITY: Record<DayPart, Partial<Record<Category, number>>> = {
  morning: { coffee: 1, bakery: 1, park: 0.9, outdoors: 0.9, gym: 0.9, food: 0.6 },
  lunch: { food: 1, coffee: 0.6, mall: 0.6, museum: 0.6, workspace: 0.6 },
  afternoon: { coffee: 0.9, dessert: 0.9, shopping: 0.8, mall: 0.8, museum: 0.8, attraction: 0.8, park: 0.7 },
  evening: { coffee: 0.8, food: 0.9, shopping: 0.8, entertainment: 0.9, cinema: 0.9, bar: 0.8, dessert: 0.8 },
  night: { food: 0.9, cinema: 1, bar: 1, nightlife: 1, dessert: 0.7, entertainment: 0.7 },
};

export function timeRelevance(dayPart: DayPart, categories: Category[]): number {
  const table = TIME_AFFINITY[dayPart];
  return Math.max(0.3, ...categories.map((c) => table[c] ?? 0.3));
}

/** Popularity blends quality and volume so a 5.0 with 3 reviews doesn't win. */
export function popularity(place: Place): number {
  if (place.rating === undefined) return 0.4;
  const quality = Math.max(0, (place.rating - 2.5) / 2.5);
  const volume = Math.min(1, Math.log10((place.reviewCount ?? 0) + 1) / 4);
  return 0.6 * quality + 0.4 * volume;
}

/** 1 when you're there, ~0.5 at 10 min, ~0.1 at 30 min walk. */
export function distanceRelevance(minutes: number): number {
  return Math.exp(-minutes / 14);
}

export interface RankInput {
  origin: LatLng;
  places: Place[];
  context: ContextType;
  dayPart: DayPart;
  now: LocalTime;
  weights?: RankingWeights;
  /** Exclude these ids (e.g. the venue you're standing in). */
  exclude?: Set<string>;
}

export function scorePlace(
  place: Place,
  input: Omit<RankInput, "places" | "exclude">,
): ScoredPlace {
  const w = input.weights ?? DEFAULT_WEIGHTS;
  const distanceM = distanceMeters(input.origin, place);
  const minutes = walkMinutes(distanceM);
  const open = openNow(place, input.now);
  const breakdown = {
    distance: w.distance * distanceRelevance(minutes),
    context: w.context * contextRelevance(input.context, place.categories),
    open: w.open * (open === true ? 1 : open === null ? 0.5 : 0),
    rating: w.rating * popularity(place),
    time: w.time * timeRelevance(input.dayPart, place.categories),
  };
  // Sponsored placements never change the score; they are only labelled in the UI.
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { place, distanceM, walkMinutes: minutes, openNow: open, score, breakdown };
}

export function rankPlaces(input: RankInput): ScoredPlace[] {
  return input.places
    .filter((p) => !input.exclude?.has(p.id))
    .map((p) => scorePlace(p, input))
    .sort((a, b) => b.score - a.score);
}
