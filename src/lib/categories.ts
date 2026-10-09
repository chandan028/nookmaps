import type { Category, ContextType, Place } from "./types";

/** Google Places (New) primary types → internal categories. */
const GOOGLE_TYPE_MAP: Record<string, Category> = {
  cafe: "coffee",
  coffee_shop: "coffee",
  tea_house: "coffee",
  cafeteria: "food",
  bakery: "bakery",
  dessert_shop: "dessert",
  dessert_restaurant: "dessert",
  ice_cream_shop: "dessert",
  donut_shop: "dessert",
  confectionery: "dessert",
  chocolate_shop: "dessert",
  juice_shop: "coffee",
  restaurant: "food",
  meal_takeaway: "food",
  meal_delivery: "food",
  fast_food_restaurant: "food",
  food_court: "food",
  sandwich_shop: "food",
  pizza_restaurant: "food",
  breakfast_restaurant: "food",
  brunch_restaurant: "food",
  bar: "bar",
  pub: "bar",
  wine_bar: "bar",
  bar_and_grill: "bar",
  night_club: "nightlife",
  karaoke: "nightlife",
  movie_theater: "cinema",
  bowling_alley: "entertainment",
  amusement_center: "entertainment",
  amusement_park: "entertainment",
  video_arcade: "entertainment",
  escape_room: "entertainment",
  comedy_club: "entertainment",
  concert_hall: "entertainment",
  performing_arts_theater: "entertainment",
  event_venue: "entertainment",
  water_park: "entertainment",
  zoo: "attraction",
  aquarium: "attraction",
  tourist_attraction: "attraction",
  historical_landmark: "attraction",
  monument: "attraction",
  cultural_landmark: "attraction",
  observation_deck: "attraction",
  art_gallery: "museum",
  museum: "museum",
  library: "workspace",
  coworking_space: "workspace",
  park: "park",
  national_park: "outdoors",
  state_park: "outdoors",
  garden: "park",
  botanical_garden: "park",
  hiking_area: "outdoors",
  beach: "outdoors",
  playground: "park",
  dog_park: "park",
  plaza: "outdoors",
  shopping_mall: "mall",
  department_store: "shopping",
  clothing_store: "shopping",
  book_store: "shopping",
  gift_shop: "shopping",
  market: "shopping",
  store: "shopping",
  electronics_store: "shopping",
  shoe_store: "shopping",
  jewelry_store: "shopping",
  hotel: "hotel",
  lodging: "hotel",
  resort_hotel: "hotel",
  hostel: "hotel",
  guest_house: "hotel",
  gym: "gym",
  fitness_center: "gym",
  sports_club: "gym",
  yoga_studio: "gym",
  university: "campus",
  school: "campus",
};

/** Google cuisine types end with `_restaurant`; anything we don't list is still food. */
export function categoriesFromGoogleTypes(types: string[]): Category[] {
  const out = new Set<Category>();
  for (const t of types) {
    const mapped = GOOGLE_TYPE_MAP[t];
    if (mapped) out.add(mapped);
    else if (t.endsWith("_restaurant")) out.add("food");
    else if (t.endsWith("_store") || t.endsWith("_shop")) out.add("shopping");
  }
  if (out.size === 0) out.add("other");
  return [...out];
}

/** OpenStreetMap tag (key=value) → category. */
const OSM_TAG_MAP: Record<string, Category> = {
  "amenity=cafe": "coffee",
  "amenity=restaurant": "food",
  "amenity=fast_food": "food",
  "amenity=food_court": "food",
  "amenity=ice_cream": "dessert",
  "amenity=bar": "bar",
  "amenity=pub": "bar",
  "amenity=biergarten": "bar",
  "amenity=nightclub": "nightlife",
  "amenity=cinema": "cinema",
  "amenity=theatre": "entertainment",
  "amenity=arts_centre": "museum",
  "amenity=library": "workspace",
  "amenity=coworking_space": "workspace",
  "amenity=university": "campus",
  "amenity=college": "campus",
  "amenity=marketplace": "shopping",
  "shop=bakery": "bakery",
  "shop=pastry": "dessert",
  "shop=confectionery": "dessert",
  "shop=coffee": "coffee",
  "shop=tea": "coffee",
  "shop=mall": "mall",
  "shop=department_store": "shopping",
  "shop=clothes": "shopping",
  "shop=books": "shopping",
  "shop=gift": "shopping",
  "shop=shoes": "shopping",
  "shop=electronics": "shopping",
  "shop=jewelry": "shopping",
  "tourism=attraction": "attraction",
  "tourism=viewpoint": "attraction",
  "tourism=museum": "museum",
  "tourism=gallery": "museum",
  "tourism=zoo": "attraction",
  "tourism=aquarium": "attraction",
  "tourism=theme_park": "entertainment",
  "tourism=hotel": "hotel",
  "tourism=hostel": "hotel",
  "tourism=guest_house": "hotel",
  "historic=monument": "attraction",
  "historic=memorial": "attraction",
  "historic=castle": "attraction",
  "historic=fort": "attraction",
  "leisure=park": "park",
  "leisure=garden": "park",
  "leisure=nature_reserve": "outdoors",
  "leisure=bowling_alley": "entertainment",
  "leisure=amusement_arcade": "entertainment",
  "leisure=escape_game": "entertainment",
  "leisure=water_park": "entertainment",
  "leisure=fitness_centre": "gym",
  "leisure=sports_centre": "gym",
};

export function categoriesFromOsmTags(tags: Record<string, string>): {
  categories: Category[];
  types: string[];
} {
  const cats = new Set<Category>();
  const types: string[] = [];
  for (const key of ["amenity", "shop", "tourism", "leisure", "historic"]) {
    const v = tags[key];
    if (!v) continue;
    const kv = `${key}=${v}`;
    types.push(kv);
    const mapped = OSM_TAG_MAP[kv];
    if (mapped) cats.add(mapped);
    else if (key === "shop") cats.add("shopping");
  }
  if (tags.cuisine && /coffee/.test(tags.cuisine)) cats.add("coffee");
  if (tags.cuisine && /(dessert|ice_cream|cake)/.test(tags.cuisine)) cats.add("dessert");
  if (cats.size === 0) cats.add("other");
  return { categories: [...cats], types };
}

/** Top-level groups the user sees as chips (PRD §7). */
export const CHIP_GROUPS: {
  id: string;
  label: string;
  emoji: string;
  categories: Category[];
}[] = [
  { id: "eat", label: "Eat", emoji: "🍽️", categories: ["food", "bakery"] },
  { id: "coffee", label: "Coffee", emoji: "☕", categories: ["coffee"] },
  { id: "dessert", label: "Desserts", emoji: "🍰", categories: ["dessert", "bakery"] },
  { id: "drinks", label: "Drinks", emoji: "🍸", categories: ["bar", "nightlife"] },
  {
    id: "entertainment",
    label: "Entertainment",
    emoji: "🎬",
    categories: ["cinema", "entertainment"],
  },
  { id: "sights", label: "Sights", emoji: "🏛️", categories: ["attraction", "museum"] },
  { id: "shopping", label: "Shopping", emoji: "🛍️", categories: ["shopping", "mall"] },
  { id: "outdoors", label: "Outdoors", emoji: "🌳", categories: ["park", "outdoors"] },
  { id: "activities", label: "Activities", emoji: "🏃", categories: ["gym", "entertainment"] },
  { id: "work", label: "Work spots", emoji: "💻", categories: ["workspace", "coffee"] },
];

export function chipMatches(chipId: string, place: Place): boolean {
  const group = CHIP_GROUPS.find((g) => g.id === chipId);
  if (!group) return false;
  return place.categories.some((c) => group.categories.includes(c));
}

export const THINGS_TO_DO: Category[] = [
  "cinema",
  "entertainment",
  "attraction",
  "museum",
  "park",
  "outdoors",
  "gym",
];

export function hasAny(place: Place, cats: Category[]): boolean {
  return place.categories.some((c) => cats.includes(c));
}

/** Which context a POI puts the user in (PRD §6). */
export function contextTypeForPlace(place: Place): ContextType {
  const c = place.categories;
  if (c.includes("mall")) return "mall";
  if (c.includes("hotel")) return "hotel";
  if (c.includes("campus")) return "campus";
  if (c.includes("park") || c.includes("outdoors")) return "park";
  if (c.includes("attraction") || c.includes("museum")) return "attraction";
  if (c.includes("coffee") || c.includes("bakery") || c.includes("dessert")) return "cafe";
  if (c.includes("bar") || c.includes("nightlife")) return "bar";
  if (c.includes("food")) return "restaurant";
  return "street";
}

export const CATEGORY_LABEL: Record<Category, string> = {
  food: "Food",
  coffee: "Coffee",
  dessert: "Desserts",
  bakery: "Bakery",
  bar: "Bar",
  nightlife: "Nightlife",
  cinema: "Cinema",
  entertainment: "Entertainment",
  attraction: "Attraction",
  museum: "Museum & art",
  park: "Park",
  outdoors: "Outdoors",
  shopping: "Shopping",
  mall: "Mall",
  hotel: "Hotel",
  gym: "Fitness",
  campus: "Campus",
  workspace: "Work spot",
  other: "Place",
};

export const CATEGORY_EMOJI: Record<Category, string> = {
  food: "🍽️",
  coffee: "☕",
  dessert: "🍰",
  bakery: "🥐",
  bar: "🍸",
  nightlife: "🪩",
  cinema: "🎬",
  entertainment: "🎳",
  attraction: "📸",
  museum: "🖼️",
  park: "🌳",
  outdoors: "🥾",
  shopping: "🛍️",
  mall: "🏬",
  hotel: "🏨",
  gym: "🏋️",
  campus: "🎓",
  workspace: "💻",
  other: "📍",
};

export function primaryCategory(place: Place): Category {
  return place.categories[0] ?? "other";
}
