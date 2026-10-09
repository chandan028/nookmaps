"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { CATEGORY_EMOJI, CATEGORY_LABEL } from "@/lib/categories";
import {
  loadLastLocation,
  loadSaved,
  removeSaved,
  restoreSaved,
  type SavedPlace,
  type StoredLocation,
} from "@/lib/client/storage";
import { distanceMeters, formatDistance } from "@/lib/geo";
import { directionsUrl, placeHref } from "@/lib/links";
import { providerFromId } from "@/lib/placeDetail";
import styles from "./saved.module.css";

function savedOn(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

/** Saved places (PRD §14, §22). Kept in localStorage only: nothing leaves the device. */
export default function SavedPage() {
  const [items, setItems] = useState<SavedPlace[] | null>(null);
  const [loc, setLoc] = useState<StoredLocation | null>(null);
  const [removed, setRemoved] = useState<SavedPlace | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setItems(loadSaved());
    setLoc(loadLastLocation());
    // Stay in sync when another tab saves or removes a place.
    const onStorage = () => setItems(loadSaved());
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearTimeout(undoTimer.current);
    };
  }, []);

  const remove = useCallback((item: SavedPlace) => {
    setItems(removeSaved(item.id));
    setRemoved(item);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemoved(null), 6000);
  }, []);

  const undo = useCallback(() => {
    if (!removed) return;
    setItems(restoreSaved(removed));
    setRemoved(null);
    clearTimeout(undoTimer.current);
  }, [removed]);

  return (
    <main className="container">
      <header className="app-header">
        <h1>Saved places</h1>
        <p className={`muted small ${styles.privacy}`}>
          <span aria-hidden>🔒</span> Saved places stay on this device. Nothing is uploaded, and clearing your
          browser data removes them.
        </p>
      </header>

      {items === null ? (
        <div className="stack" aria-busy="true" aria-label="Loading saved places">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 96 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon} aria-hidden>
            ♡
          </div>
          <h2>No saved places yet</h2>
          <p className="muted">
            Tap <strong>Save</strong> on any place to keep it here for later.
          </p>
          <Link href="/" className="btn btn-primary">
            Discover what&apos;s nearby
          </Link>
        </div>
      ) : (
        <>
          <p className="muted small" aria-live="polite">
            {items.length} saved {items.length === 1 ? "place" : "places"}
          </p>
          <ul className={styles.list}>
            {items.map((item) => {
              const cat = item.categories[0] ?? "other";
              const provider = providerFromId(item.id);
              const params = { section: "saved", category: cat, provider };
              const distance = loc ? distanceMeters(loc, item) : null;
              return (
                <li key={item.id} className={`card ${styles.item}`}>
                  <Link
                    href={placeHref(item.id)}
                    className={styles.main}
                    onClick={() => track("place_opened", params)}
                  >
                    <span className={styles.thumb} aria-hidden>
                      {CATEGORY_EMOJI[cat]}
                    </span>
                    <span className={styles.body}>
                      <span className={styles.name}>{item.name}</span>
                      <span className="meta">
                        <span>{CATEGORY_LABEL[cat]}</span>
                        {distance !== null && <span>{formatDistance(distance)} away</span>}
                        <span>Saved {savedOn(item.savedAt)}</span>
                      </span>
                      {item.address && <span className={styles.address}>{item.address}</span>}
                    </span>
                  </Link>
                  <div className={styles.actions}>
                    <a
                      className="btn btn-sm btn-primary"
                      href={directionsUrl({ ...item, provider })}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => track("directions_clicked", params)}
                    >
                      Directions
                    </a>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => remove(item)}
                      aria-label={`Remove ${item.name} from saved`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className={styles.toast} role="status" aria-live="polite">
        {removed && (
          <div className={styles.toastInner}>
            <span>Removed {removed.name}</span>
            <button type="button" className={styles.undo} onClick={undo}>
              Undo
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
