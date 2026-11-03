import type { Block, FormDef, Who } from "@/lib/onboarding-forms";
import { residentialAgreement } from "./onboarding-agreement";

/**
 * The forms every organization starts with. They are general placeholders, not legal documents:
 * each owner reviews and edits them (or replaces them with their own) before sending them to a
 * family. CareHouse One will replace these with reviewed starter forms.
 */
let n = 0;
const bid = (prefix: string) => `${prefix}${(n++).toString(36).padStart(3, "0")}`;
const h = (text: string): Block => ({ id: bid("h"), type: "heading", text });
const p = (text: string): Block => ({ id: bid("p"), type: "text", text });
const f = (label: string, input: Extract<Block, { type: "field" }>["input"], opts: { who?: Who; required?: boolean; options?: string[]; help?: string } = {}): Block => ({
  id: bid("f"),
  type: "field",
  label,
  input,
  required: opts.required ?? true,
  who: opts.who ?? "poa",
  ...(opts.options && { options: opts.options }),
  ...(opts.help && { help: opts.help }),
});
const sign = (label: string, who: Who): Block => ({ id: bid("s"), type: "signature", label, who });

const PLACEHOLDER = "Starter text: replace it with your home's own wording (and have it reviewed) before sending this form to a family.";

export function starterForms(): FormDef[] {
  n = 0;
  return [
    {
      title: "Resident information",
      description: "About the person moving in.",
      kind: "form",
      required: true,
      blocks: [
        h("About the resident"),
        f("Legal name", "text"),
        f("Preferred name", "text", { required: false }),
        f("Date of birth", "date"),
        f("Primary language", "text", { required: false }),
        f("Address before moving in", "long", { required: false }),
        h("Health"),
        f("Allergies (medicines, foods, other)", "long", { help: "Write “None known” if there are none." }),
        f("Diet or texture needs", "text", { required: false }),
        f("Primary doctor's name and phone", "text"),
        f("Pharmacy name and phone", "text", { required: false }),
        f("Medicaid number", "text", { required: false }),
        f("Medicare number", "text", { required: false }),
        f("Other insurance (company and member number)", "text", { required: false }),
        h("For the home to complete"),
        f("Room", "text", { who: "staff", required: false }),
        f("Move-in date", "date", { who: "staff" }),
      ],
    },
    {
      title: "Responsible party and emergency contacts",
      description: "Who can make decisions, and who to call.",
      kind: "form",
      required: true,
      blocks: [
        h("Responsible party"),
        f("Your full name", "text"),
        f("Relationship to the resident", "text"),
        f("Your authority", "choice", { options: ["Health care power of attorney", "Durable (financial) power of attorney", "Court-appointed guardian", "Representative payee", "Other"] }),
        f("Phone", "text"),
        f("Email", "text"),
        f("Mailing address", "long"),
        h("Emergency contact (if different)"),
        f("Name", "text", { required: false }),
        f("Relationship", "text", { required: false }),
        f("Phone", "text", { required: false }),
        p("By signing, I confirm this information is correct and I will tell the home if it changes."),
        sign("Responsible party", "poa"),
      ],
    },
    {
      title: "Consent to administer medications",
      description: "Lets trained staff give the resident's medications as prescribed.",
      kind: "form",
      required: true,
      blocks: [
        p(PLACEHOLDER),
        p("I authorize trained staff of the home to store and give the resident's medications as ordered by the prescriber, to keep a record of every dose, and to contact the prescriber or pharmacy about the resident's medications."),
        f("Medications may be given by staff who are certified to do so", "check"),
        f("The pharmacy the home uses may be told about allergies and changes", "yesno"),
        sign("Responsible party", "poa"),
        sign("For the home", "staff"),
      ],
    },
    {
      title: "Photo and media consent",
      description: "Whether the resident's photo can be used.",
      kind: "form",
      required: true,
      blocks: [
        p("The home keeps a photo of each resident in their record so staff give care to the right person. This form is about any other use."),
        f("Photos for the resident's record (identification)", "yesno"),
        f("Photos in the home's newsletter or social media", "choice", { options: ["Yes", "Yes, without the resident's name", "No"] }),
        sign("Responsible party", "poa"),
      ],
    },
    residentialAgreement(),
    { title: "Power of attorney or guardianship papers", description: "A copy of the signed power of attorney or the court's guardianship order.", kind: "upload", required: true, blocks: [] },
    { title: "Insurance cards", description: "Front and back of the Medicaid, Medicare and any other insurance cards.", kind: "upload", required: true, blocks: [] },
    { title: "Photo ID of the responsible party", description: "A driver's license or other photo ID.", kind: "upload", required: true, blocks: [] },
    { title: "Current medication list or doctor's orders", description: "The latest list from the doctor, pharmacy or hospital discharge papers.", kind: "upload", required: false, blocks: [] },
  ];
}
