# CareHouse One

Care management for group homes: medications (eMAR), diagnoses, vitals, progress notes, shift sign-in and staff, on a shared tablet for caregivers and a web app for nurses, managers and owners.

## Repository

| Folder | What's in it |
| --- | --- |
| `web/` | The application (Next.js, TypeScript, PostgreSQL). See [web/README.md](web/README.md). |
| `prototype/` | The clickable HTML prototypes and the original UX spec page. Sample data only. |
| `.github/workflows/` | CI: lint, type-check, tests and build on every push. |

The build specification lives in Claude Docs ("CareHouse One · Build Specification v1").

## Status

Built so far:

1. **Foundation:** sign-in with required two-step verification, sessions and idle timeout, password reset, staff invitations, deactivation and reactivation, tenant isolation with PostgreSQL row-level security, append-only audit log.
2. **Medications:** residents, medication orders with allergy and duplicate checks, the medication pass with hard stops, as-needed doses with follow-ups, monthly medication record. Resident check is two identifiers or a wristband scan (organization setting).
3. **Care records:** vital signs with out-of-range flags and nurse review, progress notes with addenda, shift sign-in and sign-out, ICD-10-CM diagnoses with history. Caregivers get a four-item menu for the shared tablet.

Next: owner dashboard across homes, offline mode and tablet polish, then Google Cloud deployment and reviews.

**No real resident information may be entered until the production checklist in the build spec is complete** (BAAs signed, security review, backups verified).
