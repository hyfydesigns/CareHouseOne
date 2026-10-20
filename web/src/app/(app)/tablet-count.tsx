"use client";

import { useEffect, useRef, useState } from "react";

/** Same rule as the server (isCountable in server/meds.ts). */
const COUNTABLE = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|caplet|caplets)\b/i;

/**
 * "Tablets on hand" and "Tablets per dose", shown only while the order's strength looks like a
 * tablet or capsule. Owners and admins only (it's part of the add-medication form).
 */
export function TabletCount() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [countable, setCountable] = useState(false);

  useEffect(() => {
    const strength = anchor.current?.closest("form")?.elements.namedItem("strength") as HTMLInputElement | null;
    if (!strength) return;
    const check = () => setCountable(COUNTABLE.test(strength.value));
    strength.addEventListener("input", check);
    return () => strength.removeEventListener("input", check);
  }, []);

  return (
    <>
      <span ref={anchor} hidden />
      {countable && (
        <fieldset className="form-section">
          <legend>Tablet count</legend>
          <p className="hint">Optional. Each dose recorded as given takes it off the count. Only owners and admins see the count.</p>
          <div className="row" style={{ alignItems: "start" }}>
            <div className="field" style={{ flex: "0 1 180px" }}>
              <label htmlFor="countOnHand">Tablets on hand</label>
              <input id="countOnHand" name="countOnHand" type="number" min={0} max={10000} step={0.5} inputMode="decimal" placeholder="For example: 30" />
            </div>
            <div className="field" style={{ flex: "0 1 180px" }}>
              <label htmlFor="perDose">Tablets per dose</label>
              <input id="perDose" name="perDose" type="number" min={0.5} max={20} step={0.5} inputMode="decimal" defaultValue={1} />
            </div>
          </div>
        </fieldset>
      )}
    </>
  );
}
