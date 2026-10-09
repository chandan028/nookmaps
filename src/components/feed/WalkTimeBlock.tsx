"use client";

import { useId, useState } from "react";
import { PlaceCard } from "@/components/PlaceCard";
import type { WalkBucket } from "@/lib/types";
import styles from "./feed.module.css";

const INITIAL = 4;

/** PRD §9: group by practical reachability ("within 5 min") rather than kilometres. */
export function WalkTimeBlock({ buckets }: { buckets: WalkBucket[] }) {
  const headingId = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (buckets.length === 0) return null;

  const current = buckets.find((b) => b.minutes === selected) ?? buckets[0];
  const shown = expanded ? current.items : current.items.slice(0, INITIAL);

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section-head">
        <h2 id={headingId}>By walking time</h2>
        <span className="muted small">Open or hours unknown</span>
      </div>
      <div className="chips" role="group" aria-label="Walking time">
        {buckets.map((b) => (
          <button
            key={b.minutes}
            type="button"
            className="chip"
            aria-pressed={b.minutes === current.minutes}
            onClick={() => {
              setSelected(b.minutes);
              setExpanded(false);
            }}
          >
            {b.label}
            <span className={styles.chipCount}>
              <span className="sr-only">, </span>
              {b.items.length}
              <span className="sr-only"> places</span>
            </span>
          </button>
        ))}
      </div>
      <ul className={`stack ${styles.railList} ${styles.walkList}`}>
        {shown.map((item) => (
          <li key={item.place.id}>
            <PlaceCard item={item} section={`walk-${current.minutes}`} />
          </li>
        ))}
      </ul>
      {current.items.length > INITIAL && (
        <button type="button" className={`btn btn-sm btn-ghost ${styles.showAll}`} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show fewer" : `Show all ${current.items.length}`}
        </button>
      )}
    </section>
  );
}
