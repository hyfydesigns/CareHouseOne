import type { Metadata } from "next";
import { CONTACT_EMAIL } from "../shell";

export const metadata: Metadata = { title: "Privacy · CareHouse One" };

// Plain-language notice for the public website. Have it reviewed with the terms before launch.
export default function PrivacyPage() {
  return (
    <section className="site-doc">
      <div className="site-wrap">
        <h1>Privacy</h1>
        <p>This page covers the CareHouse One website (www.carehouseone.com). Care records in the app are covered by each customer&apos;s Business Associate Agreement.</p>
        <h2>What the website collects</h2>
        <ul>
          <li>When you request a demo: your name, work email, organization, the number of homes and residents, and your message. We use them only to arrange and follow up on the demo.</li>
          <li>When you subscribe: PayPal handles the payment. We receive your subscription ID, name and email from PayPal; we never see or store card or bank details.</li>
        </ul>
        <h2>What it doesn&apos;t do</h2>
        <ul>
          <li>No advertising or tracking cookies, and no analytics that follow you across sites.</li>
          <li>We don&apos;t sell or share your details, except with PayPal to take payment and with our email provider to send you messages.</li>
        </ul>
        <h2>Questions or deletion</h2>
        <p>Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we&apos;ll answer or delete your details.</p>
      </div>
    </section>
  );
}
