import type { AreaInfo, Category, LatLng, OpeningHours, Place } from "../types";
import type { GeocodeResult, NearbyQuery, PlacesProvider } from "./types";

/**
 * Offline demo provider. It lays a fixed, clearly fictional neighbourhood
 * around whatever coordinates it is asked about, so the whole app (context
 * detection, "What next?", plans, natural-language search) can be exercised
 * without API keys or network. Enable with NOOKMAPS_PROVIDER=demo; never used
 * silently in place of a real provider.
 */

type Hours = "allday" | "cafe" | "lunchdinner" | "evening" | "retail" | "daylight" | "24h";

const HOURS: Record<Hours, [number, number]> = {
  allday: [8 * 60, 23 * 60],
  cafe: [7 * 60, 22 * 60],
  lunchdinner: [11 * 60 + 30, 23 * 60 + 30],
  evening: [17 * 60, 26 * 60], // closes 2 AM
  retail: [10 * 60, 21 * 60 + 30],
  daylight: [5 * 60 + 30, 20 * 60],
  "24h": [0, 0],
};

function weekly(kind: Hours): OpeningHours {
  if (kind === "24h") {
    return { periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ openDay: d, openMinute: 0 })) };
  }
  const [open, close] = HOURS[kind];
  return {
    periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      openDay: d,
      openMinute: open,
      closeDay: close >= 1440 ? (d + 1) % 7 : d,
      closeMinute: close % 1440,
    })),
  };
}

interface Seed {
  name: string;
  cats: Category[];
  types: string[];
  /** metres east, metres north of the origin */
  dx: number;
  dy: number;
  rating: number;
  reviews: number;
  price?: number;
  hours: Hours;
  footprint?: number;
}

const SEEDS: Seed[] = [
  { name: "Third Wave Coffee (demo)", cats: ["coffee"], types: ["cafe"], dx: 6, dy: 4, rating: 4.4, reviews: 2310, price: 2, hours: "cafe", footprint: 18 },
  { name: "Corner House Desserts (demo)", cats: ["dessert"], types: ["dessert_shop"], dx: 90, dy: 40, rating: 4.6, reviews: 5400, price: 1, hours: "allday" },
  { name: "Toit Brewpub (demo)", cats: ["bar", "food"], types: ["bar", "restaurant"], dx: -180, dy: 120, rating: 4.5, reviews: 18000, price: 3, hours: "lunchdinner" },
  { name: "Glen's Bakehouse (demo)", cats: ["bakery", "coffee"], types: ["bakery", "cafe"], dx: 220, dy: -60, rating: 4.3, reviews: 3100, price: 2, hours: "cafe" },
  { name: "Truffles (demo)", cats: ["food"], types: ["restaurant", "american_restaurant"], dx: 310, dy: 210, rating: 4.4, reviews: 22000, price: 2, hours: "lunchdinner" },
  { name: "Darshini Tiffin Room (demo)", cats: ["food"], types: ["restaurant", "south_indian_restaurant"], dx: -70, dy: -110, rating: 4.2, reviews: 980, price: 1, hours: "allday" },
  { name: "PVR Cinemas (demo)", cats: ["cinema"], types: ["movie_theater"], dx: 820, dy: 380, rating: 4.3, reviews: 9100, price: 2, hours: "allday" },
  { name: "Smaaash Bowling (demo)", cats: ["entertainment"], types: ["bowling_alley"], dx: -650, dy: 520, rating: 4.1, reviews: 4200, price: 3, hours: "lunchdinner" },
  { name: "Defence Colony Park (demo)", cats: ["park"], types: ["park"], dx: 420, dy: -380, rating: 4.4, reviews: 1500, price: 0, hours: "daylight", footprint: 120 },
  { name: "Lalbagh Botanical Garden (demo)", cats: ["park", "attraction"], types: ["botanical_garden", "tourist_attraction"], dx: -1900, dy: -1400, rating: 4.6, reviews: 98000, price: 0, hours: "daylight", footprint: 600 },
  { name: "Indiranagar Social (demo)", cats: ["bar", "workspace", "food"], types: ["bar", "coworking_space"], dx: 520, dy: 90, rating: 4.3, reviews: 14000, price: 2, hours: "allday" },
  { name: "Blossom Book House (demo)", cats: ["shopping"], types: ["book_store"], dx: -380, dy: -260, rating: 4.7, reviews: 6100, price: 1, hours: "retail" },
  { name: "Phoenix Marketcity (demo)", cats: ["mall", "shopping"], types: ["shopping_mall"], dx: 1700, dy: 900, rating: 4.5, reviews: 120000, price: 2, hours: "retail", footprint: 250 },
  { name: "Visvesvaraya Museum (demo)", cats: ["museum", "attraction"], types: ["museum"], dx: -2200, dy: 1300, rating: 4.5, reviews: 41000, price: 1, hours: "retail" },
  { name: "Skyye Rooftop (demo)", cats: ["nightlife", "bar"], types: ["night_club", "bar"], dx: 760, dy: -150, rating: 4.2, reviews: 7600, price: 4, hours: "evening" },
  { name: "Meghana Foods (demo)", cats: ["food"], types: ["restaurant", "indian_restaurant"], dx: 150, dy: 330, rating: 4.4, reviews: 31000, price: 2, hours: "lunchdinner" },
  { name: "Cult Fitness (demo)", cats: ["gym"], types: ["gym"], dx: -260, dy: 60, rating: 4.3, reviews: 870, price: 2, hours: "allday" },
  { name: "Chai Point (demo)", cats: ["coffee"], types: ["tea_house"], dx: 40, dy: -150, rating: 4.0, reviews: 640, price: 1, hours: "24h" },
  { name: "Art Houz Gallery (demo)", cats: ["museum"], types: ["art_gallery"], dx: -560, dy: -90, rating: 4.5, reviews: 420, price: 0, hours: "retail" },
  { name: "Commercial Street Market (demo)", cats: ["shopping"], types: ["market"], dx: -1300, dy: 1600, rating: 4.2, reviews: 52000, price: 1, hours: "retail", footprint: 200 },
  { name: "Brahmin's Coffee Bar (demo)", cats: ["coffee", "food"], types: ["cafe"], dx: -950, dy: -700, rating: 4.6, reviews: 23000, price: 1, hours: "cafe" },
  { name: "Late Night Dosa Cart (demo)", cats: ["food"], types: ["fast_food_restaurant"], dx: 260, dy: 140, rating: 4.1, reviews: 300, price: 1, hours: "evening" },
  { name: "Ulsoor Lake Promenade (demo)", cats: ["outdoors", "park"], types: ["park", "tourist_attraction"], dx: -1100, dy: 300, rating: 4.3, reviews: 12000, price: 0, hours: "daylight", footprint: 400 },
  { name: "The Leela Palace (demo)", cats: ["hotel"], types: ["hotel"], dx: 1500, dy: -900, rating: 4.7, reviews: 26000, price: 4, hours: "24h", footprint: 150 },
];

function offset(origin: LatLng, dx: number, dy: number): LatLng {
  return {
    lat: origin.lat + dy / 111_320,
    lng: origin.lng + dx / (111_320 * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

function originKey(o: LatLng): string {
  return `${o.lat.toFixed(5)},${o.lng.toFixed(5)}`;
}

export function demoPlaces(origin: LatLng): Place[] {
  const key = originKey(origin);
  return SEEDS.map((s, i) => {
    const p = offset(origin, s.dx, s.dy);
    return {
      id: `demo:${i}@${key}`,
      provider: "demo" as const,
      name: s.name,
      lat: p.lat,
      lng: p.lng,
      categories: s.cats,
      types: s.types,
      rating: s.rating,
      reviewCount: s.reviews,
      priceLevel: s.price,
      openingHours: weekly(s.hours),
      address: `${Math.abs(Math.round(s.dx))} m ${s.dx >= 0 ? "east" : "west"}, ${Math.abs(Math.round(s.dy))} m ${s.dy >= 0 ? "north" : "south"} of you (demo data)`,
      website: "https://example.com",
      phone: "+91 00000 00000",
      footprintM: s.footprint ?? 20,
    };
  });
}

export class DemoProvider implements PlacesProvider {
  readonly name = "demo" as const;

  async nearby(q: NearbyQuery): Promise<Place[]> {
    const origin = { lat: q.lat, lng: q.lng };
    return demoPlaces(origin);
  }

  async details(id: string): Promise<Place | null> {
    const m = /^demo:(\d+)@(-?[\d.]+),(-?[\d.]+)$/.exec(id);
    if (!m) return null;
    return demoPlaces({ lat: Number(m[2]), lng: Number(m[3]) })[Number(m[1])] ?? null;
  }

  async reverseGeocode(): Promise<AreaInfo> {
    return { label: "Demo Nook", street: "100 Feet Road", neighborhood: "Demo Nook", city: "Demo City" };
  }

  async geocode(query: string): Promise<GeocodeResult[]> {
    return [{ lat: 12.9784, lng: 77.6408, label: `${query} (demo location)` }];
  }
}
