/**
 * The Terms of Service and Business Associate Agreement that clients sign with their order form
 * (admin site > Contracts). GENERATED from legal/terms-and-baa.md by `npm run contract:text`:
 * edit that file, not this one. Every contract stores a copy of the text it was sent with, so
 * changing this never changes a contract already sent or signed.
 */

export type ContractBlock =
  | { type: "h"; text: string }
  | { type: "p"; text: string }
  | { type: "li"; text: string }
  | { type: "table"; rows: string[][] };
export type ContractPart = { title: string; blocks: ContractBlock[] };

/** The company clients contract with. */
export const CONTRACT_PARTY = "HyFy Interactive LLC";

export const CONTRACT_VERSION = "Version 1.0 of November 13, 2026";

/** False until a lawyer has reviewed the text (scripts/contract-text.ts). */
export const CONTRACT_REVIEWED = false;

export const CONTRACT_TERMS: ContractPart[] = [
  {
    title: "Terms of Service",
    blocks: [
      {
        type: "p",
        text: "Version 1.0 · November 13, 2026",
      },
      {
        type: "p",
        text: 'These Terms are a contract between HyFy Interactive LLC, a Texas limited liability company that owns and operates CareHouse One ("HyFy", "we", "us"), and the organization that signs up for CareHouse One or signs an order form for it ("Customer", "you"). They take effect for you on the day you accept them, by signing an order form or by accepting them when you set up your account. The person who accepts them confirms they are authorized to bind the Customer. If you don\'t agree, don\'t use the Service.',
      },
      {
        type: "h",
        text: "1. The Service",
      },
      {
        type: "p",
        text: "1.1 CareHouse One is web software for group homes: medication orders and the medication administration record, vital signs, progress notes, incident reports, appointments, diagnoses, shift sign-in, safety checks, staff training records, resident and staff onboarding forms, and related tools (the \"Service\"). We may improve or change features over time; we won't remove a core recordkeeping feature during your subscription without 60 days' notice.",
      },
      {
        type: "p",
        text: "1.2 The Service is a recordkeeping tool, not a medical device and not medical advice. Safety checks in the Service (for example allergy warnings, blood pressure holds and dose timing) are aids. Your staff and your licensed professionals remain responsible for every care decision, for following prescriber orders and your state's rules, and for verifying what they record.",
      },
      {
        type: "p",
        text: "1.3 The Service is offered to businesses, not consumers, and only for use in the United States.",
      },
      {
        type: "h",
        text: "2. Accounts and access",
      },
      {
        type: "p",
        text: "2.1 You choose who gets an account and what role they have (owner, admin, caregiver). You're responsible for everything done under your accounts, for removing access promptly when someone leaves, and for keeping your registered tablets physically secure.",
      },
      {
        type: "p",
        text: "2.2 Owners and admins should turn on two-step verification. Caregivers may only sign in on tablets an owner or admin has registered, which lock with a personal PIN. You'll tell us right away at hello@carehouseone.com if you suspect an account or tablet has been compromised.",
      },
      {
        type: "p",
        text: "2.3 Each person must have their own account. Sharing passwords or PINs is not allowed.",
      },
      {
        type: "h",
        text: "3. Fees, free trial and payment",
      },
      {
        type: "p",
        text: "3.1 Price: after the free trial, the days up to the end of your first billing cycle are charged pro rata at $49 per home per month. The next 3 billing cycles are $49 per home (the introductory price), and after that it's $99 per home per month. If your free trial ends on the 28th, your first billing cycle is a whole one and counts as the first of the 3. The price doesn't depend on the number of residents. An order form may set a different start date or number of introductory months. Prices are in US dollars and exclude taxes, which you pay where they apply.",
      },
      {
        type: "p",
        text: "3.2 Billing cycle: every customer is on the same monthly billing cycle, which runs from the 28th of one month to the 28th of the next (US Central time). Fees are billed in arrears: we email the invoice for a billing cycle the day after it ends, and it's due on the 5th of the following month.",
      },
      {
        type: "p",
        text: "3.3 How we count: each invoice is for the number of homes on your account on the day it's issued. Adding a home or a resident never requires our approval.",
      },
      {
        type: "p",
        text: "3.4 Free trial: subscriptions started online begin with a 30-day free trial. If you cancel by the end of the free trial, nothing is owed. Customers who sign an order form start on the date it sets instead.",
      },
      {
        type: "p",
        text: "3.5 Payment: PayPal collects each invoice automatically on its due date, from the card or PayPal balance on your subscription, unless we agree in an order form to bill you by PayPal invoice, which you pay by card or with PayPal by its due date. When you add a home, PayPal may ask you to approve the higher amount; until you do, PayPal collects the previous amount. There is no minimum term: the Service continues month to month until cancelled.",
      },
      {
        type: "p",
        text: "3.6 Price changes: the move from the introductory price to the regular price in 3.1 isn't a price change. For any other change, we'll give at least 30 days' notice by email before it takes effect.",
      },
      {
        type: "p",
        text: "3.7 Late payment: if a payment fails, we'll email the billing contacts and PayPal will try again. A payment not received by the 10th of the month it's due is late: we add a late fee of $35 for that invoice, sent as a separate PayPal invoice, and adding staff, registering tablets and changing settings are paused until the overdue amount is paid. Care records, the medication pass and the medication record are never locked because of non-payment.",
      },
      {
        type: "p",
        text: "3.8 Refunds: fees already paid are non-refundable, except where the law requires otherwise or where we end the Service without cause (section 9.3).",
      },
      {
        type: "h",
        text: "4. Your data",
      },
      {
        type: "p",
        text: '4.1 You own your data. Everything you and your staff put into the Service, including protected health information about residents ("Customer Data"), belongs to you. You give us permission to host, process and back up Customer Data only to provide and support the Service, as described in these Terms and the Business Associate Agreement.',
      },
      {
        type: "p",
        text: '4.2 HIPAA: our Business Associate Agreement (the "BAA", published at www.carehouseone.com/baa) is part of these Terms and applies to all protected health information in the Service. If these Terms and the BAA conflict about protected health information, the BAA wins.',
      },
      {
        type: "p",
        text: "4.3 No selling or advertising: we never sell Customer Data, never use it for advertising, and never use it to train artificial intelligence models.",
      },
      {
        type: "p",
        text: "4.4 Your responsibilities: you're responsible for the accuracy of what you record, for having the right to record it (including any consents your state requires), and for answering requests from residents and guardians about their records.",
      },
      {
        type: "p",
        text: "4.5 Export: owners and admins can print or save any resident's records as PDF at any time. On request we'll also provide a full export of your Customer Data in a common format at no charge.",
      },
      {
        type: "p",
        text: "4.6 Usage information: we may collect information about how the Service is used (for example page loads, errors and performance) to run and improve it. It never includes resident information, and we never share it in a way that identifies you.",
      },
      {
        type: "h",
        text: "5. Acceptable use",
      },
      {
        type: "p",
        text: "You won't, and won't let anyone else: use the Service to break the law or anyone's rights; try to get into accounts or data that aren't yours; probe, scan or test the Service's security without our written permission; interfere with or overload the Service; copy, resell or build a competing product from the Service; or put information into the public demo (demo.carehouseone.com) that relates to real people.",
      },
      {
        type: "h",
        text: "6. Security and availability",
      },
      {
        type: "p",
        text: "6.1 We protect the Service with administrative, physical and technical safeguards described in the BAA, including encryption in transit and at rest, role-based access, automatic sign-out and tablet locking, a tamper-proof audit log, and daily backups with point-in-time recovery.",
      },
      {
        type: "p",
        text: "6.2 The Service runs on Google Cloud in the United States. We aim for it to be available around the clock, but we don't promise uninterrupted service. We'll announce scheduled maintenance in advance where we can. Your homes should keep a paper downtime procedure for the medication pass.",
      },
      {
        type: "p",
        text: "6.3 Our current subprocessors are listed in the exhibit to the BAA. We'll give 30 days' notice before adding one that will handle protected health information.",
      },
      {
        type: "h",
        text: "7. Support",
      },
      {
        type: "p",
        text: "Email support at hello@carehouseone.com, Monday to Friday, 9 AM to 5 PM US Central time, except US federal holidays. We aim to respond within one business day.",
      },
      {
        type: "h",
        text: "8. Confidentiality",
      },
      {
        type: "p",
        text: "Each party will keep the other's non-public business information confidential and use it only for this relationship. Protected health information is governed by the BAA instead.",
      },
      {
        type: "h",
        text: "9. Term, cancellation and termination",
      },
      {
        type: "p",
        text: "9.1 Cancel any time: you can cancel at any time from PayPal or by emailing us. Cancellation takes effect at the end of the current billing cycle, and the Service keeps working until then. Because fees are billed in arrears, the invoice for that last billing cycle is still due and is issued on the usual date. PayPal no longer collects payments automatically after a cancellation, so we send that invoice, and any earlier invoice that's still unpaid, as a PayPal invoice, due on its usual due date. Section 3.7 applies to late payment of these invoices.",
      },
      {
        type: "p",
        text: "9.2 Ending for breach: either party may end these Terms if the other materially breaches them and doesn't fix the breach within 30 days of written notice. We may suspend access immediately if needed to stop a security threat or illegal use, and we'll tell you why.",
      },
      {
        type: "p",
        text: "9.3 Ending the Service: if we stop offering the Service, we'll give at least 90 days' notice and refund any prepaid fees for the time after it ends.",
      },
      {
        type: "p",
        text: "9.4 After it ends: your account becomes read-only for 60 days so you can export your records. Then we delete Customer Data, except copies in backups, which are deleted as the backups age out within 30 more days, and anything the law requires us to keep. The BAA's return and destruction terms also apply.",
      },
      {
        type: "h",
        text: "10. Warranties and disclaimers",
      },
      {
        type: "p",
        text: "10.1 We promise the Service will substantially work as described in our product documentation, and that we'll provide it with reasonable skill and care. If it doesn't, tell us and we'll fix it; if we can't, either party may end these Terms and we'll refund prepaid fees for the rest of the paid period.",
      },
      {
        type: "p",
        text: '10.2 Except as stated in these Terms, the Service is provided "as is". To the extent the law allows, we disclaim all other warranties, including merchantability, fitness for a particular purpose and non-infringement. We don\'t promise the Service will be error-free or that it will catch every medication or care error.',
      },
      {
        type: "h",
        text: "11. Limits of liability",
      },
      {
        type: "p",
        text: "11.1 Neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits or revenue, even if told they were possible.",
      },
      {
        type: "p",
        text: "11.2 Except as set out in 11.3 and 11.4, each party's total liability under these Terms is limited to the fees you paid in the 12 months before the event that caused the claim.",
      },
      {
        type: "p",
        text: "11.3 Each party's total liability for breaches of section 8 (Confidentiality) or of the BAA is limited to three times the fees you paid in the 12 months before the event that caused the claim.",
      },
      {
        type: "p",
        text: "11.4 No limit in this section applies to your payment obligations, to either party's indemnity obligations in section 12, or to a party's gross negligence, fraud or willful misconduct.",
      },
      {
        type: "h",
        text: "12. Indemnities",
      },
      {
        type: "p",
        text: "12.1 We'll defend you against third-party claims that the Service infringes their intellectual property, and pay what a court awards or we agree to settle, if you tell us promptly and let us control the defense.",
      },
      {
        type: "p",
        text: "12.2 You'll defend us against third-party claims arising from your care decisions, your use of the Service against these Terms, or Customer Data you didn't have the right to record, on the same conditions.",
      },
      {
        type: "h",
        text: "13. General",
      },
      {
        type: "p",
        text: "13.1 Changes to these Terms: we may update these Terms. We'll email owners at least 30 days before a material change takes effect; continuing to use the Service after that means you accept it. If you don't, you can cancel before it takes effect. A change never alters an order form you've already signed unless you agree in writing.",
      },
      {
        type: "p",
        text: "13.2 Governing law: these Terms are governed by the laws of the State of Texas, without regard to conflict-of-laws rules. Disputes go to the state or federal courts in Harris County, Texas, and both parties consent to those courts.",
      },
      {
        type: "p",
        text: "13.3 Notices: we send notices to the owner email addresses on your account. You send them to hello@carehouseone.com, with a copy by mail to HyFy Interactive LLC, 9898 Bissonnet St, Suite 368, Houston, TX 77036, for notices of breach or termination.",
      },
      {
        type: "p",
        text: "13.4 Other terms: neither party may assign these Terms without the other's consent, except to a successor of its whole business. Neither party is liable for delays caused by events beyond its reasonable control. If a provision can't be enforced, the rest still applies. Not enforcing a right isn't a waiver. CareHouse One is a product name of HyFy Interactive LLC. These Terms, the BAA and any order form signed under them are the whole agreement about the Service and replace earlier discussions; if an order form conflicts with these Terms, the order form controls.",
      },
    ],
  },
  {
    title: "Business Associate Agreement",
    blocks: [
      {
        type: "p",
        text: "Version 1.0 · November 13, 2026",
      },
      {
        type: "p",
        text: 'This Business Associate Agreement ("BAA") is between the Customer, as a covered entity or business associate ("Covered Entity"), and HyFy Interactive LLC, a Texas limited liability company that owns and operates CareHouse One ("Business Associate"). It is part of the CareHouse One Terms of Service (the "Agreement") and takes effect when the Customer accepts them. It applies whenever Business Associate creates, receives, maintains or transmits Protected Health Information for Covered Entity through the Service.',
      },
      {
        type: "h",
        text: "1. Definitions",
      },
      {
        type: "p",
        text: 'Capitalized terms not defined here (including Breach, Data Aggregation, Designated Record Set, Electronic Protected Health Information, Health Care Operations, Individual, Required by Law, Secretary, Security Incident, Subcontractor and Unsecured Protected Health Information) have the meanings in the HIPAA Rules, 45 CFR Parts 160 and 164. "Protected Health Information" or "PHI" means protected health information, as defined in 45 CFR 160.103, that Business Associate handles for Covered Entity. "HIPAA Rules" means the Privacy, Security, Breach Notification and Enforcement Rules at 45 CFR Parts 160 and 164, as amended.',
      },
      {
        type: "h",
        text: "2. Permitted uses and disclosures",
      },
      {
        type: "p",
        text: "Business Associate may use and disclose PHI only:",
      },
      {
        type: "li",
        text: "to provide the Service to Covered Entity under the Agreement;",
      },
      {
        type: "li",
        text: "as Required by Law;",
      },
      {
        type: "li",
        text: "for Business Associate's proper management and administration or to carry out its legal responsibilities, provided that any disclosure is Required by Law, or Business Associate gets reasonable written assurances from the recipient that it will keep the PHI confidential, use or further disclose it only as Required by Law or for the purpose it was disclosed, and report any breach of confidentiality it learns of;",
      },
      {
        type: "li",
        text: "to de-identify PHI under 45 CFR 164.514, solely to operate, secure and improve the Service. De-identified information is no longer PHI. Business Associate will not sell it or use it for advertising.",
      },
      {
        type: "p",
        text: "Business Associate will not use or disclose PHI in any way that would violate Subpart E of 45 CFR Part 164 if done by Covered Entity, will apply the minimum necessary standard, will not sell PHI, and will not use PHI for marketing or to train artificial intelligence models. Business Associate will not perform Data Aggregation services unless Covered Entity agrees in writing.",
      },
      {
        type: "h",
        text: "3. Safeguards",
      },
      {
        type: "p",
        text: "Business Associate will comply with Subpart C of 45 CFR Part 164 (the Security Rule) for Electronic PHI and will use appropriate administrative, physical and technical safeguards to prevent use or disclosure of PHI other than as this BAA allows. Its safeguards include:",
      },
      {
        type: "li",
        text: "a written security risk analysis, reviewed at least yearly, and security policies with workforce training;",
      },
      {
        type: "li",
        text: "encryption of PHI in transit (TLS) and at rest, hosting on Google Cloud in the United States under Google's Business Associate Addendum;",
      },
      {
        type: "li",
        text: "each customer's data walled off from every other customer's in the database (row-level security);",
      },
      {
        type: "li",
        text: "unique user accounts, role-based access, optional two-step verification, automatic sign-out after inactivity, and shared tablets that lock with a personal PIN and can be removed remotely;",
      },
      {
        type: "li",
        text: "an audit log of access and changes that cannot be edited or deleted through the Service;",
      },
      {
        type: "li",
        text: "daily backups kept for 30 days and point-in-time recovery for 7 days, with restores tested;",
      },
      {
        type: "li",
        text: "limiting Business Associate's own staff access to PHI to what is needed to provide support, at Covered Entity's request or to fix a problem.",
      },
      {
        type: "h",
        text: "4. Reporting",
      },
      {
        type: "p",
        text: "4.1 Breaches: Business Associate will notify Covered Entity of any Breach of Unsecured PHI without unreasonable delay, and in any case within 5 business days after discovering it. The notice will include, as far as known: the Individuals affected, what happened and when, the types of PHI involved, what Business Associate has done to investigate and limit harm, and a contact person. Business Associate will provide further information as it learns it and will reasonably help Covered Entity meet its own notification duties.",
      },
      {
        type: "p",
        text: "4.2 Other improper use or disclosure: Business Associate will report any use or disclosure of PHI not allowed by this BAA within 10 business days of discovering it.",
      },
      {
        type: "p",
        text: "4.3 Security Incidents: Business Associate will report successful Security Incidents within 10 business days of discovering them. This section is notice that unsuccessful attempts happen routinely (for example pings, port scans, blocked sign-in attempts and denial-of-service attempts that don't result in unauthorized access) and no further report of them is required.",
      },
      {
        type: "p",
        text: "4.4 Mitigation and costs: Business Associate will mitigate, as far as practicable, any harmful effect it knows of. Where a Breach results from Business Associate's or its Subcontractor's failure to meet this BAA, Business Associate will reimburse Covered Entity's reasonable costs of the notifications the law requires, subject to section 11.3 of the Terms.",
      },
      {
        type: "h",
        text: "5. Subcontractors",
      },
      {
        type: "p",
        text: "Business Associate will ensure that any Subcontractor that creates, receives, maintains or transmits PHI for it agrees in writing to the same restrictions and conditions that apply to Business Associate, including the Security Rule. The current list is in the exhibit. Business Associate will give Covered Entity 30 days' notice before adding a Subcontractor that will handle PHI.",
      },
      {
        type: "h",
        text: "6. Individuals' rights",
      },
      {
        type: "p",
        text: "6.1 Access: Covered Entity can view, print and export any resident's records in the Service at any time, which lets it respond to requests under 45 CFR 164.524. If an Individual asks Business Associate directly, it will forward the request to Covered Entity within 5 business days.",
      },
      {
        type: "p",
        text: "6.2 Amendment: Covered Entity's authorized users can add corrections through the Service (records like progress notes and incident reports are corrected by addendum, not overwritten, to keep the original). Business Associate will help make amendments Covered Entity directs under 45 CFR 164.526.",
      },
      {
        type: "p",
        text: "6.3 Accounting of disclosures: Business Associate will keep the information needed for Covered Entity to give an accounting of disclosures under 45 CFR 164.528 and provide it within 15 business days of a request.",
      },
      {
        type: "p",
        text: "6.4 Covered Entity's obligations: to the extent Business Associate carries out an obligation of Covered Entity under Subpart E of 45 CFR Part 164, it will follow the requirements that apply to Covered Entity for that obligation.",
      },
      {
        type: "h",
        text: "7. Books and records",
      },
      {
        type: "p",
        text: "Business Associate will make its internal practices, books and records relating to PHI available to the Secretary to determine compliance with the HIPAA Rules.",
      },
      {
        type: "h",
        text: "8. Covered Entity's obligations",
      },
      {
        type: "p",
        text: "Covered Entity will: tell Business Associate of any limitation in its notice of privacy practices, any change in or revocation of an Individual's permission, or any restriction it agrees to, to the extent it affects Business Associate's use or disclosure of PHI; not ask Business Associate to use or disclose PHI in a way not allowed under the HIPAA Rules if done by Covered Entity; and put into the Service only the PHI needed for the care and records the Service supports.",
      },
      {
        type: "h",
        text: "9. Term and termination",
      },
      {
        type: "p",
        text: "9.1 This BAA lasts as long as the Agreement and then until all PHI is returned or destroyed under section 9.3.",
      },
      {
        type: "p",
        text: "9.2 If either party learns that the other has materially breached this BAA, it may give written notice and a 30-day opportunity to cure. If the breach isn't cured, the non-breaching party may end the Agreement and this BAA. If cure isn't possible, it may end them immediately.",
      },
      {
        type: "p",
        text: "9.3 Return or destruction: when the Agreement ends, Business Associate will keep the Covered Entity's account available read-only for 60 days so Covered Entity can export its records, then destroy all PHI, including PHI held by Subcontractors. Copies in backups are destroyed as the backups age out, within 30 more days. Business Associate will confirm destruction in writing on request. If returning or destroying some PHI isn't feasible (for example, where a law requires keeping it), Business Associate will tell Covered Entity why, keep protecting it under this BAA, and limit further use and disclosure to the reasons that make return or destruction infeasible.",
      },
      {
        type: "h",
        text: "10. Miscellaneous",
      },
      {
        type: "p",
        text: "10.1 Amendment: the parties will amend this BAA as needed to comply with changes to the HIPAA Rules. Business Associate may update this BAA to reflect such changes with 30 days' notice.",
      },
      {
        type: "p",
        text: "10.2 Interpretation: any ambiguity is resolved to permit compliance with the HIPAA Rules. If this BAA conflicts with the Agreement about PHI, this BAA controls.",
      },
      {
        type: "p",
        text: "10.3 Survival: the obligations in sections 4, 7 and 9.3 survive termination.",
      },
      {
        type: "p",
        text: "10.4 No third-party beneficiaries: nothing in this BAA gives rights to anyone other than the parties.",
      },
      {
        type: "p",
        text: "10.5 State law: where state law about health records or privacy is more protective than HIPAA, Business Associate will comply with it as it applies to the Service, including, for Customers in Texas, Chapter 181 of the Texas Health and Safety Code (the Texas Medical Records Privacy Act) and Section 521.053 of the Texas Business and Commerce Code.",
      },
      {
        type: "p",
        text: "10.6 Notices: notices under this BAA go to the addresses in section 13.3 of the Terms.",
      },
    ],
  },
  {
    title: "Exhibit: subprocessors",
    blocks: [
      {
        type: "p",
        text: "Only Google Cloud stores or handles PHI; the others see business contact details or nothing personal at all.",
      },
      {
        type: "table",
        rows: [
          [
            "Service",
            "What it does for us",
            "What it sees",
            "PHI?",
            "Agreement",
          ],
          [
            "Google Cloud (Cloud Run, Cloud SQL, Secret Manager, Cloud Logging), us-central1 (Iowa, USA)",
            "Runs the app, stores the database and its backups",
            "All Customer Data, encrypted at rest",
            "Yes",
            "Google Cloud Business Associate Addendum",
          ],
          [
            "Resend",
            "Sends account emails: invitations, password resets, billing and trial notices, alerts that an incident report was filed",
            "Staff names and email addresses, and the home's name; never resident names or health details",
            "No",
            "Resend terms and data processing addendum",
          ],
          [
            "PayPal",
            "Takes subscription and invoice payments",
            "Organization name, billing contact, amounts billed",
            "No",
            "PayPal user agreement",
          ],
          [
            "Cloudflare",
            "DNS for carehouseone.com (app traffic goes directly to Google Cloud, not through Cloudflare)",
            "Nothing from the app",
            "No",
            "Cloudflare terms",
          ],
          [
            "Have I Been Pwned",
            "Checks new passwords against known breached passwords",
            "The first 5 characters of a password's SHA-1 hash; never the password or who it belongs to",
            "No",
            "Public service, no account",
          ],
        ],
      },
    ],
  },
];

/** True while the text hasn't been reviewed by a lawyer, or still has blanks in [brackets]. */
export const contractIsDraft = () =>
  !CONTRACT_REVIEWED || JSON.stringify(CONTRACT_TERMS).includes("[");
