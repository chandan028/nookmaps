import type { Place } from "./types";

/** Hand off to the platform's navigation app (PRD §16). Google Maps universal links open the app on mobile. */
export function directionsUrl(place: Pick<Place, "lat" | "lng" | "name" | "id" | "provider">): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${place.lat},${place.lng}`,
    travelmode: "walking",
  });
  if (place.provider === "google") params.set("destination_place_id", place.id.replace(/^g:/, ""));
  return `https://www.google.com/maps/dir/?${params}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function placeHref(id: string): string {
  return `/place/${encodeURIComponent(id)}`;
}
