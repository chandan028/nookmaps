"use client";

import Link from "next/link";
import { CATEGORY_EMOJI, CATEGORY_LABEL, primaryCategory } from "@/lib/categories";
import { formatDistance, formatWalk } from "@/lib/geo";
import { placeHref } from "@/lib/links";
import { track } from "@/lib/analytics";
import type { ScoredPlace } from "@/lib/types";

export function OpenBadge({ open }: { open: boolean | null }) {
  if (open === null) return <span className="muted">Hours unknown</span>;
  return open ? <span className="open">Open now</span> : <span className="closed">Closed</span>;
}

export function PriceLevel({ level }: { level?: number }) {
  if (level === undefined) return null;
  if (level === 0) return <span>Free</span>;
  return <span aria-label={`Price level ${level} of 4`}>{"₹".repeat(level)}</span>;
}

/** The one card used everywhere a place appears in a list. */
export function PlaceCard({ item, section }: { item: ScoredPlace; section?: string }) {
  const { place } = item;
  const cat = primaryCategory(place);
  const photo = place.photos?.[0]?.url;
  return (
    <Link
      href={placeHref(place.id)}
      className="card place-card"
      onClick={() => track("place_opened", { section, category: cat, provider: place.provider })}
    >
      <div className="thumb" aria-hidden>
        {photo ? <img src={`${photo}&w=160`} alt="" loading="lazy" /> : CATEGORY_EMOJI[cat]}
      </div>
      <div className="body">
        <div className="name">{place.name}</div>
        <div className="meta">
          <span>{CATEGORY_LABEL[cat]}</span>
          {place.rating !== undefined && (
            <span>
              ★ {place.rating.toFixed(1)}
              {place.reviewCount ? ` (${place.reviewCount.toLocaleString()})` : ""}
            </span>
          )}
          <PriceLevel level={place.priceLevel} />
        </div>
        <div className="meta">
          <span>{formatWalk(item.walkMinutes)}</span>
          <span>{formatDistance(item.distanceM)}</span>
          <OpenBadge open={item.openNow} />
          {place.sponsored && <span className="badge badge-sponsored">Sponsored</span>}
        </div>
      </div>
    </Link>
  );
}
