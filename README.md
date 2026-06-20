# AdX Domain Tracker

A deployable web app for managing rented subdomain clients and showing each client
their assigned Google Ad Manager / AdX numbers.

## What It Does

- Admin dashboard for clients, subdomains, assignment, rent status, and sync actions.
- Client dashboard for currently assigned subdomains only, using all stored
  synced data for those sites.
- Client dashboards auto-refresh in the browser, so new synced numbers appear
  without the client pressing refresh.
- Pausing a client immediately blocks new logins and API access while retaining
  the client, domains, and stored reporting data for later reactivation.
- Google Ad Manager OAuth connection and AdX report sync.
- AdX revenue, CTR, eCPM, and impressions from an existing interactive report.
- Exact selected date/range sync by setting the saved Ad Manager report date range before each run.
- Backfill old AdX dates with Sync Range or Backfill Sites, then use Refresh AdX
  and the cron task to fetch only the latest stored date through today.
- Optional GA4 sync for visitor columns.
- SQLite-backed storage mounted at `/data` for Coolify deployment.

## Quick Start

```bash
npm install
npm run dev
```

Open the client dev app at `http://localhost:5173`.

The first run creates only the administrator. Production does not create demo
clients, domains, or metrics. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before
deploying. These values update the single existing admin account on the next
deploy, which is how to rotate the administrator login safely.

## Production

```bash
npm run build
npm start
```

The API and built React app are served from the same Express process.

## Deployment

Use Coolify with this folder as the app base directory. The production container
listens on port `8080`, exposes `/health`, and expects persistent SQLite storage
mounted at `/data`.

Start with [DEPLOY-COOLIFY.md](./DEPLOY-COOLIFY.md), then set these production
values in Coolify:

- `APP_URL` set to the public HTTPS URL.
- `DB_PATH=/data/app.db`.
- Strong `SESSION_SECRET` and 64-character hex `TOKEN_ENCRYPTION_KEY` values.
- Google OAuth redirect URI:
  `https://your-domain.example/api/admin/google/oauth/callback`.
- Google Ad Manager network/report settings:
  `AD_MANAGER_NETWORK_CODE`, `AD_MANAGER_REPORT_ID`,
  `AD_MANAGER_REPORT_DIMENSIONS`, and `AD_MANAGER_REPORT_METRICS`.

From the provided Ad Manager screenshot, the likely production values are:

```env
AD_MANAGER_NETWORK_CODE=23350042371
AD_MANAGER_REPORT_ID=7704780540
AD_MANAGER_REPORT_DIMENSIONS=DATE,SITE
AD_MANAGER_REPORT_METRICS=REVENUE,AD_EXCHANGE_CTR,AD_EXCHANGE_AVERAGE_ECPM,TOTAL_IMPRESSIONS
REPORT_CURRENCY=MAD
```

Use `DATE,SITE` for `AD_MANAGER_REPORT_DIMENSIONS` when possible. That lets
backfill fetch a full date range in one Ad Manager run instead of one run per
day. If Google rejects the date dimension, the app falls back to the slower
day-by-day sync automatically.

Enable GitHub auto-deploys in Coolify only after the first manual deployment
passes the `/health` check.
