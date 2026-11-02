import type { Metadata } from "next";

export const metadata: Metadata = { title: "Move-in paperwork", robots: { index: false, follow: false } };

/** The family's pages: no app menu, readable on a phone. */
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="family">
      <div className="brand small muted"><span className="mark" aria-hidden="true">C1</span>CareHouse One</div>
      {children}
    </main>
  );
}
