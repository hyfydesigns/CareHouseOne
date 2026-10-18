import "./site.css";
import Link from "next/link";
import { appBaseUrl } from "@/lib/hosts";
import { signupOpen } from "@/server/billing";

export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@carehouseone.com";

/** Header and footer for every public page. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  const open = signupOpen();
  return (
    <div className="site">
      <header className="site-head">
        <div className="site-wrap">
          <Link href="/" className="brand">
            <span className="mark" aria-hidden="true">C1</span>CareHouse One
          </Link>
          <nav aria-label="Site">
            <Link href="/#features">Features</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/#faq">Questions</Link>
            <a href={`${appBaseUrl()}/sign-in`}>Sign in</a>
            {open ? (
              <Link className="btn primary" href="/signup">Start free trial</Link>
            ) : (
              <Link className="btn primary" href="/#demo">Request a demo</Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-foot">
        <div className="site-wrap">
          <span>© {new Date().getFullYear()} CareHouse One</span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <nav aria-label="Legal">
            <a href={`${appBaseUrl()}/sign-in`}>Sign in</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/baa">Business Associate Agreement</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
