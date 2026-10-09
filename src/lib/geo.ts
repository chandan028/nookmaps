import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_000;
/** Average urban walking pace, ~4.8 km/h, including a little crossing/waiting time. */
export const WALK_METERS_PER_MINUTE = 80;
/** Streets are not straight lines; inflate crow-flies distance for walking estimates. */
const DETOUR_FACTOR = 1.25;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated walking time in whole minutes (minimum 1). */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round((distanceM * DETOUR_FACTOR) / WALK_METERS_PER_MINUTE));
}

export const WALK_BUCKETS = [5, 10, 15, 30] as const;
export type WalkBucketMinutes = (typeof WALK_BUCKETS)[number];

/** PRD §9: group by practical reachability rather than kilometres. */
export function walkBucket(minutes: number): WalkBucketMinutes | null {
  for (const b of WALK_BUCKETS) if (minutes <= b) return b;
  return null;
}

export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM / 10) * 10 || 10} m`;
  return `${(distanceM / 1000).toFixed(distanceM < 10_000 ? 1 : 0)} km`;
}

export function formatWalk(minutes: number): string {
  if (minutes <= 1) return "1 min walk";
  if (minutes < 60) return `${minutes} min walk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min walk` : `${h} h walk`;
}

/** True when the user has moved far enough that the feed is likely stale (PRD §21). */
export function movedSignificantly(a: LatLng, b: LatLng, thresholdM = 150): boolean {
  return distanceMeters(a, b) >= thresholdM;
}

/** Round coordinates for cache keys; ~11 m at 4 decimals. */
export function roundCoord(v: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}
