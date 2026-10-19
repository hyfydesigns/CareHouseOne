"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type PaypalButtons = {
  Buttons: (o: {
    style?: Record<string, string>;
    createSubscription: (data: unknown, actions: { subscription: { create: (o: { plan_id: string; quantity: string }) => Promise<string> } }) => Promise<string>;
    onApprove: (data: { subscriptionID?: string }) => Promise<void>;
    onError?: (e: unknown) => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> };
};

/**
 * Resident count, then PayPal's subscription button. PayPal opens its own window for the payment;
 * when the buyer approves, the server checks the subscription with PayPal before anything happens.
 */
export function Subscribe(props: {
  clientId: string;
  planId: string;
  nonce?: string;
  price: number;
  trialDays: number;
  onSubscribed: (subscriptionId: string) => Promise<{ setupUrl?: string; error?: string }>;
}) {
  const { planId, onSubscribed } = props;
  const [residents, setResidents] = useState(6);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const count = useRef(residents);
  useEffect(() => {
    count.current = residents;
  }, [residents]);

  useEffect(() => {
    const pp = (window as unknown as { paypal?: PaypalButtons }).paypal;
    if (!ready || !pp || !box.current) return;
    box.current.innerHTML = "";
    const buttons = pp.Buttons({
      style: { shape: "rect", label: "subscribe", layout: "vertical" },
      createSubscription: (_d, actions) => actions.subscription.create({ plan_id: planId, quantity: String(count.current) }),
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

  const monthly = residents * props.price;
  return (
    <div className="card" style={{ gap: 16 }}>
      <Script
        src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(props.clientId)}&vault=true&intent=subscription&currency=USD&components=buttons`}
        nonce={props.nonce}
        onReady={() => setReady(true)}
        onError={() => setError("PayPal couldn't load. Check your connection and refresh.")}
      />
      <div className="field" style={{ maxWidth: 380 }}>
        <label htmlFor="residents">How many residents live in all your homes right now?</label>
        <input
          id="residents"
          inputMode="numeric"
          value={residents}
          aria-describedby="residentsHint"
          style={{ maxWidth: 140 }}
          onChange={(e) => setResidents(Math.min(500, Math.max(1, Number(e.target.value.replace(/[^0-9]/g, "")) || 1)))}
        />
        <span id="residentsHint" className="small muted">
          You&apos;re billed per resident. The count updates to your active residents on the 1st of each month.
        </span>
      </div>
      <p style={{ margin: 0 }}>
        <b>${monthly.toLocaleString("en-US")} a month</b> after {props.trialDays} days free.
      </p>
      {busy ? <p className="notice" role="status">Confirming with PayPal…</p> : <div ref={box} aria-label="PayPal subscription button" />}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
