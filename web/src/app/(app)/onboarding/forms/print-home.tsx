"use client";

import { createContext, useContext, useState } from "react";

type Home = { id: string; name: string };

/** The home whose name, address and contact details go on blank printed forms ("" for none). */
const PrintHome = createContext<{ homes: Home[]; home: string; setHome: (id: string) => void }>({ homes: [], home: "", setHome: () => {} });

export function PrintHomeProvider({ homes, children }: { homes: Home[]; children: React.ReactNode }) {
  const [home, setHome] = useState(homes[0]?.id ?? "");
  return <PrintHome.Provider value={{ homes, home, setHome }}>{children}</PrintHome.Provider>;
}

/** Choose the home for printed copies; nothing to choose with a single home. */
export function PrintHomeSelect() {
  const { homes, home, setHome } = useContext(PrintHome);
  if (homes.length < 2) return null;
  return (
    <label className="row small" style={{ gap: 8, margin: 0 }}>
      <span>Home on printed copies:</span>
      <select value={home} onChange={(e) => setHome(e.target.value)} style={{ width: "auto", minHeight: 36 }}>
        {homes.map((h) => (
          <option key={h.id} value={h.id}>{h.name}</option>
        ))}
        <option value="">No home (organization only)</option>
      </select>
    </label>
  );
}

export function PrintBlankLink({ formId, label, title }: { formId: string; label: string; title?: string }) {
  const { home } = useContext(PrintHome);
  return (
    <a className="btn small" href={`/api/onboarding/forms/${formId}/paper?home=${home || "none"}`} target="_blank" rel="noreferrer" title={title}>
      {label}
    </a>
  );
}
