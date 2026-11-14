import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACT_TERMS } from "@/lib/contract-text";
import { LegalPart } from "../legal-doc";

export const metadata: Metadata = { title: "Business Associate Agreement · CareHouse One" };

// The same text clients sign with their order form (legal/terms-and-baa.md → src/lib/contract-text.ts).
export default function BaaPage() {
  const baa = CONTRACT_TERMS.find((p) => p.title === "Business Associate Agreement")!;
  const exhibit = CONTRACT_TERMS.find((p) => p.title.startsWith("Exhibit"));
  return (
    <section className="site-doc">
      <div className="site-wrap">
        <LegalPart part={baa} />
        {exhibit && <LegalPart part={exhibit} level={2} />}
        <p className="small">This agreement is part of the CareHouse One <Link href="/terms">Terms of Service</Link>.</p>
      </div>
    </section>
  );
}
