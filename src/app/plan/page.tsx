"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PlanTimeline } from "@/components/plan/PlanTimeline";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/client/api";
import type { StoredLocation } from "@/lib/client/storage";
import { useLocation } from "@/lib/client/useLocation";
import { directionsUrl } from "@/lib/links";
import { formatDuration, PLAN_OPTIONS, type PlanMinutes, type PlanResponse } from "@/lib/planner";
import { formatClock } from "@/lib/time";
import styles from "./plan.module.css";

function requestPlan(loc: StoredLocation, minutes: PlanMinutes, seed: number): Promise<PlanResponse> {
  return postJson<PlanResponse>("/api/plan", {
    lat: loc.lat,
    lng: loc.lng,
    acc: Math.round(loc.accuracyM ?? (loc.source === "manual" ? 500 : 30)),
    minutes,
    seed,
  });
}

/** "I have N minutes": a walkable, open-when-you-get-there sequence of nearby places (PRD §19). */
export default function PlanPage() {
  const { location, status, error, request } = useLocation();
  const [minutes, setMinutes] = useState<PlanMinutes | null>(null);
  const [seed, setSeed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sameAsBefore, setSameAsBefore] = useState(false);
  const latest = useRef(0);
  const lastIds = useRef("");

  useEffect(() => {
    if (!location || minutes === null) return;
    const id = ++latest.current;
    setLoading(true);
    setLoadError(null);
    requestPlan(location, minutes, seed).then(
      (res) => {
        if (id !== latest.current) return;
        const ids = res.plan.stops.map((s) => s.place.id).join("|");
        setSameAsBefore(seed > 0 && ids === lastIds.current);
        lastIds.current = ids;
        setData(res);
        setLoading(false);
        track("plan_generated", { minutes, stops: res.plan.stops.length });
      },
      (e: Error) => {
        if (id !== latest.current) return;
        setData(null);
        setLoadError(e.message);
        setLoading(false);
      },
    );
  }, [location, minutes, seed, attempt]);

  const choose = (m: PlanMinutes) => {
    if (m === minutes) return;
    setMinutes(m);
    setSeed(0);
  };

  const plan = data?.plan;
  const first = plan?.stops[0];
  const startLabel = data?.startingFrom
    ? `From ${data.startingFrom}`
    : location?.source === "manual"
      ? `From ${location.label ?? "the location you set"}`
      : "From where you are";

  return (
    <main className="container">
      <header className="app-header">
        <div className="eyebrow">Plan my time</div>
        <h1>How much time do you have?</h1>
        <p className="muted small">
          Real places nearby, in an order that works: open when you get there, all on foot.
        </p>
      </header>

      {!location && (
        <div className={`card ${styles.locate}`}>
          <p>
            Plans start from where you are. Share your location once (we don&apos;t track you), or set a
            location on the home screen.
          </p>
          <div className={styles.locateActions}>
            <button className="btn btn-primary" onClick={() => request()} disabled={status === "requesting"}>
              {status === "requesting" ? "Finding you…" : "Use my location"}
            </button>
            <Link className="btn" href="/">
              Set a location manually
            </Link>
          </div>
          {error && <p className="notice">{error}</p>}
        </div>
      )}

      {location && (
        <>
          <div className={`chips ${styles.chips}`} role="group" aria-label="Time available">
            {PLAN_OPTIONS.map((o) => (
              <button
                key={o.minutes}
                type="button"
                className="chip"
                aria-pressed={minutes === o.minutes}
                onClick={() => choose(o.minutes)}
              >
                {o.label}
              </button>
            ))}
          </div>

          {minutes === null && (
            <p className={`muted ${styles.hint}`}>
              Pick a time and we&apos;ll line up coffee, things to do and food nearby, using real opening
              hours and walking times.
            </p>
          )}

          <div className="sr-only" aria-live="polite">
            {loading ? "Planning…" : plan ? (plan.summary ? `Plan ready: ${plan.summary}` : "No plan found") : ""}
          </div>

          {loading && !plan && (
            <div className={styles.loading} aria-hidden>
              <div className={`skeleton ${styles.skeletonSummary}`} />
              <div className={`skeleton ${styles.skeletonStop}`} />
              <div className={`skeleton ${styles.skeletonStop}`} />
            </div>
          )}

          {loadError && !loading && (
            <div className={`notice ${styles.error}`}>
              <span>{loadError}</span>
              <button type="button" className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}

          {plan && plan.stops.length === 0 && (
            <div className={`card ${styles.empty}`} aria-busy={loading}>
              <div className={styles.emptyIcon} aria-hidden>
                🕰️
              </div>
              <p>Not enough open places nearby for this time; try a longer window or later.</p>
            </div>
          )}

          {plan && first && (
            <section className={`${styles.result} ${loading ? styles.stale : ""}`} aria-busy={loading}>
              <div className={`card ${styles.summary}`}>
                <div className={styles.summaryText}>
                  <div className={styles.total}>{formatDuration(plan.totalMinutes)}</div>
                  <div className="muted small">
                    {plan.stops.length} {plan.stops.length === 1 ? "stop" : "stops"} ·{" "}
                    {formatClock(plan.start.minute)} – {formatClock(plan.endsAtMinute)}
                  </div>
                </div>
                <div className={styles.summaryActions}>
                  <a
                    className="btn btn-primary"
                    href={directionsUrl(first.place)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Start: walking directions to ${first.place.name}`}
                    onClick={() =>
                      track("directions_clicked", {
                        section: "plan-start",
                        category: first.category,
                        provider: first.place.provider,
                      })
                    }
                  >
                    Start
                  </a>
                  <button type="button" className="btn" onClick={() => setSeed((s) => s + 1)} disabled={loading}>
                    {loading ? "Shuffling…" : "Shuffle"}
                  </button>
                </div>
              </div>
              {sameAsBefore && !loading && (
                <p className={`muted small ${styles.note}`}>This is the only plan that fits right now.</p>
              )}
              {plan.skipped.length > 0 && (
                <p className={`muted small ${styles.note}`}>
                  Nothing open nearby in time for: {plan.skipped.join(", ").toLowerCase()}.
                </p>
              )}
              <PlanTimeline plan={plan} startLabel={startLabel} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
