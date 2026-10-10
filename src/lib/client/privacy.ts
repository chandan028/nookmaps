"use client";

import { OPT_OUT_KEY, resetSessionMetrics } from "../analytics";

/** Everything NookMaps writes to Web Storage is namespaced with this prefix. */
const PREFIX = "nookmaps:";

/** Removes Google Analytics cookies (_ga, _ga_<id>) for this site. */
export function deleteAnalyticsCookies(): void {
  if (typeof document === "undefined") return;
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim())
    .filter((n): n is string => !!n && /^_ga(_|$)/.test(n));
  // GA sets its cookies on the highest settable domain, so try every suffix.
  const parts = location.hostname.split(".");
  const domains = [""].concat(parts.map((_, i) => parts.slice(i).join(".")).filter((d) => d.includes(".")));
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=.${domain}` : ""}`;
    }
  }
}

function clearStorage(storage: Storage | undefined, keep: (key: string, value: string | null) => boolean): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      if (keep(k, storage.getItem(k))) continue;
      storage.removeItem(k);
      removed++;
    }
  } catch {
    /* storage blocked: nothing stored either */
  }
  return removed;
}

/**
 * "Clear my data" (PRD §21, §26): removes saved places, preferences, the last
 * location, analytics bookkeeping and analytics cookies. An opt-out is kept so
 * that clearing data never silently re-enables analytics. The offline cache
 * (public/sw.js) only holds app files, never places or locations, so it stays.
 */
export function clearNookmapsData(): number {
  if (typeof window === "undefined") return 0;
  let local: Storage | undefined;
  let session: Storage | undefined;
  try {
    local = window.localStorage;
    session = window.sessionStorage;
  } catch {
    /* blocked */
  }
  let removed = clearStorage(local, (k, v) => k === OPT_OUT_KEY && v === "1");
  removed += clearStorage(session, () => false);
  resetSessionMetrics();
  deleteAnalyticsCookies();
  return removed;
}
