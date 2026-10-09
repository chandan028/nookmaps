import type { AreaInfo, LatLng, Place, ProviderName } from "../types";

export interface NearbyQuery extends LatLng {
  radiusM: number;
  /** Optional cap on results; providers may return fewer. */
  limit?: number;
}

export interface GeocodeResult extends LatLng {
  label: string;
}

/**
 * The replaceable data-provider layer (PRD §11). Anything that can answer
 * these four questions can power NookMaps.
 */
export interface PlacesProvider {
  readonly name: ProviderName;
  nearby(q: NearbyQuery): Promise<Place[]>;
  details(id: string): Promise<Place | null>;
  /** Where is the user, in words? street → neighbourhood → city. */
  reverseGeocode(p: LatLng): Promise<AreaInfo>;
  /** Manual-location fallback when GPS permission is denied (PRD §21). */
  geocode(query: string, near?: LatLng): Promise<GeocodeResult[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderName,
    readonly status?: number,
  ) {
    super(message);
  }
}
