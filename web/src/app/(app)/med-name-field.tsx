"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

interface Suggestion {
  name: string;
  strength: string;
  route: string | null;
  purpose?: string;
  residents?: number;
}

type Option = Suggestion & { group: "history" | "catalog" };

/**
 * The medication name with suggestions as you type: medications already ordered in this
 * organization (picking one also fills strength, route and purpose), then the standard list.
 * Any name can still be typed; the allergy and duplicate checks run when the order is saved.
 */
export function MedNameField() {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<AbortController | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searched, setSearched] = useState("");

  function search(q: string) {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setOpen(false);
      setOptions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      pending.current?.abort();
      const ctrl = new AbortController();
      pending.current = ctrl;
      try {
        const res = await fetch(`/api/medications?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { history: Suggestion[]; catalog: Suggestion[] };
        setOptions([...data.history.map((s) => ({ ...s, group: "history" as const })), ...data.catalog.map((s) => ({ ...s, group: "catalog" as const }))]);
        setSearched(q.trim());
        setActive(-1);
        setOpen(true);
      } catch {
        /* aborted by newer typing, or offline: keep typing freely */
      }
    }, 200);
  }

  function pick(o: Option) {
    const form = input.current?.form;
    if (!form || !input.current) return;
    input.current.value = o.name;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el && value) {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true })); // so fields that watch it (the tablet count) update
      }
    };
    set("strength", o.strength);
    const route = form.elements.namedItem("route") as HTMLSelectElement | null;
    if (route && o.route && [...route.options].some((opt) => opt.value === o.route)) route.value = o.route;
    // Purpose: fill it from history, and replace (or clear) one an earlier pick filled in, but
    // never overwrite what the person typed themselves.
    const purpose = form.elements.namedItem("purpose") as HTMLInputElement | null;
    if (purpose && (!purpose.value || purpose.value === purpose.dataset.auto)) {
      purpose.value = o.purpose ?? "";
      purpose.dataset.auto = o.purpose ?? "";
    }
    setOpen(false);
    (form.elements.namedItem(o.strength ? "purpose" : "strength") as HTMLInputElement | null)?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !options.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const optId = (i: number) => `${listId}-o${i}`;
  return (
    <div className="combo">
      <input
        ref={input}
        id="name"
        name="name"
        required
        autoComplete="off"
        placeholder="Start typing, for example: lisin"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        onChange={(e) => search(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => options.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="combo-list" id={listId} role="listbox" aria-label="Medication suggestions">
          {options.length === 0 && <li className="combo-empty">No matches for “{searched}”. You can still type the full name.</li>}
          {options.map((o, i) => (
            <li key={`${o.group}${o.name}${o.strength}${o.route}`} role="presentation">
              {(i === 0 || options[i - 1].group !== o.group) && (
                <div className="combo-group" role="presentation">{o.group === "history" ? "Used in your homes" : "Medication list"}</div>
              )}
              <div
                id={optId(i)}
                role="option"
                aria-selected={i === active}
                className="combo-opt"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the field until the pick is done
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <b>{o.name}</b> <span>{o.strength}</span>
                {o.route && <span className="muted"> · {o.route}</span>}
                {o.group === "history" && (
                  <span className="small muted">
                    <br />
                    {o.purpose ? `For ${o.purpose.toLowerCase()} · ` : ""}
                    {o.residents} resident{o.residents === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
