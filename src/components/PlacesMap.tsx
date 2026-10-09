"use client";

import type { LatLng, Place, ScoredPlace } from "@/lib/types";

export interface PlacesMapProps {
  origin: LatLng & { accuracyM?: number };
  places: ScoredPlace[];
  /** The venue the user is at, highlighted when present. */
  current?: Place;
  /** Called when a marker is tapped; defaults to opening the place detail page. */
  onSelect?: (place: Place) => void;
  height?: number | string;
}

/**
 * Map view (PRD §16). Client-only: import with next/dynamic({ ssr: false }).
 * Placeholder until the Leaflet implementation lands.
 */
export default function PlacesMap({ places, height = 420 }: PlacesMapProps) {
  return (
    <div className="card" style={{ height, display: "grid", placeItems: "center" }}>
      <span className="muted small">Map of {places.length} places</span>
    </div>
  );
}
