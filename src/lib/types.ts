// Normalized internal place model (PRD §12). Every provider maps into this shape
// so the context and recommendation engines never see provider-specific fields.

export type Category =
  | "food"
  | "coffee"
  | "dessert"
  | "bakery"
  | "bar"
  | "nightlife"
  | "cinema"
  | "entertainment"
  | "attraction"
  | "museum"
  | "park"
  | "outdoors"
  | "shopping"
  | "mall"
  | "hotel"
  | "gym"
  | "campus"
  | "workspace"
  | "other";

export interface LatLng {
  lat: number;
  lng: number;
}

/** A weekly opening period, minutes since Sunday 00:00 in the place's local time. */
export interface OpeningPeriod {
  /** 0 = Sunday … 6 = Saturday */
  openDay: number;
  openMinute: number;
  /** Absent for places open 24 hours. */
  closeDay?: number;
  closeMinute?: number;
}

export interface OpeningHours {
  periods: OpeningPeriod[];
  /** Human readable lines, e.g. "Monday: 8:00 AM – 10:00 PM". */
  weekdayText?: string[];
  /** Raw provider string (e.g. OSM `opening_hours`) kept for display. */
  raw?: string;
}

export interface PlacePhoto {
  /** Either a full URL or a provider photo reference resolved by /api/photo. */
  url: string;
  width?: number;
  height?: number;
  attributions?: { name: string; uri?: string }[];
}

export type ProviderName = "google" | "osm" | "demo";

export interface Place {
  id: string;
  provider: ProviderName;
  name: string;
  lat: number;
  lng: number;
  categories: Category[];
  /** Provider types kept for transparency and context matching. */
  types: string[];
  rating?: number;
  reviewCount?: number;
  /** 0 (free) … 4 (very expensive) */
  priceLevel?: number;
  openingHours?: OpeningHours;
  /** Live status from the provider, when it gives one. */
  currentlyOpen?: boolean;
  address?: string;
  photos?: PlacePhoto[];
  website?: string;
  phone?: string;
  /** Approximate footprint radius in metres, used for "am I inside it?" checks. */
  footprintM?: number;
  /** Reserved for future clearly-labelled sponsored placements (PRD §13, §25). */
  sponsored?: boolean;
}

export type DayPart = "morning" | "lunch" | "afternoon" | "evening" | "night";

export type ContextType =
  | "cafe"
  | "restaurant"
  | "bar"
  | "mall"
  | "attraction"
  | "park"
  | "hotel"
  | "campus"
  | "street";

export interface DetectedContext {
  type: ContextType;
  /** The POI the user is at, only when confidence is high enough. */
  currentPlace?: Place;
  confidence: number;
  /** Why we decided this, shown in a tooltip and useful for debugging. */
  reason: string;
}

export interface ScoredPlace {
  place: Place;
  distanceM: number;
  walkMinutes: number;
  openNow: boolean | null;
  score: number;
  breakdown: Record<string, number>;
}

export interface FeedSection {
  id: string;
  title: string;
  subtitle?: string;
  /** Category the section is about, so tapping "see all" can filter. */
  category?: Category | "things-to-do";
  items: ScoredPlace[];
}

export interface AreaInfo {
  label: string;
  street?: string;
  neighborhood?: string;
  city?: string;
}

export interface CategoryChip {
  id: string;
  label: string;
  emoji: string;
  count: number;
}

export interface WalkBucket {
  minutes: 5 | 10 | 15 | 30;
  label: string;
  items: ScoredPlace[];
}

export interface DiscoverResponse {
  origin: LatLng & { accuracyM?: number };
  area: AreaInfo;
  context: DetectedContext;
  dayPart: DayPart;
  headline: string;
  chips: CategoryChip[];
  sections: FeedSection[];
  buckets: WalkBucket[];
  places: ScoredPlace[];
  provider: ProviderName;
  radiusM: number;
}
