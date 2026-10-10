"use client";

import { useEffect, useState } from "react";
import {
  analyticsChoice,
  analyticsEnabled,
  browserRequestsNoTracking,
  onConsentChange,
  setAnalyticsOptOut,
  type AnalyticsChoice,
} from "@/lib/analytics";
import { clearNookmapsData } from "@/lib/client/privacy";
import styles from "./privacy.module.css";

const GA_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GA_ID);

interface ConsentState {
  enabled: boolean;
  choice: AnalyticsChoice;
  browserSignal: boolean;
}

/** The analytics opt-out switch, wired to `nookmaps:analytics-optout`. */
export function AnalyticsToggle() {
  const [state, setState] = useState<ConsentState | null>(null);

  useEffect(() => {
    const read = () =>
      setState({
        enabled: analyticsEnabled(),
        choice: analyticsChoice(),
        browserSignal: browserRequestsNoTracking(),
      });
    read();
    return onConsentChange(read);
  }, []);

  return (
    <div className="stack">
      <label className={`card ${styles.switchRow}`}>
        <span className={styles.switchText}>
          <span className={styles.switchLabel}>Share anonymous usage analytics</span>
          <span className="small muted">
            {state === null ? "Checking…" : state.enabled ? "On: helps us see which suggestions are useful" : "Off: nothing is sent"}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className={styles.switch}
          checked={state?.enabled ?? false}
          disabled={state === null}
          onChange={(e) => setAnalyticsOptOut(!e.target.checked)}
        />
      </label>
      {state?.browserSignal && state.choice === "default" && (
        <p className="small muted">
          Your browser sends a Do Not Track or Global Privacy Control signal, so analytics stay off
          unless you switch them on here.
        </p>
      )}
      {!GA_CONFIGURED && (
        <p className="small muted">
          Analytics aren&apos;t set up on this copy of NookMaps, so nothing is sent either way.
        </p>
      )}
    </div>
  );
}

/** "Clear my data": removes every NookMaps key from this browser, after a confirmation step. */
export function ClearDataButton() {
  const [step, setStep] = useState<"idle" | "confirm" | "done">("idle");

  return (
    <div className="stack">
      {step === "confirm" ? (
        <div className={`card ${styles.confirm}`} role="group" aria-labelledby="clear-confirm">
          <p id="clear-confirm" className={styles.confirmText}>
            This removes your saved places, preferences and last location from this device. It
            can&apos;t be undone.
          </p>
          <div className="row wrap">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                clearNookmapsData();
                setStep("done");
              }}
            >
              Yes, clear my data
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setStep("confirm")}>
            Clear my data
          </button>
        </div>
      )}
      <p className="small muted" role="status" aria-live="polite">
        {step === "done" ? "Done. NookMaps data has been removed from this device." : ""}
      </p>
    </div>
  );
}
