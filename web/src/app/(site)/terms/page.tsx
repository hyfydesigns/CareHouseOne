import type { Metadata } from "next";
import { CONTACT_EMAIL } from "../shell";

export const metadata: Metadata = { title: "Terms of Service · CareHouse One" };

// Placeholder until the lawyer-reviewed document is ready. Self-service sign-up stays closed
// (SIGNUP_OPEN) until this page holds the final text.
export default function TermsPage() {
  return (
    <section className="site-doc">
      <div className="site-wrap">
        <h1>Terms of Service</h1>
        <p>We&apos;re finalizing this document. It will be published here before online sign-up opens, and every customer accepts it before entering any information.</p>
        <p>To review the current version for your organization, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </div>
    </section>
  );
}
