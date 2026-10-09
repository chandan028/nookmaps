import { detectContext } from "./context";
import { isValidLatLng } from "./geo";
import { applyConstraintsWithFallback, loosenTips, parseQuery, type Constraints } from "./nlq";
import { rankPlaces, type RankingWeights } from "./ranking";
import { BadRequest, clampRadius } from "./request";
import { dayPart as dayPartOf, localTime } from "./time";
import type { ContextType, DayPart, LatLng, Place, ProviderName, ScoredPlace } from "./types";

/** "Ask NookMaps" (PRD §20, V4): free text in → constraints + ranked real places out. */

export const MAX_QUERY_LENGTH = 300;
export const ASK_RESULT_LIMIT = 20;

export interface AskRequest {
  origin: LatLng & { accuracyM: number };
  query: string;
  radiusM: number;
  tzOffsetMinutes: number;
}

export interface AskResponse {
  /** What the parser understood; `explanation` holds the display chips. */
  constraints: Constraints;
  /** Best matches first, at most ASK_RESULT_LIMIT. */
  results: ScoredPlace[];
  /** Plain-language notes when soft constraints had to be loosened. */
  notes: string[];
  /** Ways to loosen the request; only when nothing fits. */
  tips: string[];
  context: { type: ContextType; confidence: number };
  dayPart: DayPart;
  provider: ProviderName;
  radiusM: number;
}

function numberField(body: Record<string, unknown>, key: string, fallback?: number): number {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new BadRequest(`Missing ${key}`);
  }
  const v = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(v)) throw new BadRequest(`Invalid ${key}`);
  return v;
}

/** Validate the JSON body of POST /api/ask: `{ lat, lng, acc?, query, radius?, tzo }`. */
export function parseAskRequest(body: unknown): AskRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequest("Send a JSON object");
  }
  const b = body as Record<string, unknown>;
  const lat = numberField(b, "lat");
  const lng = numberField(b, "lng");
  if (!isValidLatLng(lat, lng)) throw new BadRequest("Invalid coordinates");
  const accuracyM = Math.max(0, Math.min(10_000, numberField(b, "acc", 30)));
  const radiusM = clampRadius(numberField(b, "radius", 2000));
  const tzOffsetMinutes = Math.max(-14 * 60, Math.min(12 * 60, numberField(b, "tzo", 0)));
  if (typeof b.query !== "string") throw new BadRequest("Missing query");
  const query = b.query.replace(/\s+/g, " ").trim();
  if (query.length < 1 || query.length > MAX_QUERY_LENGTH) {
    throw new BadRequest(`Ask in 1–${MAX_QUERY_LENGTH} characters`);
  }
  return { origin: { lat, lng, accuracyM }, query, radiusM, tzOffsetMinutes };
}

export interface AnswerAskInput extends AskRequest {
  places: Place[];
  nowMs: number;
  provider: ProviderName;
  weights?: RankingWeights;
  limit?: number;
}

/**
 * The deterministic pipeline behind /api/ask: detect where the user is,
 * rank nearby places as the feed does (excluding the venue they're in),
 * then filter and re-rank them with the parsed constraints.
 */
export function answerAsk(input: AnswerAskInput): AskResponse {
  const now = localTime(input.nowMs, input.tzOffsetMinutes);
  const part = dayPartOf(now);
  const context = detectContext(input.origin, input.places);
  const exclude = new Set(context.currentPlace ? [context.currentPlace.id] : []);
  const ranked = rankPlaces({
    origin: input.origin,
    places: input.places,
    context: context.type,
    dayPart: part,
    now,
    weights: input.weights,
    exclude,
  }).filter((s) => s.distanceM <= input.radiusM * 1.1);
  const constraints = parseQuery(input.query);
  const { results, notes } = applyConstraintsWithFallback(ranked, constraints, now);
  return {
    constraints,
    results: results.slice(0, input.limit ?? ASK_RESULT_LIMIT),
    notes,
    tips: results.length === 0 ? loosenTips(constraints) : [],
    context: { type: context.type, confidence: context.confidence },
    dayPart: part,
    provider: input.provider,
    radiusM: input.radiusM,
  };
}
