# NookMaps — notes for contributors (human or agent)

Product spec: the "Exact-Location Discovery App" PRD. Section numbers (PRD §N) are cited in code comments.

## Conventions

- Next.js 15 App Router, React 19, TypeScript strict. Path alias `@/` → `src/`.
- Pure, testable logic lives in `src/lib/` (no React, no `fetch` except in `src/lib/providers/`).
  Browser-only helpers live in `src/lib/client/` and start with `"use client"`.
- Every provider maps into the normalized `Place` model (`src/lib/types.ts`). Never leak
  provider-specific fields into UI code.
- Analytics: call `track()` from `src/lib/analytics.ts` with an `AnalyticsEvent`. Never pass
  coordinates, addresses or free-text queries.
- Location: use `useLocation()` from `src/lib/client/useLocation.ts`; the last chosen location is in
  sessionStorage via `loadLastLocation()`. No continuous tracking.
- Styling: plain CSS in `src/app/globals.css` using the CSS custom properties defined there
  (light + dark). Mobile-first; 16px gutters; touch targets ≥ 44px. Reuse `.btn`, `.chip`, `.card`,
  `.section`, `PlaceCard`.
- Tests: Vitest in `tests/*.test.ts`. Use `demoPlaces(origin)` from `src/lib/providers/demo.ts` as
  fixtures. Run `npm run typecheck && npm test && npm run build` before pushing.
