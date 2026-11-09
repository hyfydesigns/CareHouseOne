"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { INTRO_MONTHS, INTRO_PRICE_PER_HOME, PRICE_PER_HOME, usd } from "@/lib/pricing";

type PaypalButtons = {
  Buttons: (o: {
    style?: Record<string, string>;
    createSubscription: (data: unknown, actions: { subscription: { create: (o: { plan_id: string; quantity: string }) => Promise<string> } }) => Promise<string>;
    onApprove: (data: { subscriptionID?: string }) => Promise<void>;
    onError?: (e: unknown) => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> };
};

/**
 * Number of homes, then PayPal's subscription button. PayPal opens its own window for the payment;
 * when the buyer approves, the server checks the subscription with PayPal before anything happens.
 */
export function Subscribe(props: {
  clientId: string;
  planId: string;
  nonce?: string;
  trialDays: number;
  onSubscribed: (subscriptionId: string) => Promise<{ setupUrl?: string; error?: string }>;
}) {
  const { planId, onSubscribed } = props;
  const [homes, setHomes] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The subscription's quantity is the number of homes; PayPal's plan has the prices.
  const quantity = useRef(homes);
  useEffect(() => {
    quantity.current = homes;
  }, [homes]);

  useEffect(() => {
    const pp = (window as unknown as { paypal?: PaypalButtons }).paypal;
    if (!ready || !pp || !box.current) return;
    box.current.innerHTML = "";
    const buttons = pp.Buttons({
      style: { shape: "rect", label: "subscribe", layout: "vertical" },
      createSubscription: (_d, actions) => actions.subscription.create({ plan_id: planId, quantity: String(quantity.current) }),
      onApprove: async (data) => {
        setBusy(true);
        const r = await onSubscribed(data.subscriptionID ?? "");
        if (r.setupUrl) window.location.assign(r.setupUrl);
        else {
          setBusy(false);
          setError(r.error ?? "Something went wrong. Your trial may have started; check your email for the setup link.");
        }
      },
      onError: () => setError("PayPal couldn't start the subscription. Try again, or email us."),
    });
    buttons.render(box.current).catch(() => setError("PayPal couldn't load. Refresh the page to try again."));
    return () => {
      buttons.close?.().catch(() => {});
    };
  }, [ready, planId, onSubscribed]);


  return (
    <div className="card" style={{ gap: 16 }}>
      <Script
        src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(props.clientId)}&vault=true&intent=subscription&currency=USD&components=buttons`}
        nonce={props.nonce}
        onReady={() => setReady(true)}
        onError={() => setError("PayPal couldn't load. Check your connection and refresh.")}
      />
      <div className="field" style={{ maxWidth: 380 }}>
        <label htmlFor="homes">How many homes do you run?</label>
        <input
          id="homes"
          inputMode="numeric"
          value={homes}
          aria-describedby="homesHint"
          style={{ maxWidth: 140 }}
          onChange={(e) => setHomes(Math.min(100, Math.max(1, Number(e.target.value.replace(/[^0-9]/g, "")) || 1)))}
        />
        <span id="homesHint" className="small muted">
          Priced per home, with any number of residents. If you add a home later, the amount updates on the 1st of the next month.
        </span>
      </div>
      <p style={{ margin: 0 }}>
        {props.trialDays} days free, then <b>{usd(homes * INTRO_PRICE_PER_HOME)} a month</b> for {INTRO_MONTHS} months, then <b>{usd(homes * PRICE_PER_HOME)} a month</b>.
      </p>
      {busy ? <p className="notice" role="status">Confirming with PayPal…</p> : <div ref={box} aria-label="PayPal subscription button" />}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
