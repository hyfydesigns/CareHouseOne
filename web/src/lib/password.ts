import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * A short local blocklist of passwords that appear in every breach list. Production should also
 * check the Have I Been Pwned range API (k-anonymity, no password leaves the server) before
 * accepting a new password.
 */
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
    return "That password has appeared in known data breaches. Choose a different one.";
  }
  if (/^(.)\1+$/.test(password)) return "Don't use the same character over and over.";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Don't include your email name in your password.";
  return null;
}

// Argon2id with OWASP-recommended minimums (19 MiB, 2 iterations).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password).catch(() => false);
}
