import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { signupOpen } from "@/server/billing";
import { PRICE_PER_RESIDENT, TRIAL_DAYS } from "@/server/paypal";
import { subscribedAction } from "../actions";
import { Subscribe } from "./subscribe";

export const metadata: Metadata = { title: "Start your free trial · CareHouse One" };

export default async function SignupPage() {
  if (!signupOpen()) {
    return (
      <section className="site-signup">
        <div className="site-wrap">
          <h1>Online sign-up opens soon</h1>
          <p className="muted">We&apos;re onboarding a few organizations at a time while we finish our customer agreements. Request a demo and we&apos;ll set you up directly.</p>
          <Link className="btn primary" href="/#demo" style={{ justifySelf: "start" }}>Request a demo</Link>
        </div>
      </section>
    );
  }
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <section className="site-signup">
      <div className="site-wrap">
        <div>
          <h1>Start your {TRIAL_DAYS}-day free trial</h1>
          <p className="muted">
            ${PRICE_PER_RESIDENT} per resident per month after the trial, billed through PayPal. Cancel anytime in PayPal before the trial ends and you won&apos;t be
            charged.
          </p>
        </div>
        <Subscribe
          clientId={process.env.PAYPAL_CLIENT_ID!}
          planId={process.env.PAYPAL_PLAN_ID!}
          nonce={nonce}
          price={PRICE_PER_RESIDENT}
          trialDays={TRIAL_DAYS}
          onSubscribed={subscribedAction}
        />
        <p className="small muted" style={{ margin: 0 }}>
          Next you&apos;ll name your organization and homes and accept the <Link href="/terms">Terms of Service</Link> and the{" "}
          <Link href="/baa">Business Associate Agreement</Link>. PayPal only receives your organization&apos;s billing details and resident count.
        </p>
      </div>
    </section>
  );
}
