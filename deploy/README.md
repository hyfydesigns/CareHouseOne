# Deploying CareHouse One to Google Cloud

This is the runbook for production. Every step is done by the developer.

| Setting | Value |
| --- | --- |
| Google Cloud project | `carehouseone` |
| Region | `us-central1` |
| App address | `https://app.carehouseone.com` (until the domain is mapped in step 8: `https://carehouse-one-PROJECT_NUMBER.us-central1.run.app`, printed by `setup.sh`) |
| Email sender | `CareHouse One <no-reply@carehouseone.com>`, sent through Resend |
| Domain registrar and DNS | Cloudflare (`carehouseone.com`) |
| Public site | `https://www.carehouseone.com` (same Cloud Run service; step 9) |
| Payments | PayPal Subscriptions, $50 per resident per month, 30-day free trial (step 9) |

**No real resident data until the build spec's production plan step 1 (compliance foundation) and step 4 (testing, including a restore test) are complete.**

## What runs where

| Piece | Google Cloud service | Notes |
| --- | --- | --- |
| Web app | Cloud Run `carehouse-one` | Docker image from `web/Dockerfile`. Scales to zero; at most 3 instances. Applies database migrations when a new revision starts. |
| Database | Cloud SQL for PostgreSQL 17 `carehouse-db` | Daily backups kept 30 days, point-in-time recovery for 7 days, encrypted connections only, deletion protection. Reached through the Cloud SQL connector, never an open port. |
| Secrets | Secret Manager | `database-url`, `data-encryption-key`, `cron-secret`, `smtp-url`, `paypal-client-secret`. Only the runtime service account can read them. |
| Images | Artifact Registry `carehouse` | Tagged with the git commit. |
| Housekeeping | Cloud Scheduler `carehouse-cron` | Every 5 minutes: retries unsent emails, refreshes PayPal subscriptions (and sends the resident count on the 1st), clears old rate-limit counters. |
| Payments | PayPal | Sees the organization name, billing contact and resident count only, never resident details. Webhooks go to `/api/paypal/webhook`. |
| Email | Resend (SMTP) | Invitation and password-reset links only, never resident details. |
| DNS | Cloudflare | Every record DNS only (grey cloud), never proxied. |
| Deploys | GitHub Actions `Deploy` workflow | Manual. Signs in to Google with Workload Identity Federation (no keys), only from `main` of this repository. |

Logs go to Cloud Logging. The app never logs request bodies, resident details, or email links.

## 1. Before anything else

1. Create a Google Cloud organization (through Cloud Identity or Google Workspace) and the project `carehouseone`. Link billing.
2. **Accept Google Cloud's Business Associate Agreement** for the organization (Google Cloud console > IAM & Admin > Settings or your account team; see Google's "HIPAA compliance on Google Cloud" page). Check that every service in the table above is on Google's list of covered services at the time you sign.
3. Turn on 2-step verification for every Google account with access to the project. Give access to as few people as possible.

## 2. One-time setup

Open Cloud Shell in the project (it has `gcloud` signed in) and run:

```bash
git clone https://github.com/hyfydesigns/CareHouseOne.git && cd CareHouseOne
PROJECT_ID=carehouseone bash deploy/setup.sh
```

Options (environment variables): `REGION` (default `us-central1`), `DB_TIER` (default `db-g1-small`), `APP_URL` (default: the Cloud Run address, which is predictable). Keep the default `APP_URL` for now; step 8 switches to `app.carehouseone.com`. If Resend is already set up, pass `SMTP_URL` too (see step 3):

```bash
SMTP_URL='smtps://resend:YOUR_RESEND_API_KEY@smtp.resend.com:465' PROJECT_ID=carehouseone bash deploy/setup.sh
```

The script generates the database password, the encryption key and the cron secret directly into Secret Manager. It prints the values to set as **GitHub repository variables** (Settings > Secrets and variables > Actions > Variables). None of them are secrets.

Then in GitHub: Settings > Environments > New environment `production`, and add yourself as a required reviewer, so every deploy waits for your click.

**Keep `data-encryption-key` safe.** It encrypts two-step verification keys in the database. If it's lost, every user has to set up two-step verification again. Don't delete old versions of the secret.

## 3. Email for invitations and password resets (Resend)

The emails only contain links, never resident details, so the provider doesn't need a BAA. Keep it that way: never put resident names or care details in an email.

1. In Resend: Domains > Add domain > `carehouseone.com`.
2. Add the DNS records Resend shows (DKIM, and SPF and MX for its sending subdomain) in Cloudflare > DNS > Records, exactly as shown and **DNS only**. Resend can also add them to Cloudflare for you.
3. Add a DMARC record in Cloudflare: type `TXT`, name `_dmarc`, content `v=DMARC1; p=quarantine; rua=mailto:YOUR_EMAIL`.
4. Wait for the domain to show **Verified** in Resend, then create an API key with **Sending access** only.
5. Store it in Secret Manager (skip if you passed `SMTP_URL` to `setup.sh`). The SMTP username is literally `resend`; the password is the API key:

```bash
printf '%s' 'smtps://resend:YOUR_RESEND_API_KEY@smtp.resend.com:465' | gcloud secrets create smtp-url --data-file=-
gcloud secrets add-iam-policy-binding smtp-url --member="serviceAccount:carehouse-run@carehouseone.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
```

6. Set the GitHub variables `SMTP_ENABLED` = `true` and `MAIL_FROM` = `CareHouse One <no-reply@carehouseone.com>`. Resend rejects senders on unverified domains.

Check the SMTP host and port against Resend's SMTP settings page. Until email is set up, invitations wait in the database outbox; the app still works.

To get replies (for example to `support@carehouseone.com`), turn on Cloudflare Email Routing and forward to your own inbox.

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
export APP_URL="https://app.carehouseone.com"
export SMTP_URL="$(gcloud secrets versions access latest --secret=smtp-url)" MAIL_FROM="CareHouse One <no-reply@carehouseone.com>"
npm run org:create -- ~/org.json
```

Until `app.carehouseone.com` works (step 8), set `APP_URL` to the `run.app` address `setup.sh` printed, or the owner's invitation link won't open. Run every `export` in the same Cloud Shell session as `npm run org:create`.

`org.json` (write it in Cloud Shell, for example with `nano ~/org.json`, not in the repository). Use each home's real time zone: medication times and daily records depend on it.

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
# the copy inherits deletion protection; turn it off on the COPY only, never on carehouse-db
gcloud sql instances patch carehouse-restore-test --no-deletion-protection
gcloud sql instances delete carehouse-restore-test
gcloud sql instances list   # only carehouse-db should remain
```

Write down the date, how long the restore took and who checked it; keep it with the HIPAA policies.

## 8. App address: app.carehouseone.com

Do this after the first deploy succeeds on the `run.app` address.

**Keep the record DNS only (grey cloud) in Cloudflare.** If Cloudflare proxied it, Cloudflare would decrypt all app traffic, including resident data, and would need a BAA (only on its Enterprise plans). DNS only, traffic stays encrypted from the tablet to Google.

1. Map the domain:

```bash
gcloud beta run domain-mappings create --service carehouse-one --domain app.carehouseone.com --region us-central1
```

2. If Google asks you to verify `carehouseone.com` first, follow its link and add the `TXT` record it gives you in Cloudflare.
3. Add the record the command shows in Cloudflare, typically type `CNAME`, name `app`, target `ghs.googlehosted.com`, **DNS only**.
4. Wait for Google to issue the certificate (usually 15 to 60 minutes), until `https://app.carehouseone.com/api/health` shows `{"ok":true}`.
5. Change the GitHub variable `APP_URL` to `https://app.carehouseone.com`, point the scheduler at it, and run Deploy again so emailed links use the new address:

```bash
gcloud scheduler jobs update http carehouse-cron --location us-central1 --uri "https://app.carehouseone.com/api/cron"
```

Also in Cloudflare: turn on auto-renew and the registrar lock for `carehouseone.com`. If the domain lapses, email and the app address stop working.

## 9. Public site and PayPal sign-up

The landing page, pricing and sign-up live at `www.carehouseone.com`, served by the same Cloud Run service as the app. **Online sign-up stays closed (`SIGNUP_OPEN` off) until the lawyer-reviewed Terms of Service and Business Associate Agreement replace the placeholders at `/terms` and `/baa`.** Until then the site offers "Request a demo".

### 9a. The www address

1. Map it (the domain is already verified from step 8):

```bash
gcloud beta run domain-mappings create --service carehouse-one --domain www.carehouseone.com --region us-central1
```

2. In Cloudflare add the record it shows (`CNAME`, name `www`, target `ghs.googlehosted.com`), **DNS only**.
3. Send the bare domain to www: in Cloudflare add an `A` record for `@` pointing to `192.0.2.1` with the proxy **on** (orange cloud; nothing is ever served from it), then Rules > Redirect Rules > "Redirect from root to WWW". This is the only proxied record, and it carries no app traffic.
4. Email for the site: in Cloudflare Email Routing, forward `hello@carehouseone.com` to your inbox.
5. GitHub variables: `SITE_URL` = `https://www.carehouseone.com`, `CONTACT_EMAIL` = `hello@carehouseone.com`, `LEADS_EMAIL` = the address that should get demo requests. Run Deploy.

Demo requests are stored in the `leads` table and emailed to `LEADS_EMAIL`.

### 9b. PayPal in sandbox (test money)

1. developer.paypal.com > Apps & Credentials > **Sandbox** > Create App. Copy the client ID and secret.
2. Create the product and plan (in Cloud Shell, from `~/CareHouseOne/web`). It prints the plan ID:

```bash
PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID='CLIENT_ID' PAYPAL_CLIENT_SECRET='SECRET' npm run paypal:setup
```

3. Store the secret and let the app read it:

```bash
printf '%s' 'SECRET' | gcloud secrets create paypal-client-secret --data-file=-
gcloud secrets add-iam-policy-binding paypal-client-secret --member="serviceAccount:carehouse-run@carehouseone.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
```

4. In the PayPal app, add a webhook: URL `https://app.carehouseone.com/api/paypal/webhook`, events `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED` and `PAYMENT.SALE.COMPLETED`. Copy the webhook ID.
5. GitHub variables: `PAYPAL_ENV` = `sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_PLAN_ID`, `PAYPAL_WEBHOOK_ID`. Leave `SIGNUP_OPEN` unset. Run Deploy.

**Try the whole flow locally** with the sandbox (sign-up is open only on your computer). In `web/.env.local` (never committed):

```
SIGNUP_OPEN=true
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_PLAN_ID=...
```

Then `npm run dev`, open `http://www.localhost:3000/signup`, subscribe with a PayPal sandbox **personal** test account (developer dashboard > Testing tools > Sandbox accounts), set up the organization, and follow the invitation link printed in the dev server log. Webhooks don't reach your computer; the scheduled sync picks the subscription up in production.

### 9c. Going live

1. Publish the final Terms of Service and BAA at `/terms` and `/baa` (replace the placeholder pages in `web/src/app/(site)/`), and have the privacy page reviewed with them.
2. In PayPal, switch to **Live**, create a live app, run `npm run paypal:setup` with `PAYPAL_ENV=live` and the live credentials, add a new version of `paypal-client-secret` with the live secret, and add the same webhook to the live app.
3. GitHub variables: `PAYPAL_ENV` = `live`, the live `PAYPAL_CLIENT_ID`, `PAYPAL_PLAN_ID` and `PAYPAL_WEBHOOK_ID`, and `SIGNUP_OPEN` = `true`. Run Deploy. The app refuses to start with sign-up open and any PayPal setting missing.
4. Subscribe once yourself with a real card, set up a test organization, then cancel the subscription in PayPal and check that Settings > Billing shows it as cancelled.

**What customers see:** a billing card in Settings with the plan, the residents billed, the active residents now and the next payment date. If a payment fails, owners and admins get an email and a banner; after 14 days inviting staff, registering tablets and settings changes pause. Care records and the medication record are never blocked. On the first of each month the active resident count is sent to PayPal; if PayPal needs the payer to approve a higher amount, an "Approve the new count in PayPal" button appears.

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
