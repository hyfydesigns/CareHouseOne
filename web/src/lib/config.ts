/** Fails fast at startup when production is missing settings it can't run safely without. */
export function checkProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing = ["DATABASE_URL", "DATA_ENCRYPTION_KEY", "APP_URL", "CRON_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required settings: ${missing.join(", ")}`);
  const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  if (!process.env.APP_URL!.startsWith("https://")) throw new Error("APP_URL must use https in production");
  if (!process.env.SMTP_URL) console.warn("[startup] SMTP_URL is not set: invitation and password-reset emails will wait in the outbox");
}
