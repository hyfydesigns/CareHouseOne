import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** A short local blocklist of passwords that appear in every breach list (see also isBreached). */
const COMMON = [
  "password", "passw0rd", "qwerty", "letmein", "welcome", "iloveyou", "admin", "abc123", "monkey",
  "dragon", "sunshine", "princess", "football", "baseball", "trustno1", "changeme", "123456",
];

export function checkPasswordPolicy(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  const lower = password.toLowerCase();
  const stripped = lower.replace(/[^a-z]/g, "");
  // "Password1234!" strips to "password": a breached word padded with digits and symbols.
  if (COMMON.some((w) => stripped === w || lower.replace(/[^a-z0-9]/g, "") === w)) {
    return BREACHED;
  }
  if (/^(.)\1+$/.test(password)) return "Don't use the same character over and over.";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Don't include your email name in your password.";
  return null;
}

export const BREACHED = "That password has appeared in known data breaches. Choose a different one.";

/**
 * Checks the Have I Been Pwned range API. Only the first 5 characters of the password's SHA-1
 * leave the server (k-anonymity), with padding so the response size reveals nothing. If the
 * service can't be reached, the password is allowed and a warning is logged: an outage there
 * mustn't stop a caregiver from setting a password. Off in tests and when PWNED_CHECK=off.
 */
export async function isBreached(password: string): Promise<boolean> {
  if (process.env.NODE_ENV === "test" || process.env.PWNED_CHECK === "off") return false;
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    return text.split("\n").some((line) => {
      const [hashSuffix, count] = line.trim().split(":");
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch (e) {
    console.warn(`[password] breach check unavailable: ${(e as Error).message}`);
    return false;
  }
}

// Argon2id with OWASP-recommended minimums (19 MiB, 2 iterations).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password).catch(() => false);
}
