"use client";

import Link from "next/link";
import type { StoredLocation } from "@/lib/client/storage";
import { accuracyNotice, areaLine, DAY_PART_TITLE } from "@/lib/feedFilter";
import { placeHref } from "@/lib/links";
import type { DiscoverResponse } from "@/lib/types";
import styles from "./feed.module.css";

/**
 * "You're at Third Wave Coffee" / "You're around Indiranagar" (PRD §5, §26).
 * The venue claim comes from the API, which only names a venue when it is
 * confident; we add an explicit notice when GPS accuracy is poor.
 */
export function FeedHeader({
  feed,
  location,
  refreshing,
  loading,
  gpsAvailable,
  notice,
  manualOpen,
  onRefresh,
  onChangeLocation,
}: {
  feed: DiscoverResponse | null;
  location: StoredLocation;
  refreshing: boolean;
  /** Whether the first feed for this location is still on its way (vs. failed). */
  loading: boolean;
  gpsAvailable: boolean;
  notice?: string | null;
  manualOpen: boolean;
  onRefresh: () => void;
  onChangeLocation: () => void;
}) {
  const manual = location.source === "manual";
  const approx = manual ? null : accuracyNotice(location.accuracyM);
  const venue = feed?.context.currentPlace;
  const line = feed ? areaLine(feed.area, feed.headline) : manual ? location.label ?? "" : "";

  return (
    <header className={styles.header}>
      <div className="eyebrow">
        {manual ? "Chosen location" : "Right now"}
        {feed ? ` · ${DAY_PART_TITLE[feed.dayPart]}` : ""}
      </div>
      {feed ? (
        <h1 className={styles.headline}>{feed.headline}</h1>
      ) : (
        <h1 className={`${styles.headline} ${styles.headlinePending}`}>
          {loading ? "Looking around…" : "What's around you"}
        </h1>
      )}
      {line && <p className={styles.area}>{line}</p>}
      {feed && venue && (
        <p className={styles.reason}>
          {feed.context.reason}{" "}
          <Link href={placeHref(venue.id)}>About this place</Link>
        </p>
      )}
      {approx && (
        <div
          className={styles.accuracy}
          role="status"
          title="We won't name a specific venue until your position is more precise."
        >
          <span aria-hidden>◌</span>
          {approx}
        </div>
      )}
      {notice && <p className={`notice ${styles.headerNotice}`}>{notice}</p>}
      <div className={styles.headerActions}>
        {gpsAvailable && (
          <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <>
                <span className={`${styles.spinner} ${styles.spinnerSm}`} aria-hidden /> Locating…
              </>
            ) : (
              <>
                <span aria-hidden>↻</span> {manual ? "Use my location" : "Refresh location"}
              </>
            )}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onChangeLocation}
          aria-expanded={manualOpen}
        >
          <span aria-hidden>✎</span> Change location
        </button>
      </div>
    </header>
  );
}
