import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { setPinAction, signOutAction } from "../actions";
import { SetPinForm } from "../forms";

export default async function PinPage() {
  const me = await requireSession();
  if (!me.device || !me.needsPin) redirect("/dashboard");
  return (
    <>
      <h1>Set your tablet PIN</h1>
      <p className="muted">
        This is a shared tablet ({me.device.name}). It locks after 2 minutes without a touch. Unlock it with this PIN for the rest of your
        shift instead of your password. Five wrong tries sign you out.
      </p>
      <SetPinForm action={setPinAction} />
      <form action={signOutAction}>
        <button className="btn small">Not {me.name.split(" ")[0]}? Sign out</button>
      </form>
    </>
  );
}
