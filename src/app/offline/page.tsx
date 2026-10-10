import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline — NookMaps",
  robots: { index: false },
};

/**
 * Served by public/sw.js when a page can't be loaded (PRD §22 PWA). Static and
 * script-free on purpose: it has to work from the cache with no network.
 */
export default function Offline() {
  return (
    <main className="container">
      <header className="app-header">
        <div className="eyebrow">NookMaps</div>
        <h1>You&apos;re offline</h1>
      </header>
      <div className="stack">
        <p className="muted">
          NookMaps needs a connection to see what&apos;s open around you right now. Places and
          locations are never kept offline, so there&apos;s nothing out of date to show you.
        </p>
        <div>
          {/* A plain link, so the browser does a full load and tries the network again. */}
          <a className="btn btn-primary" href="/">
            Try again
          </a>
        </div>
      </div>
    </main>
  );
}
