"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
} from "react";
import { PlaceCard, PriceLevel } from "@/components/PlaceCard";
import { track } from "@/lib/analytics";
import { CATEGORY_EMOJI, CATEGORY_LABEL, primaryCategory } from "@/lib/categories";
import { ApiError, placeDetail, type PlaceDetailResponse } from "@/lib/client/api";
import { isSaved, loadLastLocation, toggleSaved, type StoredLocation } from "@/lib/client/storage";
import { distanceMeters, formatDistance, formatWalk, walkMinutes } from "@/lib/geo";
import { directionsUrl, telUrl } from "@/lib/links";
import {
  displayHost,
  groupWhatNext,
  photoSrc,
  safeExternalUrl,
  shareClipboardText,
  shareContent,
  weeklyHours,
  whatNextPlaces,
} from "@/lib/placeDetail";
import { localTime, openStatusText } from "@/lib/time";
import type { Place, PlacePhoto, ProviderName } from "@/lib/types";
import styles from "./place.module.css";

const MAP_HEIGHT = 260;
/** Beyond this the "you" dot would zoom the small map out to the whole city. */
const SHOW_USER_ON_MAP_M = 3000;

const PlacesMap = dynamic(() => import("@/components/PlacesMap"), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: MAP_HEIGHT }} aria-hidden />,
});

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: PlaceDetailResponse }
  | { status: "not-found" }
  | { status: "error"; message: string };

const PROVIDER_CREDIT: Record<ProviderName, string> = {
  google: "Place information from Google Maps.",
  osm: "Place data © OpenStreetMap contributors.",
  demo: "Demo data: this place is fictional.",
};

/* ---------- Small pieces ---------- */

function BackLink() {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Go back to the feed (keeping its scroll position) when we came from inside the app.
    if (window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
  };
  return (
    <Link href="/" className={`btn btn-ghost btn-sm ${styles.back}`} onClick={onClick}>
      <span aria-hidden>←</span> Back
    </Link>
  );
}

function Gallery({ place, photos }: { place: Place; photos: PlacePhoto[] }) {
  const [broken, setBroken] = useState<Set<number>>(() => new Set());
  const visible = photos.map((p, i) => ({ p, i })).filter(({ i }) => !broken.has(i));
  const cat = primaryCategory(place);

  if (!visible.length) {
    return (
      <div className={styles.heroFallback} aria-hidden>
        <span>{CATEGORY_EMOJI[cat]}</span>
      </div>
    );
  }
  return (
    <div
      className={`${styles.gallery} ${visible.length === 1 ? styles.gallerySingle : ""}`}
      aria-label={`Photos of ${place.name}`}
      role="group"
    >
      {visible.map(({ p, i }, n) => {
        const credits = (p.attributions ?? []).filter((a) => a.name);
        return (
          <figure key={i} className={styles.photo}>
            <img
              src={photoSrc(p.url, 800)}
              alt={`${place.name}, photo ${n + 1} of ${visible.length}`}
              loading={n === 0 ? "eager" : "lazy"}
              decoding="async"
              onError={() => setBroken((prev) => new Set(prev).add(i))}
            />
            {credits.length > 0 && (
              <figcaption className={styles.credit}>
                Photo:{" "}
                {credits.map((a, k) => {
                  const href = safeExternalUrl(a.uri);
                  return (
                    <span key={k}>
                      {k > 0 && ", "}
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {a.name}
                        </a>
                      ) : (
                        a.name
                      )}
                    </span>
                  );
                })}
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}

function TileInner({ icon, label }: { icon: string; label: string }) {
  return (
    <>
      <span className={styles.actionIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.actionLabel}>{label}</span>
    </>
  );
}

type TileProps = { icon: string; label: string; primary?: boolean };

function ActionLink({ icon, label, primary, ...props }: TileProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...props} className={`${styles.action} ${primary ? styles.actionPrimary : ""}`}>
      <TileInner icon={icon} label={label} />
    </a>
  );
}

function ActionButton({ icon, label, primary, ...props }: TileProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={`${styles.action} ${primary ? styles.actionPrimary : ""}`}>
      <TileInner icon={icon} label={label} />
    </button>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading place">
      <div className={`skeleton ${styles.skelHero}`} />
      <div className={`skeleton ${styles.skelLine}`} style={{ width: "35%" }} />
      <div className={`skeleton ${styles.skelTitle}`} />
      <div className={`skeleton ${styles.skelLine}`} style={{ width: "60%" }} />
      <div className={styles.actions}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`skeleton ${styles.skelAction}`} />
        ))}
      </div>
      <div className={`skeleton ${styles.skelCard}`} />
      <div className={`skeleton ${styles.skelCard}`} />
    </div>
  );
}

/* ---------- Page ---------- */

/** Place detail (PRD §14) with the contextual "What next?" sections (PRD §15). */
export default function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const id = useMemo(() => {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  }, [rawId]);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [userLoc, setUserLoc] = useState<StoredLocation | null>(null);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    placeDetail(id).then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setState({ status: "not-found" });
        else
          setState({
            status: "error",
            message:
              err instanceof ApiError
                ? err.message
                : "We couldn't reach NookMaps. Check your connection and try again.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  useEffect(() => {
    setUserLoc(loadLastLocation());
    setSaved(isSaved(id));
  }, [id]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const place = state.status === "ready" ? state.data.place : null;

  useEffect(() => {
    if (!place) return;
    const previous = document.title;
    document.title = `${place.name} · NookMaps`;
    return () => {
      document.title = previous;
    };
  }, [place]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  if (state.status === "loading") {
    return (
      <main className={`container ${styles.page}`}>
        <div className={styles.topBar}>
          <BackLink />
        </div>
        <DetailSkeleton />
      </main>
    );
  }

  if (state.status === "not-found" || state.status === "error") {
    const notFound = state.status === "not-found";
    return (
      <main className={`container ${styles.page}`}>
        <div className={styles.topBar}>
          <BackLink />
        </div>
        <div className={styles.empty} role={notFound ? undefined : "alert"}>
          <div className={styles.emptyIcon} aria-hidden>
            {notFound ? "🧭" : "⚠️"}
          </div>
          <h1>{notFound ? "We couldn't find this place" : "This place didn't load"}</h1>
          <p className="muted">
            {notFound ? "It may have closed, moved, or the link is out of date." : state.message}
          </p>
          <div className="row wrap" style={{ justifyContent: "center" }}>
            {!notFound && (
              <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            )}
            <Link href="/" className={notFound ? "btn btn-primary" : "btn"}>
              Discover nearby
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <PlaceDetail
      data={state.data}
      userLoc={userLoc}
      saved={saved}
      onToggleSave={() => {
        const now = toggleSaved(state.data.place);
        setSaved(now);
        if (now) {
          track("place_saved", {
            section: "detail",
            category: primaryCategory(state.data.place),
            provider: state.data.place.provider,
          });
        }
        showToast(now ? "Saved on this device" : "Removed from saved");
      }}
      toast={toast}
      showToast={showToast}
    />
  );
}

function PlaceDetail({
  data,
  userLoc,
  saved,
  onToggleSave,
  toast,
  showToast,
}: {
  data: PlaceDetailResponse;
  userLoc: StoredLocation | null;
  saved: boolean;
  onToggleSave: () => void;
  toast: string | null;
  showToast: (msg: string) => void;
}) {
  const { place } = data;
  const cat = primaryCategory(place);
  const params = { section: "detail", category: cat, provider: place.provider };

  // Client-only render (data arrives after mount), so reading the clock here is hydration-safe.
  const now = localTime(Date.now(), new Date().getTimezoneOffset());
  const status = openStatusText(place, now);
  const statusTone =
    status?.startsWith("Closing soon") ? styles.warn : data.openNow === true ? "open" : data.openNow === false ? "closed" : "";
  const week = weeklyHours(place.openingHours, now.day);

  const website = safeExternalUrl(place.website);
  const fromUser = userLoc ? distanceMeters(userLoc, place) : null;
  const walk = fromUser !== null ? walkMinutes(fromUser) : null;

  const groups = useMemo(() => groupWhatNext(data.whatNext), [data.whatNext]);
  const mapPlaces = useMemo(() => whatNextPlaces(data.whatNext, place.id), [data.whatNext, place.id]);
  // Close enough to say "You're at …" (PRD §26: only claim it when we're confident).
  const atPlace =
    userLoc?.source === "gps" &&
    fromUser !== null &&
    fromUser <= (place.footprintM ?? 20) + Math.min(60, userLoc.accuracyM ?? 30);
  const showUserOnMap = userLoc !== null && fromUser !== null && fromUser <= SHOW_USER_ON_MAP_M;
  const mapOrigin = showUserOnMap && userLoc
    ? { lat: userLoc.lat, lng: userLoc.lng, accuracyM: userLoc.accuracyM }
    : { lat: place.lat, lng: place.lng };

  const share = async () => {
    const content = shareContent(place, window.location.origin);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(content);
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return; // user closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(shareClipboardText(content));
      showToast("Link copied");
    } catch {
      showToast("Couldn't share. Copy the address bar link instead.");
    }
  };

  return (
    <main className={`container ${styles.page}`}>
      <div className={styles.topBar}>
        <BackLink />
      </div>

      <Gallery place={place} photos={place.photos ?? []} />

      <header className={styles.header}>
        <div className={styles.category}>
          <span aria-hidden>{CATEGORY_EMOJI[cat]}</span> {CATEGORY_LABEL[cat]}
          {place.categories.slice(1, 3).map((c) => (
            <span key={c} className={styles.extraCat}>
              · {CATEGORY_LABEL[c]}
            </span>
          ))}
        </div>
        <h1 className={styles.name}>
          {place.name}
          {place.sponsored && (
            <span className={`badge badge-sponsored ${styles.sponsored}`} title="Paid placement. It doesn't change rankings.">
              Sponsored
            </span>
          )}
        </h1>
        <div className={styles.facts}>
          {place.rating !== undefined && (
            <span aria-label={`Rated ${place.rating.toFixed(1)} out of 5${place.reviewCount ? ` from ${place.reviewCount.toLocaleString()} reviews` : ""}`}>
              <span className={styles.star} aria-hidden>
                ★
              </span>{" "}
              {place.rating.toFixed(1)}
              {place.reviewCount ? <span className="muted"> ({place.reviewCount.toLocaleString()})</span> : null}
            </span>
          )}
          <PriceLevel level={place.priceLevel} />
          {status ? <span className={statusTone}>{status}</span> : <span className="muted">Hours unknown</span>}
        </div>
        {fromUser !== null && walk !== null && (
          <p className={styles.distance}>
            <span aria-hidden>🚶</span> {formatDistance(fromUser)}
            {walk <= 60 && <> · {formatWalk(walk)}</>} from{" "}
            {userLoc?.source === "manual" ? (userLoc.label ? userLoc.label : "your chosen location") : "you"}
          </p>
        )}
      </header>

      <div className={styles.actions}>
        <ActionLink
          primary
          icon="➜"
          label="Directions"
          href={directionsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("directions_clicked", params)}
        />
        {place.phone && (
          <ActionLink
            icon="📞"
            label="Call"
            href={telUrl(place.phone)}
            onClick={() => track("phone_clicked", params)}
          />
        )}
        {website && (
          <ActionLink
            icon="🌐"
            label="Website"
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("website_clicked", params)}
          />
        )}
        <ActionButton
          icon={saved ? "♥" : "♡"}
          label={saved ? "Saved" : "Save"}
          aria-pressed={saved}
          onClick={onToggleSave}
        />
        <ActionButton icon="⤴" label="Share" onClick={share} />
      </div>

      <section className={`section ${styles.info}`} aria-label="Details">
        {(week || place.openingHours?.raw) && (
          <details className={styles.hours}>
            <summary>
              <span aria-hidden>🕒</span>
              <span className={statusTone}>{status ?? "Opening hours"}</span>
              <span className={styles.summaryHint}>See hours</span>
            </summary>
            {week ? (
              <table className={styles.hoursTable}>
                <tbody>
                  {week.map((d) => (
                    <tr key={d.day} className={d.isToday ? styles.today : undefined} aria-current={d.isToday ? "date" : undefined}>
                      <th scope="row">{d.label}</th>
                      <td>{d.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className={styles.rawHours}>{place.openingHours?.raw}</p>
            )}
          </details>
        )}
        {place.address && (
          <div className={styles.infoRow}>
            <span aria-hidden>📍</span>
            <span>{place.address}</span>
          </div>
        )}
        {place.phone && (
          <div className={styles.infoRow}>
            <span aria-hidden>📞</span>
            <a href={telUrl(place.phone)} onClick={() => track("phone_clicked", params)}>
              {place.phone}
            </a>
          </div>
        )}
        {website && (
          <div className={styles.infoRow}>
            <span aria-hidden>🌐</span>
            <a href={website} target="_blank" rel="noopener noreferrer" onClick={() => track("website_clicked", params)}>
              {displayHost(website)}
            </a>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="map-heading">
        <div className="section-head">
          <h2 id="map-heading">On the map</h2>
          {mapPlaces.length > 0 && <span className="muted small">With {mapPlaces.length} places nearby</span>}
        </div>
        <PlacesMap origin={mapOrigin} places={mapPlaces} current={place} height={MAP_HEIGHT} showOrigin={showUserOnMap} />
      </section>

      <section className="section" aria-labelledby="what-next-heading">
        <div className={styles.whatNextHead}>
          <span className="eyebrow">{atPlace ? `You're at ${place.name}` : `When you're at ${place.name}`}</span>
          <h2 id="what-next-heading">What next?</h2>
        </div>
        {groups.length === 0 ? (
          <p className="notice">Nothing else nearby is open right now. Try again a little later.</p>
        ) : (
          groups.map((g) => (
            <div key={g.id} className={styles.group}>
              <h3 className={styles.groupTitle}>{g.title}</h3>
              {g.sections.map((s) => (
                <div key={s.id} className={styles.subsection}>
                  <div className="section-head">
                    <h4 className={styles.subTitle}>{s.title}</h4>
                    {s.subtitle && <span className="muted small">{s.subtitle}</span>}
                  </div>
                  <div className={s.items.length > 1 ? "rail" : "stack"}>
                    {s.items.map((it) => (
                      <PlaceCard key={it.place.id} item={it} section={s.id} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <p className={`tiny muted ${styles.credits}`}>{PROVIDER_CREDIT[place.provider]}</p>

      <div className={styles.toast} role="status" aria-live="polite">
        {toast && <span>{toast}</span>}
      </div>
    </main>
  );
}
