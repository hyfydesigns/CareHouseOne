/** A home's address and contact details, as stored on the home. */
export interface HomeContact {
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
}

/** "3915 Tidewater Dr, Houston, TX 77045" (whatever parts are filled in). */
export function addressLine(h: Pick<HomeContact, "street" | "city" | "state" | "zip">): string {
  const stateZip = [h.state, h.zip].filter(Boolean).join(" ");
  return [h.street, h.city, stateZip].filter(Boolean).join(", ");
}

/** "Phone: … · Fax: … · Email: …" for a form header. */
export function contactLine(h: Pick<HomeContact, "phone" | "fax" | "email">): string {
  return [h.phone && `Phone: ${h.phone}`, h.fax && `Fax: ${h.fax}`, h.email && `Email: ${h.email}`].filter(Boolean).join(" · ");
}
