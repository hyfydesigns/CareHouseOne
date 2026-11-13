import type { Metadata } from "next";
import { CONTRACT_PARTY } from "@/lib/contract-text";
import { getDb } from "@/db/client";
import { dayIn, showDay } from "@/lib/billing-cycle";
import { CONTRACT_CONSENT, contractByToken, type ContractDocument } from "@/server/contracts";
import { signContractAction } from "./actions";
import { SignContract } from "./sign";

export const metadata: Metadata = { title: "Your agreement · CareHouse One", referrer: "no-referrer" };

/** The agreement a client signs from their emailed link: order form, Terms and BAA, then the signature. */
export default async function ContractPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await contractByToken(await getDb(), token);
  const wrap = (children: React.ReactNode) => (
    <main className="main" style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px 64px" }}>
      <div className="brand" style={{ marginBottom: 12 }}>
        <span className="mark" aria-hidden="true">C1</span>CareHouse One
      </div>
      {children}
    </main>
  );
  if (!c) {
    return wrap(
      <section className="card">
        <h1>This link has expired</h1>
        <p>Ask CareHouse One for a new one; just reply to the email it came in.</p>
      </section>,
    );
  }
  const d = c.document as unknown as ContractDocument;
  const signed = c.status === "signed";
  return wrap(
    <>
      <div>
        <h1 style={{ marginBottom: 4 }}>Agreement between {d.client.orgName} and {CONTRACT_PARTY}</h1>
        <p className="muted" style={{ margin: 0 }}>Order form, Terms of Service and Business Associate Agreement · issued {showDay(d.issuedOn, true)}</p>
      </div>
      {signed ? (
        <section className="card">
          <p className="notice" role="status" style={{ margin: 0 }}>
            Signed by {c.signedName} ({c.signedTitle}) on {showDay(dayIn(c.signedAt!), true)}. Thank you.
          </p>
          <a className="btn primary" href={`/contract/${token}/pdf`} style={{ justifySelf: "start" }}>Download the signed agreement (PDF)</a>
        </section>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Please read it all; you can sign at the bottom. <a href={`/contract/${token}/pdf`}>Download it as a PDF</a></p>
      )}
      <section className="card">
        <h2>Order form</h2>
        <dl style={{ margin: 0, display: "grid", gap: 10 }}>
          {d.order.map((l, i) => (
            <div key={i}>
              <dt><b>{i + 1}. {l.label}</b></dt>
              <dd style={{ margin: "2px 0 0 18px" }}>{l.text}</dd>
            </div>
          ))}
        </dl>
        <p className="small muted" style={{ margin: 0 }}>This order form and the Terms of Service and Business Associate Agreement below are one agreement. If they conflict, the order form controls.</p>
      </section>
      {d.terms.map((part) => (
        <section className="card" key={part.title}>
          <h2>{part.title}</h2>
          {part.blocks.map((b, i) =>
            b.type === "h" ? (
              <h3 key={i} style={{ margin: "8px 0 0" }}>{b.text}</h3>
            ) : b.type === "li" ? (
              <p key={i} style={{ margin: "0 0 0 18px" }}>• {b.text}</p>
            ) : b.type === "p" ? (
              <p key={i} style={{ margin: 0 }}>{b.text}</p>
            ) : (
              <div className="tablewrap" key={i}>
                <table>
                  <thead><tr>{b.rows[0].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{b.rows.slice(1).map((r, j) => <tr key={j}>{r.map((cell, k) => <td key={k} className="small">{cell}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ),
          )}
        </section>
      ))}
      {!signed && (
        <section className="card" aria-labelledby="sign-h">
          <h2 id="sign-h">Sign for {d.client.orgName}</h2>
          <p className="small" style={{ margin: 0 }}>Signing as {c.signerName} ({c.signerEmail}). Sign by drawing or typing your name; you&apos;ll get a PDF copy by email.</p>
          <SignContract sign={signContractAction.bind(null, token)} defaultName={c.signerName} consentText={CONTRACT_CONSENT} />
        </section>
      )}
    </>,
  );
}
