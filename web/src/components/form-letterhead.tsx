/* eslint-disable @next/next/no-img-element -- the logo is a data: URL from the server */
import type { LetterheadView } from "@/server/onboarding";

/** The top of a form: the organization's logo and name, and the home's address and contact details. */
export function FormLetterhead({ head }: { head: LetterheadView }) {
  return (
    <div className="letterhead">
      {head.logoUrl && <img src={head.logoUrl} alt={`${head.org} logo`} />}
      <div>
        <b>{head.org}</b>
        <div className="small muted">{head.address ? `${head.home} · ${head.address}` : head.home}</div>
        {head.contact && <div className="small muted">{head.contact}</div>}
      </div>
    </div>
  );
}
