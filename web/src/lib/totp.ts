import { generate, generateSecret, generateURI, verify } from "otplib";

export const TOTP_ISSUER = "CareHouse One";

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, email: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: email, secret });
}

/** Accepts the current code and one 30-second step either side, for clock drift. */
export async function checkTotp(secret: string, token: string): Promise<boolean> {
  const clean = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const res = await verify({ secret, token: clean, epochTolerance: 30 });
  return res.valid;
}

/** Used by tests and the local development helper script only. */
export function currentTotp(secret: string): Promise<string> {
  return generate({ secret });
}
