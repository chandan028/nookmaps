"use client";

import type { Place } from "../types";

/** Lightweight local preferences (PRD §22). Everything stays on the device. */
export interface Prefs {
  radiusM: number;
  view: "list" | "map";
}

const PREFS_KEY = "nookmaps:prefs";
const SAVED_KEY = "nookmaps:saved";
const LAST_LOCATION_KEY = "nookmaps:last-location";

export const DEFAULT_PREFS: Prefs = { radiusM: 2000, view: "list" };

function read<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: Storage | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: preferences are optional */
  }
}

const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

export function loadPrefs(): Prefs {
  return read(local(), PREFS_KEY, DEFAULT_PREFS);
}

export function savePrefs(p: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...p };
  write(local(), PREFS_KEY, next);
  return next;
}

export type SavedPlace = Pick<Place, "id" | "name" | "lat" | "lng" | "categories" | "address"> & {
  savedAt: number;
};

export function loadSaved(): SavedPlace[] {
  try {
    const raw = local()?.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedPlace[]) : [];
  } catch {
    return [];
  }
}

export function isSaved(id: string): boolean {
  return loadSaved().some((p) => p.id === id);
}

export function toggleSaved(place: Place): boolean {
  const saved = loadSaved();
  const exists = saved.some((p) => p.id === place.id);
  const next = exists
    ? saved.filter((p) => p.id !== place.id)
    : [
        {
          id: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          categories: place.categories,
          address: place.address,
          savedAt: Date.now(),
        },
        ...saved,
      ];
  write(local(), SAVED_KEY, next);
  return !exists;
}

/** Remove one saved place; returns the remaining list. */
export function removeSaved(id: string): SavedPlace[] {
  const next = loadSaved().filter((p) => p.id !== id);
  write(local(), SAVED_KEY, next);
  return next;
}

/** Put back a place removed with `removeSaved` (undo), newest first. */
export function restoreSaved(item: SavedPlace): SavedPlace[] {
  const next = [...loadSaved().filter((p) => p.id !== item.id), item].sort((a, b) => b.savedAt - a.savedAt);
  write(local(), SAVED_KEY, next);
  return next;
}

/**
 * The last location the user chose, kept for this tab only (sessionStorage)
 * so plan / ask / detail screens can reuse it without re-prompting, and so it
 * is gone when the tab closes (PRD §21, minimal retention).
 */
export interface StoredLocation {
  lat: number;
  lng: number;
  accuracyM?: number;
  source: "gps" | "manual";
  label?: string;
  at: number;
}

export function loadLastLocation(): StoredLocation | null {
  try {
    const raw = session()?.getItem(LAST_LOCATION_KEY);
    return raw ? (JSON.parse(raw) as StoredLocation) : null;
  } catch {
    return null;
  }
}

export function saveLastLocation(loc: StoredLocation): void {
  write(session(), LAST_LOCATION_KEY, loc);
}

export function clearLastLocation(): void {
  try {
    session()?.removeItem(LAST_LOCATION_KEY);
  } catch {
    /* ignore */
  }
}
