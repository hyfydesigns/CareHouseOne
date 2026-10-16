# CareHouse One web app for Cloud Run.
# Build:  docker build -t carehouse-one web/
# The image holds no secrets: DATABASE_URL, DATA_ENCRYPTION_KEY, CRON_SECRET and SMTP_URL come
# from Secret Manager at run time.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# Migrations are applied at startup (src/instrumentation.ts).
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 8080
CMD ["node", "server.js"]
