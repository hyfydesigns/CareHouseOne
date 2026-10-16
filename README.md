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

Stage 1 (foundation) is built: sign-in with required two-step verification, sessions and idle timeout, password reset, staff invitations, deactivation and reactivation, tenant isolation with PostgreSQL row-level security, and an append-only audit log.

Next stages: residents and medications (orders, the safe medication pass, PRN and follow-ups), then vitals, progress notes, shift sign-in/out and ICD-10-CM diagnoses, then the owner dashboard, offline mode and Google Cloud deployment.

**No real resident information may be entered until the production checklist in the build spec is complete** (BAAs signed, security review, backups verified).
