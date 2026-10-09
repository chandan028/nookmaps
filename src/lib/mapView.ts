import type { LatLng } from "./types";

/** Pure helpers for the map view (PRD §16); no Leaflet here so they can be unit tested. */

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Smallest box around the points, or null when there are none. Ignores invalid coordinates. */
export function boundsOf(points: LatLng[]): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (!b) b = { south: p.lat, north: p.lat, west: p.lng, east: p.lng };
    else {
      b.south = Math.min(b.south, p.lat);
      b.north = Math.max(b.north, p.lat);
      b.west = Math.min(b.west, p.lng);
      b.east = Math.max(b.east, p.lng);
    }
  }
  return b;
}

/** True when the box is effectively a single point (so fitBounds would zoom in absurdly). */
export function isPointLike(b: Bounds, epsilonDeg = 0.00005): boolean {
  return b.north - b.south < epsilonDeg && b.east - b.west < epsilonDeg;
}

export function boundsCenter(b: Bounds): LatLng {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/**
 * A stable key for "the set of things on the map". The view refits only when
 * this changes, so a re-render with the same places doesn't undo the user's
 * panning and zooming.
 */
export function viewKey(points: LatLng[]): string {
  return points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
}

/** Accuracy circles are only worth drawing for a real GPS fix of sensible size. */
export function showAccuracyCircle(accuracyM: number | undefined, maxM = 1000): accuracyM is number {
  return typeof accuracyM === "number" && Number.isFinite(accuracyM) && accuracyM > 0 && accuracyM <= maxM;
}
