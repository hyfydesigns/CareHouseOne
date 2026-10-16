# Deploying CareHouse One to Google Cloud

This is the runbook for production. Every step is done by the developer. **No real resident data until the build spec's production plan step 1 (compliance foundation) and step 4 (testing, including a restore test) are complete.**

## What runs where

| Piece | Google Cloud service | Notes |
| --- | --- | --- |
| Web app | Cloud Run `carehouse-one` | Docker image from `web/Dockerfile`. Scales to zero; at most 3 instances. Applies database migrations when a new revision starts. |
| Database | Cloud SQL for PostgreSQL 17 `carehouse-db` | Daily backups kept 30 days, point-in-time recovery for 7 days, encrypted connections only, deletion protection. Reached through the Cloud SQL connector, never an open port. |
| Secrets | Secret Manager | `database-url`, `data-encryption-key`, `cron-secret`, `smtp-url` (optional). Only the runtime service account can read them. |
| Images | Artifact Registry `carehouse` | Tagged with the git commit. |
| Housekeeping | Cloud Scheduler `carehouse-cron` | Every 5 minutes: retries unsent emails, clears old rate-limit counters. |
| Deploys | GitHub Actions `Deploy` workflow | Manual. Signs in to Google with Workload Identity Federation (no keys), only from `main` of this repository. |

Logs go to Cloud Logging. The app never logs request bodies, resident details, or email links.

## 1. Before anything else

1. Create a Google Cloud organization (through Cloud Identity or Google Workspace) and a project, for example `carehouse-one-prod`. Link billing.
2. **Accept Google Cloud's Business Associate Agreement** for the organization (Google Cloud console > IAM & Admin > Settings or your account team; see Google's "HIPAA compliance on Google Cloud" page). Check that every service in the table above is on Google's list of covered services at the time you sign.
3. Turn on 2-step verification for every Google account with access to the project. Give access to as few people as possible.

## 2. One-time setup

Open Cloud Shell in the project (it has `gcloud` signed in) and run:

```bash
git clone https://github.com/hyfydesigns/CareHouseOne.git && cd CareHouseOne
PROJECT_ID=carehouse-one-prod bash deploy/setup.sh
```

Options (environment variables): `REGION` (default `us-central1`), `DB_TIER` (default `db-g1-small`), `APP_URL` (default: the Cloud Run address, which is predictable). If you already have email settings, pass `SMTP_URL` too (see step 3).

The script generates the database password, the encryption key and the cron secret directly into Secret Manager. It prints the values to set as **GitHub repository variables** (Settings > Secrets and variables > Actions > Variables). None of them are secrets.

Then in GitHub: Settings > Environments > New environment `production`, and add yourself as a required reviewer, so every deploy waits for your click.

**Keep `data-encryption-key` safe.** It encrypts two-step verification keys in the database. If it's lost, every user has to set up two-step verification again. Don't delete old versions of the secret.

## 3. Email for invitations and password resets

The emails only contain links, never resident details, so the provider doesn't need a BAA. Any SMTP provider works (Postmark, SendGrid, Amazon SES, Google Workspace SMTP relay). Set up SPF and DKIM for your sending domain with the provider, then:

```bash
printf '%s' 'smtps://USERNAME:PASSWORD@smtp.provider.com:465' | gcloud secrets create smtp-url --data-file=-
gcloud secrets add-iam-policy-binding smtp-url --member="serviceAccount:carehouse-run@PROJECT_ID.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
```

Set the GitHub variables `SMTP_ENABLED` to `true` and `MAIL_FROM` to the sender, for example `CareHouse One <no-reply@carehouseone.com>`. Until email is set up, invitations wait in the database outbox; the app still works.

## 4. Deploy

GitHub > Actions > Deploy > Run workflow (branch `main`). It runs lint, type checks and tests, builds the image, deploys it, and checks `/api/health` on the live app.

**Roll back** to the previous revision if something is wrong:

```bash
gcloud run revisions list --service carehouse-one --region us-central1
gcloud run services update-traffic carehouse-one --region us-central1 --to-revisions REVISION_NAME=100
```

Migrations only ever add to the database, so an older revision keeps working after a newer one migrated it. A migration that removes or renames something needs its own plan.

## 5. Create the customer's organization

There's no public sign-up. Create the organization, its homes and the owner's invitation from Cloud Shell, through the Cloud SQL Auth Proxy:

```bash
cd ~/CareHouseOne/web && npm ci
cloud-sql-proxy "$(gcloud sql instances describe carehouse-db --format='value(connectionName)')" --port 5432 &
export DATABASE_URL="$(gcloud secrets versions access latest --secret=database-url | sed -E 's#@localhost/([^?]+)\?host=.*#@127.0.0.1:5432/\1#')"
export APP_URL="https://carehouse-one-PROJECT_NUMBER.us-central1.run.app"
export SMTP_URL="$(gcloud secrets versions access latest --secret=smtp-url)" MAIL_FROM="CareHouse One <no-reply@your-domain>"
npm run org:create -- ~/org.json
```

`org.json` (write it in Cloud Shell, not in the repository):

```json
{
  "orgName": "Client organization name",
  "homes": [
    { "name": "First home", "timeZone": "America/Chicago", "beds": 8 },
    { "name": "Second home", "timeZone": "America/Chicago", "beds": 6 }
  ],
  "owner": { "name": "Owner's full name", "email": "owner@client.com" }
}
```

The owner gets an email, sets a password and two-step verification, invites their staff from the Staff page and registers each home's tablet in Settings (on the tablet itself). Add `--print-link` only if email isn't working; the link is a secret, so give it to the owner directly. Stop the proxy afterwards (`kill %1`) and close Cloud Shell.

## 6. Monitoring

In the Google Cloud console:

1. **Uptime check:** Monitoring > Uptime checks > Create: HTTPS, the app's host, path `/api/health`, every 5 minutes, from 3 regions. Alert to your email and phone.
2. **Error alert:** Logging > Log-based alerts: `resource.type="cloud_run_revision" severity>=ERROR`, notify at most once an hour.
3. **Database:** Cloud SQL > carehouse-db > Monitoring: alert when storage passes 80% or CPU stays above 80% for 15 minutes.
4. **Budget:** Billing > Budgets: alert at 50%, 90% and 100% of the monthly budget.

## 7. Prove a restore works (production plan step 4)

Before go-live and once a year, restore into a throwaway instance and check the data, then delete it:

```bash
gcloud sql instances clone carehouse-db carehouse-restore-test --point-in-time "$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
# connect with cloud-sql-proxy to carehouse-restore-test and check row counts, then:
gcloud sql instances delete carehouse-restore-test
```

Write down the date, how long the restore took and who checked it; keep it with the HIPAA policies.

## 8. Custom domain (optional)

Map a domain such as `app.carehouseone.com` (Cloud Run > Manage custom domains, or a load balancer for more control), then update the `APP_URL` variable, redeploy, and point the scheduler at it:

```bash
gcloud scheduler jobs update http carehouse-cron --location us-central1 --uri "https://app.carehouseone.com/api/cron"
```

## Routine work

- **Yearly ICD-10-CM update** (before October 1): download the CMS order file, then with the proxy running `npm run icd:import -- icd10cm_order_2028.txt "FY 2028"`.
- **Rotate the cron secret:** add a new version of `cron-secret`, update the scheduler job's Authorization header, redeploy.
- **Rotate the database password:** `gcloud sql users set-password`, add a new `database-url` version with it, redeploy.
- **Remove a lost tablet:** owner signs in > Settings > Home tablets > Remove. That signs everyone out of it. Also lock or wipe it in device management.

## Cost (first client)

Roughly: Cloud SQL `db-g1-small` with 10 GB and backups about $30 a month; Cloud Run, Scheduler, Secret Manager, Artifact Registry and logging a few dollars at this size. Set the budget alert in step 6.

## Known limits to review in the security review

- The app's database login owns the tables. Request code switches to the restricted `app_user` role inside each transaction, so row-level security limits every request to one organization; only sign-in and housekeeping run as the owner.
- The Cloud Scheduler job carries the cron secret in its configuration, visible to project members who can view Scheduler jobs.
- Rate limits are per IP address (Google's front end supplies it). Accounts also lock after 5 wrong passwords.
