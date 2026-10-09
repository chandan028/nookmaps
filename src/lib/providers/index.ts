import { TtlCache } from "../cache";
import { roundCoord } from "../geo";
import type { AreaInfo, LatLng, Place, ProviderName } from "../types";
import { DemoProvider } from "./demo";
import { GooglePlacesProvider } from "./google";
import { OsmProvider } from "./osm";
import type { GeocodeResult, NearbyQuery, PlacesProvider } from "./types";

export type { PlacesProvider } from "./types";

const nearbyCache = new TtlCache<{ places: Place[]; provider: ProviderName }>(5 * 60_000);
const detailsCache = new TtlCache<Place | null>(10 * 60_000);
const areaCache = new TtlCache<AreaInfo>(30 * 60_000);

/** Ordered provider chain: the first one that answers wins (PRD §11, §22). */
export function providerChain(env: NodeJS.ProcessEnv = process.env): PlacesProvider[] {
  const forced = env.NOOKMAPS_PROVIDER as ProviderName | undefined;
  const google = env.GOOGLE_MAPS_API_KEY ? new GooglePlacesProvider(env.GOOGLE_MAPS_API_KEY) : null;
  if (forced === "demo") return [new DemoProvider()];
  if (forced === "osm") return [new OsmProvider()];
  if (forced === "google") {
    if (!google) throw new Error("NOOKMAPS_PROVIDER=google but GOOGLE_MAPS_API_KEY is not set");
    return [google];
  }
  return google ? [google, new OsmProvider()] : [new OsmProvider()];
}

function providerFor(id: string): PlacesProvider | null {
  const chain = providerChain();
  const prefix = id.split(":")[0];
  const wanted: ProviderName | null =
    prefix === "g" ? "google" : prefix === "osm" ? "osm" : prefix === "demo" ? "demo" : null;
  if (!wanted) return null;
  const inChain = chain.find((p) => p.name === wanted);
  if (inChain) return inChain;
  // A link to an OSM place should still open when Google is the primary.
  if (wanted === "osm") return new OsmProvider();
  if (wanted === "demo") return new DemoProvider();
  return null;
}

async function firstSuccessful<T>(
  fn: (p: PlacesProvider) => Promise<T>,
  accept: (v: T) => boolean = () => true,
): Promise<{ value: T; provider: ProviderName }> {
  let lastError: unknown;
  for (const p of providerChain()) {
    try {
      const value = await fn(p);
      if (accept(value)) return { value, provider: p.name };
    } catch (err) {
      lastError = err;
      console.warn(`[nookmaps] provider ${p.name} failed:`, (err as Error).message);
    }
  }
  throw lastError ?? new Error("No places provider returned results");
}

export async function fetchNearby(q: NearbyQuery): Promise<{ places: Place[]; provider: ProviderName }> {
  const key = `${roundCoord(q.lat)},${roundCoord(q.lng)},${q.radiusM}`;
  const cached = nearbyCache.get(key);
  if (cached) return cached;
  const { value, provider } = await firstSuccessful((p) => p.nearby(q), (v) => v.length > 0);
  const result = { places: value, provider };
  nearbyCache.set(key, result);
  return result;
}

export async function fetchDetails(id: string): Promise<Place | null> {
  return detailsCache.getOrLoad(id, async () => {
    const p = providerFor(id);
    return p ? p.details(id) : null;
  });
}

export async function fetchArea(p: LatLng): Promise<AreaInfo> {
  const key = `${roundCoord(p.lat, 3)},${roundCoord(p.lng, 3)}`;
  const hit = areaCache.get(key);
  if (hit) return hit;
  try {
    const { value } = await firstSuccessful((prov) => prov.reverseGeocode(p));
    areaCache.set(key, value);
    return value;
  } catch {
    return { label: "your location" };
  }
}

export async function geocode(query: string, near?: LatLng): Promise<GeocodeResult[]> {
  const { value } = await firstSuccessful((p) => p.geocode(query, near), (v) => v.length > 0);
  return value;
}
