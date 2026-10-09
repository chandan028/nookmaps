"use client";

import { useEffect, useState } from "react";
import { PlaceCard } from "@/components/PlaceCard";
import { discover } from "@/lib/client/api";
import { useLocation } from "@/lib/client/useLocation";
import type { DiscoverResponse } from "@/lib/types";

/** Foundation home screen: location → feed. The full experience is built on top of this. */
export default function Home() {
  const { location, status, error, request } = useLocation();
  const [feed, setFeed] = useState<DiscoverResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!location) return;
    setLoadError(null);
    discover(location, 2000).then(setFeed, (e: Error) => setLoadError(e.message));
  }, [location]);

  return (
    <main className="container">
      <header className="app-header">
        <div className="eyebrow">NookMaps</div>
        <h1>{feed?.headline ?? "What can you do here?"}</h1>
      </header>
      {!location && (
        <div className="stack">
          <p className="muted">
            NookMaps uses your current location once to show what you can eat, drink, do and see
            right where you are.
          </p>
          <button className="btn btn-primary" onClick={() => request()} disabled={status === "requesting"}>
            {status === "requesting" ? "Finding you…" : "Use my location"}
          </button>
          {error && <p className="notice">{error}</p>}
        </div>
      )}
      {loadError && <p className="notice">{loadError}</p>}
      {feed?.sections.map((s) => (
        <section key={s.id} className="section">
          <div className="section-head">
            <h2>{s.title}</h2>
            {s.subtitle && <span className="muted small">{s.subtitle}</span>}
          </div>
          <div className="stack">
            {s.items.map((it) => (
              <PlaceCard key={it.place.id} item={it} section={s.id} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
