import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { DEMO_ROLES, demoMode } from "@/server/demo";
import { demoSignInAction } from "./actions";

export const metadata: Metadata = { title: "Try the demo · CareHouse One" };

/** The demo's front door: pick who to be. */
export default function DemoPage() {
  if (!demoMode()) notFound();
  return (
    <>
      <h1>Try CareHouse One</h1>
      <p className="muted" style={{ margin: 0 }}>
        A demo group home company with two homes and made-up residents. Click around, give medications, file a report: it all goes back to the start on its own.
      </p>
      <form action={demoSignInAction.bind(null, "owner")}>
        <button className="btn primary big" style={{ width: "100%" }}><Icon name="home" size={20} />Be the owner</button>
      </form>
      <p className="small muted" style={{ margin: "-6px 0 0" }}>{DEMO_ROLES.owner.who}: the dashboard for both homes, residents, orders, staff, incidents, billing and settings.</p>
      <form action={demoSignInAction.bind(null, "caregiver")}>
        <button className="btn give big" style={{ width: "100%" }}><Icon name="pill" size={20} />Be the caregiver</button>
      </form>
      <p className="small muted" style={{ margin: "-6px 0 0" }}>
        {DEMO_ROLES.caregiver.who} on the Cedar Ridge tablet: the medication pass, vital signs, notes and shift sign-in. You&apos;ll choose a PIN for the tablet first.
      </p>
      <p className="notice" style={{ margin: 0 }}>Everyone here is made up. Please don&apos;t enter real names or health information.</p>
    </>
  );
}
