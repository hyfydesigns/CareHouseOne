/** Fails fast at startup when production is missing settings it can't run safely without. */
export function checkProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.DEMO_MODE === "true") {
    // The public demo runs on its own in-memory database with no secrets; it must never point at real data.
    if (process.env.DATABASE_URL) throw new Error("The demo app must not have DATABASE_URL: it keeps its own in-memory database.");
    if (process.env.SIGNUP_OPEN === "true") throw new Error("The demo app can't take sign-ups: set SIGNUP_OPEN=false.");
    if (!process.env.APP_URL?.startsWith("https://")) throw new Error("APP_URL must use https in production");
    return;
  }
  const missing = ["DATABASE_URL", "DATA_ENCRYPTION_KEY", "APP_URL", "CRON_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required settings: ${missing.join(", ")}`);
  const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  if (!process.env.APP_URL!.startsWith("https://")) throw new Error("APP_URL must use https in production");
  if (process.env.SIGNUP_OPEN === "true") {
    const pp = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_PLAN_ID", "PAYPAL_WEBHOOK_ID"].filter((k) => !process.env[k]);
    if (pp.length) throw new Error(`SIGNUP_OPEN is on but these PayPal settings are missing: ${pp.join(", ")}`);
  }
  if (!process.env.SMTP_URL) console.warn("[startup] SMTP_URL is not set: invitation and password-reset emails will wait in the outbox");
}
