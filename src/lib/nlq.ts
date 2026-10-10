import { hasAny, THINGS_TO_DO } from "./categories";
import { walkMinutes as walkMinutesForDistance } from "./geo";
import { addMinutes, isOpenThrough, type LocalTime } from "./time";
import type { Category, Place, ScoredPlace } from "./types";

/**
 * Natural-language discovery (PRD §20, V4): "I have ₹500 and two hours",
 * "I want something fun nearby but not food". A deterministic, rule-based
 * parser turns the request into constraints, and `applyConstraints` filters
 * and re-ranks real, already-scored places with them. No AI, no network: the
 * same text always gives the same constraints.
 */

/* ---------------------------------------------------------------- types -- */

export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

export type Mood =
  | "fun"
  | "chill"
  | "romantic"
  | "cheap"
  | "outdoors"
  | "kids"
  | "work"
  | "group"
  | "activity";

export interface Budget {
  /** The amount as written, e.g. 500 for "₹500". */
  amount: number;
  currency: CurrencyCode;
  /** How many people the amount covers (1 unless "for two", "for 4 people", a date…). */
  people: number;
  /** amount ÷ people, what the price-level mapping uses. */
  perPerson: number;
}

/** When the user wants to go, if not right now ("this evening", "tonight"). */
export interface TimeWindow {
  label: string;
  /** Local minutes since midnight; `endMinute` may exceed 1440 for windows past midnight. */
  startMinute: number;
  endMinute: number;
}

export interface Constraints {
  /** Places must match at least one of these (named categories ∪ mood categories). */
  includeCategories: Category[];
  /** Categories the user named directly ("coffee", "movies"); boosted more than moods. */
  explicitCategories: Category[];
  /** Places with any of these categories are dropped. */
  excludeCategories: Category[];
  moods: Mood[];
  budget?: Budget;
  /** Google-style price level cap, 0 (free) … 4. */
  maxPriceLevel?: number;
  /** How long the user has, in minutes. */
  timeMinutes?: number;
  maxWalkMinutes?: number;
  /** The walk limit came from a vague word ("nearby"), so it may be widened if nothing fits. */
  walkIsApproximate?: boolean;
  /** Must be open when the user gets there. Defaults to true. */
  openNow: boolean;
  /** Must stay open late (≈ 9–11 PM local). */
  openLate: boolean;
  when?: TimeWindow;
  /** Human-readable chips: what was understood, in display order. */
  explanation: string[];
  /** Words we didn't understand, for debugging and "try rephrasing" hints. */
  unknownWords?: string[];
}

/* ----------------------------------------------------------- currencies -- */

interface CurrencyInfo {
  symbol: string;
  locale: string;
  /** Per-person upper bounds for price levels 1, 2 and 3; above the last is level 4. */
  thresholds: [number, number, number];
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  INR: { symbol: "₹", locale: "en-IN", thresholds: [300, 800, 2000] },
  USD: { symbol: "$", locale: "en-US", thresholds: [15, 35, 70] },
  EUR: { symbol: "€", locale: "en-IE", thresholds: [15, 35, 70] },
  GBP: { symbol: "£", locale: "en-GB", thresholds: [12, 30, 60] },
};

/** Map an amount per person to the highest Google price level it comfortably covers. */
export function priceLevelForBudget(perPerson: number, currency: CurrencyCode): number {
  if (perPerson <= 0) return 0;
  const [l1, l2, l3] = CURRENCIES[currency].thresholds;
  if (perPerson <= l1) return 1;
  if (perPerson <= l2) return 2;
  if (perPerson <= l3) return 3;
  return 4;
}

export function formatMoney(amount: number, currency: CurrencyCode): string {
  const info = CURRENCIES[currency];
  const n = amount.toLocaleString(info.locale, { maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
  return `${info.symbol}${n}`;
}

function priceSymbols(level: number, currency: CurrencyCode): string {
  return level === 0 ? "free" : CURRENCIES[currency].symbol.repeat(level);
}

export function formatDuration(minutes: number): string {
  if (minutes >= ALL_DAY_MINUTES) return "All day";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} h ${m} min`;
}

/* ------------------------------------------------------------- lexicons -- */

interface MoodDef {
  label: string;
  categories: Category[];
  exclude?: Category[];
  maxPriceLevel?: number;
  words: string[];
}

export const MOODS: Record<Mood, MoodDef> = {
  fun: {
    label: "Fun things",
    categories: ["entertainment", "cinema", "nightlife", "attraction"],
    words: ["fun", "exciting", "excitement", "entertaining", "entertainment", "adventure", "adventurous", "thrill", "thrilling", "lively", "buzzing", "happening", "a good time", "good time"],
  },
  chill: {
    label: "Chill & quiet",
    categories: ["park", "coffee", "museum", "workspace"],
    words: ["chill", "chilled", "chill out", "chilling", "relax", "relaxing", "relaxed", "quiet", "quieter", "calm", "peaceful", "peace", "cozy", "cosy", "laid back", "unwind", "unwinding", "low key", "lowkey", "serene", "tranquil", "silent"],
  },
  romantic: {
    label: "Romantic",
    categories: ["dessert", "bar", "park", "attraction"],
    words: ["romantic", "romance", "date", "dates", "anniversary", "couple", "couples", "girlfriend", "boyfriend", "partner", "wife", "husband", "bae", "valentine", "valentines"],
  },
  cheap: {
    label: "Cheap",
    categories: [],
    maxPriceLevel: 1,
    // Matched by the price step (it has to run before negation handling).
    words: [],
  },
  outdoors: {
    label: "Outdoors",
    categories: ["park", "outdoors"],
    words: ["outdoors", "outdoor", "outside", "open air", "fresh air", "nature", "green", "greenery", "hike", "hikes", "hiking", "trail", "trails", "trek", "trekking", "beach", "sunshine"],
  },
  kids: {
    label: "Kid-friendly",
    categories: ["park", "attraction", "entertainment", "dessert"],
    exclude: ["bar", "nightlife"],
    words: ["kids", "kid", "children", "child", "family", "families", "kid friendly", "kids friendly", "family friendly", "child friendly", "toddler", "toddlers", "son", "daughter", "baby", "little ones", "children friendly"],
  },
  work: {
    label: "Good for working",
    categories: ["workspace", "coffee"],
    words: ["work", "working", "laptop", "wifi", "remote work", "study", "studying", "focus", "meeting", "meetings", "emails", "work friendly", "plug", "plug point", "charging"],
  },
  group: {
    label: "Good for groups",
    categories: ["food", "bar", "entertainment"],
    words: ["group", "groups", "friends", "gang", "buddies", "colleagues", "team", "team outing", "squad", "mates", "bunch of us", "the gang", "the boys", "the girls"],
  },
  activity: {
    label: "Things to do",
    // The feed's "things to do" minus the gym, which nobody means by "something to do".
    categories: THINGS_TO_DO.filter((c) => c !== "gym"),
    words: ["something to do", "things to do", "stuff to do", "thing to do", "to do", "activity", "activities", "explore", "exploring", "kill time", "pass time", "bored", "outing"],
  },
};

interface CategoryEntry {
  label: string;
  /** Chip when negated; defaults to `Not <label>`. */
  negLabel?: string;
  categories: Category[];
  /** Extra categories excluded when the word is negated ("not food" also skips bakeries). */
  negatedAlso?: Category[];
  words: string[];
}

const CATEGORY_WORDS: CategoryEntry[] = [
  { label: "Coffee", negLabel: "No coffee", categories: ["coffee"], words: ["coffee", "coffees", "espresso", "latte", "lattes", "cappuccino", "cold brew", "filter coffee", "coffee shop", "coffee place", "caffeine"] },
  { label: "Cafés", negLabel: "No cafés", categories: ["coffee"], words: ["cafe", "cafes", "caffe", "coffeehouse"] },
  { label: "Chai & tea", negLabel: "No tea", categories: ["coffee"], words: ["chai", "tea", "teas", "tea house", "chai tapri", "tapri"] },
  { label: "Juice & shakes", negLabel: "No juice bars", categories: ["coffee"], words: ["juice", "juices", "smoothie", "smoothies", "milkshake", "milkshakes", "shake", "shakes", "juice bar"] },
  { label: "Breakfast", negLabel: "No breakfast", categories: ["food", "bakery", "coffee"], words: ["breakfast", "brunch", "tiffin"] },
  { label: "Lunch", negLabel: "No lunch", categories: ["food"], words: ["lunch"] },
  { label: "Dinner", negLabel: "No dinner", categories: ["food"], words: ["dinner", "supper"] },
  {
    label: "Food",
    negLabel: "Not food",
    categories: ["food"],
    negatedAlso: ["bakery", "dessert"],
    words: ["food", "foods", "eat", "eats", "eating", "meal", "meals", "hungry", "restaurant", "restaurants", "bite", "dine", "dining", "eatery", "eateries", "street food", "fast food", "pizza", "pizzas", "burger", "burgers", "biryani", "dosa", "dosas", "idli", "momos", "noodles", "sushi", "ramen", "tacos", "sandwich", "sandwiches", "thali", "curry", "kebab", "kebabs", "chinese", "italian", "north indian", "south indian", "veg", "non veg"],
  },
  { label: "Snacks", negLabel: "No snacks", categories: ["bakery", "dessert", "food"], words: ["snack", "snacks", "nibbles", "chaat"] },
  {
    label: "Desserts",
    negLabel: "No desserts",
    categories: ["dessert"],
    words: ["dessert", "desserts", "sweet", "sweets", "something sweet", "sweet tooth", "ice cream", "ice creams", "icecream", "gelato", "cake", "cakes", "pastry", "pastries", "chocolate", "chocolates", "waffle", "waffles", "donut", "donuts", "doughnut", "doughnuts", "falooda", "kulfi", "brownie", "brownies"],
  },
  { label: "Bakery", negLabel: "No bakeries", categories: ["bakery"], words: ["bakery", "bakeries", "bread", "croissant", "croissants", "baked goods", "puffs"] },
  {
    label: "Drinks & bars",
    negLabel: "No bars",
    categories: ["bar"],
    words: ["drink", "drinks", "drinking", "beer", "beers", "bar", "bars", "pub", "pubs", "brewery", "breweries", "brewpub", "microbrewery", "cocktail", "cocktails", "wine", "booze", "alcohol", "whisky", "whiskey", "happy hour", "a drink"],
  },
  { label: "Nightlife", negLabel: "No clubs", categories: ["nightlife"], words: ["club", "clubs", "clubbing", "nightclub", "nightclubs", "dancing", "dance", "party", "partying", "nightlife", "karaoke", "disco", "lounge"] },
  { label: "Movies", negLabel: "No movies", categories: ["cinema"], words: ["movie", "movies", "film", "films", "cinema", "cinemas", "flick", "flicks", "multiplex", "movie theatre", "movie theater", "imax"] },
  { label: "Theatre & shows", negLabel: "No shows", categories: ["entertainment", "cinema"], words: ["theatre", "theater", "theatres", "theaters", "comedy", "standup", "stand up", "live music", "concert", "concerts", "gig", "gigs"] },
  {
    label: "Bowling & games",
    negLabel: "No games",
    categories: ["entertainment"],
    words: ["bowling", "arcade", "arcades", "games", "gaming", "game zone", "escape room", "go karting", "karting", "trampoline", "laser tag", "amusement", "amusement park", "theme park", "water park"],
  },
  { label: "Museums & art", negLabel: "No museums", categories: ["museum"], words: ["museum", "museums", "art", "arts", "gallery", "galleries", "art gallery", "exhibition", "exhibitions", "exhibit", "history", "heritage", "culture", "cultural"] },
  { label: "Parks", negLabel: "No parks", categories: ["park"], words: ["park", "parks", "garden", "gardens", "lake", "lakes", "playground"] },
  { label: "A walk", negLabel: "No walks", categories: ["park", "outdoors"], words: ["walk", "walks", "stroll", "strolls", "go for a walk", "jog", "jogging", "promenade"] },
  { label: "Shopping", negLabel: "No shopping", categories: ["shopping", "mall"], words: ["shopping", "shop", "shops", "store", "stores", "boutique", "boutiques", "clothes", "market", "markets", "flea market", "souvenirs", "window shopping"] },
  { label: "Malls", negLabel: "No malls", categories: ["mall"], words: ["mall", "malls", "shopping mall", "shopping centre", "shopping center"] },
  { label: "Bookshops", negLabel: "No bookshops", categories: ["shopping"], words: ["books", "book", "bookstore", "bookstores", "bookshop", "bookshops", "book store", "book shop"] },
  { label: "Gym & fitness", negLabel: "No gym", categories: ["gym"], words: ["gym", "gyms", "workout", "work out", "working out", "exercise", "fitness", "yoga", "pilates", "crossfit", "sports"] },
  {
    label: "Sights",
    negLabel: "No sightseeing",
    categories: ["attraction"],
    words: ["sights", "sight", "sightseeing", "landmark", "landmarks", "monument", "monuments", "tourist", "touristy", "tourist spot", "tourist spots", "attraction", "attractions", "photo spot", "photo spots", "photos", "photo", "photography", "instagram", "instagrammable", "view", "views", "viewpoint", "sunset", "zoo", "aquarium"],
  },
  { label: "Work spots", negLabel: "No work spots", categories: ["workspace"], words: ["coworking", "co working", "coworking space", "library", "libraries", "study spot", "workspace"] },
  { label: "Hotels", negLabel: "No hotels", categories: ["hotel"], words: ["hotel", "hotels"] },
];

const NEGATIONS = [
  "not", "no", "nothing", "never", "without", "except", "except for", "excluding", "exclude", "avoid",
  "avoiding", "skip", "skipping", "minus", "neither", "but not", "anything but", "anything other than",
  "other than", "instead of", "rather than", "don't", "dont", "do not", "doesn't", "won't", "don't want",
  "dont want", "do not want", "don't like", "dont like", "hate", "not into", "sick of", "tired of",
  "had enough of", "no more", "none of", "isn't", "aren't",
];

/** Words that end a negated phrase: "no food, just drinks", "not food but fun". */
const BOUNDARIES = [
  ",", ".", ";", "!", "?", "(", ")", "but", "though", "although", "however", "instead", "rather", "just",
  "only", "so", "then", "i", "i'm", "im", "we", "we're", "want", "wanna", "prefer", "preferably", "ideally",
  "maybe", "also", "plus", "something", "somewhere", "someplace", "anything", "anywhere", "please", "like",
];

const CONNECTORS = ["and", "or", "nor", "either", "/"];

const STOPWORDS = new Set(
  (
    "a an the some any my our your their his her its me us we you they i i'm im i've ive i'd id it this that these those " +
    "is are am was were be been being have has had having got get getting do does did doing go going gonna wanna want " +
    "wants wanting need needs would like love fancy feel feeling looking look find show suggest recommend give tell " +
    "please can could should will shall may might let lets let's to of in on at for with from by about around into " +
    "onto over up out off than then there here where what which who whom how when why somewhere someplace something " +
    "anything everything anywhere place places spot spots thing things stuff kind sort type good nice great best cool " +
    "decent fine okay ok really very super quite pretty bit little lot lots much more less most least few many one " +
    "ones other another else also too so just only even still again maybe perhaps probably today now right currently " +
    "time hey hi hello thanks thank yes yeah sure idea ideas options option area near far new try trying visit visiting " +
    "grab grabbing hang hangout hanging out spend spending money cash afford cost costs price pay budget friendly " +
    "affordable worth enjoy enjoying while whilst before after during until till left spare free kill some-where " +
    "people person persons pax adults of-us myself ourselves alone solo together and or nor but if as because since " +
    "either neither both all whole entire full day days hours hour minutes minute mins min walk walking away"
  ).split(/\s+/),
);

type Hit =
  | { kind: "category"; entry: CategoryEntry }
  | { kind: "mood"; mood: Mood }
  | { kind: "negation" }
  | { kind: "boundary" }
  | { kind: "connector" };

const PHRASES = new Map<string, Hit>();
let MAX_PHRASE_TOKENS = 1;
function addPhrase(phrase: string, hit: Hit): void {
  if (PHRASES.has(phrase)) return;
  PHRASES.set(phrase, hit);
  MAX_PHRASE_TOKENS = Math.max(MAX_PHRASE_TOKENS, phrase.split(" ").length);
}
// Order matters only for duplicates: the first definition wins.
for (const n of NEGATIONS) addPhrase(n, { kind: "negation" });
for (const c of CONNECTORS) addPhrase(c, { kind: "connector" });
for (const b of BOUNDARIES) addPhrase(b, { kind: "boundary" });
for (const entry of CATEGORY_WORDS) for (const w of entry.words) addPhrase(w, { kind: "category", entry });
for (const [mood, def] of Object.entries(MOODS) as [Mood, MoodDef][]) {
  for (const w of def.words) addPhrase(w, { kind: "mood", mood });
}

function lookup(tokens: string[], i: number): { hit: Hit; len: number } | null {
  for (let len = Math.min(MAX_PHRASE_TOKENS, tokens.length - i); len >= 1; len--) {
    const phrase = tokens.slice(i, i + len).join(" ");
    const hit = PHRASES.get(phrase);
    if (hit) return { hit, len };
  }
  // Simple plural fallback: "cinemas" → "cinema".
  const t = tokens[i];
  if (t.length > 3 && t.endsWith("s")) {
    const hit = PHRASES.get(t.slice(0, -1));
    if (hit && (hit.kind === "category" || hit.kind === "mood")) return { hit, len: 1 };
  }
  return null;
}

/* -------------------------------------------------------- normalisation -- */

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const SCALE_NUMBERS: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100_000, lakhs: 100_000 };

/** "five hundred" → "500", "twenty five" → "25", "one hundred and fifty" → "150". */
export function numberWordsToDigits(text: string): string {
  const words = text.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (!(words[i] in SMALL_NUMBERS) && !(words[i] in SCALE_NUMBERS)) {
      out.push(words[i]);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let lastWasScale = false;
    let j = i;
    while (j < words.length) {
      const w = words[j];
      if (w === "and" && lastWasScale && words[j + 1] !== undefined && words[j + 1] in SMALL_NUMBERS) {
        j++;
        continue;
      }
      if (w in SMALL_NUMBERS) {
        const v = SMALL_NUMBERS[w];
        // "twenty five" combines; "five five" or "twenty thirty" do not.
        if (j > i && current % 100 !== 0 && (v >= 10 || current % 10 !== 0)) break;
        current += v;
        lastWasScale = false;
      } else if (w in SCALE_NUMBERS) {
        const scale = SCALE_NUMBERS[w];
        if (scale === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * scale;
          current = 0;
        }
        lastWasScale = true;
      } else break;
      j++;
    }
    out.push(String(total + current));
    i = j;
  }
  return out.join(" ");
}

export function normalize(text: string): string {
  let s = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”"]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/…/g, " . ");
  s = s.replace(/(\d),(?=\d)/g, "$1"); // 1,500 → 1500 (also Indian 1,00,000)
  s = s.replace(/(?<![a-z])rs\.\s?(?=\d)/g, "rs "); // Rs. 500
  s = s.replace(/([a-z])-(?=[a-z])/g, "$1 "); // late-night → late night
  s = s.replace(/\bwi ?fi\b/g, "wifi");
  s = s.replace(/&/g, " and ");
  s = s.replace(/'s\b/g, "").replace(/'(?![a-z])/g, " ");
  s = s.replace(/([,;!?()])/g, " $1 ").replace(/\.(?!\d)/g, " . ");
  s = s.replace(/\s+/g, " ").trim();
  // Fractions and vague quantities before number words.
  s = s
    .replace(/\b(?:an?|one) hour and (?:a )?half\b/g, "90 minutes")
    .replace(/\bhour and (?:a )?half\b/g, "90 minutes")
    .replace(/\bhalf (?:an |a )?hour\b/g, "30 minutes")
    .replace(/\b(?:a )?quarter (?:of )?(?:an |a )?hour\b/g, "15 minutes")
    .replace(/\bhalf (?:a )?day\b/g, "240 minutes")
    .replace(/\b(?:a )?couple (?:of )?(?=(?:hours?|hrs?|minutes?|mins?)\b)/g, "2 ")
    .replace(/\b(?:a )?few (?=(?:hours?|hrs?)\b)/g, "3 ")
    .replace(/\ba (?=(?:hundred|thousand|lakh)\b)/g, "one ");
  s = numberWordsToDigits(s);
  s = s
    .replace(/\b(\d+) and (?:a )?half (hours?|hrs?)\b/g, (_, n: string, unit: string) => `${Number(n) + 0.5} ${unit}`)
    .replace(/\b(?:an?|1) (?=(?:hours?|hrs?)\b)/g, "1 ");
  return s.replace(/\s+/g, " ").trim();
}

/* ----------------------------------------------------------- extraction -- */

const ALL_DAY_MINUTES = 480;

const AMOUNT = String.raw`\d+(?:\.\d+)?(?![\d.])(?: ?k\b)?`;
const PREFIX_CUR = String.raw`(?:₹|(?<![a-z])rs|(?<![a-z])inr|us ?\$|\$|(?<![a-z])usd|€|(?<![a-z])eur|£|(?<![a-z])gbp)`;
const SUFFIX_CUR = String.raw`(?:₹|rs\b|rupees?\b|inr\b|\/-|bucks\b|dollars?\b|usd\b|\$|euros?\b|eur\b|€|pounds?\b|quid\b|gbp\b|£)`;
const MONEY_QUAL = String.raw`(?:(?:under|below|less than|no more than|not more than|at most|max(?:imum)?(?: of)?|up to|upto|within|around|about|roughly|approx(?:imately)?|only|just|(?:my |our |the |a )?budget(?: of| is)?)\s)*`;
const PER_PERSON = String.raw`(?:\s(?:each|per person|per head|a head|pp|per pax|a person|per adult|apiece))?`;
const MONEY_TAIL = String.raw`(?:\s(?:budget|max|tops))?`;
const MONEY_PREFIX_RE = new RegExp(
  `${MONEY_QUAL}${PREFIX_CUR}\\s?(${AMOUNT})(?:\\s?(?:-|to)\\s?${PREFIX_CUR}?\\s?(${AMOUNT}))?${MONEY_TAIL}${PER_PERSON}`,
  "g",
);
const MONEY_SUFFIX_RE = new RegExp(
  `${MONEY_QUAL}(${AMOUNT})(?:\\s?(?:-|to)\\s?(${AMOUNT}))?\\s?${SUFFIX_CUR}${MONEY_TAIL}${PER_PERSON}`,
  "g",
);
const NOT_MONEY_UNIT = String.raw`(?!\s?(?:min\b|mins\b|minutes?\b|hours?\b|hrs?\b|h\b|km|kms\b|m\b|meters?\b|metres?\b|people\b|persons?\b|pax\b|of us\b|am\b|pm\b|%|:))`;
const BARE_BUDGET_RE = new RegExp(
  `\\b(?:(?:my |our |the |a )?budget(?: of| is)?|spend(?:ing)?|afford|under|below|less than|max(?:imum)?|up to|upto|around|about)\\s(?:(?:of|around|about|roughly|only|just|max|under)\\s)?(${AMOUNT})${NOT_MONEY_UNIT}${PER_PERSON}`,
  "g",
);
const BARE_BUDGET_AFTER_RE = new RegExp(`\\b(${AMOUNT})\\s(?:budget|to spend)\\b${PER_PERSON}`, "g");
const MONEY_CUE_RE = /\b(?:budget|spend|spending|afford|money|cash|cost|costs|pay|paying|price|bill)\b/;
const PER_PERSON_RE = /\b(?:each|per person|per head|a head|pp|per pax|a person|per adult|apiece)\b/;

function parseAmount(raw: string): number {
  const k = /k$/.test(raw.trim());
  const n = Number.parseFloat(raw);
  return k ? n * 1000 : n;
}

function currencyOf(text: string): CurrencyCode {
  if (/₹|(?<![a-z])rs(?![a-z])|rupee|(?<![a-z])inr(?![a-z])|\/-/.test(text)) return "INR";
  if (/€|(?<![a-z])eur|euro/.test(text)) return "EUR";
  if (/£|(?<![a-z])gbp|pound|quid/.test(text)) return "GBP";
  return "USD";
}

interface Extracted {
  amount?: number;
  currency?: CurrencyCode;
  perPersonSaid: boolean;
}

function extractMoney(s: string, defaultCurrency: CurrencyCode): { text: string; money: Extracted } {
  const money: Extracted = { perPersonSaid: false };
  const take = (m: string, a: string, b: string | undefined, currency: CurrencyCode): string => {
    if (money.amount === undefined) {
      const values = [a, b].filter((x): x is string => !!x).map(parseAmount).filter(Number.isFinite);
      if (values.length) {
        money.amount = Math.max(...values);
        money.currency = currency;
      }
    }
    if (PER_PERSON_RE.test(m)) money.perPersonSaid = true;
    return " ";
  };
  let text = s
    .replace(MONEY_PREFIX_RE, (m, a: string, b?: string) => take(m, a, b, currencyOf(m)))
    .replace(MONEY_SUFFIX_RE, (m, a: string, b?: string) => take(m, a, b, currencyOf(m)));
  if (money.amount === undefined && MONEY_CUE_RE.test(text)) {
    const bare = (m: string, a: string): string => {
      const v = parseAmount(a);
      if (v < 20) return m; // "under 5" is not a budget
      return take(m, a, undefined, defaultCurrency);
    };
    text = text.replace(BARE_BUDGET_RE, bare).replace(BARE_BUDGET_AFTER_RE, bare);
  }
  if (money.amount !== undefined) {
    text = text.replace(/\b(?:my |our |the |a )?budget(?: of| is)?\b/g, " ");
    if (PER_PERSON_RE.test(text)) {
      money.perPersonSaid = true;
      text = text.replace(new RegExp(PER_PERSON_RE.source, "g"), " ");
    }
  }
  return { text, money };
}

const NUMR = String.raw`(\d+(?:\.\d+)?)(?![\d.])`;
const MINS = String.raw`(?:minutes?|mins?|min)\b`;
const WALK_WORDS = String.raw`(?:walk(?:ing)?(?: distance)?|stroll|away|on foot|by foot|from (?:here|me|my location|where i am)|of (?:here|me)|radius|walkable)`;
const WALK_QUAL = String.raw`(?:(?:within|in|under|less than|no more than|not more than|at most|max(?:imum)?(?: of)?|up to|upto|about|around|only|just|a)\s)*`;
const WALK_RES: RegExp[] = [
  new RegExp(String.raw`\b${WALK_QUAL}${NUMR}\s?(?:-\s?)?${MINS}\s?${WALK_WORDS}`, "g"),
  new RegExp(String.raw`\bwithin\s(?:a\s)?${NUMR}\s?(?:-\s?)?${MINS}`, "g"),
  new RegExp(String.raw`\b(?:walk(?:ing)?|stroll)\s(?:of\s)?(?:(?:under|less than|within|max(?:imum)?|up to|at most|about|around)\s)?${NUMR}\s?${MINS}`, "g"),
];
const DISTANCE_RE = new RegExp(
  String.raw`\b(?:(?:within|under|less than|in|up to|upto|max(?:imum)?|about|around)\s)*${NUMR}\s?(km|kms|kilomet(?:er|re)s?|m|meters?|metres?|mtrs?)\b(?:\s(?:radius|away|walk|from (?:here|me)))?`,
  "g",
);

const VAGUE_WALK: { re: RegExp; minutes: number; label: string }[] = [
  {
    re: /\b(?:right (?:here|nearby|next door|around the corner)|next door|steps away|a few steps(?: away)?|(?:very|super|really) (?:close|near)(?: by)?|around the corner|in this building)\b/g,
    minutes: 5,
    label: "Very close (≤ 5 min walk)",
  },
  {
    re: /\b(?:(?:within )?walking distance|walkable|(?:on|by) foot)\b/g,
    minutes: 15,
    label: "Walking distance (≤ 15 min)",
  },
  {
    re: /\b(?:near ?by|near (?:me|here|us)|close ?by|close to (?:me|here|us)|not (?:too |that |very |so )?far(?: away| from here)?|nothing (?:too )?far|around here|in the area|nearest|closest|close)\b/g,
    minutes: 10,
    label: "Nearby (≤ 10 min walk)",
  },
];

const DUR_QUAL = String.raw`(?:(?:for|only|just|about|around|roughly|approx(?:imately)?|under|less than|no more than|not more than|at most|max(?:imum)?|up to|upto|like|maybe|spare|got|have|free for|in)\s)*`;
const DUR_TAIL = String.raw`(?:\s(?:to kill|to spare|free|of free time|left|to burn|on my hands|off|break))?`;
const RANGE = String.raw`(?:\s?(?:-|to|or)\s?(\d+(?:\.\d+)?))?`;
const ALL_DAY_RE = /\b(?:(?:for )?(?:all|the whole|whole|the entire|entire|full|a full) day|for the day|day out)\b/g;
// "2 hours", "1.5 hrs", "2-3 hours", "1 hour 30 min", "2h30m", "1h30".
const HOURS_RE = new RegExp(
  `\\b${DUR_QUAL}${NUMR}${RANGE}\\s?(?:hours?|hrs?|h)(?:\\b|(?=\\d))(?:\\s?(?:and\\s)?(\\d+)\\s?(?:minutes?|mins?|min|m)\\b|(?<=h)(\\d{1,2})\\b)?${DUR_TAIL}`,
  "g",
);
const MINUTES_RE = new RegExp(`\\b${DUR_QUAL}${NUMR}${RANGE}\\s?(?:-\\s?)?(?:minutes?|mins?|min)\\b${DUR_TAIL}`, "g");

const PEOPLE_RES: RegExp[] = [
  /\bfor (?:the |us |all )?(\d{1,2})(?: (?:people|persons|pax|adults|of us|friends|ppl))?\b(?!\s?(?:min|mins|minutes?|hours?|hrs?|h\b|km|m\b|am\b|pm\b|o'?clock|%|k\b|\.\d|:))/g,
  /\b(?:we are|we're|there are|there's|party of|group of|table for) (\d{1,2})\b/g,
  /\b(\d{1,2}) (?:people|persons|pax|adults|of us|ppl)\b/g,
];

const FREE_NEXT = /^\s*(?:wifi|time|for|until|till|from|now|today|tonight|this|after|to|parking)\b/;
const FREE_PREV = /(?:feel|gluten|sugar|smoke|dairy|i'm|im|am|are|we're|be|i|we|totally|completely|fully)\s*$/;

const WHENS: Record<"morning" | "afternoon" | "evening" | "tonight" | "late", TimeWindow> = {
  morning: { label: "This morning", startMinute: 8 * 60, endMinute: 11 * 60 },
  afternoon: { label: "This afternoon", startMinute: 14 * 60, endMinute: 18 * 60 },
  evening: { label: "This evening", startMinute: 18 * 60, endMinute: 22 * 60 },
  tonight: { label: "Tonight", startMinute: 20 * 60, endMinute: 29 * 60 },
  late: { label: "Late night", startMinute: 21 * 60, endMinute: 29 * 60 },
};

const WHEN_RULES: { re: RegExp; when?: TimeWindow; openLate?: boolean; now?: boolean; anyHours?: boolean; replace?: string }[] = [
  { re: /\b(?:even if (?:it is |its |it )?closed|open or closed|closed is (?:fine|ok|okay)|(?:don't|doesn't|do not|does not) (?:need|have) to be open)\b/g, anyHours: true },
  { re: /\b(?:open (?:right )?now|right now|now|at the moment|asap|immediately|currently open)\b/g, now: true },
  {
    re: /\b(?:(?:open|opens|stays? open|close|closes|closing|serving)(?: till| until| til)? (?:late|after midnight|past midnight)|late opening|open 24 ?(?:hours?|hrs?|\/ ?7|x7)|24 ?(?:\/ ?7|x7)|24 hours? open)\b/g,
    openLate: true,
  },
  { re: /\b(?:late night|latenight|after midnight|midnight|all night)\b/g, openLate: true, when: WHENS.late },
  { re: /\blate (?=(?:dinner|supper|snacks?|bite|meal|food|drinks?|coffee)\b)/g, openLate: true, when: WHENS.late },
  { re: /\b(?:tonight|tonite|this night)\b/g, openLate: true, when: WHENS.tonight },
  { re: /\bdate night\b/g, when: WHENS.evening, replace: " date " },
  { re: /\b(?:this evening|evening|after work|after office|after college|after class)\b/g, when: WHENS.evening },
  { re: /\b(?:this afternoon|afternoon)\b/g, when: WHENS.afternoon },
  { re: /\b(?:this morning|morning)\b/g, when: WHENS.morning },
];

const MODERATE_PRICE_RE =
  /\b(?:not too (?:expensive|pricey|costly|fancy|posh)|not (?:very |that |super |so |overly )?(?:expensive|pricey|costly)|nothing (?:too |very |that |super |overly )?(?:expensive|pricey|costly|fancy|posh)|nothing fancy|reasonabl[ey](?: priced)?|moderately priced|mid ?range|mid ?priced|decently priced|value for money)\b/g;
const CHEAP_RE =
  /\b(?:dirt cheap|cheap(?:ly|est)?|inexpensive|affordable|low cost|low budget|on a (?:tight )?budget|budget friendly|pocket friendly|wallet friendly|economical|broke|tight budget|budget|(?:don't|dont|do not) want to spend (?:much|a lot|too much)|not (?:much|a lot of) money|(?:low|tight|short) on (?:cash|money))\b/g;
/** "$$", "₹₹₹": the price-level notation people know from map apps. */
const SYMBOL_LEVEL_RE = /(?<!\S)(?:₹{1,4}|\${1,4}|€{1,4}|£{1,4})(?!\S)/g;
const FREE_RE = /\b(?:for free|free of cost|free entry|free admission|no cost|costs? nothing|zero budget|without spending|no money)\b/g;
const QUIET_RE =
  /\b(?:not (?:too |very |that |so |overly )?(?:crowded|busy|packed|noisy|loud)|no crowds?|less crowded|uncrowded|away from (?:the )?crowds?|without (?:the )?crowds?)\b/g;

/* --------------------------------------------------------------- parser -- */

export interface ParseOptions {
  /** Currency for amounts written without one ("budget of 500"). */
  defaultCurrency?: CurrencyCode;
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Turn free text into discovery constraints. Pure and deterministic.
 * Unknown words are ignored (and reported), so garbage in gives the
 * default "open now, anything nearby" constraints out.
 */
export function parseQuery(text: string, opts: ParseOptions = {}): Constraints {
  const defaultCurrency = opts.defaultCurrency ?? "INR";
  let s = normalize(typeof text === "string" ? text.slice(0, 500) : "");

  // 1. Money: "₹500", "$20 each", "1.5k rupees for two", "budget of 800".
  const extracted = extractMoney(s, defaultCurrency);
  s = extracted.text;
  const money = extracted.money;

  // 2. "Open 24 hours" must not be read as a two-day time budget.
  let openLate = false;
  let explicitNow = false;
  let anyHours = false;
  const whens: TimeWindow[] = [];
  const applyWhen = (rule: (typeof WHEN_RULES)[number]) => {
    s = s.replace(rule.re, () => {
      if (rule.openLate) openLate = true;
      if (rule.now) explicitNow = true;
      if (rule.anyHours) anyHours = true;
      if (rule.when) whens.push(rule.when);
      return rule.replace ?? " ";
    });
  };
  applyWhen(WHEN_RULES[0]);
  applyWhen(WHEN_RULES[2]);

  // 3. Walk limits with numbers: "within 5 minutes", "10 min walk", "within 1 km".
  let maxWalkMinutes: number | undefined;
  let walkLabel: string | undefined;
  let walkIsApproximate = false;
  const setWalk = (minutes: number, label: string) => {
    if (maxWalkMinutes === undefined || minutes < maxWalkMinutes) {
      maxWalkMinutes = minutes;
      walkLabel = label;
    }
  };
  for (const re of WALK_RES) {
    s = s.replace(re, (_m, n: string) => {
      const minutes = Math.max(1, Math.round(Number(n)));
      setWalk(minutes, `Within a ${minutes}-min walk`);
      return " ";
    });
  }
  s = s.replace(DISTANCE_RE, (m, n: string, unit: string) => {
    const value = Number(n);
    const km = unit.startsWith("k");
    if (!km && value < 50) {
      // "within 10m" is more likely minutes than metres.
      if (unit !== "m" || !/^within\b/.test(m)) return m;
      const minutes = Math.max(1, Math.round(value));
      setWalk(minutes, `Within a ${minutes}-min walk`);
      return " ";
    }
    const metres = km ? value * 1000 : value;
    if (metres <= 0 || metres > 20_000) return m;
    const minutes = walkMinutesForDistance(metres);
    const dist = km ? `${value} km` : `${Math.round(metres)} m`;
    setWalk(minutes, `Within ${dist} (≈ ${minutes} min walk)`);
    return " ";
  });

  // 4. Time available: "two hours", "90 minutes", "half an hour", "all day".
  let timeMinutes: number | undefined;
  const setTime = (minutes: number) => {
    if (timeMinutes === undefined && minutes > 0) timeMinutes = Math.min(720, Math.max(5, Math.round(minutes)));
  };
  s = s.replace(ALL_DAY_RE, () => {
    setTime(ALL_DAY_MINUTES);
    return " ";
  });
  s = s.replace(
    HOURS_RE,
    (_m, a: string, b: string | undefined, extra: string | undefined, attached: string | undefined) => {
      const hours = Math.max(Number(a), b ? Number(b) : 0);
      setTime(hours * 60 + Number(extra ?? attached ?? 0));
      return " ";
    },
  );
  s = s.replace(MINUTES_RE, (_m, a: string, b: string | undefined) => {
    setTime(Math.max(Number(a), b ? Number(b) : 0));
    return " ";
  });

  // 5. Party size: "for two", "4 of us", "table for 6".
  let people: number | undefined;
  for (const re of PEOPLE_RES) {
    s = s.replace(re, (m, n: string) => {
      const v = Number(n);
      if (v < 1 || v > 30) return m;
      people ??= v;
      return " ";
    });
  }

  // 6. Price words (before negation, since they contain "not" / "nothing").
  let priceWordLevel: number | undefined;
  let priceWordLabel: string | undefined;
  const moods: Mood[] = [];
  const setPriceWord = (level: number, label: string) => {
    if (priceWordLevel === undefined || level < priceWordLevel) {
      priceWordLevel = level;
      priceWordLabel = label;
    }
  };
  const cur = money.currency ?? defaultCurrency;
  s = s.replace(FREE_RE, () => {
    setPriceWord(0, "Free only");
    return " ";
  });
  s = s.replace(/\bfree\b/g, (m, offset: number, whole: string) => {
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + m.length);
    if (FREE_NEXT.test(after) || FREE_PREV.test(before)) return m;
    setPriceWord(0, "Free only");
    return " ";
  });
  s = s.replace(SYMBOL_LEVEL_RE, (m) => {
    const symbolCurrency = currencyOf(m);
    setPriceWord(m.length, `Price ≤ ${priceSymbols(m.length, symbolCurrency)}`);
    return " ";
  });
  s = s.replace(MODERATE_PRICE_RE, () => {
    setPriceWord(2, `Not too pricey (≤ ${priceSymbols(2, cur)})`);
    return " ";
  });
  s = s.replace(CHEAP_RE, () => {
    setPriceWord(1, `Cheap (≈ ${priceSymbols(1, cur)})`);
    if (!moods.includes("cheap")) moods.push("cheap");
    return " ";
  });

  // 7. When: "tonight", "late night", "this afternoon", "now".
  for (const rule of WHEN_RULES) applyWhen(rule);

  // 8. Vague distance words: "nearby", "walking distance", "very close".
  if (maxWalkMinutes === undefined) {
    let best: { minutes: number; label: string } | undefined;
    for (const v of VAGUE_WALK) {
      s = s.replace(v.re, () => {
        if (!best || v.minutes < best.minutes) best = { minutes: v.minutes, label: v.label };
        return " ";
      });
    }
    if (best) {
      maxWalkMinutes = best.minutes;
      walkLabel = best.label;
      walkIsApproximate = true;
    }
  } else {
    for (const v of VAGUE_WALK) s = s.replace(v.re, " ");
  }

  // 9. "Not crowded" means quiet, not a negated category.
  s = s.replace(QUIET_RE, " quiet ");

  // 10. Category and mood words, with negation scopes.
  const tokens = s.split(" ").filter(Boolean);
  const included: CategoryEntry[] = [];
  const excluded: CategoryEntry[] = [];
  const whatChips: string[] = [];
  const unknown: string[] = [];
  let negating = false;
  let awaitingConnector = false;
  for (let i = 0; i < tokens.length; ) {
    const found = lookup(tokens, i);
    if (!found) {
      const t = tokens[i];
      if (!STOPWORDS.has(t) && !/^[\d.]+$/.test(t) && t.length > 1) unknown.push(t);
      i++;
      continue;
    }
    const { hit, len } = found;
    i += len;
    switch (hit.kind) {
      case "negation":
        negating = true;
        awaitingConnector = false;
        break;
      case "boundary":
        negating = false;
        break;
      case "connector":
        awaitingConnector = false;
        break;
      case "category":
      case "mood": {
        // "no food fun stuff": a second item without "and/or" starts a new, positive phrase.
        if (negating && awaitingConnector) negating = false;
        if (hit.kind === "category") {
          if (negating) excluded.push(hit.entry);
          else {
            included.push(hit.entry);
            whatChips.push(hit.entry.label);
          }
        } else if (!negating && !moods.includes(hit.mood)) {
          moods.push(hit.mood);
          whatChips.push(MOODS[hit.mood].label);
        }
        if (negating) awaitingConnector = true;
        break;
      }
    }
  }

  // Resolve includes vs excludes. A directly negated word always wins; the softer
  // implied exclusions ("not food" → bakeries, kids → no bars) yield to a named category.
  const named = uniq(included.flatMap((e) => e.categories));
  const directExclude = uniq(excluded.flatMap((e) => e.categories));
  const impliedExclude = uniq([
    ...excluded.flatMap((e) => e.negatedAlso ?? []),
    ...moods.flatMap((m) => MOODS[m].exclude ?? []),
  ]).filter((c) => !named.includes(c));
  const excludeCategories = uniq([...directExclude, ...impliedExclude]);
  const explicitCategories = named.filter((c) => !excludeCategories.includes(c));
  const includeCategories = uniq([...explicitCategories, ...moods.flatMap((m) => MOODS[m].categories)]).filter(
    (c) => !excludeCategories.includes(c),
  );

  // Budget → price level (per person).
  let budget: Budget | undefined;
  let maxPriceLevel: number | undefined;
  let budgetLabel: string | undefined;
  if (money.amount !== undefined && money.currency) {
    const party = money.perPersonSaid ? 1 : (people ?? (moods.includes("romantic") ? 2 : 1));
    const perPerson = money.amount / party;
    budget = { amount: money.amount, currency: money.currency, people: party, perPerson };
    maxPriceLevel = priceLevelForBudget(perPerson, money.currency);
    const amount = formatMoney(money.amount, money.currency);
    const level = priceSymbols(maxPriceLevel, money.currency);
    if (maxPriceLevel === 0) budgetLabel = "Free only";
    else if (money.perPersonSaid) budgetLabel = `Budget ≤ ${amount} per person (≈ ${level})`;
    else if (party > 1) budgetLabel = `Budget ≤ ${amount} for ${party} (≈ ${level})`;
    else budgetLabel = `Budget ≤ ${amount} (≈ ${level})`;
  }
  if (priceWordLevel !== undefined) {
    maxPriceLevel = maxPriceLevel === undefined ? priceWordLevel : Math.min(maxPriceLevel, priceWordLevel);
  }

  // Earliest requested window wins ("this afternoon or evening").
  const when = whens.length ? whens.reduce((a, b) => (b.startMinute < a.startMinute ? b : a)) : undefined;

  const explanation = uniq(
    [
      ...whatChips,
      budgetLabel,
      priceWordLabel !== budgetLabel ? priceWordLabel : undefined,
      timeMinutes !== undefined ? formatDuration(timeMinutes) : undefined,
      walkLabel,
      when?.label,
      openLate && when !== WHENS.late ? "Open late" : undefined,
      explicitNow && !when ? "Open now" : undefined,
      anyHours ? "Open or closed" : undefined,
      ...excluded.map((e) => e.negLabel ?? `Not ${e.label.toLowerCase()}`),
    ].filter((x): x is string => !!x),
  );

  const constraints: Constraints = {
    includeCategories,
    explicitCategories,
    excludeCategories,
    moods,
    openNow: !anyHours,
    openLate,
    explanation,
  };
  if (budget) constraints.budget = budget;
  if (maxPriceLevel !== undefined) constraints.maxPriceLevel = maxPriceLevel;
  if (timeMinutes !== undefined) constraints.timeMinutes = timeMinutes;
  if (maxWalkMinutes !== undefined) {
    constraints.maxWalkMinutes = maxWalkMinutes;
    if (walkIsApproximate) constraints.walkIsApproximate = true;
  }
  if (when) constraints.when = when;
  if (unknown.length) constraints.unknownWords = uniq(unknown);
  return constraints;
}

/** True when the parser understood anything beyond the defaults. */
export function hasConstraints(c: Constraints): boolean {
  return c.explanation.length > 0;
}

/* ------------------------------------------------------------- applying -- */

/** Typical and shortest sensible visit per category, in minutes. */
export const VISIT_MINUTES: Record<Category, { typical: number; min: number }> = {
  food: { typical: 60, min: 30 },
  coffee: { typical: 30, min: 15 },
  dessert: { typical: 25, min: 15 },
  bakery: { typical: 20, min: 10 },
  bar: { typical: 75, min: 45 },
  nightlife: { typical: 120, min: 60 },
  cinema: { typical: 150, min: 120 },
  entertainment: { typical: 90, min: 60 },
  attraction: { typical: 60, min: 30 },
  museum: { typical: 90, min: 45 },
  park: { typical: 30, min: 15 },
  outdoors: { typical: 45, min: 20 },
  shopping: { typical: 45, min: 20 },
  mall: { typical: 90, min: 45 },
  hotel: { typical: 60, min: 30 },
  gym: { typical: 60, min: 45 },
  campus: { typical: 30, min: 15 },
  workspace: { typical: 60, min: 45 },
  other: { typical: 30, min: 15 },
};

/** A place's visit length: the most flexible of its categories (a café-bakery can be a quick stop). */
export function visitMinutes(place: Pick<Place, "categories">): { typical: number; min: number } {
  const cats = place.categories.length ? place.categories : (["other"] as Category[]);
  return {
    typical: Math.min(...cats.map((c) => VISIT_MINUTES[c].typical)),
    min: Math.min(...cats.map((c) => VISIT_MINUTES[c].min)),
  };
}

/** When the outing starts: now, or later today if the user asked for "this evening" etc. */
export function startTime(c: Pick<Constraints, "when">, now: LocalTime): LocalTime {
  if (!c.when) return now;
  let minute = now.minute;
  // 1 AM is still "tonight".
  if (c.when.endMinute > 1440 && minute < c.when.endMinute - 1440) minute += 1440;
  if (minute >= c.when.startMinute) return now;
  return addMinutes(now, c.when.startMinute - minute);
}

const LATE_FROM = 21 * 60;
const LATE_UNTIL = 23 * 60;

/** The stretch a place must be open for "open late": 9–11 PM, or the next hour if it's already later. */
export function lateWindow(start: LocalTime): { from: LocalTime; minutes: number } {
  if (start.minute < 5 * 60) return { from: start, minutes: 60 };
  const fromMinute = Math.max(start.minute, LATE_FROM);
  return { from: addMinutes(start, fromMinute - start.minute), minutes: Math.max(LATE_UNTIL - fromMinute, 60) };
}

const BOOST_EXPLICIT = 0.25;
const BOOST_MOOD = 0.12;
const BOOST_CAP = 0.5;
const PENALTY_UNKNOWN_PRICE = 0.05;
const PENALTY_UNKNOWN_HOURS = 0.05;
const PENALTY_SHORT_VISIT = 0.08;
const PENALTY_UNKNOWN_LATE = 0.1;

/**
 * Filter and re-rank already-scored places with parsed constraints.
 * Hard filters: excluded categories, included categories (when any were
 * asked for), price cap (unknown price allowed), walk limit, open when you
 * get there (and for long enough), open late, and visit length vs the time
 * available. Matches for named categories and moods are boosted. The query
 * adjustment is recorded in `breakdown.query`.
 */
export function applyConstraints(scored: ScoredPlace[], c: Constraints, now: LocalTime): ScoredPlace[] {
  const start = startTime(c, now);
  const startsNow = start.day === now.day && start.minute === now.minute;
  const late = c.openLate ? lateWindow(start) : null;
  const lateIsNow = now.minute >= LATE_FROM || now.minute < 5 * 60;
  const moodSets = c.moods.map((m) => MOODS[m].categories).filter((cats) => cats.length > 0);
  const out: ScoredPlace[] = [];

  for (const s of scored) {
    const p = s.place;
    if (c.excludeCategories.length && hasAny(p, c.excludeCategories)) continue;
    if (c.includeCategories.length && !hasAny(p, c.includeCategories)) continue;
    if (c.maxWalkMinutes !== undefined && s.walkMinutes > c.maxWalkMinutes) continue;

    let adjust = 0;
    if (c.maxPriceLevel !== undefined) {
      if (p.priceLevel === undefined) adjust -= PENALTY_UNKNOWN_PRICE;
      else if (p.priceLevel > c.maxPriceLevel) continue;
    }

    // Does a visit fit in the time available (walking there included)?
    const visit = visitMinutes(p);
    let stay = visit.min;
    if (c.timeMinutes !== undefined) {
      const left = c.timeMinutes - s.walkMinutes;
      if (left < visit.min) continue;
      if (left < visit.typical) adjust -= PENALTY_SHORT_VISIT;
      stay = Math.min(visit.typical, left);
    }

    if (c.openNow) {
      if (startsNow && s.openNow === false) continue;
      const arrival = addMinutes(start, s.walkMinutes);
      // Open when you arrive, and still open by the time you'd finish.
      const through = isOpenThrough(p.openingHours, arrival, stay);
      if (through === false) continue;
      if (through === null) {
        if (!(startsNow && s.openNow === true)) adjust -= PENALTY_UNKNOWN_HOURS;
      } else if (isOpenThrough(p.openingHours, arrival, visit.typical) === false) {
        adjust -= PENALTY_SHORT_VISIT;
      }
    }

    if (late) {
      const ok = isOpenThrough(p.openingHours, late.from, late.minutes);
      if (ok === false) continue;
      if (ok === null) {
        if (lateIsNow && p.currentlyOpen === false) continue;
        adjust -= PENALTY_UNKNOWN_LATE;
      }
    }

    let boost = 0;
    if (c.explicitCategories.length && hasAny(p, c.explicitCategories)) boost += BOOST_EXPLICIT;
    for (const cats of moodSets) if (hasAny(p, cats)) boost += BOOST_MOOD;
    adjust += Math.min(BOOST_CAP, boost);

    out.push({ ...s, score: s.score + adjust, breakdown: { ...s.breakdown, query: adjust } });
  }
  return out.sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
}

export interface ConstrainedResults {
  results: ScoredPlace[];
  /** What was loosened, in words, when strict matching found too little. */
  notes: string[];
}

/**
 * `applyConstraints`, then — only if fewer than `minResults` fit — loosen the
 * soft parts in a fixed order: a walk limit that came from "nearby"-style
 * words is doubled, then mood-only categories become a preference instead of
 * a filter. Budget, time, exclusions and named categories are never loosened.
 * Strict matches always stay on top.
 */
export function applyConstraintsWithFallback(
  scored: ScoredPlace[],
  c: Constraints,
  now: LocalTime,
  minResults = 3,
): ConstrainedResults {
  let results = applyConstraints(scored, c, now);
  const notes: string[] = [];
  if (results.length >= minResults) return { results, notes };

  const merge = (extra: ScoredPlace[]): ScoredPlace[] => {
    const seen = new Set(results.map((s) => s.place.id));
    return [...results, ...extra.filter((s) => !seen.has(s.place.id))];
  };
  let relaxed = c;

  if (c.maxWalkMinutes !== undefined && c.walkIsApproximate) {
    const wider = Math.max(20, c.maxWalkMinutes * 2);
    relaxed = { ...relaxed, maxWalkMinutes: wider };
    const next = merge(applyConstraints(scored, relaxed, now));
    if (next.length > results.length) {
      notes.push(`Not much within a ${c.maxWalkMinutes}-min walk, so I looked up to ${wider} min away.`);
      results = next;
    }
    if (results.length >= minResults) return { results, notes };
  }

  if (c.explicitCategories.length === 0 && c.includeCategories.length > 0) {
    const before = results.length;
    relaxed = { ...relaxed, includeCategories: [] };
    const next = merge(applyConstraints(scored, relaxed, now));
    if (next.length > before) {
      notes.push(
        before === 0
          ? "Nothing matched exactly, so here are the closest alternatives."
          : `Only ${before} exact ${before === 1 ? "match" : "matches"}, so I've added other options below.`,
      );
      results = next;
    }
  }
  return { results, notes };
}

/** Suggestions for the empty state, most likely culprit first. */
export function loosenTips(c: Constraints): string[] {
  const tips: string[] = [];
  if (c.maxWalkMinutes !== undefined) tips.push("Walk a little further");
  if (c.timeMinutes !== undefined) tips.push("Allow a bit more time");
  if (c.maxPriceLevel !== undefined) tips.push("Stretch the budget a little");
  if (c.openLate) tips.push("Drop the late-night requirement");
  if (c.when) tips.push("Try a different time of day");
  if (c.excludeCategories.length) tips.push("Remove one of the exclusions");
  if (c.includeCategories.length) tips.push("Ask for a broader kind of place");
  tips.push("Increase the search radius on the home screen");
  return tips;
}
