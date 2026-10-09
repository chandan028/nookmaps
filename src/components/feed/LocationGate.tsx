"use client";

import Link from "next/link";
import { useState } from "react";
import type { LocationStatus } from "@/lib/client/useLocation";
import { ManualLocationSearch, type ManualPick } from "./ManualLocationSearch";
import styles from "./feed.module.css";

/**
 * Everything shown before we have a location (PRD §4, §21): the permission
 * explainer, the "finding you" state, and the denied / unavailable /
 * unsupported states, each with a manual location fallback.
 */
export function LocationGate({
  status,
  onRequest,
  onPick,
}: {
  status: LocationStatus;
  onRequest: () => void;
  onPick: (pick: ManualPick) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);

  if (status === "requesting") {
    return (
      <section className={styles.gate} aria-busy="true">
        <div className={styles.gateIcon} aria-hidden>
          <span className={styles.spinner} />
        </div>
        <h1 className={styles.gateTitle}>Finding you…</h1>
        <p className={styles.gateLead}>
          Your browser may ask to share your location. Choose <strong>Allow</strong> to see what&apos;s
          around you right now.
        </p>
        {manualOpen ? (
          <ManualLocationSearch onPick={onPick} autoFocus title="Where are you?" />
        ) : (
          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost" onClick={() => setManualOpen(true)}>
              Enter a location instead
            </button>
          </div>
        )}
      </section>
    );
  }

  if (status === "denied" || status === "unavailable" || status === "unsupported") {
    const copy = {
      denied: {
        icon: "🔒",
        title: "Location is off for NookMaps",
        lead: "No problem. Tell us where you are and we'll show what's nearby. To use your exact position instead, allow location for this site in your browser settings, then try again.",
      },
      unavailable: {
        icon: "📡",
        title: "We couldn't find your position",
        lead: "Your device didn't return a location. Moving near a window or turning on Wi-Fi can help, or enter a location below.",
      },
      unsupported: {
        icon: "🧭",
        title: "This browser can't share your location",
        lead: "Enter where you are and we'll show what you can do nearby.",
      },
    }[status];
    return (
      <section className={styles.gate}>
        <div className={styles.gateIcon} aria-hidden>
          {copy.icon}
        </div>
        <h1 className={styles.gateTitle}>{copy.title}</h1>
        <p className={styles.gateLead}>{copy.lead}</p>
        <ManualLocationSearch onPick={onPick} title="Where are you?" />
        {status !== "unsupported" && (
          <div className={styles.actions}>
            <button type="button" className="btn" onClick={onRequest}>
              <span aria-hidden>◎</span> Try my location again
            </button>
          </div>
        )}
        <Link href="/privacy" className={styles.privacyLink}>
          How NookMaps uses location
        </Link>
      </section>
    );
  }

  // idle: explain why before the browser prompt appears.
  return (
    <section className={styles.gate}>
      <div className={styles.gateIcon} aria-hidden>
        📍
      </div>
      <div className="eyebrow">NookMaps</div>
      <h1 className={styles.gateTitle}>What can you do right here?</h1>
      <p className={styles.gateLead}>
        Share your location once and NookMaps shows what you can eat, drink, do and see within a short
        walk. It can even tell when you&apos;re at a café, a mall or a park, and suggest what fits.
      </p>
      <ul className={styles.points}>
        <li>
          <span className={styles.pointIcon} aria-hidden>
            ◎
          </span>
          <span>Checked only when you open the app or tap refresh. No background tracking.</span>
        </li>
        <li>
          <span className={styles.pointIcon} aria-hidden>
            🔐
          </span>
          <span>
            Your position is used to find places near you. We don&apos;t keep a location history, and
            analytics never see it.
          </span>
        </li>
        <li>
          <span className={styles.pointIcon} aria-hidden>
            ⌨️
          </span>
          <span>Prefer not to? Type a location instead.</span>
        </li>
      </ul>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={onRequest}>
          <span aria-hidden>◎</span> Use my location
        </button>
        {!manualOpen && (
          <button type="button" className="btn" onClick={() => setManualOpen(true)}>
            Enter a location instead
          </button>
        )}
      </div>
      {manualOpen && <ManualLocationSearch onPick={onPick} autoFocus title="Where are you?" />}
      <Link href="/privacy" className={styles.privacyLink}>
        How NookMaps uses location
      </Link>
    </section>
  );
}
