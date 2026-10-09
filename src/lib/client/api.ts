"use client";

import type { DiscoverResponse, FeedSection, Place } from "../types";
import type { StoredLocation } from "./storage";

function tzo(): string {
  return String(new Date().getTimezoneOffset());
}

/** A failed API call; `status` lets screens tell "not found" from "try again". */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

export function discover(loc: StoredLocation, radiusM: number): Promise<DiscoverResponse> {
  const q = new URLSearchParams({
    lat: String(loc.lat),
    lng: String(loc.lng),
    acc: String(Math.round(loc.accuracyM ?? (loc.source === "manual" ? 500 : 30))),
    radius: String(radiusM),
    tzo: tzo(),
  });
  return getJson(`/api/discover?${q}`);
}

export interface PlaceDetailResponse {
  place: Place;
  openNow: boolean | null;
  whatNext: FeedSection[];
}

export function placeDetail(id: string): Promise<PlaceDetailResponse> {
  return getJson(`/api/place/${encodeURIComponent(id)}?tzo=${tzo()}`);
}

export function geocode(q: string): Promise<{ results: { lat: number; lng: number; label: string }[] }> {
  return getJson(`/api/geocode?q=${encodeURIComponent(q)}`);
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return getJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...((body as object) ?? {}), tzo: new Date().getTimezoneOffset() }),
  });
}
