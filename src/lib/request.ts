import { isValidLatLng } from "./geo";

export class BadRequest extends Error {}

export function num(params: URLSearchParams, key: string, fallback?: number): number {
  const raw = params.get(key);
  if (raw === null || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new BadRequest(`Missing ${key}`);
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new BadRequest(`Invalid ${key}`);
  return v;
}

export function latLngFrom(params: URLSearchParams): { lat: number; lng: number } {
  const lat = num(params, "lat");
  const lng = num(params, "lng");
  if (!isValidLatLng(lat, lng)) throw new BadRequest("Invalid coordinates");
  return { lat, lng };
}

/** Client sends Date#getTimezoneOffset(); clamp to real-world offsets. */
export function tzOffsetFrom(params: URLSearchParams): number {
  return Math.max(-14 * 60, Math.min(12 * 60, num(params, "tzo", 0)));
}

export function clampRadius(r: number): number {
  return Math.max(100, Math.min(5000, Math.round(r)));
}

export function errorResponse(err: unknown): Response {
  if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
  console.error("[nookmaps]", err);
  return Response.json({ error: "Places are unavailable right now. Please try again." }, { status: 502 });
}

/** Responses depend on precise location; never let shared caches store them. */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
