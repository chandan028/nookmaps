"use client";

import type { CategoryChip } from "@/lib/types";
import styles from "./feed.module.css";

/** Dynamic category chips (PRD §7): only non-empty chips come from the API. */
export function ChipsRow({
  chips,
  active,
  onSelect,
}: {
  chips: CategoryChip[];
  active: string | null;
  /** null clears the filter. */
  onSelect: (chipId: string | null) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className={`chips ${styles.chipsWrap}`} role="group" aria-label="Filter by category">
      <button type="button" className="chip" aria-pressed={active === null} onClick={() => onSelect(null)}>
        All
      </button>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className="chip"
          aria-pressed={active === c.id}
          onClick={() => onSelect(active === c.id ? null : c.id)}
        >
          <span aria-hidden>{c.emoji}</span>
          {c.label}
          <span className={styles.chipCount}>
            <span className="sr-only">, </span>
            {c.count}
            <span className="sr-only"> {c.count === 1 ? "place" : "places"}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
