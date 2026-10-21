import Link from "next/link";
import { Icon } from "@/components/icon";
import { clock, localClock } from "@/lib/time";
import type { Slot } from "@/server/meds";

const LABEL: Record<Slot["state"], [string, string]> = {
  upcoming: ["mute", "Later"],
  due: ["warn", "Due now"],
  late: ["crit", "Late"],
  given: ["ok", "Given"],
  refused: ["crit", "Refused"],
  held: ["warn", "Held"],
};

export function SlotRow({ slot, tz, canGive, back }: { slot: Slot; tz: string; canGive: boolean; back: string }) {
  const [tone, label] = LABEL[slot.state];
  const href = `/meds/give/${slot.order.id}?at=${encodeURIComponent(slot.scheduledFor.toISOString())}&back=${encodeURIComponent(back)}`;
  return (
    <div className="dose">
      <span>
        <b>{slot.order.name}</b> {slot.order.strength}
        <br />
        <span className="small muted">
          {clock(slot.time)} · {slot.order.purpose}
          {slot.order.instructions ? ` · ${slot.order.instructions}` : ""}
          {slot.order.bpCheck ? " · check BP first" : ""}
          {slot.order.stopDate ? ` · last day ${slot.order.stopDate}` : ""}
        </span>
        {slot.dose && (
          <>
            <br />
            <span className="small muted">
              {slot.dose.outcome === "given" ? "Given" : slot.dose.outcome === "refused" ? "Refused" : "Held"} at {localClock(slot.dose.recordedAt, tz)} by {slot.dose.byName ?? "unknown"}
              {slot.dose.late ? " · late" : ""}
              {slot.dose.reason ? ` · ${slot.dose.reason}` : ""}
            </span>
          </>
        )}
      </span>
      <span className="row" style={{ flexWrap: "nowrap" }}>
        <span className={`pill ${tone}`}>{label}</span>
        {canGive && (slot.state === "due" || slot.state === "late") && (
          <Link className="btn give big" href={href}><Icon name="pill" size={20} />Give</Link>
        )}
      </span>
    </div>
  );
}
