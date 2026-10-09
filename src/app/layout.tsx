import type { Metadata, Viewport } from "next";
import { Analytics } from "@/components/Analytics";
import { BottomNav } from "@/components/BottomNav";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

// Icons come from app/icon.svg and app/apple-icon.png, the manifest from app/manifest.ts.
export const metadata: Metadata = {
  title: "NookMaps — what can I do here?",
  description: "Open the app and discover what you can do right now, exactly where you are.",
  applicationName: "NookMaps",
  appleWebApp: { capable: true, title: "NookMaps", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
        <BottomNav />
        <Analytics />
        <ServiceWorker />
      </body>
    </html>
  );
}
