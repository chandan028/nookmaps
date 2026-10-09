"use client";

import { formatRadius, MAX_RADIUS_M } from "@/lib/feedFilter";
import styles from "./feed.module.css";

/** Placeholder while the feed loads: optional header lines, chips and two rails. */
export function FeedSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return (
    <div aria-hidden>
      {withHeader && (
        <div style={{ paddingTop: 22 }}>
          <div className={`skeleton ${styles.skelLine}`} style={{ width: 120 }} />
          <div className={`skeleton ${styles.skelTitle}`} />
          <div className={`skeleton ${styles.skelLine}`} style={{ width: "55%" }} />
        </div>
      )}
      <div className={styles.skelChips}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`skeleton ${styles.skelChip}`} />
        ))}
      </div>
      {[0, 1].map((s) => (
        <div key={s} className="section">
          <div className={`skeleton ${styles.skelLine}`} style={{ width: 160, marginBottom: 12 }} />
          <div className="rail" style={{ overflow: "hidden" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`skeleton ${styles.skelCard}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FeedError({
  message,
  onRetry,
  onChangeLocation,
}: {
  message: string;
  onRetry: () => void;
  onChangeLocation: () => void;
}) {
  return (
    <div className={`card ${styles.state}`} role="alert">
      <div className={styles.stateIcon} aria-hidden>
        ⚠️
      </div>
      <h2>Couldn&apos;t load places</h2>
      <p className="muted">{message}</p>
      <div className="row wrap" style={{ justifyContent: "center" }}>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="btn" onClick={onChangeLocation}>
          Change location
        </button>
      </div>
    </div>
  );
}

export function FeedEmpty({
  radiusM,
  onWiden,
  onChangeLocation,
}: {
  radiusM: number;
  onWiden: () => void;
  onChangeLocation: () => void;
}) {
  const canWiden = radiusM < MAX_RADIUS_M;
  return (
    <div className={`card ${styles.state}`}>
      <div className={styles.stateIcon} aria-hidden>
        🧭
      </div>
      <h2>Nothing to suggest within {formatRadius(radiusM)}</h2>
      <p className="muted">
        We couldn&apos;t find places to suggest here right now.
        {canWiden ? " Try looking a little further." : " Try another location."}
      </p>
      <div className="row wrap" style={{ justifyContent: "center" }}>
        {canWiden && (
          <button type="button" className="btn btn-primary" onClick={onWiden}>
            Search within {formatRadius(MAX_RADIUS_M)}
          </button>
        )}
        <button type="button" className="btn" onClick={onChangeLocation}>
          Change location
        </button>
      </div>
    </div>
  );
}
