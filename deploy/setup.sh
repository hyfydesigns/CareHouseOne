#!/usr/bin/env bash
# One-time Google Cloud setup for CareHouse One. Run it in Cloud Shell (gcloud is already signed
# in there) after creating the project, linking billing and accepting Google's BAA:
#
#   PROJECT_ID=carehouseone bash deploy/setup.sh
#
# Safe to re-run: steps that already exist are skipped. It creates:
#   - Artifact Registry repository for the app image
#   - Cloud SQL for PostgreSQL 17 with daily backups, point-in-time recovery, encrypted-only
#     connections and deletion protection
#   - Secrets: database-url, data-encryption-key, cron-secret (and smtp-url if SMTP_URL is set)
#   - A runtime service account for Cloud Run and a deploy service account for GitHub Actions,
#     trusted only from the hyfydesigns/CareHouseOne repository (no keys are created)
#   - A Cloud Scheduler job that calls /api/cron every 5 minutes
#
# Secret values are generated here and go straight into Secret Manager; nothing is printed.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID, for example PROJECT_ID=carehouseone}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-carehouse-one}"
REPO="${REPO:-carehouse}"
DB_INSTANCE="${DB_INSTANCE:-carehouse-db}"
DB_TIER="${DB_TIER:-db-g1-small}"
DB_NAME="${DB_NAME:-carehouse}"
DB_USER="${DB_USER:-carehouse_app}"
GITHUB_REPO="${GITHUB_REPO:-hyfydesigns/CareHouseOne}"
RUN_SA="carehouse-run@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="carehouse-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

say() { printf '\n== %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }
random_hex() { openssl rand -hex 32; }

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
APP_URL="${APP_URL:-https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app}"

say "Enabling services"
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com iam.googleapis.com

say "Artifact Registry"
exists gcloud artifacts repositories describe "$REPO" --location "$REGION" ||
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location "$REGION" \
    --description="CareHouse One images"

say "Cloud SQL instance (takes several minutes the first time)"
if ! exists gcloud sql instances describe "$DB_INSTANCE"; then
  gcloud sql instances create "$DB_INSTANCE" \
    --database-version=POSTGRES_17 --edition=ENTERPRISE --tier="$DB_TIER" --region="$REGION" \
    --availability-type=ZONAL --storage-type=SSD --storage-size=10 --storage-auto-increase \
    --backup-start-time=07:00 --retained-backups-count=30 \
    --enable-point-in-time-recovery --retained-transaction-log-days=7 \
    --ssl-mode=ENCRYPTED_ONLY --deletion-protection \
    --maintenance-window-day=SUN --maintenance-window-hour=8
fi
CONNECTION="$(gcloud sql instances describe "$DB_INSTANCE" --format='value(connectionName)')"

say "Database and app user"
exists gcloud sql databases describe "$DB_NAME" --instance "$DB_INSTANCE" ||
  gcloud sql databases create "$DB_NAME" --instance "$DB_INSTANCE"

put_secret() { # name value
  if exists gcloud secrets describe "$1"; then return 0; fi
  printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=-
}

if ! exists gcloud secrets describe database-url; then
  DB_PASSWORD="$(random_hex)"
  if exists gcloud sql users describe "$DB_USER" --instance "$DB_INSTANCE"; then
    gcloud sql users set-password "$DB_USER" --instance "$DB_INSTANCE" --password "$DB_PASSWORD"
  else
    gcloud sql users create "$DB_USER" --instance "$DB_INSTANCE" --password "$DB_PASSWORD"
  fi
  put_secret database-url "postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION}"
  unset DB_PASSWORD
fi

say "Secrets"
put_secret data-encryption-key "$(openssl rand -base64 32)"
put_secret cron-secret "$(random_hex)"
if [[ -n "${SMTP_URL:-}" ]]; then put_secret smtp-url "$SMTP_URL"; fi

say "Service accounts"
exists gcloud iam service-accounts describe "$RUN_SA" ||
  gcloud iam service-accounts create carehouse-run --display-name="CareHouse One (Cloud Run)"
exists gcloud iam service-accounts describe "$DEPLOY_SA" ||
  gcloud iam service-accounts create carehouse-deploy --display-name="CareHouse One (GitHub deploy)"

gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUN_SA}" \
  --role=roles/cloudsql.client --condition=None >/dev/null
for s in database-url data-encryption-key cron-secret smtp-url paypal-client-secret; do
  exists gcloud secrets describe "$s" || continue
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:${RUN_SA}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done

for role in roles/run.admin roles/artifactregistry.writer; do  # run.admin: needed to make the service public (no invoker IAM check)
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOY_SA}" \
    --role="$role" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/iam.serviceAccountUser >/dev/null

say "GitHub Actions sign-in (Workload Identity Federation, no keys)"
exists gcloud iam workload-identity-pools describe github --location=global ||
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
exists gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github ||
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --display-name="GitHub" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'"
POOL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

say "Cloud Scheduler: housekeeping every 5 minutes"
if ! exists gcloud scheduler jobs describe carehouse-cron --location "$REGION"; then
  gcloud scheduler jobs create http carehouse-cron --location "$REGION" --schedule="*/5 * * * *" \
    --uri="${APP_URL}/api/cron" --http-method=POST \
    --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=cron-secret)" \
    --attempt-deadline=60s
fi

say "Cloud Scheduler: medication list (NLM RxTerms) update, quarterly"
if ! exists gcloud scheduler jobs describe carehouse-rxterms --location "$REGION"; then
  gcloud scheduler jobs create http carehouse-rxterms --location "$REGION" --schedule="0 6 5 1,4,7,10 *" --time-zone="America/Chicago" \
    --uri="${APP_URL}/api/cron/rxterms" --http-method=POST \
    --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=cron-secret)" \
    --attempt-deadline=600s
fi

say "Done. Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables):"
cat <<EOF
  GCP_PROJECT_ID    ${PROJECT_ID}
  GCP_REGION        ${REGION}
  GCP_WIF_PROVIDER  ${POOL}/providers/github
  GCP_DEPLOY_SA     ${DEPLOY_SA}
  GCP_RUN_SA        ${RUN_SA}
  CLOUD_SQL         ${CONNECTION}
  APP_URL           ${APP_URL}
  MAIL_FROM         CareHouse One <no-reply@carehouseone.com>
  SMTP_ENABLED      $( [[ -n "${SMTP_URL:-}" ]] && echo true || echo false )
Then run the "Deploy" workflow from the Actions tab.
EOF
