/**
 * Product analytics (PRD §23). Event names are fixed here so every screen
 * reports the same vocabulary. Never send precise coordinates: only coarse,
 * derived context such as context type, category, section or day part.
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

const FORBIDDEN_KEYS = /^(lat|lng|lon|latitude|longitude|coords?|accuracy|address|query_text)$/i;

/** Drop anything that looks like precise location before it leaves the device. */
export function sanitize(params: AnalyticsParams = {}): AnalyticsParams {
  const out: AnalyticsParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || FORBIDDEN_KEYS.test(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 100) : v;
  }
  return out;
}

type Listener = (event: AnalyticsEvent, params: AnalyticsParams) => void;
const listeners = new Set<Listener>();

/** Lets the analytics provider (GA4) and tests subscribe to events. */
export function onTrack(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function track(event: AnalyticsEvent, params?: AnalyticsParams): void {
  const clean = sanitize(params);
  for (const l of listeners) {
    try {
      l(event, clean);
    } catch {
      /* analytics must never break the app */
    }
  }
}
