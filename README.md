# CareHouse One

Care management for group homes: medications (eMAR), diagnoses, vitals, progress notes, shift sign-in and staff, on a shared tablet for caregivers and a web app for nurses, managers and owners.

## Repository

| Folder | What's in it |
| --- | --- |
| `web/` | The application (Next.js, TypeScript, PostgreSQL). See [web/README.md](web/README.md). |
| `prototype/` | The clickable HTML prototypes and the original UX spec page. Sample data only. |
| `deploy/` | Google Cloud setup script and the production runbook. |
| `.github/workflows/` | CI on every push; `Deploy` (manual) builds and deploys to Cloud Run. |

The build specification lives in Claude Docs ("CareHouse One · Build Specification v1").

## Status

Built so far:

1. **Foundation:** sign-in with required two-step verification, sessions and idle timeout, password reset, staff invitations, deactivation and reactivation, tenant isolation with PostgreSQL row-level security, append-only audit log.
2. **Medications:** residents, medication orders with allergy and duplicate checks, the medication pass with hard stops, as-needed doses with follow-ups, monthly medication record. Resident check is two identifiers or a wristband scan (organization setting).
3. **Care records:** vital signs with out-of-range flags and nurse review, progress notes with addenda, shift sign-in and sign-out, ICD-10-CM diagnoses with history. Caregivers get a four-item menu for the shared tablet.

4. **Owner view and tablets:** a dashboard card per home (today's medications, late doses, overdue follow-ups, readings to review, notes, who's on shift, tablet last used). Registered home tablets: shift sign-in only works on one, a personal PIN unlocks it, it locks after 2 minutes idle. Offline mode: installable app, offline banner, and an encrypted on-tablet queue for vital signs and progress notes that syncs without duplicates. Medications are not recorded offline.

5. **Production readiness (in progress):** Docker image and Cloud Run deployment (manual GitHub workflow with keyless sign-in), Cloud SQL with backups and point-in-time recovery, secrets in Secret Manager, migrations at startup, SMTP email with retries, per-IP rate limits, Content Security Policy, breached-password check, health check, and a script to create a customer organization. See [deploy/README.md](deploy/README.md).

6. **Public site and sign-up:** landing page and pricing at www.carehouseone.com ($50 per resident per month, 30-day free trial), demo requests, PayPal Subscriptions with webhooks and a monthly resident count, self-service organization setup, a billing card in Settings, and admin features pausing 14 days after a failed payment (care records never). Sign-up stays closed (`SIGNUP_OPEN`) until the Terms and BAA are final; see runbook step 9.

Next: the dry run, compliance foundation, and the security and clinical reviews.

**No real resident information may be entered until the production checklist in the build spec is complete** (BAAs signed, security review, backups verified).
