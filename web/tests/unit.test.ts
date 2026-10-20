import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/password";
import { canInvite, canManage, type Actor } from "@/lib/permissions";
import { checkTotp, currentTotp, newTotpSecret } from "@/lib/totp";

describe("password policy", () => {
  it("requires at least 12 characters", () => {
    expect(checkPasswordPolicy("short-pass")).toMatch(/12 characters/);
    expect(checkPasswordPolicy("long enough phrase")).toBeNull();
  });
  it("blocks breached words padded with digits and symbols", () => {
    expect(checkPasswordPolicy("password1234")).toMatch(/breaches/);
    expect(checkPasswordPolicy("Password1234!!")).toMatch(/breaches/);
  });
  it("blocks repeated characters and the email name", () => {
    expect(checkPasswordPolicy("aaaaaaaaaaaaaa")).toMatch(/same character/);
    expect(checkPasswordPolicy("andre.thomas-2026!", "andre.thomas@example.test")).toMatch(/email name/);
  });
  it("hashes with argon2 and verifies", async () => {
    const h = await hashPassword("blue harbor morning");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "blue harbor morning")).toBe(true);
    expect(await verifyPassword(h, "blue harbor evening")).toBe(false);
  });
});

describe("crypto", () => {
  it("encrypts and decrypts, with a fresh IV each time", () => {
    const a = encrypt("secret value");
    const b = encrypt("secret value");
    expect(a).not.toEqual(b);
    expect(decrypt(a)).toBe("secret value");
  });
  it("rejects tampered ciphertext", () => {
    const parts = encrypt("secret value").split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("makes long random tokens and stable hashes", () => {
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
    expect(sha256("x")).toBe(sha256("x"));
  });
});

describe("two-step codes", () => {
  it("accepts the current code and rejects others", async () => {
    const s = newTotpSecret();
    expect(await checkTotp(s, await currentTotp(s))).toBe(true);
    expect(await checkTotp(s, "000000")).toBe(false);
    expect(await checkTotp(s, "12ab56")).toBe(false);
  });
});

describe("permissions", () => {
  const CR = "11111111-1111-4111-8111-111111111111";
  const MH = "22222222-2222-4222-8222-222222222222";
  const owner: Actor = { id: "o", role: "owner", facilityIds: [CR, MH] };
  const admin: Actor = { id: "a", role: "admin", facilityIds: [CR, MH] };
  const manager: Actor = { id: "m", role: "manager", facilityIds: [CR] };
  const caregiver: Actor = { id: "c", role: "caregiver", facilityIds: [CR] };

  it("lets owners and admins add the offered roles anywhere, except admins adding owners", () => {
    expect(canInvite(owner, "admin", [MH])).toBe(true);
    expect(canInvite(admin, "med_caregiver", [CR, MH])).toBe(true);
    expect(canInvite(admin, "owner", [CR])).toBe(false);
  });
  it("doesn't offer the nurse or manager roles, but existing ones can still be managed", () => {
    expect(canInvite(owner, "nurse", [CR])).toBe(false);
    expect(canInvite(owner, "manager", [CR])).toBe(false);
    expect(canManage(owner, { id: "n1", role: "nurse", facilityIds: [CR] })).toBe(true);
  });
  it("limits managers to caregivers in their own homes", () => {
    expect(canInvite(manager, "caregiver", [CR])).toBe(true);
    expect(canInvite(manager, "med_caregiver", [CR])).toBe(true);
    expect(canInvite(manager, "nurse", [CR])).toBe(false);
    expect(canInvite(manager, "caregiver", [MH])).toBe(false);
    expect(canInvite(manager, "caregiver", [CR, MH])).toBe(false);
  });
  it("never lets caregivers add or manage staff", () => {
    expect(canInvite(caregiver, "caregiver", [CR])).toBe(false);
    expect(canManage(caregiver, { id: "x", role: "caregiver", facilityIds: [CR] })).toBe(false);
  });
  it("doesn't let anyone manage themselves, or non-owners manage owners", () => {
    expect(canManage(owner, { id: "o", role: "owner", facilityIds: [CR] })).toBe(false);
    expect(canManage(admin, { id: "o2", role: "owner", facilityIds: [CR] })).toBe(false);
  });
});

describe("AM/PM display", () => {
  it("turns stored 24-hour times into AM/PM for people", async () => {
    const { clock } = await import("@/lib/time");
    expect(["00:00", "00:30", "08:05", "12:00", "12:45", "13:00", "23:59"].map(clock)).toEqual(["12:00 AM", "12:30 AM", "8:05 AM", "12:00 PM", "12:45 PM", "1:00 PM", "11:59 PM"]);
  });
});
