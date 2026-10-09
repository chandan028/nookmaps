"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { analyticsEnabled, onConsentChange, onTrackWithConsent, redactPath } from "@/lib/analytics";
import { deleteAnalyticsCookies } from "@/lib/client/privacy";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag } & Record<string, unknown>;

function gaWindow(): GaWindow {
  return window as unknown as GaWindow;
}

/** Page fields for GA: the redacted route, never ids or query strings. */
function pageFields(pathname: string) {
  const path = redactPath(pathname);
  return { page_location: `${location.origin}${path}`, page_path: path, page_title: path };
}

/**
 * GA4 bridge (PRD §22, §23). Renders nothing unless NEXT_PUBLIC_GA_ID is set
 * and the user allows analytics (opt-out flag, Do Not Track, Global Privacy
 * Control). Events come from `track()` already sanitised; page views carry a
 * redacted path only.
 *
 * GA property setup: turn off Enhanced measurement in the web data stream
 * (page changes based on browser history, outbound clicks, site search, form
 * interactions). Page views are sent manually here with redacted paths, and
 * outbound "Directions" links contain the destination's coordinates.
 */
export function Analytics() {
  // null until the stored choice has been read on the client.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!GA_ID) return;
    const update = () => setEnabled(analyticsEnabled());
    update();
    return onConsentChange(update);
  }, []);

  useEffect(() => {
    if (!GA_ID || enabled === null) return;
    const w = gaWindow();
    // GA's own kill switch: stops gtag.js sending anything, even if already loaded.
    w[`ga-disable-${GA_ID}`] = !enabled;
    if (!enabled) {
      deleteAnalyticsCookies();
      return;
    }
    if (!w.gtag) {
      w.dataLayer = w.dataLayer ?? [];
      w.gtag = function gtag() {
        // gtag.js expects the Arguments object itself, not an array.
        w.dataLayer!.push(arguments);
      };
      w.gtag("js", new Date());
      w.gtag("config", GA_ID, {
        anonymize_ip: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        send_page_view: false,
        ...pageFields(location.pathname),
      });
    }
    return onTrackWithConsent((event, params) => w.gtag?.("event", event, params));
  }, [enabled]);

  useEffect(() => {
    if (!GA_ID || !enabled) return;
    const w = gaWindow();
    const fields = pageFields(pathname);
    // `set` makes every later event report the redacted page, not the real URL.
    w.gtag?.("set", fields);
    w.gtag?.("event", "page_view", fields);
  }, [enabled, pathname]);

  if (!GA_ID || !enabled) return null;
  return (
    <Script
      id="ga4"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`}
      strategy="afterInteractive"
    />
  );
}
