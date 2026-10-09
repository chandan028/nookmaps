"use client";

import { use, useEffect, useState } from "react";
import { PlaceCard } from "@/components/PlaceCard";
import { placeDetail, type PlaceDetailResponse } from "@/lib/client/api";
import { directionsUrl } from "@/lib/links";

/** Foundation detail screen; the full detail experience is built on top of this. */
export default function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<PlaceDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    placeDetail(decodeURIComponent(id)).then(setData, (e: Error) => setError(e.message));
  }, [id]);

  if (error) return <main className="container"><p className="notice">{error}</p></main>;
  if (!data) return <main className="container"><div className="skeleton" style={{ height: 160, marginTop: 24 }} /></main>;
  const { place } = data;
  return (
    <main className="container">
      <header className="app-header">
        <h1>{place.name}</h1>
        {place.address && <p className="muted">{place.address}</p>}
        <a className="btn btn-primary" href={directionsUrl(place)} target="_blank" rel="noopener noreferrer">
          Directions
        </a>
      </header>
      {data.whatNext.map((s) => (
        <section key={s.id} className="section">
          <h2>{s.title}</h2>
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
