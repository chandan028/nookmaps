import type { MetadataRoute } from "next";

/** Web app manifest (PRD §22: responsive web app / PWA). Colours are the light design tokens. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "NookMaps",
    short_name: "NookMaps",
    description: "Open the app and discover what you can do right now, exactly where you are.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf8f5",
    theme_color: "#faf8f5",
    categories: ["travel", "navigation", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Plan my time", url: "/plan" },
      { name: "Ask NookMaps", url: "/ask" },
      { name: "Saved places", url: "/saved" },
    ],
  };
}
