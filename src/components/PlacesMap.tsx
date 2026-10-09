"use client";

import "leaflet/dist/leaflet.css";
import { Control, DomEvent, DomUtil, divIcon, latLngBounds, type DivIcon, type Map as LeafletMap } from "leaflet";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { OpenBadge } from "@/components/PlaceCard";
import { track } from "@/lib/analytics";
import { CATEGORY_EMOJI, CATEGORY_LABEL, primaryCategory } from "@/lib/categories";
import { formatWalk } from "@/lib/geo";
import { directionsUrl, placeHref } from "@/lib/links";
import { boundsOf, isPointLike, showAccuracyCircle, viewKey, type Bounds } from "@/lib/mapView";
import type { Category, LatLng, Place, ScoredPlace } from "@/lib/types";
import styles from "./map.module.css";

export interface PlacesMapProps {
  origin: LatLng & { accuracyM?: number };
  places: ScoredPlace[];
  /** The venue the user is at, highlighted when present. */
  current?: Place;
  /** Called when a marker is tapped; defaults to opening the place detail page. */
  onSelect?: (place: Place) => void;
  height?: number | string;
  /** Draw the "you are here" dot and accuracy circle at `origin` (default true). */
  showOrigin?: boolean;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const SINGLE_POINT_ZOOM = 16;
const MAX_FIT_ZOOM = 17;
const FIT_PADDING: [number, number] = [36, 36];
/** Keep popups clear of the control column on the left and the attribution at the bottom. */
const POPUP_PAD_TL: [number, number] = [60, 12];
const POPUP_PAD_BR: [number, number] = [12, 28];

type MarkerState = "open" | "closed" | "current";

/** Emoji pins as DOM markers: no image assets, so no broken default-icon paths in bundlers. */
const iconCache = new Map<string, DivIcon>();
function iconFor(category: Category, state: MarkerState): DivIcon {
  const key = `${category}|${state}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const size = state === "current" ? 44 : 34;
    const cls = [styles.pin, state === "current" ? styles.pinCurrent : "", state === "closed" ? styles.pinClosed : ""]
      .filter(Boolean)
      .join(" ");
    icon = divIcon({
      className: cls,
      // Only our own emoji constants go into the HTML; place names are set via `title`.
      html: `<span aria-hidden="true">${CATEGORY_EMOJI[category]}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
      tooltipAnchor: [0, -size / 2],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function fit(map: LeafletMap, b: Bounds | null, animate: boolean) {
  if (!b) return;
  if (isPointLike(b)) {
    map.setView([b.south, b.west], Math.max(map.getZoom() || 0, SINGLE_POINT_ZOOM), { animate });
    return;
  }
  map.fitBounds(
    latLngBounds([b.south, b.west], [b.north, b.east]),
    { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM, animate },
  );
}

/**
 * Keeps the view sensible: refits when the set of places changes, recovers
 * when the map was created inside a hidden container (list/map toggle), and
 * only lets the scroll wheel zoom once the user has engaged with the map so
 * the page still scrolls past it.
 */
function ViewController({ bounds, fitKey }: { bounds: Bounds | null; fitKey: string }) {
  const map = useMap();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const lastKey = useRef(fitKey);

  useEffect(() => {
    if (lastKey.current === fitKey) return;
    lastKey.current = fitKey;
    fit(map, boundsRef.current, true);
  }, [map, fitKey]);

  useEffect(() => {
    const el = map.getContainer();
    let wasEmpty = el.clientWidth === 0 || el.clientHeight === 0;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const empty = el.clientWidth === 0 || el.clientHeight === 0;
        if (empty) {
          wasEmpty = true;
          return;
        }
        map.invalidateSize();
        if (wasEmpty) fit(map, boundsRef.current, false);
        wasEmpty = false;
      });
    });
    ro.observe(el);

    const enableWheel = () => map.scrollWheelZoom.enable();
    const disableWheel = () => map.scrollWheelZoom.disable();
    map.on("focus click", enableWheel);
    map.on("blur", disableWheel);
    el.addEventListener("mouseleave", disableWheel);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      map.off("focus click", enableWheel);
      map.off("blur", disableWheel);
      el.removeEventListener("mouseleave", disableWheel);
    };
  }, [map]);

  return null;
}

/** "Show all" button stacked under the zoom buttons as a native Leaflet control. */
function RecenterControl({ bounds }: { bounds: Bounds | null }) {
  const map = useMap();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    const control = new Control({ position: "topleft" });
    control.onAdd = () => {
      const bar = DomUtil.create("div", "leaflet-bar leaflet-control");
      const btn = DomUtil.create("a", styles.recenter, bar);
      btn.href = "#";
      btn.setAttribute("role", "button");
      btn.setAttribute("aria-label", "Show all places");
      btn.title = "Show all places";
      btn.innerHTML = '<span aria-hidden="true">⤢</span>';
      DomEvent.disableClickPropagation(bar);
      DomEvent.on(btn, "click", (e) => {
        DomEvent.preventDefault(e);
        fit(map, boundsRef.current, true);
      });
      return bar;
    };
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);

  return null;
}

function PlacePopup({ place, item, isCurrentPage }: { place: Place; item?: ScoredPlace; isCurrentPage: boolean }) {
  const cat = primaryCategory(place);
  const params = { section: "map", category: cat, provider: place.provider };
  return (
    <div className={styles.popup}>
      <div className={styles.popupName}>{place.name}</div>
      <div className={styles.popupMeta}>
        <span>
          {CATEGORY_EMOJI[cat]} {CATEGORY_LABEL[cat]}
        </span>
        {item && <span>{formatWalk(item.walkMinutes)}</span>}
        {item && <OpenBadge open={item.openNow} />}
        {place.sponsored && <span className="badge badge-sponsored">Sponsored</span>}
      </div>
      <div className={styles.popupActions}>
        {!isCurrentPage && (
          <Link
            href={placeHref(place.id)}
            className={`${styles.popupBtn} ${styles.popupBtnPrimary}`}
            onClick={() => track("place_opened", params)}
          >
            Details
          </Link>
        )}
        <a
          href={directionsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.popupBtn}
          onClick={() => track("directions_clicked", params)}
        >
          Directions
        </a>
      </div>
    </div>
  );
}

/**
 * Map view (PRD §16) on OpenStreetMap tiles via Leaflet. Client-only: import
 * with next/dynamic({ ssr: false }). Tapping a marker calls `onSelect`, or by
 * default opens a popup with the place and a link to its detail page.
 */
export default function PlacesMap({ origin, places, current, onSelect, height = 420, showOrigin = true }: PlacesMapProps) {
  const pathname = usePathname();

  const markers = useMemo(
    () => places.filter((s) => s.place.id !== current?.id && Number.isFinite(s.place.lat) && Number.isFinite(s.place.lng)),
    [places, current?.id],
  );

  const points = useMemo(() => {
    const pts: LatLng[] = [];
    if (showOrigin) pts.push({ lat: origin.lat, lng: origin.lng });
    if (current) pts.push({ lat: current.lat, lng: current.lng });
    for (const s of markers) pts.push({ lat: s.place.lat, lng: s.place.lng });
    return pts;
  }, [showOrigin, origin.lat, origin.lng, current, markers]);

  const bounds = useMemo(() => boundsOf(points), [points]);
  const fitKey = useMemo(() => viewKey(points), [points]);

  // MapContainer props are only read on creation; later changes go through ViewController.
  const [initial] = useState(() => {
    if (bounds && !isPointLike(bounds)) {
      return { bounds: latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]) };
    }
    const c = bounds ? { lat: bounds.south, lng: bounds.west } : origin;
    return { center: [c.lat, c.lng] as [number, number], zoom: SINGLE_POINT_ZOOM };
  });

  const label = `Map of ${markers.length + (current ? 1 : 0)} place${markers.length + (current ? 1 : 0) === 1 ? "" : "s"}`;

  return (
    <div className={styles.wrap} style={{ height }} role="region" aria-label={label}>
      <MapContainer
        {...initial}
        boundsOptions={{ padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM }}
        className={styles.map}
        scrollWheelZoom={false}
        zoomControl
        attributionControl
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
        <ViewController bounds={bounds} fitKey={fitKey} />
        <RecenterControl bounds={bounds} />

        {showOrigin && showAccuracyCircle(origin.accuracyM) && (
          <Circle
            center={[origin.lat, origin.lng]}
            radius={origin.accuracyM}
            pathOptions={{ className: styles.accuracy, interactive: false }}
          />
        )}
        {showOrigin && (
          <CircleMarker
            center={[origin.lat, origin.lng]}
            radius={8}
            pathOptions={{ className: styles.originDot }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              You are here
            </Tooltip>
          </CircleMarker>
        )}

        {markers.map((item) => {
          const { place } = item;
          return (
            <Marker
              key={place.id}
              position={[place.lat, place.lng]}
              icon={iconFor(primaryCategory(place), item.openNow === false ? "closed" : "open")}
              title={place.name}
              alt={place.name}
              keyboard
              riseOnHover
              eventHandlers={onSelect ? { click: () => onSelect(place) } : undefined}
            >
              {!onSelect && (
                <Popup minWidth={200} maxWidth={260} autoPanPaddingTopLeft={POPUP_PAD_TL} autoPanPaddingBottomRight={POPUP_PAD_BR}>
                  <PlacePopup place={place} item={item} isCurrentPage={pathname === placeHref(place.id)} />
                </Popup>
              )}
            </Marker>
          );
        })}

        {current && (
          <Marker
            key={`current:${current.id}`}
            position={[current.lat, current.lng]}
            icon={iconFor(primaryCategory(current), "current")}
            title={current.name}
            alt={current.name}
            keyboard
            zIndexOffset={1000}
            eventHandlers={onSelect ? { click: () => onSelect(current) } : undefined}
          >
            <Tooltip permanent direction="top" className={styles.currentLabel}>
              {current.name}
            </Tooltip>
            {!onSelect && (
              <Popup minWidth={200} maxWidth={260} autoPanPaddingTopLeft={POPUP_PAD_TL} autoPanPaddingBottomRight={POPUP_PAD_BR}>
                <PlacePopup place={current} isCurrentPage={pathname === placeHref(current.id)} />
              </Popup>
            )}
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
