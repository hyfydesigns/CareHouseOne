import Link from "next/link";
import { PRICE_PER_RESIDENT, TRIAL_DAYS } from "@/server/paypal";
import { signupOpen } from "@/server/billing";
import { demoAction } from "./actions";
import { DemoForm } from "./demo-form";

const icon = (d: string) => (
  <span className="site-icon" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  </span>
);

const FEATURES: Array<{ title: string; body: string; d: string }> = [
  {
    title: "A medication pass that stops mistakes",
    body: "Doses due now, one tap to give. The wrong resident, an allergy, a duplicate dose or a blood pressure that's too low stops the dose before it's given.",
    d: "M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM8.5 8.5l7 7",
  },
  {
    title: "As-needed doses with follow-ups",
    body: "Caregivers record why an as-needed dose was given, and the app reminds them to check whether it worked within the hour.",
    d: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  },
  {
    title: "Vital signs that get noticed",
    body: "Blood pressure (sitting or lying down), pulse, temperature, blood sugar, oxygen and weight with plain labels. Readings outside the usual range alert the caregiver and stay flagged until someone reviews them.",
    d: "M3 12h4l3-8 4 16 3-8h4",
  },
  {
    title: "Progress notes that hold up",
    body: "Notes by shift and type. Once saved they can't be edited, only added to, and every note shows who wrote it and when.",
    d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6M8 13h8M8 17h5",
  },
  {
    title: "Shift sign-in at the home",
    body: "Caregivers sign in and out of their shift on the home's own tablet, so hours are recorded at the right home. Monthly hours for each person.",
    d: "M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  },
  {
    title: "Diagnoses with ICD-10-CM",
    body: "Search the full, current ICD-10-CM code set, keep each resident's diagnoses with their history, and update the codes every October.",
    d: "M4 6h16M4 12h16M4 18h10",
  },
  {
    title: "One view of every home",
    body: "Owners see each home at a glance: late doses, overdue follow-ups, readings to review, notes, and who's on shift right now.",
    d: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  },
  {
    title: "A shared tablet done right",
    body: "Each caregiver signs in once a shift and unlocks with a personal PIN. The tablet locks itself after 2 minutes and hides everything until it's unlocked.",
    d: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2",
  },
  {
    title: "Keeps going when Wi-Fi drops",
    body: "Vital signs and progress notes are saved on the tablet, encrypted, and sent when the connection is back, without duplicates.",
    d: "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01",
  },
];

const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;

export function Landing() {
  const open = signupOpen();
  return (
    <>
      <section className="site-hero">
        <div className="site-wrap">
          <div>
            <span className="site-kicker">For group homes</span>
            <h1>Care records your caregivers can get right on the first try.</h1>
            <p className="lead">
              CareHouse One puts the medication pass, vital signs, progress notes and shift sign-in on one shared tablet in each home, with large buttons, plain
              words and hard stops where mistakes happen. Owners and admins see everything from any browser.
            </p>
            <div className="site-cta">
              {open ? (
                <Link className="btn primary" href="/signup">Start your {TRIAL_DAYS}-day free trial</Link>
              ) : (
                <a className="btn primary" href="#demo">Request a demo</a>
              )}
              <a className="btn" href="#pricing">See pricing</a>
            </div>
          </div>
          <div className="site-tablet" role="img" aria-label="Illustration of the medication pass on a tablet, showing doses due and a stop for a low blood pressure">
            <div className="screen" aria-hidden="true">
              <div className="bar"><span>Medication pass · Cedar Ridge</span><span>08:02</span></div>
              <div className="dose"><div><b>Lisinopril 10 mg</b><span>Room 2 · due 08:00</span></div><span className="give">Give</span></div>
              <div className="dose"><div><b>Metformin 500 mg</b><span>Room 4 · due 08:00</span></div><span className="give">Give</span></div>
              <div className="stop">Stop: blood pressure 96/60 is below the hold limit. Hold the dose and tell the nurse.</div>
              <div className="dose"><div><b>Vitamin D 1,000 IU</b><span>Room 5 · due 09:00</span></div><span className="give">Give</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section" id="features" aria-labelledby="features-h">
        <div className="site-wrap">
          <h2 className="title" id="features-h">Everything a shift needs, nothing it doesn&apos;t</h2>
          <p className="sub">Caregivers see four screens: Medication &amp; Diagnosis, Sign In / Sign Out, Vital Signs and Progress Notes. Owners and admins get the tools behind them.</p>
          <div className="site-grid">
            {FEATURES.map((f) => (
              <div className="site-feature" key={f.title}>
                {icon(f.d)}
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section alt" aria-labelledby="how-h">
        <div className="site-wrap">
          <h2 className="title" id="how-h">Up and running in an afternoon</h2>
          <ol className="site-steps">
            <li>
              <h3>Set up your homes</h3>
              <p>{open ? "Start the free trial with PayPal, then add your organization and homes." : "We set up your organization and homes with you."} You get an invitation to sign in.</p>
            </li>
            <li>
              <h3>Invite your team</h3>
              <p>Add your caregivers and admins. Register each home&apos;s tablet in Settings; caregivers set their own PIN on it.</p>
            </li>
            <li>
              <h3>Start the medication pass</h3>
              <p>Enter residents, medication orders and diagnoses, and the next shift works from the tablet.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="site-section" id="pricing" aria-labelledby="pricing-h">
        <div className="site-wrap">
          <h2 className="title" id="pricing-h">One plan. Priced per resident.</h2>
          <p className="sub">You pay for the residents you care for, not for logins, so every caregiver can have their own account.</p>
          <div className="site-price">
            <div className="site-plan">
              <div>
                <div className="amount">{fmt(PRICE_PER_RESIDENT)} <small>per resident per month</small></div>
                <p className="muted" style={{ margin: "8px 0 0" }}>{TRIAL_DAYS}-day free trial · billed monthly through PayPal · cancel anytime</p>
              </div>
              <ul>
                <li>Every feature, in every home</li>
                <li>Unlimited staff accounts and homes</li>
                <li>Two-step verification for owners and admins; caregivers sign in only on the home&apos;s tablet, with a personal PIN</li>
                <li>Automatic tablet lock and an audit log nobody can edit</li>
                <li>Daily backups</li>
                <li>A Business Associate Agreement with every subscription</li>
                <li>Email support</li>
              </ul>
              {open ? (
                <Link className="btn primary" href="/signup" style={{ justifySelf: "start" }}>Start free trial</Link>
              ) : (
                <a className="btn primary" href="#demo" style={{ justifySelf: "start" }}>Request a demo</a>
              )}
            </div>
            <div className="stack">
              <h3>What it costs</h3>
              <div className="site-examples">
                {[6, 13, 25].map((n) => (
                  <div key={n}><span>{n} residents</span><b>{fmt(n * PRICE_PER_RESIDENT)} a month</b></div>
                ))}
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                We count active residents on the first of each month; discharged residents aren&apos;t billed. PayPal sees only your organization&apos;s name, the billing
                contact and that count, never anything about residents.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section alt" id="faq" aria-labelledby="faq-h">
        <div className="site-wrap">
          <h2 className="title" id="faq-h">Questions</h2>
          <div className="site-faq">
            <details>
              <summary>Is CareHouse One built for HIPAA?</summary>
              <p>
                Yes. Data is encrypted in transit and at rest. Owners and admins use two-step verification; caregivers don&apos;t need an
                authenticator app, because they can only sign in on a tablet you&apos;ve registered to their home, which then locks with their personal PIN.
                Sessions end automatically, and every change is kept in an audit log nobody can edit. It runs on Google Cloud services covered by Google&apos;s Business Associate
                Agreement, and we sign one with every customer.
              </p>
            </details>
            <details>
              <summary>What devices do we need?</summary>
              <p>Any recent tablet, phone or computer with a web browser. Most homes use one shared tablet; it installs from the browser like an app.</p>
            </details>
            <details>
              <summary>What happens when the internet goes down?</summary>
              <p>
                Vital signs and progress notes keep working: they&apos;re saved on the tablet, encrypted, and sent when the connection is back. The medication pass
                needs a connection, because its safety checks use the latest orders, so the home follows its paper downtime procedure until it&apos;s back.
              </p>
            </details>
            <details>
              <summary>What counts as a resident?</summary>
              <p>Each active resident on the first of the month. Residents you discharge stop counting from the next month.</p>
            </details>
            <details>
              <summary>Can we cancel?</summary>
              <p>Anytime, from your PayPal account. Care records and the medication record are never locked because of a missed payment.</p>
            </details>
          </div>
        </div>
      </section>

      <section className="site-section" id="demo" aria-labelledby="demo-h">
        <div className="site-wrap site-demo">
          <div>
            <h2 className="title" id="demo-h">See it with your own homes in mind</h2>
            <p className="sub">
              Tell us a little about your homes and we&apos;ll set up a 30-minute walkthrough of the tablet screens and the owner tools.
            </p>
          </div>
          <DemoForm action={demoAction} />
        </div>
      </section>
    </>
  );
}
