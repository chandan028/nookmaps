import { categoriesFromOsmTags } from "../categories";
import { parseOsmOpeningHours } from "../time";
import type { AreaInfo, LatLng, Place } from "../types";
import { ProviderError, type GeocodeResult, type NearbyQuery, type PlacesProvider } from "./types";

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

const FILTERS = [
  `["amenity"~"^(cafe|restaurant|fast_food|food_court|ice_cream|bar|pub|biergarten|nightclub|cinema|theatre|arts_centre|library|marketplace)$"]`,
  `["shop"~"^(bakery|pastry|confectionery|coffee|tea|mall|department_store|books|gift|clothes)$"]`,
  `["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|aquarium|theme_park|hotel|hostel)$"]`,
  `["leisure"~"^(park|garden|bowling_alley|amusement_arcade|escape_game|water_park|fitness_centre)$"]`,
  `["historic"~"^(monument|castle|fort)$"]`,
];

function footprintFromBounds(b: OsmElement["bounds"]): number | undefined {
  if (!b) return undefined;
  const dLat = (b.maxlat - b.minlat) * 111_320;
  const dLng = (b.maxlon - b.minlon) * 111_320 * Math.cos((b.minlat * Math.PI) / 180);
  return Math.min(800, Math.max(10, Math.sqrt(dLat ** 2 + dLng ** 2) / 2));
}

export function normalizeOsmElement(el: OsmElement): Place | null {
  const tags = el.tags ?? {};
  const name = tags.name ?? tags["name:en"];
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!name || lat === undefined || lng === undefined) return null;
  const { categories, types } = categoriesFromOsmTags(tags);
  const address = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:suburb"] ?? tags["addr:neighbourhood"],
    tags["addr:city"],
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: `osm:${el.type}:${el.id}`,
    provider: "osm",
    name,
    lat,
    lng,
    categories,
    types,
    openingHours: parseOsmOpeningHours(tags.opening_hours),
    address: address || undefined,
    website: tags.website ?? tags["contact:website"],
    phone: tags.phone ?? tags["contact:phone"],
    footprintM: footprintFromBounds(el.bounds) ?? (el.type === "node" ? 15 : undefined),
  };
}

/**
 * OpenStreetMap fallback (PRD §11): Overpass for places, Nominatim for
 * geocoding. No ratings or live status, so ranking leans on distance,
 * category and parsed opening hours.
 */
export class OsmProvider implements PlacesProvider {
  readonly name = "osm" as const;
  private overpass = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
  private nominatim = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
  private userAgent = `NookMaps/0.1 (${process.env.OSM_CONTACT || "https://github.com/chandan028/nookmaps"})`;

  private async overpassQuery(query: string): Promise<OsmElement[]> {
    const res = await fetch(this.overpass, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.userAgent,
      },
      body: `data=${encodeURIComponent(query)}`,
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(`Overpass ${res.status}`, "osm", res.status);
    const data = (await res.json()) as { elements?: OsmElement[] };
    return data.elements ?? [];
  }

  async nearby(q: NearbyQuery): Promise<Place[]> {
    const r = Math.min(Math.round(q.radiusM), 5000);
    const around = `(around:${r},${q.lat},${q.lng})`;
    const body = FILTERS.map((f) => `nwr${f}["name"]${around};`).join("\n");
    const elements = await this.overpassQuery(`[out:json][timeout:20];(\n${body}\n);out center bb tags ${q.limit ?? 200};`);
    return elements.map(normalizeOsmElement).filter((p): p is Place => p !== null);
  }

  async details(id: string): Promise<Place | null> {
    const m = /^osm:(node|way|relation):(\d+)$/.exec(id);
    if (!m) return null;
    const elements = await this.overpassQuery(`[out:json][timeout:15];${m[1]}(${m[2]});out center bb tags;`);
    return elements[0] ? normalizeOsmElement(elements[0]) : null;
  }

  async reverseGeocode(p: LatLng): Promise<AreaInfo> {
    const url = `${this.nominatim}/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${p.lat}&lon=${p.lng}`;
    const res = await fetch(url, { headers: { "User-Agent": this.userAgent }, cache: "no-store" });
    if (!res.ok) throw new ProviderError(`Nominatim ${res.status}`, "osm", res.status);
    const data = (await res.json()) as { address?: Record<string, string> };
    const a = data.address ?? {};
    const street = a.road ?? a.pedestrian;
    const neighborhood = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district;
    const city = a.city ?? a.town ?? a.village ?? a.county;
    return { street, neighborhood, city, label: neighborhood ?? street ?? city ?? "your location" };
  }

  async geocode(query: string, near?: LatLng): Promise<GeocodeResult[]> {
    const params = new URLSearchParams({ format: "jsonv2", q: query, limit: "5" });
    if (near) {
      const d = 0.5;
      params.set("viewbox", `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
    }
    const res = await fetch(`${this.nominatim}/search?${params}`, {
      headers: { "User-Agent": this.userAgent },
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(`Nominatim ${res.status}`, "osm", res.status);
    const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    return data.map((d) => ({ lat: Number(d.lat), lng: Number(d.lon), label: d.display_name }));
  }
}
