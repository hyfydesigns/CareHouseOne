/**
 * A starter list of allergy families and the drug names that belong to them. It catches common
 * conflicts by name; it is not a drug-interaction database. Clinical review should extend it, and
 * production should consider a licensed drug database.
 */
const FAMILIES: Record<string, string[]> = {
  penicillin: ["penicillin", "amoxicillin", "ampicillin", "augmentin", "piperacillin", "dicloxacillin", "nafcillin"],
  amoxicillin: ["amoxicillin", "augmentin"],
  sulfa: ["sulfa", "sulfamethoxazole", "bactrim", "septra", "sulfasalazine"],
  cephalosporin: ["cephalexin", "keflex", "cefdinir", "ceftriaxone", "cefuroxime", "cefazolin"],
  codeine: ["codeine", "tylenol #3", "tylenol with codeine"],
  opioid: ["codeine", "morphine", "oxycodone", "hydrocodone", "tramadol", "hydromorphone", "fentanyl"],
  aspirin: ["aspirin", "acetylsalicylic"],
  nsaid: ["ibuprofen", "advil", "motrin", "naproxen", "aleve", "aspirin", "diclofenac", "meloxicam", "celecoxib"],
  ibuprofen: ["ibuprofen", "advil", "motrin"],
  naproxen: ["naproxen", "aleve"],
  acetaminophen: ["acetaminophen", "tylenol", "paracetamol"],
  tetracycline: ["tetracycline", "doxycycline", "minocycline"],
  macrolide: ["erythromycin", "azithromycin", "zithromax", "clarithromycin"],
  fluoroquinolone: ["ciprofloxacin", "cipro", "levofloxacin", "levaquin", "moxifloxacin"],
  statin: ["atorvastatin", "lipitor", "simvastatin", "rosuvastatin", "crestor", "pravastatin"],
  "ace inhibitor": ["lisinopril", "enalapril", "ramipril", "benazepril", "captopril"],
  latex: [],
};

/** Returns the allergy entry that conflicts with this medication name, if any. */
export function allergyConflict(allergies: string[], medicationName: string): string | null {
  const med = medicationName.toLowerCase();
  for (const raw of allergies) {
    const a = raw.toLowerCase();
    const key = Object.keys(FAMILIES).find((k) => a.includes(k));
    const names = key ? [...FAMILIES[key], key] : [a.split(/[\s(,]/)[0]];
    if (names.some((n) => n.length >= 3 && med.includes(n))) return raw;
  }
  return null;
}
