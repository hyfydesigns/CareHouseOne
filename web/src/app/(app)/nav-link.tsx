"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";

/** Each section has its own icon color, so the menu is easy to scan on a tablet. */
const COLORS: Record<IconName, string> = {
  home: "#5b4bdb",
  pill: "#e07a2e",
  residents: "#1c9c7a",
  pulse: "#d14b7a",
  notes: "#2f7fd8",
  clock: "#2e9e5b",
  alert: "#d4452a",
  shield: "#c0730c",
  staff: "#8a4fd8",
  calendar: "#178f9e",
  list: "#6b6890",
  settings: "#6b6890",
};

export function NavLink({ href, icon, children }: { href: string; icon: IconName; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      <span className="ico" style={{ "--ic": COLORS[icon] } as React.CSSProperties}>
        <Icon name={icon} />
      </span>
      {children}
    </Link>
  );
}
