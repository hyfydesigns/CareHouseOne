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

export const CONTRACT_VERSION = "Version 1.3 of November 14, 2026";

/** False until a lawyer has reviewed the text (scripts/contract-text.ts). */
export const CONTRACT_REVIEWED = true;

export const CONTRACT_TERMS: ContractPart[] = [
  {
    title: "Terms of Service",
    blocks: [
      {
        type: "p",
        text: "Version 1.3 · November 14, 2026",
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
        text: "1.1 CareHouse One provides web-based recordkeeping tools to group homes, assisted-living providers and other healthcare organizations, including medication orders and administration records, vital signs, progress notes, incident reports, appointments, diagnoses, shift sign-in, safety checks, staff training, onboarding forms and related functions (the “Service”). Features are available only to the extent enabled in Customer’s subscription and configuration. HyFy may improve features over time and will provide at least 60 days’ advance notice before discontinuing a core recordkeeping function during an active subscription, except when immediate action is necessary for security or legal compliance.",
      },
      {
        type: "p",
        text: "1.2 The Service is a recordkeeping tool, not a medical device and not medical advice. Safety checks in the Service (for example allergy warnings, blood pressure holds and dose timing) are aids. Your staff and your licensed professionals remain responsible for every care decision, for following prescriber orders and your state's rules, and for verifying what they record.",
      },
      {
        type: "p",
        text: "1.3 The Service is offered to organizations for professional use in the United States, including group homes, assisted-living providers and other healthcare organizations, and not directly to consumers. Customer is responsible for determining whether its use and care setting are permitted under applicable licensing, retention, privacy and professional requirements. No representation is made that every feature is suitable or licensed for every setting or state.",
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
        text: "2.2 Multi-factor or two-step authentication is not currently offered for owner or admin accounts. Customer must use unique, strong credentials, restrict privileged access, promptly remove departed users, and secure and monitor authorized tablets. Where configured, caregiver tablets lock with a personal PIN. Customer will promptly report suspected compromise to hello@carehouseone.com. HyFy may introduce stronger authentication after providing relevant implementation notice; nothing here represents it as currently available.",
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
        text: "3.1 Price: Online subscriptions have a 30-day free trial under section 3.4. After the trial, any partial billing cycle is prorated at $49 per active home per month based on the actual days of that billing cycle. The following three full billing cycles are $49 per home per cycle (introductory price); thereafter, the regular rate is $99 per home per cycle. A full cycle beginning immediately after trial expiration counts as the first introductory cycle. An order form may specify different prices, dates, trial terms or introductory cycles. Prices are in US dollars and exclude applicable taxes.",
      },
      {
        type: "p",
        text: "3.2 Billing cycle: Each cycle begins at 12:00 a.m. Central time on the 28th of a month and ends immediately before 12:00 a.m. Central time on the 28th of the next month. Fees are billed in arrears. HyFy issues the invoice on the calendar day following the end of the cycle, with payment due on the next occurring 5th calendar day. If an invoice is issued on the 29th, 30th or 31st, it is due on the 5th of the following month. HyFy will specify the service dates, home count, and rate on each invoice.",
      },
      {
        type: "p",
        text: "3.3 How homes are counted: Each invoice is for the number of homes on Customer’s account on the day the invoice is issued, at the per-home rate for that billing cycle. Homes added or removed during a billing cycle are not prorated by the day; the only prorated period is the first partial billing cycle described in section 3.1. A home removed before an invoice is issued is not billed on that invoice. A home’s rate follows the applicable Customer introductory or regular pricing phase unless an order form specifies otherwise. Resident counts do not affect fees, and adding a home or a resident never requires HyFy’s approval.",
      },
      {
        type: "p",
        text: "3.4 Free trial: Online subscriptions begin with a 30-day free trial measured from activation. Cancellation before the trial expires incurs no subscription fee. Order-form customers begin on the start date stated in their order form. A trial does not authorize the use of the Service with PHI before the BAA has been accepted and required safeguards are operational.",
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
        text: "3.7 Late payment: If payment fails, HyFy will notify billing contacts and may retry collection. An unpaid invoice is late on the 10th calendar day of the month in which it was due. HyFy may assess one $35 late fee per overdue invoice, to the extent permitted by applicable law and if disclosed in the invoice or order form, and pause nonclinical administrative features after notice. HyFy will not disable access to existing care records, medication administration, emergency exports, or the ability to obtain a copy of Customer Data solely for nonpayment during the normal service term. HyFy may ultimately terminate for material nonpayment under section 9.2, subject to the continuity and export obligations in sections 9.4 and 9.5.",
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
        text: "4.1 Customer Data: As between the parties, Customer retains all rights it has in data submitted to or created through the Service, including resident PHI. HyFy receives a limited right to host, process, transmit, secure, back up, and support Customer Data solely as required to provide the Service, meet legal obligations, and as expressly permitted by the BAA. This provision does not determine who owns an individual’s medical record under applicable law.",
      },
      {
        type: "p",
        text: "4.2 HIPAA: The attached Business Associate Agreement (BAA) is incorporated into these Terms and applies to PHI that HyFy creates, receives, maintains or transmits on behalf of Customer in a HIPAA-covered relationship. The BAA governs in the event of conflict concerning PHI. Customers not subject to HIPAA remain subject to applicable state privacy and health-record laws and the data-protection terms of these Terms; whether a particular customer is a covered entity, business associate, or neither must be evaluated separately.",
      },
      {
        type: "p",
        text: "4.3 No commercialization or model training: HyFy will not sell Customer Data or PHI; use Customer Data or PHI for advertising, marketing, or training artificial intelligence models; or create de-identified datasets from PHI for product improvement, analytics, resale, research, or any other secondary purpose. Operational processing strictly necessary to host, secure, troubleshoot, back up, and provide the Service remains permitted under the BAA.",
      },
      {
        type: "p",
        text: "4.4 Your responsibilities: you're responsible for the accuracy of what you record, for having the right to record it (including any consents your state requires), and for answering requests from residents and guardians about their records.",
      },
      {
        type: "p",
        text: "4.5 Export: Authorized owners and admins can download Customer Data in machine-readable formats supported by the Service and may print or save resident records as PDF. Upon verified written request, HyFy will provide a full, reasonably structured, machine-readable export of Customer Data without a separate export fee within 15 business days where reasonably feasible. Exports will be provided through an appropriately secure channel and may include separate files for documents or images not naturally represented as structured data.",
      },
      {
        type: "p",
        text: "4.6 Operational telemetry: HyFy may process the minimum service telemetry necessary to operate, monitor, secure, debug and support the Service, subject to the BAA where that information constitutes PHI. HyFy will not de-identify PHI for internal analytics or product improvement and will not publish Customer-identifiable usage metrics without Customer’s written permission.",
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
        text: "6.1 HyFy will maintain the administrative, physical, and technical safeguards required by applicable law and this BAA. HyFy confirms that its Google Cloud BAA and documented security controls are in place; specific deployment details and ongoing control effectiveness remain subject to periodic validation. No technical control is guaranteed to eliminate all risk. Multi-factor authentication is not currently implemented and is not represented as a safeguard.",
      },
      {
        type: "p",
        text: "6.2 HyFy hosts the Service on Google Cloud in the United States under its confirmed Business Associate Addendum and documented security program. HyFy aims for continuous availability but does not guarantee uninterrupted service or a specific uptime percentage. It will provide advance notice of scheduled maintenance when practicable and prompt notice of material unscheduled outages. Customer must maintain clinically appropriate downtime and record-reconciliation procedures, especially for medication administration.",
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
        text: "8. Confidentiality: Each party will protect the other party’s nonpublic business information using reasonable care, no less than the care used for its own similarly sensitive information, and will disclose it only to persons with a need to know who are bound by appropriate confidentiality duties. Exceptions apply to information that becomes public without breach, was already lawfully known, is independently developed, or is lawfully obtained from another source. Required legal disclosures are permitted with advance notice where legally allowed. PHI remains subject to the BAA.",
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
        text: "9.2 Ending for breach: Either party may terminate for a material breach not cured within 30 days after written notice describing the breach. HyFy may temporarily suspend specific affected functionality only to the extent reasonably necessary to address an imminent security threat or illegal use, with prompt explanation unless prohibited by law. HyFy will preserve records and provide safe export access where reasonably possible. A material BAA breach is also subject to the BAA’s termination provisions.",
      },
      {
        type: "p",
        text: "9.3 Ending the Service: if we stop offering the Service, we'll give at least 90 days' notice and refund any prepaid fees for the time after it ends.",
      },
      {
        type: "p",
        text: "9.4 After termination: The account will ordinarily remain read-only for 60 days to enable secure export; the parties may agree to a shorter or longer period in writing. HyFy will then delete active Customer Data and cause PHI-bearing subcontractors to do the same, subject to applicable retention obligations and the BAA. Backup copies will expire within the stated 30-day backup retention schedule after the active deletion date, provided that this schedule has been verified. Where destruction is infeasible or legally prohibited, HyFy will continue to protect retained PHI and restrict further uses and disclosures as the BAA requires.",
      },
      {
        type: "p",
        text: "9.5 Care continuity: Customer is responsible for record-retention requirements, downtime processes, and maintaining independent copies needed for resident safety. HyFy will not intentionally withhold available records as leverage in a payment dispute. If read-only access presents a documented security risk, the parties will use a safe alternative export process.",
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
        text: "11.1 Subject to sections 11.3 and 11.4 and to the fullest extent permitted by law, neither party is liable to the other for lost profits, lost business opportunities, or indirect, incidental, special, consequential or punitive damages. This exclusion does not eliminate payment for expressly covered third-party notification costs under the BAA or any liability that cannot legally be excluded.",
      },
      {
        type: "p",
        text: "11.2 Except as provided in sections 11.3 and 11.4, each party’s total aggregate contractual liability arising from the Service and these Terms is limited to the fees actually paid by Customer to HyFy for the Service in the 12 months preceding the first event giving rise to the claim. No minimum dollar floor applies. The cap is aggregate for all claims, not per claim. If no fees were paid, this cap may be zero to the extent enforceable by law.",
      },
      {
        type: "p",
        text: "11.3 Each party’s total aggregate contractual liability for breach of section 8 or this BAA, including reimbursement of notification costs under BAA section 4.4, is limited to two times the fees actually paid by Customer during the 12 months preceding the first event giving rise to the claim. This cap does not restrict statutory regulator authority or liabilities that applicable law prohibits limiting.",
      },
      {
        type: "p",
        text: "11.4 Nothing in this section limits Customer’s obligation to pay amounts lawfully due, a party’s fraud or willful misconduct, or a liability that cannot be limited under applicable law. Indemnity obligations under section 12 are subject to the applicable caps in sections 11.2 and 11.3 unless expressly amended by a signed order form.",
      },
      {
        type: "h",
        text: "12. Indemnities",
      },
      {
        type: "p",
        text: "12.1 HyFy will defend Customer from third-party claims alleging that the unmodified Service, used as authorized, infringes a United States patent, copyright or trade secret, and pay damages finally awarded or settlements it approves. HyFy has no obligation to the extent a claim arises from Customer Data, unauthorized modifications, combinations not supplied by HyFy, or use after HyFy offers a non-infringing replacement. If a claim is likely, HyFy may procure continued use, modify or replace the affected Service, or terminate the affected feature with a proportionate refund of any prepaid unused fees.",
      },
      {
        type: "p",
        text: "12.2 Customer will defend HyFy against third-party claims to the extent arising from Customer’s clinical and care decisions, unlawful or unauthorized Customer Data, or material misuse of the Service, excluding claims caused by HyFy’s own breach, negligence or misconduct. For all indemnities, the protected party must give reasonably prompt notice, allow the defending party control of defense with competent counsel, and reasonably cooperate at the defending party’s expense. No settlement may admit liability or impose a nonmonetary obligation on the protected party without its written consent.",
      },
      {
        type: "h",
        text: "13. General",
      },
      {
        type: "p",
        text: "13.1 Changes to these Terms: HyFy may change these Terms prospectively by providing at least 30 days’ notice of a material change to the registered owner’s email. Material changes to privacy protections, liability limits, fees, dispute procedures, or the BAA require affirmative acceptance before applying to an existing Customer, except modifications legally required to maintain compliance. Continued use alone will not amend an existing signed order form or retroactively waive accrued claims. If Customer rejects a proposed change, the then-current Terms govern until cancellation or a mutually agreed transition.",
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
        text: "13.4 Other terms: Neither party may assign these Terms without the other’s consent, except to a successor to substantially all of its relevant business that assumes these obligations and does not reduce PHI protections. Neither party is liable for delays from events beyond reasonable control, except payment due and reasonable obligations to safeguard Customer Data. Invalid provisions are severed; failure to enforce is not waiver. HyFy may use the CareHouse One product name. These Terms, the BAA and signed order forms comprise the entire agreement. Order forms control commercial terms where expressly inconsistent; the BAA always controls as to PHI and legally required safeguards, notwithstanding any order-form language.",
      },
    ],
  },
  {
    title: "Business Associate Agreement",
    blocks: [
      {
        type: "p",
        text: "Version 1.3 · November 14, 2026",
      },
      {
        type: "p",
        text: "This Business Associate Agreement (“BAA”) is between HyFy Interactive LLC (“Business Associate”) and the customer accepting the CareHouse One Terms (“Customer”). If Customer is a HIPAA covered entity, Customer is the “Covered Entity” for this BAA. If Customer acts as a business associate for another covered entity, Customer is an “Upstream Business Associate,” and HyFy is its subcontractor business associate; references below to “Covered Entity” include that Upstream Business Associate solely for purposes of the parties’ obligations under this BAA. This BAA applies only to PHI that HyFy creates, receives, maintains or transmits for Customer and is effective when the Customer accepts the Terms and this BAA.",
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
        text: "Business Associate is not authorized to de-identify PHI or create or retain de-identified datasets from PHI for product analytics, research, training, resale, or product improvement. A separately signed written amendment approved by Customer would be required before any such activity; nothing in the Terms or this BAA grants that permission.",
      },
      {
        type: "p",
        text: "Business Associate will not use or disclose PHI in a manner that would violate Subpart E of 45 CFR Part 164 if done by Covered Entity, except for uses and disclosures expressly permitted for its own management and administration under this section. Business Associate will apply the minimum-necessary standard where applicable, consistent with Customer’s communicated restrictions. PHI may not be sold, used for marketing, used to train artificial intelligence models, or de-identified for secondary use. Data Aggregation services are not authorized without prior written agreement.",
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
        text: "encryption of PHI in transit (TLS) and at rest, with Google Cloud hosting in the United States and a confirmed Google Cloud Business Associate Addendum;",
      },
      {
        type: "li",
        text: "logical isolation of each Customer’s data from other Customers, including database row-level security if this has been implemented and verified;",
      },
      {
        type: "li",
        text: "unique user accounts, role-based access, session timeout, and registered caregiver tablets with personal PIN locking where configured. Multi-factor authentication is not currently implemented and is not a claimed security control;",
      },
      {
        type: "li",
        text: "audit logs designed to detect and deter unauthorized access or alteration and protected against ordinary users editing or deleting log entries;",
      },
      {
        type: "li",
        text: "daily backups with a stated target retention of 30 days and point-in-time recovery target of 7 days, subject to periodic restore testing and documented recovery procedures;",
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
        text: "4.1 Breaches: Business Associate will notify Customer without unreasonable delay and in any event within five business days after discovery of a Breach of Unsecured PHI. It will provide information available at the time, including affected individuals where known, incident timing, categories of PHI, containment and mitigation measures, and a response contact, with supplemental updates as facts become known. Where law requires a shorter period, that shorter period applies. Customer generally remains responsible for notices to individuals, regulators and media unless the parties expressly allocate those tasks in writing.",
      },
      {
        type: "p",
        text: "4.2 Other improper use or disclosure: Business Associate will report any use or disclosure of PHI not allowed by this BAA within 10 business days of discovering it.",
      },
      {
        type: "p",
        text: "4.3 Security Incidents: Business Associate will report successful Security Incidents involving Customer PHI within 10 business days of discovery, or sooner if they qualify as reportable Breaches. The parties acknowledge that routine unsuccessful attacks (such as blocked scans and denied logins) occur continually; this paragraph constitutes ongoing notice of those attempts, provided they have not resulted in unauthorized access, use, disclosure, modification or destruction of PHI or material interference with the Service.",
      },
      {
        type: "p",
        text: "4.4 Mitigation and costs: Business Associate will take reasonable steps to mitigate known harmful effects of an impermissible use or disclosure. To the extent a Breach is caused by Business Associate’s or its Subcontractor’s failure to comply with this BAA, Business Associate will reimburse Customer for reasonable, documented costs of notifications that law requires Customer to provide, subject to the cap in Terms section 11.3. The parties will cooperate in investigating and documenting the incident, including any risk assessment. Credit monitoring, forensic consulting and regulatory defense costs are not included unless agreed in writing or required by law.",
      },
      {
        type: "h",
        text: "5. Subcontractors",
      },
      {
        type: "p",
        text: "Business Associate will ensure that each Subcontractor that creates, receives, maintains or transmits PHI for it enters a written BAA with substantially the same applicable restrictions, conditions, and Security Rule obligations before PHI is made available. The exhibit lists current relevant providers based on presently understood data flows. Business Associate will notify Customer at least 30 days before introducing a new PHI-handling Subcontractor, except an emergency replacement needed for security or continuity, in which case it will notify Customer as soon as practicable. Business Associate remains responsible for subcontractor compliance with its obligations under this BAA.",
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
        text: "9.3 Return or destruction: After termination, Business Associate will preserve read-only access for up to 60 days for secure export, unless a different arrangement is required by law or agreed in writing. After that period, it will return or destroy PHI retained for Customer (including by PHI-bearing Subcontractors) and confirm destruction upon written request. Backup copies will be deleted as they expire under a verified 30-day retention schedule; until then they remain protected and are not restored for ordinary operations. If return or destruction is infeasible, Business Associate will document the reason, notify Customer, maintain the required protections, and limit further use and disclosure to the reason for retention. This does not relieve Customer of independent medical-record retention duties.",
      },
      {
        type: "h",
        text: "10. Miscellaneous",
      },
      {
        type: "p",
        text: "10.1 Amendment: The parties will amend this BAA when necessary to comply with applicable HIPAA Rules. HyFy may propose legally required amendments with advance notice where practicable, but a material nonmandatory change to the allocation of privacy rights or duties requires affirmative agreement. Nothing here permits unilateral reduction of protections required by law.",
      },
      {
        type: "p",
        text: "10.2 Interpretation: any ambiguity is resolved to permit compliance with the HIPAA Rules. If this BAA conflicts with the Agreement about PHI, this BAA controls.",
      },
      {
        type: "p",
        text: "10.3 Survival: Obligations concerning reporting, confidentiality, retained PHI, access to records by the Secretary, return or destruction, and any other provisions intended by nature to survive continue for as long as applicable PHI is retained or obligations remain outstanding.",
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
        text: "Current subprocessor summary: Google Cloud hosts and processes PHI under a confirmed Business Associate Addendum. When an incident report is filed, CareHouse One emails the Customer’s active owners and admins a short alert to review it; the alert contains no resident names or incident details. Other service providers are used for operational email, billing, DNS or password checks; verify all templates, metadata, access logs, and actual transmission paths before concluding that no PHI reaches those providers. Any new PHI-processing subprocessor requires an appropriate written BAA in advance.",
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
            "Sends account invitations, password resets, billing and trial notices, and alerts that an incident report was filed (without resident names or incident details)",
            "Business emails, staff names and organizational information; no resident details intended",
            "Not intended; verify templates and logs",
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
            "Verify app traffic and log flows",
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
