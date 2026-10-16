import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { signOutAction, unlockAction } from "../actions";
import { UnlockForm } from "../forms";

/** Shows nothing about residents: only who the tablet is locked for. */
export default async function LockedPage() {
  const me = await requireSession();
  if (!me.device) redirect("/dashboard");
  if (me.needsPin) redirect("/pin");
  if (!me.locked) redirect("/dashboard");
  return (
    <>
      <h1>Tablet locked</h1>
      <p className="muted">
        Locked for <b>{me.name}</b>. Enter your PIN to pick up where you left off.
      </p>
      <UnlockForm action={unlockAction} />
      <form action={signOutAction}>
        <button className="btn small">Someone else? Sign out {me.name.split(" ")[0]}</button>
      </form>
    </>
  );
}
