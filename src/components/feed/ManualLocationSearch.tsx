"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { geocode } from "@/lib/client/api";
import styles from "./feed.module.css";

export interface ManualPick {
  lat: number;
  lng: number;
  label: string;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; results: ManualPick[] }
  | { kind: "error"; message: string };

/**
 * Manual location fallback (PRD §21): used when location permission is
 * denied or unavailable, or when the user wants to look somewhere else.
 * Searches on submit only (no search-as-you-type), which keeps geocoding
 * traffic low and respects the OpenStreetMap Nominatim usage policy.
 * The query text never goes to analytics.
 */
export function ManualLocationSearch({
  onPick,
  autoFocus = false,
  title,
}: {
  onPick: (pick: ManualPick) => void;
  autoFocus?: boolean;
  title?: string;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const seq = useRef(0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setState({ kind: "error", message: "Type at least two characters." });
      return;
    }
    const n = ++seq.current;
    setState({ kind: "searching" });
    try {
      const { results } = await geocode(q);
      if (n === seq.current) setState({ kind: "results", results });
    } catch (err) {
      if (n !== seq.current) return;
      const message =
        err instanceof TypeError
          ? "Couldn't reach NookMaps. Check your connection and try again."
          : (err as Error).message || "Search failed. Please try again.";
      setState({ kind: "error", message });
    }
  }

  return (
    <div className={styles.manual}>
      {title && (
        <label htmlFor={inputId} className={styles.manualTitle}>
          {title}
        </label>
      )}
      <form role="search" className={styles.search} onSubmit={onSubmit}>
        {!title && (
          <label htmlFor={inputId} className="sr-only">
            Search for a place, area or address
          </label>
        )}
        <input
          id={inputId}
          className="input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={200}
          placeholder="Area, landmark or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={autoFocus}
        />
        <button className="btn" type="submit" disabled={state.kind === "searching"}>
          {state.kind === "searching" ? "Searching…" : "Search"}
        </button>
      </form>
      <div aria-live="polite">
        {state.kind === "error" && <p className={styles.formError}>{state.message}</p>}
        {state.kind === "results" && state.results.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            No matches. Try a nearby landmark, neighbourhood or city.
          </p>
        )}
        {state.kind === "results" && state.results.length > 0 && (
          <ul className={styles.results} aria-label="Matching locations">
            {state.results.map((r, i) => (
              <li key={`${i}-${r.lat},${r.lng}`}>
                <button type="button" className={styles.result} onClick={() => onPick(r)}>
                  <span aria-hidden>📍</span>
                  <span>{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Inline "Change location" panel shown under the feed header. */
export function ChangeLocationPanel({
  onPick,
  onUseGps,
  onClose,
  gpsAvailable,
}: {
  onPick: (pick: ManualPick) => void;
  onUseGps?: () => void;
  onClose: () => void;
  gpsAvailable: boolean;
}) {
  return (
    <div className={`card ${styles.panel}`} role="region" aria-label="Change location">
      <div className={styles.panelHead}>
        <strong>Change location</strong>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <ManualLocationSearch onPick={onPick} autoFocus />
      {gpsAvailable && onUseGps && (
        <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onUseGps}>
          <span aria-hidden>◎</span> Use my current location
        </button>
      )}
    </div>
  );
}
