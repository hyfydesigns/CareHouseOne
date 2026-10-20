import type { Role } from "@/db/schema";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Organization admin",
  manager: "Facility manager",
  nurse: "Nurse",
  med_caregiver: "Med-certified caregiver",
  caregiver: "Caregiver",
};

export const CAREGIVER_ROLES: Role[] = ["caregiver", "med_caregiver"];

/** Caregivers sign in on their home's registered tablet instead of using an authenticator app. */
export const usesTwoStep = (role: Role) => !CAREGIVER_ROLES.includes(role);

export interface Actor {
  id: string;
  role: Role;
  facilityIds: string[];
}

export interface StaffTarget {
  id: string;
  role: Role;
  facilityIds: string[];
}

const isOrgAdmin = (a: Actor) => a.role === "owner" || a.role === "admin";
const withinOwnHomes = (a: Actor, facilityIds: string[]) =>
  facilityIds.length > 0 && facilityIds.every((f) => a.facilityIds.includes(f));

/**
 * Roles that can be given to new staff. Nurse and Facility manager are switched off: the homes we
 * serve have only owners, admins and caregivers signing in (owners and admins do the nurse's work
 * in the app). Add them back here for a customer whose nurses or managers will use it.
 */
export const OFFERED_ROLES: Role[] = ["owner", "admin", "med_caregiver", "caregiver"];

/** Owners and admins can manage any role anywhere; managers only caregivers in their own homes. */
function hasAuthority(actor: Actor, role: Role, facilityIds: string[]): boolean {
  if (isOrgAdmin(actor)) return actor.role === "owner" || role !== "owner";
  if (actor.role === "manager") return CAREGIVER_ROLES.includes(role) && withinOwnHomes(actor, facilityIds);
  return false;
}

/** Adding someone: only the roles on offer. */
export function canInvite(actor: Actor, role: Role, facilityIds: string[]): boolean {
  return OFFERED_ROLES.includes(role) && hasAuthority(actor, role, facilityIds);
}

/**
 * Deactivating, reactivating or managing an invitation. Works for every role, including ones no
 * longer offered, so an existing nurse or manager account can always be switched off.
 */
export function canManage(actor: Actor, target: StaffTarget): boolean {
  if (actor.id === target.id) return false;
  if (target.role === "owner" && actor.role !== "owner") return false;
  return hasAuthority(actor, target.role, target.facilityIds);
}

export function canViewAudit(actor: Pick<Actor, "role">): boolean {
  return isOrgAdmin(actor as Actor);
}

export function canViewStaff(actor: Pick<Actor, "role">): boolean {
  return isOrgAdmin(actor as Actor) || actor.role === "manager" || actor.role === "nurse";
}

/** Owners and admins see every home; everyone else only the homes they're assigned to. */
export function canSeeFacility(actor: Actor, facilityId: string): boolean {
  return isOrgAdmin(actor) || actor.facilityIds.includes(facilityId);
}

/** Add, edit and discharge residents; enter and stop medication orders. The nurse's job; managers can stand in. */
export function canManageCare(actor: Pick<Actor, "role">): boolean {
  return ["owner", "admin", "manager", "nurse"].includes(actor.role);
}

/** Giving medications: nurses and med-certified caregivers only. */
export function canGiveMeds(actor: Pick<Actor, "role">): boolean {
  return actor.role === "nurse" || actor.role === "med_caregiver";
}
