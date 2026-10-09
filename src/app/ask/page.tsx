"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PlaceCard } from "@/components/PlaceCard";
import { track } from "@/lib/analytics";
import type { AskResponse } from "@/lib/ask";
import { postJson } from "@/lib/client/api";
import { loadPrefs, type StoredLocation } from "@/lib/client/storage";
import { useLocation } from "@/lib/client/useLocation";
import styles from "./ask.module.css";

const MAX_LENGTH = 300;

/** The two PRD §20 examples first, then a few that show off the other constraints. */
const EXAMPLES = [
  "I have ₹500 and two hours",
  "I want something fun nearby but not food",
  "Quiet place to work with coffee",
  "Date night, not too expensive",
  "Something to do with kids this afternoon",
  "Late-night food within 10 minutes",
];

type Status = "idle" | "loading" | "done" | "error";

function isExclusion(chip: string): boolean {
  return /^(?:not|no)\b/i.test(chip);
}

function locationLabel(loc: StoredLocation): string {
  if (loc.label) return loc.label;
  return loc.source === "gps" ? "your current location" : "the location you set";
}

/** Ask NookMaps (PRD §20, V4): plain-language requests → constraints → real places. */
export default function AskPage() {
  const { location, status: locStatus, error: locError, request } = useLocation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A question asked before we had a location; sent as soon as one arrives. */
  const [pending, setPending] = useState<string | null>(null);
  const requestId = useRef(0);

  const run = useCallback(async (text: string, loc: StoredLocation) => {
    const id = ++requestId.current;
    setStatus("loading");
    setError(null);
    try {
      const res = await postJson<AskResponse>("/api/ask", {
        lat: loc.lat,
        lng: loc.lng,
        acc: Math.round(loc.accuracyM ?? (loc.source === "manual" ? 500 : 30)),
        query: text,
        radius: loadPrefs().radiusM,
      });
      if (id !== requestId.current) return;
      setData(res);
      setStatus("done");
      const c = res.constraints;
      // Coarse shape of the request only: never the text, never coordinates.
      track("nl_query_submitted", {
        has_budget: c.budget !== undefined || c.maxPriceLevel !== undefined,
        has_time: c.timeMinutes !== undefined,
        include_count: c.includeCategories.length,
        exclude_count: c.excludeCategories.length,
        results: res.results.length,
      });
    } catch (e) {
      if (id !== requestId.current) return;
      setError((e as Error).message || "Something went wrong. Please try again.");
      setStatus("error");
      track("nl_query_submitted", { failed: true });
    }
  }, []);

  const submit = useCallback(
    (text: string) => {
      const q = text.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
      if (!q) return;
      if (!location) {
        setPending(q);
        if (locStatus !== "requesting") void request();
        return;
      }
      void run(q, location);
    },
    [location, locStatus, request, run],
  );

  useEffect(() => {
    if (location && pending) {
      setPending(null);
      void run(pending, location);
    }
  }, [location, pending, run]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(query);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(query);
    }
  };

  const pickExample = (text: string) => {
    setQuery(text);
    submit(text);
  };

  const constraints = data?.constraints;
  const loading = status === "loading";

  return (
    <main className="container">
      <header className="app-header">
        <div className="eyebrow">Ask NookMaps</div>
        <h1>What are you in the mood for?</h1>
        <p className="muted small">
          Say it the way you'd tell a friend: a budget, how much time you have, what you do or don&apos;t
          want. We&apos;ll match it to real places around you.
        </p>
      </header>

      {location ? (
        <div className={styles.location}>
          <span className="muted small">📍 Near {locationLabel(location)}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void request()}
            disabled={locStatus === "requesting"}
          >
            {locStatus === "requesting" ? "Locating…" : "Update"}
          </button>
        </div>
      ) : (
        <div className={`card ${styles.locationCard}`}>
          <p className="small">
            To find places that fit, NookMaps needs to know where you are. We use your location once,
            only for this search.
          </p>
          <div className="row wrap">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void request()}
              disabled={locStatus === "requesting"}
            >
              {locStatus === "requesting" ? "Finding you…" : "Use my location"}
            </button>
            <Link href="/" className="btn btn-ghost">
              Set a location manually
            </Link>
          </div>
          {locError && <p className="notice">{locError}</p>}
          {pending && !locError && (
            <p className="muted small">We&apos;ll answer as soon as we know where you are.</p>
          )}
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} role="search" aria-label="Ask NookMaps">
        <label htmlFor="ask-input" className="sr-only">
          Describe what you want to do
        </label>
        <textarea
          id="ask-input"
          className={styles.input}
          rows={2}
          maxLength={MAX_LENGTH}
          placeholder="I have ₹500 and two hours…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="search"
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={!query.trim() || loading}>
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>

      <div className={styles.examples} aria-label="Try one of these">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className={`chip ${styles.example}`} onClick={() => pickExample(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading && (
          <div className="section stack" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`skeleton ${styles.skeletonCard}`} />
            ))}
          </div>
        )}

        {status === "error" && error && (
          <div className="section stack">
            <p className="notice">{error}</p>
            <button type="button" className="btn" onClick={() => submit(query)}>
              Try again
            </button>
          </div>
        )}

        {status === "done" && data && constraints && (
          <>
            <section className="section">
              <div className="section-head">
                <h2>Here&apos;s what I understood</h2>
              </div>
              {constraints.explanation.length > 0 ? (
                <ul className={styles.understood}>
                  {constraints.explanation.map((chip) => (
                    <li key={chip} className={isExclusion(chip) ? `${styles.tag} ${styles.tagExclude}` : styles.tag}>
                      {chip}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">
                  I couldn&apos;t pick out a budget, a time or a kind of place, so here&apos;s what&apos;s
                  good and open around you. Try something like “coffee within 5 minutes” or “₹300 for
                  lunch”.
                </p>
              )}
            </section>

            {data.notes.map((note) => (
              <p key={note} className={`notice ${styles.note}`}>
                {note}
              </p>
            ))}

            {data.results.length > 0 ? (
              <section className="section">
                <div className="section-head">
                  <h2>
                    {data.results.length} {data.results.length === 1 ? "place fits" : "places fit"}
                  </h2>
                  {data.provider === "demo" && <span className="badge">Demo data</span>}
                </div>
                <div className="stack">
                  {data.results.map((item) => (
                    <PlaceCard key={item.place.id} item={item} section="ask" />
                  ))}
                </div>
              </section>
            ) : (
              <section className={`section card ${styles.empty}`}>
                <h2>Nothing nearby fits all of that right now</h2>
                <p className="muted small">Try loosening it a little:</p>
                <ul>
                  {data.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
