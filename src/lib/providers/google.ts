import { categoriesFromGoogleTypes } from "../categories";
import type { AreaInfo, LatLng, OpeningHours, Place } from "../types";
import { ProviderError, type GeocodeResult, type NearbyQuery, type PlacesProvider } from "./types";

const BASE = "https://places.googleapis.com/v1";
const GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json";

const PLACE_FIELDS = [
  "id",
  "displayName",
  "location",
  "types",
  "primaryType",
  "rating",
  "userRatingCount",
  "priceLevel",
  "regularOpeningHours",
  "currentOpeningHours",
  "formattedAddress",
  "shortFormattedAddress",
  "photos",
  "websiteUri",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "viewport",
];

const PRICE_LEVEL: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** Discovery-oriented types we ask Google for, so offices and ATMs don't crowd the feed. */
const INCLUDED_TYPES = [
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "dessert_shop",
  "ice_cream_shop",
  "bar",
  "night_club",
  "movie_theater",
  "bowling_alley",
  "amusement_center",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "shopping_mall",
  "book_store",
  "market",
  "gym",
  "hotel",
];

interface GPlace {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: GHours;
  currentOpeningHours?: GHours;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  photos?: {
    name: string;
    widthPx?: number;
    heightPx?: number;
    authorAttributions?: { displayName: string; uri?: string }[];
  }[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  viewport?: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } };
}

interface GHours {
  openNow?: boolean;
  periods?: { open: GPoint; close?: GPoint }[];
  weekdayDescriptions?: string[];
}
interface GPoint {
  day: number;
  hour: number;
  minute: number;
}

function hoursFrom(h: GHours | undefined): OpeningHours | undefined {
  if (!h?.periods?.length) return undefined;
  return {
    weekdayText: h.weekdayDescriptions,
    periods: h.periods.map((p) => ({
      openDay: p.open.day,
      openMinute: p.open.hour * 60 + p.open.minute,
      closeDay: p.close?.day,
      closeMinute: p.close ? p.close.hour * 60 + p.close.minute : undefined,
    })),
  };
}

/** Half the viewport diagonal is a decent "am I inside it?" radius for malls and parks. */
function footprint(v: GPlace["viewport"]): number | undefined {
  if (!v) return undefined;
  const dLat = (v.high.latitude - v.low.latitude) * 111_320;
  const dLng =
    (v.high.longitude - v.low.longitude) * 111_320 * Math.cos((v.low.latitude * Math.PI) / 180);
  return Math.min(600, Math.max(15, Math.sqrt(dLat ** 2 + dLng ** 2) / 4));
}

export function normalizeGooglePlace(g: GPlace): Place | null {
  if (!g.location || !g.displayName?.text) return null;
  const types = [g.primaryType, ...(g.types ?? [])].filter((t): t is string => !!t);
  const uniqueTypes = [...new Set(types)];
  return {
    id: `g:${g.id}`,
    provider: "google",
    name: g.displayName.text,
    lat: g.location.latitude,
    lng: g.location.longitude,
    types: uniqueTypes,
    categories: categoriesFromGoogleTypes(uniqueTypes),
    rating: g.rating,
    reviewCount: g.userRatingCount,
    priceLevel: g.priceLevel ? PRICE_LEVEL[g.priceLevel] : undefined,
    openingHours: hoursFrom(g.regularOpeningHours) ?? hoursFrom(g.currentOpeningHours),
    currentlyOpen: g.currentOpeningHours?.openNow ?? g.regularOpeningHours?.openNow,
    address: g.shortFormattedAddress ?? g.formattedAddress,
    photos: g.photos?.slice(0, 6).map((p) => ({
      // Resolved server-side by /api/photo so the API key never reaches the browser.
      url: `/api/photo?name=${encodeURIComponent(p.name)}`,
      width: p.widthPx,
      height: p.heightPx,
      attributions: p.authorAttributions?.map((a) => ({ name: a.displayName, uri: a.uri })),
    })),
    website: g.websiteUri,
    phone: g.internationalPhoneNumber ?? g.nationalPhoneNumber,
    footprintM: footprint(g.viewport),
  };
}

export class GooglePlacesProvider implements PlacesProvider {
  readonly name = "google" as const;

  constructor(private apiKey: string) {}

  private async post<T>(path: string, body: unknown, fields: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": fields,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(`Google ${path} ${res.status}`, "google", res.status);
    return (await res.json()) as T;
  }

  async nearby(q: NearbyQuery): Promise<Place[]> {
    const fields = PLACE_FIELDS.map((f) => `places.${f}`).join(",");
    const circle = {
      circle: { center: { latitude: q.lat, longitude: q.lng }, radius: Math.min(q.radiusM, 50_000) },
    };
    // Two passes: by distance (to catch the POI the user is standing in) and by
    // popularity (for "Popular around you"). Google caps each at 20 results.
    const [byDistance, byPopularity] = await Promise.all([
      this.post<{ places?: GPlace[] }>(
        "/places:searchNearby",
        { locationRestriction: circle, rankPreference: "DISTANCE", maxResultCount: 20 },
        fields,
      ),
      this.post<{ places?: GPlace[] }>(
        "/places:searchNearby",
        {
          locationRestriction: circle,
          includedTypes: INCLUDED_TYPES,
          rankPreference: "POPULARITY",
          maxResultCount: 20,
        },
        fields,
      ),
    ]);
    const seen = new Map<string, Place>();
    for (const g of [...(byDistance.places ?? []), ...(byPopularity.places ?? [])]) {
      const p = normalizeGooglePlace(g);
      if (p && !seen.has(p.id)) seen.set(p.id, p);
    }
    return [...seen.values()].slice(0, q.limit ?? 60);
  }

  async details(id: string): Promise<Place | null> {
    const raw = id.startsWith("g:") ? id.slice(2) : id;
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    const res = await fetch(`${BASE}/places/${raw}`, {
      headers: { "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": PLACE_FIELDS.join(",") },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new ProviderError(`Google details ${res.status}`, "google", res.status);
    return normalizeGooglePlace((await res.json()) as GPlace);
  }

  async reverseGeocode(p: LatLng): Promise<AreaInfo> {
    const url = `${GEOCODE}?latlng=${p.lat},${p.lng}&key=${this.apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new ProviderError(`Google geocode ${res.status}`, "google", res.status);
    const data = (await res.json()) as {
      results?: { address_components: { long_name: string; types: string[] }[] }[];
    };
    const comps = data.results?.[0]?.address_components ?? [];
    const find = (...types: string[]) =>
      comps.find((c) => types.some((t) => c.types.includes(t)))?.long_name;
    const street = find("route");
    const neighborhood = find("sublocality_level_1", "sublocality", "neighborhood");
    const city = find("locality", "administrative_area_level_2");
    return { street, neighborhood, city, label: neighborhood ?? street ?? city ?? "your location" };
  }

  async geocode(query: string, near?: LatLng): Promise<GeocodeResult[]> {
    const body: Record<string, unknown> = { textQuery: query, maxResultCount: 5 };
    if (near) {
      body.locationBias = {
        circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50_000 },
      };
    }
    const data = await this.post<{ places?: GPlace[] }>(
      "/places:searchText",
      body,
      "places.displayName,places.location,places.formattedAddress",
    );
    return (data.places ?? [])
      .filter((g) => g.location)
      .map((g) => ({
        lat: g.location!.latitude,
        lng: g.location!.longitude,
        label: [g.displayName?.text, g.formattedAddress].filter(Boolean).join(" · "),
      }));
  }
}
