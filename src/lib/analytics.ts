/**
 * Product analytics (PRD §23, §24). Event names are fixed here so every screen
 * reports the same vocabulary. Never send precise coordinates: only coarse,
 * derived context such as context type, category, section or day part.
 *
 * Privacy (PRD §21, §26):
 * - `sanitize()` strips anything location-like before an event leaves `track()`.
 * - The user can opt out (localStorage `nookmaps:analytics-optout`); browsers
 *   sending Do Not Track or Global Privacy Control are opted out by default.
 *   External sinks (GA4) subscribe with `onTrackWithConsent()` so they only
 *   ever see events while analytics are allowed.
 * - Per-session bookkeeping lives in sessionStorage (gone when the tab closes)
 *   and is only kept while analytics are allowed.
 */
export type AnalyticsEvent =
  | "location_permission_granted"
  | "location_permission_denied"
  | "manual_location_set"
  | "discovery_feed_loaded"
  | "category_selected"
  | "section_viewed"
  | "place_opened"
  | "directions_clicked"
  | "website_clicked"
  | "phone_clicked"
  | "place_saved"
  | "refresh_location"
  | "surprise_me"
  | "view_mode_changed"
  | "plan_generated"
  | "nl_query_submitted"
  | "recommendation_action";

export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

/* ------------------------------------------------------------------ */
/* Sanitising                                                          */
/* ------------------------------------------------------------------ */

const FORBIDDEN_KEYS = /^(lat|lng|lon|latitude|longitude|coords?|accuracy|address|query_text)$/i;

/** Key tokens (split on _ - and camelCase) that mark precise location or personal text. */
const FORBIDDEN_TOKENS = new Set([
  "lat",
  "lng",
  "lon",
  "latitude",
  "longitude",
  "latlng",
  "latlon",
  "coord",
  "coords",
  "coordinate",
  "coordinates",
  "accuracy",
  "geohash",
  "pluscode",
  "address",
  "street",
  "postcode",
  "postal",
]);

/** Free-text keys: what the user typed never goes to analytics (CLAUDE.md). */
const FREE_TEXT_KEYS = /^(q|query|query_text|search_term|search|prompt|text|message)$/i;

/** A "12.9784,77.6408"-style pair (also URL-encoded) anywhere in a string value. */
const COORD_PAIR = /-?\d{1,3}\.\d{3,}\s*(?:,|%2C|\s)\s*-?\d{1,3}\.\d{3,}/i;

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isForbiddenKey(key: string): boolean {
  if (FORBIDDEN_KEYS.test(key) || FREE_TEXT_KEYS.test(key)) return true;
  const tokens = keyTokens(key);
  // The exact place someone opened says roughly where they are; categories don't.
  if (/(^|_)place_(id|name)(_|$)/.test(tokens.join("_"))) return true;
  return tokens.some((t) => FORBIDDEN_TOKENS.has(t));
}

/** Drop anything that looks like precise location before it leaves the device. */
export function sanitize(params: AnalyticsParams = {}): AnalyticsParams {
  const out: AnalyticsParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || isForbiddenKey(k)) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    if (typeof v === "string" && COORD_PAIR.test(v)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 100) : v;
  }
  return out;
}

/**
 * Coarse page path for page_view events: drops ids from dynamic routes so
 * analytics never learn which exact place (and so roughly where) someone was.
 */
export function redactPath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || "/";
  const segments = path.split("/").filter(Boolean);
  const out = segments.map((seg, i) => {
    if (i > 0 && segments[i - 1] === "place") return ":id";
    // Anything that isn't a plain word (ids, numbers, encoded values) is redacted.
    return /^[a-z][a-z-]*$/i.test(seg) ? seg : ":param";
  });
  return "/" + out.join("/");
}

/* ------------------------------------------------------------------ */
/* Storage (guarded for SSR, private mode and blocked storage)         */
/* ------------------------------------------------------------------ */

export const OPT_OUT_KEY = "nookmaps:analytics-optout";
export const SESSION_KEY = "nookmaps:analytics-session";

function storage(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return (globalThis as unknown as Record<string, Storage | undefined>)[kind] ?? undefined;
  } catch {
    return undefined; // accessing storage can throw when site data is blocked
  }
}

function getItem(kind: "localStorage" | "sessionStorage", key: string): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function setItem(kind: "localStorage" | "sessionStorage", key: string, value: string | null): boolean {
  try {
    const s = storage(kind);
    if (!s) return false;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Consent                                                             */
/* ------------------------------------------------------------------ */

/** "off": user opted out. "on": user explicitly opted in. "default": no choice made. */
export type AnalyticsChoice = "on" | "off" | "default";

export function analyticsChoice(): AnalyticsChoice {
  const v = getItem("localStorage", OPT_OUT_KEY);
  return v === "1" ? "off" : v === "0" ? "on" : "default";
}

/** True when the browser sends Do Not Track or Global Privacy Control. */
export function browserRequestsNoTracking(): boolean {
  try {
    const nav = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;
    const win = globalThis as unknown as { doNotTrack?: unknown };
    if (!nav) return false;
    if (nav.globalPrivacyControl === true) return true;
    const dnt = nav.doNotTrack ?? win.doNotTrack ?? nav.msDoNotTrack;
    return dnt === "1" || dnt === "yes" || dnt === 1;
  } catch {
    return false;
  }
}

/**
 * Whether events may leave the device. An explicit choice wins; otherwise
 * DNT / GPC mean "off" (PRD §21: respect the user's signals by default).
 */
export function analyticsEnabled(): boolean {
  const choice = analyticsChoice();
  if (choice === "off") return false;
  if (choice === "on") return true;
  return !browserRequestsNoTracking();
}

const consentListeners = new Set<() => void>();

/** Notified whenever the user changes their analytics choice. */
export function onConsentChange(listener: () => void): () => void {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
}

/**
 * Persist the user's choice. `true` opts out (and forgets this session's
 * analytics bookkeeping), `false` opts in, `null` returns to the default.
 */
export function setAnalyticsOptOut(optOut: boolean | null): void {
  setItem("localStorage", OPT_OUT_KEY, optOut === null ? null : optOut ? "1" : "0");
  if (optOut) resetSessionMetrics();
  for (const l of consentListeners) {
    try {
      l();
    } catch {
      /* never break the caller */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Session metrics + recommendation-to-action conversion (PRD §24)     */
/* ------------------------------------------------------------------ */

/** The real-world actions that count towards the core metric (PRD §24). */
const MEANINGFUL_ACTIONS: Partial<Record<AnalyticsEvent, string>> = {
  directions_clicked: "directions",
  phone_clicked: "call",
  website_clicked: "website",
  place_saved: "save",
};

/** Normalises event names and short names to the conversion action vocabulary. */
const ACTION_ALIASES: Record<string, string> = {
  directions_clicked: "directions",
  directions: "directions",
  phone_clicked: "call",
  phone: "call",
  call: "call",
  website_clicked: "website",
  website: "website",
  place_saved: "save",
  save: "save",
  saved: "save",
};

/** An action is attributed to the last recommendation opened within this window. */
const ATTRIBUTION_TTL_MS = 30 * 60_000;
/** Explicit + derived recommendation_action for the same click are collapsed. */
const CONVERSION_DEDUPE_MS = 2_000;
/** A section-less place_opened this soon after a card tap is the same view. */
const SAME_OPEN_MS = 10_000;
const MAX_DISTINCT = 50;

interface SessionState {
  placesViewed: number;
  categories: string[];
  sections: string[];
  actions: number;
  hadLocation: boolean;
  feedLoaded: boolean;
  attribution?: { section: string; category?: string; at: number };
}

export interface SessionMetrics {
  /** place_opened events this session (§24 discovery engagement). */
  placesViewed: number;
  /** Distinct categories selected or opened (§24). */
  categoriesExplored: number;
  /** Distinct feed sections viewed or opened from (§24). */
  sectionsViewed: number;
  /** Directions, call, website and save actions (§24 core metric). */
  meaningfulActions: number;
  hadMeaningfulAction: boolean;
  /** Location granted or set manually (§24 activation). */
  hadLocation: boolean;
  /** A discovery feed was shown (§24 activation). */
  feedLoaded: boolean;
}

const emptyState = (): SessionState => ({
  placesViewed: 0,
  categories: [],
  sections: [],
  actions: 0,
  hadLocation: false,
  feedLoaded: false,
});

/** Used only when sessionStorage is unavailable (blocked storage, tests). */
let memoryState: SessionState | null = null;
let lastConversion: { action: string; at: number } | null = null;

function loadState(): SessionState {
  const raw = getItem("sessionStorage", SESSION_KEY);
  if (raw) {
    try {
      return { ...emptyState(), ...(JSON.parse(raw) as Partial<SessionState>) };
    } catch {
      /* corrupt: start over */
    }
  }
  return memoryState ? { ...memoryState } : emptyState();
}

function saveState(state: SessionState): void {
  if (setItem("sessionStorage", SESSION_KEY, JSON.stringify(state))) return;
  // In-memory fallback for browsers with blocked storage; never on the server,
  // where module state would be shared between requests.
  if (typeof window !== "undefined") memoryState = state;
}

/** Clears this session's analytics bookkeeping (opt-out, "clear my data", tests). */
export function resetSessionMetrics(): void {
  setItem("sessionStorage", SESSION_KEY, null);
  memoryState = null;
  lastConversion = null;
}

/** Local per-session counters behind the PRD §24 success metrics. */
export function sessionMetrics(): SessionMetrics {
  const s = loadState();
  return {
    placesViewed: s.placesViewed,
    categoriesExplored: s.categories.length,
    sectionsViewed: s.sections.length,
    meaningfulActions: s.actions,
    hadMeaningfulAction: s.actions > 0,
    hadLocation: s.hadLocation,
    feedLoaded: s.feedLoaded,
  };
}

function addDistinct(list: string[], value: AnalyticsParams[string]): void {
  if (typeof value !== "string" || !value || list.includes(value) || list.length >= MAX_DISTINCT) return;
  list.push(value);
}

const str = (v: AnalyticsParams[string]): string | undefined =>
  typeof v === "string" && v ? v : undefined;

/** True if this conversion duplicates one emitted moments ago. */
function isDuplicateConversion(action: string, now: number): boolean {
  const dup = lastConversion?.action === action && now - lastConversion.at < CONVERSION_DEDUPE_MS;
  lastConversion = { action, at: now };
  return dup;
}

/**
 * Updates the session bookkeeping for one event and returns the derived
 * recommendation_action params when the event converts a recommendation.
 */
function record(event: AnalyticsEvent, params: AnalyticsParams): AnalyticsParams | null {
  const now = Date.now();
  const s = loadState();
  let conversion: AnalyticsParams | null = null;

  switch (event) {
    case "location_permission_granted":
    case "manual_location_set":
      s.hadLocation = true;
      break;
    case "discovery_feed_loaded":
      s.feedLoaded = true;
      break;
    case "category_selected":
      addDistinct(s.categories, params.category);
      break;
    case "section_viewed":
      addDistinct(s.sections, params.section);
      break;
    case "place_opened": {
      const section = str(params.section);
      const category = str(params.category);
      const prev = s.attribution;
      // The detail page reporting the open a card tap just reported: same view, keep the chain.
      if (!section && prev && now - prev.at < SAME_OPEN_MS && (!category || category === prev.category)) break;
      s.placesViewed += 1;
      addDistinct(s.categories, category);
      addDistinct(s.sections, section);
      // A place opened outside a recommendation (saved list, shared link) breaks the chain.
      s.attribution = section ? { section, category, at: now } : undefined;
      break;
    }
    default: {
      const action = MEANINGFUL_ACTIONS[event];
      if (!action || (event === "place_saved" && params.saved === false)) break;
      s.actions += 1;
      const attr = s.attribution && now - s.attribution.at <= ATTRIBUTION_TTL_MS ? s.attribution : undefined;
      // An action taken straight from a feed card carries its own section.
      const section = str(params.section) ?? attr?.section;
      if (section) {
        const category = str(params.category) ?? attr?.category;
        if (!isDuplicateConversion(action, now)) conversion = { action, section, category };
      }
    }
  }

  saveState(s);
  return conversion;
}

/* ------------------------------------------------------------------ */
/* Tracking                                                            */
/* ------------------------------------------------------------------ */

type Listener = (event: AnalyticsEvent, params: AnalyticsParams) => void;
export type AnalyticsListener = Listener;
const listeners = new Set<Listener>();

/**
 * Subscribe to every tracked event (sanitised). In-app only: external
 * analytics providers must use `onTrackWithConsent()`.
 */
export function onTrack(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe an external sink (GA4); events are dropped while analytics are off. */
export function onTrackWithConsent(listener: Listener): () => void {
  return onTrack((event, params) => {
    if (analyticsEnabled()) listener(event, params);
  });
}

function emit(event: AnalyticsEvent, params: AnalyticsParams): void {
  for (const l of listeners) {
    try {
      l(event, params);
    } catch {
      /* analytics must never break the app */
    }
  }
}

export function track(event: AnalyticsEvent, params?: AnalyticsParams): void {
  const clean = sanitize(params);
  let conversion: AnalyticsParams | null = null;
  if (analyticsEnabled()) {
    try {
      if (event === "recommendation_action") {
        // Tracked explicitly by a screen: drop it if we just derived the same one.
        const action = ACTION_ALIASES[String(clean.action ?? "")];
        if (action && isDuplicateConversion(action, Date.now())) return;
      } else {
        conversion = record(event, clean);
      }
    } catch {
      /* bookkeeping is best-effort */
    }
  }
  emit(event, clean);
  if (conversion) emit("recommendation_action", sanitize(conversion));
}
