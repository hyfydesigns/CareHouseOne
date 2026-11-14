import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACT_TERMS } from "@/lib/contract-text";
import { LegalPart } from "../legal-doc";

export const metadata: Metadata = { title: "Terms of Service · CareHouse One" };

// The same text clients sign with their order form (legal/terms-and-baa.md → src/lib/contract-text.ts).
export default function TermsPage() {
  const part = CONTRACT_TERMS.find((p) => p.title === "Terms of Service")!;
  return (
    <section className="site-doc">
      <div className="site-wrap">
        <LegalPart part={part} />
        <p className="small">The <Link href="/baa">Business Associate Agreement</Link> is part of these Terms.</p>
      </div>
    </section>
  );
}
