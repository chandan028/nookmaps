"use client";

import Link from "next/link";
import { Fragment } from "react";
import { PriceLevel } from "@/components/PlaceCard";
import { track } from "@/lib/analytics";
import { CATEGORY_EMOJI, CATEGORY_LABEL } from "@/lib/categories";
import { formatDistance, formatWalk } from "@/lib/geo";
import { directionsUrl, placeHref } from "@/lib/links";
import { formatDuration, type Plan, type PlanStop } from "@/lib/planner";
import { formatClock } from "@/lib/time";
import styles from "./PlanTimeline.module.css";

function thumbSrc(url: string): string {
  return url.includes("?") ? `${url}&w=160` : url;
}

function StopCard({ stop }: { stop: PlanStop }) {
  const { place } = stop;
  const photo = place.photos?.[0]?.url;
  const opened = () => track("place_opened", { section: "plan", category: stop.category, provider: place.provider });
  return (
    <article className={`card ${styles.card}`}>
      <div className={styles.cardHead}>
        <span className={styles.slot}>{stop.label}</span>
        <span className={styles.stay}>
          ~{formatDuration(stop.stayMinutes)} · until {formatClock(stop.depart.minute)}
        </span>
      </div>
      <Link href={placeHref(place.id)} className={styles.place} onClick={opened}>
        <span className={styles.thumb} aria-hidden>
          {photo ? <img src={thumbSrc(photo)} alt="" loading="lazy" /> : CATEGORY_EMOJI[stop.category]}
        </span>
        <span className={styles.body}>
          <span className={styles.name}>{place.name}</span>
          <span className="meta">
            <span>{CATEGORY_LABEL[stop.category]}</span>
            {place.rating !== undefined && (
              <span>
                ★ {place.rating.toFixed(1)}
                {place.reviewCount ? ` (${place.reviewCount.toLocaleString()})` : ""}
              </span>
            )}
            <PriceLevel level={place.priceLevel} />
          </span>
        </span>
      </Link>
      <p className={styles.why}>{stop.why}</p>
      {stop.hoursUnknown && (
        <p className={styles.warn}>We couldn&apos;t check its opening hours. Confirm it&apos;s open before you go.</p>
      )}
      <div className={styles.actions}>
        <a
          className="btn btn-sm"
          href={directionsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("directions_clicked", { section: "plan", category: stop.category, provider: place.provider })}
        >
          Directions
        </a>
        <Link className="btn btn-sm btn-ghost" href={placeHref(place.id)} onClick={opened}>
          Details
        </Link>
      </div>
    </article>
  );
}

/** Vertical itinerary: time · stop card, with walking connectors in between (PRD §19). */
export function PlanTimeline({ plan, startLabel }: { plan: Plan; startLabel: string }) {
  return (
    <ol className={styles.timeline}>
      <li className={`${styles.row} ${styles.endpoint}`}>
        <span className={styles.time}>{formatClock(plan.start.minute)}</span>
        <span className={styles.rail} aria-hidden>
          <span className={styles.node} />
        </span>
        <span className={styles.endpointLabel}>{startLabel}</span>
      </li>
      {plan.stops.map((stop, i) => (
        <Fragment key={stop.place.id}>
          <li className={`${styles.row} ${styles.leg}`}>
            <span className={styles.time} />
            <span className={styles.rail} aria-hidden />
            <span className={styles.legLabel}>
              <span aria-hidden>🚶 </span>
              {formatWalk(stop.walkMinutes)}
              <span className={styles.legDistance}> · {formatDistance(stop.walkDistanceM)}</span>
            </span>
          </li>
          <li className={`${styles.row} ${styles.stop}`} aria-label={`Stop ${i + 1}: ${stop.label}, ${stop.place.name}`}>
            <span className={styles.time}>{formatClock(stop.arrive.minute)}</span>
            <span className={styles.rail} aria-hidden>
              <span className={styles.marker}>{i + 1}</span>
            </span>
            <StopCard stop={stop} />
          </li>
        </Fragment>
      ))}
      <li className={`${styles.row} ${styles.endpoint} ${styles.finish}`}>
        <span className={styles.time}>{formatClock(plan.endsAtMinute)}</span>
        <span className={styles.rail} aria-hidden>
          <span className={styles.node} />
        </span>
        <span className={styles.endpointLabel}>Done · {formatDuration(plan.totalMinutes)} in total</span>
      </li>
    </ol>
  );
}
