# NookMaps

> Open the app and discover what you can do right now, exactly where you are.

NookMaps turns your **exact location → current context → useful possibilities**. No search box
needed: it works out whether you're in a café, a mall, a park or just on a street, and shows what
you can eat, drink, do and see from there, ranked for the time of day.

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript**, a responsive web app / PWA
- **Next.js route handlers** as the backend / API proxy (keeps provider keys server-side)
- **Google Places API (New)** as the primary places provider, **OpenStreetMap** (Overpass +
  Nominatim) as the automatic fallback, and an offline **demo** provider for development
- **Leaflet + OpenStreetMap tiles** for the map view
- **GA4** for privacy-preserving analytics (coarse context only, never coordinates)
- **Vitest** for unit tests, GitHub Actions CI

## Getting started

```bash
npm install
cp .env.example .env.local   # add GOOGLE_MAPS_API_KEY, or leave empty to use OpenStreetMap
npm run dev
```

Try it without any keys or network: `NOOKMAPS_PROVIDER=demo npm run dev`. The demo provider lays a
clearly-labelled fictional neighbourhood around wherever you are.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Places API (New) + Geocoding. Optional; falls back to OSM. |
| `NOOKMAPS_PROVIDER` | Force `google`, `osm` or `demo`. |
| `NOOKMAPS_RANKING_WEIGHTS` | JSON weight overrides, e.g. `{"distance":0.35}`. |
| `OVERPASS_URL`, `NOMINATIM_URL`, `OSM_CONTACT` | OSM endpoints and contact for the User-Agent. |
| `NEXT_PUBLIC_GA_ID` | GA4 measurement id; analytics are off when empty. |

## Architecture

```
Browser Geolocation API
  → lat / lng / accuracy
  → /api/discover (Next.js route handler)
  → places provider chain (Google → OSM, or demo)    src/lib/providers/
  → normalized Place model                           src/lib/types.ts
  → context detection                                src/lib/context.ts
  → deterministic ranking                            src/lib/ranking.ts
  → feed sections, chips, walk buckets               src/lib/feed.ts
  → web / PWA UI                                     src/app/
```

### Ranking (PRD §13)

`score = distance + context + open-now + rating/popularity + time-of-day`, each component
normalised to 0–1 and weighted (defaults 0.3 / 0.2 / 0.2 / 0.2 / 0.1). Weights are configurable via
`NOOKMAPS_RANKING_WEIGHTS`. Sponsored placements, if ever introduced, are labelled and never change
the score.

### Context detection (PRD §5, §6, §15, §26)

A venue is a candidate when you're within its footprint plus your GPS error. Confidence drops with
distance, poor accuracy (>120 m disables venue detection entirely) and rival venues equally close.
Below 0.55 confidence NookMaps says "You're around Indiranagar", never "You're at …".

## Scripts

`npm run dev` · `npm run build` · `npm run typecheck` · `npm test`
