"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { movedSignificantly } from "../geo";
import { loadLastLocation, saveLastLocation, type StoredLocation } from "./storage";

export type LocationStatus =
  | "idle" // haven't asked yet; show the explainer
  | "requesting"
  | "ready"
  | "denied"
  | "unavailable"
  | "unsupported";

const MOVEMENT_THRESHOLD_M = 150;

/**
 * One-shot browser geolocation (PRD §4, §5, §21). No continuous tracking:
 * we read the position when asked, and re-check once when the tab regains
 * focus, refreshing only if the user moved more than the threshold.
 */
export function useLocation() {
  const [location, setLocation] = useState<StoredLocation | null>(null);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const locRef = useRef<StoredLocation | null>(null);
  locRef.current = location;

  useEffect(() => {
    const last = loadLastLocation();
    if (last) {
      setLocation(last);
      setStatus("ready");
    }
  }, []);

  const apply = useCallback((loc: StoredLocation) => {
    saveLastLocation(loc);
    setLocation(loc);
    setStatus("ready");
    setError(null);
  }, []);

  const request = useCallback(
    (opts: { silent?: boolean } = {}) =>
      new Promise<StoredLocation | null>((resolve) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          setStatus("unsupported");
          resolve(null);
          return;
        }
        if (!opts.silent) setStatus("requesting");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const loc: StoredLocation = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyM: pos.coords.accuracy,
              source: "gps",
              at: Date.now(),
            };
            if (!opts.silent) track("location_permission_granted");
            apply(loc);
            resolve(loc);
          },
          (err) => {
            if (err.code === err.PERMISSION_DENIED) {
              track("location_permission_denied");
              setStatus("denied");
              setError("Location permission was denied.");
            } else {
              setStatus(locRef.current ? "ready" : "unavailable");
              setError("We couldn't get your position. Try again or enter a location.");
            }
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
        );
      }),
    [apply],
  );

  const setManual = useCallback(
    (lat: number, lng: number, label?: string) => {
      track("manual_location_set");
      apply({ lat, lng, source: "manual", label, at: Date.now() });
    },
    [apply],
  );

  // Meaningful-movement refresh: check once when the user comes back to the tab.
  useEffect(() => {
    const onVisible = () => {
      const current = locRef.current;
      if (document.visibilityState !== "visible" || current?.source !== "gps") return;
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (movedSignificantly(current, next, MOVEMENT_THRESHOLD_M)) {
            apply({ ...next, accuracyM: pos.coords.accuracy, source: "gps", at: Date.now() });
          }
        },
        () => undefined,
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [apply]);

  return { location, status, error, request, setManual };
}
