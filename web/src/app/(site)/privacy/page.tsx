import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "../shell";

export const metadata: Metadata = { title: "Privacy · CareHouse One" };

// The website privacy policy approved with the Terms and BAA v1.4 (legal/CareHouse_One_Terms_BAA_v1.4.docx).
export default function PrivacyPage() {
  const email = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <section className="site-doc">
      <div className="site-wrap">
        <h1>Privacy</h1>
        <p className="muted">Updated November 14, 2026</p>
        <p>
          CareHouse One is owned and operated by HyFy Interactive LLC, a Texas limited liability company (&ldquo;we,&rdquo; &ldquo;us&rdquo;). This notice explains how we process information through the public CareHouse One website and sales or
          subscription workflows. Resident care records entered into the application are handled under the applicable customer agreement and, where relevant, the <Link href="/baa">Business Associate Agreement</Link>. Do not submit resident
          health information through public website forms.
        </p>
        <h2>What the website collects</h2>
        <ul>
          <li>
            <b>Demo inquiries:</b> We collect the name, work email, organization, approximate number of homes and residents, and message you provide. We use this information to respond to the inquiry and manage the business relationship. Do
            not include resident names, diagnoses, or other health information in the message.
          </li>
          <li>
            <b>Subscriptions and account communications:</b> PayPal handles the payment method. Depending on the integration, we may receive subscription identifiers, payer or organization name, billing contacts, transaction status and
            invoice amounts. We do not intentionally collect full payment-card numbers through our website. Our email service provider processes recipient addresses and the content of account communications.
          </li>
        </ul>
        <h2>What it doesn&apos;t do</h2>
        <ul>
          <li>We do not intentionally deploy advertising or cross-site tracking cookies on the public website.</li>
          <li>
            We do not sell website inquiry data. We disclose information to service providers that support hosting, communications and payments, and when legally required or needed to protect rights and security. We require appropriate
            safeguards for provider access and do not intentionally send resident health information through ordinary marketing or account emails.
          </li>
        </ul>
        <h2>Questions or deletion</h2>
        <p>
          Email {email} to request access, correction, or deletion of website inquiry information. We will respond as applicable law requires; some records may be retained for legal, accounting, security, or dispute-resolution purposes. We
          use reasonable administrative and technical safeguards, but no transmission or storage system is perfectly secure.
        </p>
        <h2>Who we are</h2>
        <p>HyFy Interactive LLC, 9898 Bissonnet St, Suite 368, Houston, TX 77036. Email {email}.</p>
      </div>
    </section>
  );
}
