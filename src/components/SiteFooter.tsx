import Link from "next/link";
import styles from "./SiteFooter.module.css";

/** One quiet line on every screen pointing to how location is used (PRD §21, §26). */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <Link href="/privacy">How NookMaps uses your location</Link>
    </footer>
  );
}
