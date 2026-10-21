"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

/**
 * The main menu. On wide screens it's the sidebar; on phones it collapses into a top bar with a
 * Menu button, and closes again when a page is picked.
 */
export function SideNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <nav
      className={`side${open ? " open" : ""}`}
      aria-label="Main"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) setOpen(false);
      }}
    >
      <div className="side-top">
        <div className="brand">
          <span className="mark" aria-hidden="true">C1</span>CareHouse One
        </div>
        <button type="button" className="menu-btn" aria-expanded={open} aria-controls="side-links" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "close" : "menu"} size={22} />
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <div className="side-links" id="side-links">
        {children}
      </div>
    </nav>
  );
}
