import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsToggle, ClearDataButton } from "./PrivacyControls";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy — NookMaps",
  description: "How NookMaps uses your location, what stays on your device, and how to switch it off.",
};

const STORED = [
  {
    what: "Preferences",
    where: "Kept until you clear it",
    detail: "Your search radius and whether you prefer the list or the map.",
  },
  {
    what: "Saved places",
    where: "Kept until you remove them",
    detail: "Name, category, address and position of the places you save. They live only in this browser; there is no account.",
  },
  {
    what: "Your last location",
    where: "Deleted when you close the tab",
    detail: "Kept for this tab only, so Plan, Ask and place pages can reuse it without asking again.",
  },
  {
    what: "Your analytics choice",
    where: "Kept until you change it",
    detail: "Whether you switched analytics on or off below.",
  },
  {
    what: "Session counters",
    where: "Deleted when you close the tab",
    detail: "Only while analytics are on: counts such as how many places you opened and which sections you looked at. No places, no positions.",
  },
  {
    what: "Offline copy of the app",
    where: "Updated as the app changes",
    detail: "NookMaps' own pages, styles and icons, so it opens without a connection. Never places or locations.",
  },
];

/** Privacy in plain language (PRD §21, §26). */
export default function Privacy() {
  return (
    <main className="container">
      <header className="app-header">
        <div className="eyebrow">Privacy</div>
        <h1>Your location, in plain language</h1>
        <p className={`muted ${styles.lead}`}>
          NookMaps needs to know where you are to show what&apos;s around you. Here is exactly what
          happens with that, and how to switch any of it off.
        </p>
      </header>

      <section className={`section ${styles.prose}`} aria-labelledby="why">
        <h2 id="why">Why we ask for your location</h2>
        <p>
          To find places within walking distance and to tell whether you&apos;re inside a café, a
          mall or a park, so suggestions fit where you actually are. If you&apos;d rather not share
          it, you can type a neighbourhood or address instead and everything still works.
        </p>
      </section>

      <section className={`section ${styles.prose}`} aria-labelledby="when">
        <h2 id="when">When we use it</h2>
        <ul>
          <li>
            Only after your browser asks you and you allow it. We read your position once each time
            you look for places, for example when you open the feed or tap refresh.
          </li>
          <li>
            No background or continuous tracking. When you come back to the tab, NookMaps checks
            once whether you&apos;ve moved more than about 150 m, so the list isn&apos;t stale.
          </li>
        </ul>
      </section>

      <section className={`section ${styles.prose}`} aria-labelledby="where">
        <h2 id="where">Where it goes</h2>
        <ul>
          <li>
            Your coordinates are sent over an encrypted connection to the NookMaps server, only to
            find places near you.
          </li>
          <li>
            We don&apos;t store them: there are no accounts, no location history and no database
            of where people have been. To avoid repeat lookups, nearby results are kept in server
            memory for a few minutes, filed under a rounded position (about 10 m) and not linked to
            you.
          </li>
          <li>They are never sent to analytics.</li>
        </ul>
        <h3>Who else receives them</h3>
        <ul>
          <li>
            <strong>Google Places</strong> (when this copy of NookMaps is set up with it): your
            coordinates, to find nearby places and name the area you&apos;re in.
          </li>
          <li>
            <strong>OpenStreetMap</strong> (Overpass and Nominatim, used otherwise or as a
            fallback): the same, for the same reasons.
          </li>
          <li>
            These requests come from our server, not your device, so the providers don&apos;t see
            your IP address. If you type a location instead, that text is sent the same way to look
            it up.
          </li>
          <li>
            The map view loads map images from OpenStreetMap directly in your browser, so its tile
            servers see which area is on screen. Tapping Directions opens Google Maps with the
            destination.
          </li>
        </ul>
      </section>

      <section className="section" aria-labelledby="device">
        <div className="section-head">
          <h2 id="device">What&apos;s stored on this device</h2>
        </div>
        <ul className={`card ${styles.stores}`}>
          {STORED.map((s) => (
            <li key={s.what}>
              <div className={styles.storeHead}>
                <span>{s.what}</span>
                <span className="tiny muted">{s.where}</span>
              </div>
              <div className="small muted">{s.detail}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`section ${styles.prose}`} aria-labelledby="analytics">
        <h2 id="analytics">Analytics</h2>
        <p>
          We use Google Analytics to learn which suggestions help, for example &ldquo;opened a place
          from Coffee nearby&rdquo; or &ldquo;tapped Directions&rdquo;. It only gets coarse context
          such as the category, the feed section or the time of day: never your coordinates, an
          address, which place you opened or anything you type. IP addresses are anonymised, and
          Google signals and ad personalisation are off.
        </p>
        <AnalyticsToggle />
      </section>

      <section className={`section ${styles.prose}`} aria-labelledby="clear">
        <h2 id="clear">Clear my data</h2>
        <p>
          Removes your saved places, preferences, last location and analytics data from this
          browser. If you&apos;ve switched analytics off, that choice is kept.
        </p>
        <ClearDataButton />
      </section>

      <section className={`section ${styles.prose}`} aria-labelledby="revoke">
        <h2 id="revoke">Turn off location access</h2>
        <p>Your browser holds the permission, so you can take it back at any time:</p>
        <ul>
          <li>
            <strong>Chrome</strong> (Android and desktop): tap the icon to the left of the address,
            then Permissions or Site settings, and turn Location off or reset it.
          </li>
          <li>
            <strong>Safari on iPhone and iPad</strong>: tap the page menu in the address bar, then
            Website Settings, then Location: Deny. For every site: Settings, Privacy &amp; Security,
            Location Services, Safari Websites: Never.
          </li>
          <li>
            <strong>Safari on Mac</strong>: Safari menu, Settings for This Website, Location: Deny.
          </li>
          <li>
            <strong>Firefox</strong>: click the permissions icon in the address bar and clear
            &ldquo;Access your location&rdquo;.
          </li>
          <li>
            <strong>Installed app</strong>: change it in the site settings of the browser you
            installed NookMaps from.
          </li>
        </ul>
        <p>
          Without it, NookMaps still works: type a neighbourhood or address instead.{" "}
          <Link href="/">Back to NookMaps</Link>
        </p>
      </section>
    </main>
  );
}
