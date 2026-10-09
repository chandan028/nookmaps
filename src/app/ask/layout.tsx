import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ask NookMaps",
  description: "Describe your budget, time and mood in plain words and get real places around you.",
};

export default function AskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
