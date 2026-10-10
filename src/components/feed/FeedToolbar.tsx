"use client";

import type { Prefs } from "@/lib/client/storage";
import { formatRadius, RADIUS_OPTIONS } from "@/lib/feedFilter";
import styles from "./feed.module.css";

/** List / map toggle, search radius and "Surprise me". */
export function FeedToolbar({
  view,
  onView,
  radiusM,
  onRadius,
  onSurprise,
  canSurprise,
}: {
  view: Prefs["view"];
  onView: (view: Prefs["view"]) => void;
  radiusM: number;
  onRadius: (radiusM: number) => void;
  onSurprise: () => void;
  canSurprise: boolean;
}) {
  const options: number[] = RADIUS_OPTIONS.includes(radiusM as (typeof RADIUS_OPTIONS)[number])
    ? [...RADIUS_OPTIONS]
    : [...RADIUS_OPTIONS, radiusM].sort((a, b) => a - b);

  return (
    <div className={styles.toolbar}>
      <div className={styles.segmented} role="group" aria-label="View">
        <button type="button" aria-pressed={view === "list"} onClick={() => onView("list")}>
          <span className={styles.wideOnly} aria-hidden>
            ☰
          </span>
          List
        </button>
        <button type="button" aria-pressed={view === "map"} onClick={() => onView("map")}>
          <span className={styles.wideOnly} aria-hidden>
            🗺️
          </span>
          Map
        </button>
      </div>
      <label className={styles.radius}>
        <span className={`${styles.radiusPrefix} ${styles.wideOnly}`} aria-hidden>
          Within
        </span>
        <select
          aria-label="Search radius"
          title="Search radius"
          value={radiusM}
          onChange={(e) => onRadius(Number(e.target.value))}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {formatRadius(m)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={`btn ${styles.surprise}`}
        onClick={onSurprise}
        disabled={!canSurprise}
        title={canSurprise ? "Open a random place that's open now" : "Nothing open to pick from"}
      >
        <span className={styles.wideOnly} aria-hidden>
          🎲
        </span>
        Surprise me
      </button>
    </div>
  );
}
