"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChipsRow } from "@/components/feed/ChipsRow";
import { FeedHeader } from "@/components/feed/FeedHeader";
import { FeedEmpty, FeedError, FeedSkeleton } from "@/components/feed/FeedStates";
import { FeedToolbar } from "@/components/feed/FeedToolbar";
import { LocationGate } from "@/components/feed/LocationGate";
import { ChangeLocationPanel, type ManualPick } from "@/components/feed/ManualLocationSearch";
import { ContextBlock, SectionRail } from "@/components/feed/SectionRail";
import { WalkTimeBlock } from "@/components/feed/WalkTimeBlock";
import styles from "@/components/feed/feed.module.css";
import { track } from "@/lib/analytics";
import { primaryCategory } from "@/lib/categories";
import { discover } from "@/lib/client/api";
import {
  DEFAULT_PREFS,
  loadLastLocation,
  loadPrefs,
  savePrefs,
  type Prefs,
  type StoredLocation,
} from "@/lib/client/storage";
import { useLocation } from "@/lib/client/useLocation";
import {
  activeChip,
  filterBuckets,
  filterPlaces,
  filterSections,
  MAX_RADIUS_M,
  normalizeRadius,
  pickSurprise,
  splitSections,
} from "@/lib/feedFilter";
import { placeHref } from "@/lib/links";
import type { DiscoverResponse, FeedSection } from "@/lib/types";

const PlacesMap = dynamic(() => import("@/components/PlacesMap"), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 420 }} aria-hidden />,
});

/** Show a few strong sections first; the rest are one tap away (PRD §26). */
const INITIAL_SECTIONS = 4;
/** The walking-time block slots in after this many generic sections. */
const WALK_BLOCK_AFTER = 2;
const MAP_LIMIT = 50;

interface LoadedFeed {
  feed: DiscoverResponse;
  /** The location object this feed was fetched for (identity comparison). */
  forLocation: StoredLocation;
}

function friendlyError(err: unknown): string {
  if (err instanceof TypeError) return "Couldn't reach NookMaps. Check your connection and try again.";
  return (err as Error)?.message || "Something went wrong. Please try again.";
}

/**
 * Home: "What can I do here?" (PRD §4–§10). Location → /api/discover →
 * context headline, chips, time-of-day sections and walking-time groups,
 * as a list or a map. No search query needed.
 */
export default function Home() {
  const router = useRouter();
  const { location, status, error, request, setManual } = useLocation();

  const [mounted, setMounted] = useState(false);
  const [gpsAvailable, setGpsAvailable] = useState(true);
  const [knownDenied, setKnownDenied] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState<LoadedFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [chipId, setChipId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [showAllSections, setShowAllSections] = useState(false);
  const permissionChecked = useRef(false);

  // Client-only state: preferences live in localStorage.
  useEffect(() => {
    const p = loadPrefs();
    setPrefs({
      radiusM: normalizeRadius(p.radiusM, DEFAULT_PREFS.radiusM),
      view: p.view === "map" ? "map" : "list",
    });
    setGpsAvailable(typeof navigator !== "undefined" && "geolocation" in navigator);
    setMounted(true);
  }, []);

  // If the browser already allows location, skip the explainer and locate once.
  // If it already blocks it, go straight to the manual fallback.
  useEffect(() => {
    if (permissionChecked.current) return;
    permissionChecked.current = true;
    if (loadLastLocation()) return;
    const perms = typeof navigator !== "undefined" ? navigator.permissions : undefined;
    if (!perms?.query) return;
    perms.query({ name: "geolocation" as PermissionName }).then(
      (s) => {
        if (s.state === "granted") void request();
        else if (s.state === "denied") setKnownDenied(true);
      },
      () => undefined,
    );
  }, [request]);

  // Fetch the feed whenever the location, radius or a retry changes.
  useEffect(() => {
    if (!mounted || !location) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    discover(location, prefs.radiusM).then(
      (feed) => {
        if (cancelled) return;
        setLoaded({ feed, forLocation: location });
        setLoading(false);
        // Coarse context only, never coordinates (PRD §23).
        track("discovery_feed_loaded", {
          context: feed.context.type,
          day_part: feed.dayPart,
          provider: feed.provider,
          sections: feed.sections.length,
        });
      },
      (err) => {
        if (cancelled) return;
        setLoadError(friendlyError(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mounted, location, prefs.radiusM, retryNonce]);

  // A feed for a previous location is never shown as if it were for this one.
  const feed = loaded && loaded.forLocation === location ? loaded.feed : null;
  const chip = feed ? activeChip(feed.chips, chipId) : null;
  const chipFilter = chip?.id ?? null;

  const view = useMemo(() => {
    if (!feed) return null;
    const sections = filterSections(feed.sections, chipFilter);
    const places = filterPlaces(feed.places, chipFilter);
    return {
      ...splitSections(sections),
      buckets: filterBuckets(feed.buckets, chipFilter),
      places,
      canSurprise: pickSurprise(places, () => 0) !== null,
    };
  }, [feed, chipFilter]);

  const onRequestLocation = () => {
    void request();
  };

  const onRefresh = () => {
    track("refresh_location", { from: location?.source });
    setManualOpen(false);
    void request();
  };

  const onPick = (pick: ManualPick) => {
    setManual(pick.lat, pick.lng, pick.label);
    setManualOpen(false);
  };

  const onSelectChip = (id: string | null) => {
    setChipId(id);
    if (id) track("category_selected", { chip: id });
  };

  const onView = (next: Prefs["view"]) => {
    if (next === prefs.view) return;
    setPrefs((p) => ({ ...p, view: next }));
    savePrefs({ view: next });
    track("view_mode_changed", { view: next });
  };

  const onRadius = (radiusM: number) => {
    const r = normalizeRadius(radiusM, prefs.radiusM);
    setPrefs((p) => ({ ...p, radiusM: r }));
    savePrefs({ radiusM: r });
  };

  const onSurprise = () => {
    if (!view) return;
    const pick = pickSurprise(view.places);
    if (!pick) return;
    track("surprise_me", { category: primaryCategory(pick.place), context: feed?.context.type });
    router.push(placeHref(pick.place.id));
  };

  const openManual = () => setManualOpen(true);
  const retry = () => setRetryNonce((n) => n + 1);

  if (!mounted) {
    return (
      <main className="container" aria-busy="true">
        <FeedSkeleton withHeader />
      </main>
    );
  }

  if (!location) {
    const gateStatus = status === "idle" && knownDenied ? "denied" : gpsAvailable ? status : "unsupported";
    return (
      <main className="container">
        <LocationGate status={gateStatus} onRequest={onRequestLocation} onPick={onPick} />
      </main>
    );
  }

  const headerNotice =
    status === "requesting"
      ? null
      : status === "unsupported"
        ? "This browser can't share your location."
        : status === "denied"
          ? "Location access is blocked, so we're still showing your last location. Allow it in your browser settings or change location."
          : error;
  const updating = loading && !!feed;
  const isEmpty = !!feed && feed.places.length === 0;

  const progress = (
    <div className={styles.progress} data-active={updating} role="status">
      {updating && <span className="sr-only">Updating places…</span>}
    </div>
  );

  let body: ReactNode = null;
  if (!feed) {
    body = loadError ? (
      <FeedError message={loadError} onRetry={retry} onChangeLocation={openManual} />
    ) : (
      <FeedSkeleton />
    );
  } else if (isEmpty) {
    body = (
      <>
        {progress}
        <FeedEmpty radiusM={feed.radiusM} onWiden={() => onRadius(MAX_RADIUS_M)} onChangeLocation={openManual} />
      </>
    );
  } else if (view) {
    body = (
      <>
        <ChipsRow chips={feed.chips} active={chipFilter} onSelect={onSelectChip} />
        <FeedToolbar
          view={prefs.view}
          onView={onView}
          radiusM={prefs.radiusM}
          onRadius={onRadius}
          onSurprise={onSurprise}
          canSurprise={view.canSurprise}
        />
        {loadError && (
          <div className="notice row wrap" role="alert" style={{ marginTop: 12, justifyContent: "space-between" }}>
            <span>Couldn&apos;t update: {loadError}</span>
            <button type="button" className="btn btn-sm" onClick={retry}>
              Retry
            </button>
          </div>
        )}
        {progress}
        <div className={updating ? styles.busy : undefined} aria-busy={updating}>
          {prefs.view === "map" ? (
            <>
              <div className={styles.map}>
                <PlacesMap
                  origin={feed.origin}
                  places={view.places.slice(0, MAP_LIMIT)}
                  current={feed.context.currentPlace}
                />
              </div>
              <WalkTimeBlock buckets={view.buckets} />
            </>
          ) : (
            <FeedList
              whileHere={view.whileHere}
              afterThis={view.afterThis}
              general={view.general}
              buckets={view.buckets}
              fallback={
                chip
                  ? {
                      id: `chip-${chip.id}`,
                      title: `${chip.label} nearby`,
                      items: view.places.filter((s) => s.openNow !== false).slice(0, 8),
                    }
                  : null
              }
              showAll={showAllSections || !!chip}
              onShowAll={() => setShowAllSections(true)}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <main className="container">
      <FeedHeader
        feed={feed}
        location={location}
        refreshing={status === "requesting"}
        loading={!loadError}
        gpsAvailable={gpsAvailable}
        notice={headerNotice}
        manualOpen={manualOpen}
        onRefresh={onRefresh}
        onChangeLocation={() => setManualOpen((o) => !o)}
      />
      {manualOpen && (
        <ChangeLocationPanel
          onPick={onPick}
          onUseGps={onRefresh}
          onClose={() => setManualOpen(false)}
          gpsAvailable={gpsAvailable}
        />
      )}
      {body}
      <p className="sr-only" aria-live="polite">
        {feed && !loading ? `${feed.headline}. ${feed.places.length} places nearby.` : ""}
      </p>
    </main>
  );
}

function FeedList({
  whileHere,
  afterThis,
  general,
  buckets,
  fallback,
  showAll,
  onShowAll,
}: {
  whileHere: FeedSection[];
  afterThis: FeedSection[];
  general: FeedSection[];
  buckets: DiscoverResponse["buckets"];
  /** Shown when a chip filters every section away. */
  fallback: FeedSection | null;
  showAll: boolean;
  onShowAll: () => void;
}) {
  const visible = showAll ? general : general.slice(0, INITIAL_SECTIONS);
  const hiddenCount = general.length - visible.length;
  const nothing = whileHere.length + afterThis.length + general.length === 0;
  const before = visible.slice(0, WALK_BLOCK_AFTER);
  const after = visible.slice(WALK_BLOCK_AFTER);

  return (
    <>
      <ContextBlock whileHere={whileHere} afterThis={afterThis} />
      {nothing && fallback && fallback.items.length > 0 && <SectionRail section={fallback} />}
      {before.map((s) => (
        <SectionRail key={s.id} section={s} />
      ))}
      <WalkTimeBlock buckets={buckets} />
      {after.map((s) => (
        <SectionRail key={s.id} section={s} />
      ))}
      {hiddenCount > 0 && (
        <button type="button" className={`btn ${styles.moreBtn}`} onClick={onShowAll}>
          More ideas ({hiddenCount} more {hiddenCount === 1 ? "section" : "sections"})
        </button>
      )}
    </>
  );
}
