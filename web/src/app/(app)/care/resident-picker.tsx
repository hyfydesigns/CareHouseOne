import Link from "next/link";
import type { Resident } from "@/db/schema";

/** Big tap targets for choosing a resident on the shared tablet. */
export function ResidentPicker({ residents, current, base }: { residents: Resident[]; current?: string; base: string }) {
  return (
    <nav className="chips" aria-label="Residents">
      {residents.map((r) => (
        <Link key={r.id} className="chip" style={{ minHeight: 52 }} href={`${base}?r=${r.id}`} aria-current={r.id === current ? "page" : undefined}>
          {r.firstName} {r.lastName}&nbsp;<span className="muted small">Room {r.room}</span>
        </Link>
      ))}
    </nav>
  );
}
