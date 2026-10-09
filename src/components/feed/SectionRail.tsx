"use client";

import { useEffect, useId, useRef } from "react";
import { PlaceCard } from "@/components/PlaceCard";
import { track } from "@/lib/analytics";
import type { FeedSection } from "@/lib/types";
import styles from "./feed.module.css";

/** Report a section once when at least half of it has been on screen (PRD §23). */
function useSectionViewed(id: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          track("section_viewed", { section: id });
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id]);
  return ref;
}

/** A feed section as a horizontal, swipeable rail of place cards. */
export function SectionRail({
  section,
  level = 2,
  showSubtitle = true,
  className,
}: {
  section: FeedSection;
  level?: 2 | 3;
  showSubtitle?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const ref = useSectionViewed(section.id);
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section ref={ref} className={className ?? "section"} aria-labelledby={headingId}>
      <div className="section-head">
        <Heading id={headingId}>{section.title}</Heading>
        {showSubtitle && section.subtitle && <span className="muted small">{section.subtitle}</span>}
      </div>
      <ul className={`rail ${styles.railList}`}>
        {section.items.map((item) => (
          <li key={item.place.id} className={styles.railItem}>
            <PlaceCard item={item} section={section.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The context pivot (PRD §6, §15): when we know which venue you're at, the
 * "While you're here" and "After this" sections lead the feed in their own
 * highlighted block.
 */
export function ContextBlock({
  whileHere,
  afterThis,
}: {
  whileHere: FeedSection[];
  afterThis: FeedSection[];
}) {
  if (whileHere.length === 0 && afterThis.length === 0) return null;
  const groups: { label: string; sections: FeedSection[] }[] = [
    { label: "While you're here", sections: whileHere },
    { label: "After this", sections: afterThis },
  ];
  return (
    <div className={styles.context}>
      {groups
        .filter((g) => g.sections.length > 0)
        .map((g) => (
          <div key={g.label} className={styles.contextGroup}>
            <h2 className={styles.contextLabel}>{g.label}</h2>
            {g.sections.map((s) => (
              <SectionRail key={s.id} section={s} level={3} showSubtitle={false} className={styles.contextSection} />
            ))}
          </div>
        ))}
    </div>
  );
}
