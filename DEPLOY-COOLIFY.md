# Deploying AdX Domain Tracker on Coolify

This app is deployed as one Node/Vite service. The production container listens on
port `8080`, serves the built Vite app from Express, and stores SQLite data in
`/data/app.db`.

## Coolify Resource

1. Create a new Coolify resource from your GitHub repository.
2. Select Dockerfile-based deployment.
3. Set the build context to the repository root that contains this file.
4. Set the exposed/container port to `8080`.
5. Attach persistent storage:
   - Container path: `/data`
   - Recommended volume name: `adsense-tracker-data`
6. Set the health check path to `/health`.
7. Add your production domain, for example `https://reports.example.com`.
8. Enable automatic deploys from GitHub after the first manual deploy succeeds.

Coolify should terminate TLS at the proxy. Keep the app itself on HTTP inside the
container and use the public HTTPS URL in `APP_URL`.

## Required Environment Variables

Set these in Coolify before the first deploy:

```env
NODE_ENV=production
PORT=8080
APP_URL=https://reports.example.com
DB_PATH=/data/app.db
SESSION_SECRET=replace-with-a-long-random-secret
TOKEN_ENCRYPTION_KEY=replace-with-64-hex-chars

SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=replace-before-production
SEED_CLIENT_EMAIL=client@example.com
SEED_CLIENT_PASSWORD=replace-before-production

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://reports.example.com/api/admin/google/oauth/callback
AD_MANAGER_NETWORK_CODE=23350042371
AD_MANAGER_REPORT_ID=7704780540
AD_MANAGER_REPORT_DIMENSIONS=SITE
AD_MANAGER_REPORT_METRICS=REVENUE,AD_EXCHANGE_CTR,AD_EXCHANGE_AVERAGE_ECPM
REPORT_CURRENCY=MAD
GA4_PROPERTY_ID=
ENABLE_GOOGLE_SYNC=false
```

Generate production secrets locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use one generated value for `SESSION_SECRET` and a different 64-character hex
value for `TOKEN_ENCRYPTION_KEY`.

## Google Ad Manager OAuth Setup

For AdX, use Google Ad Manager, not the AdSense API. The app asks for the
`https://www.googleapis.com/auth/admanager.readonly` scope when the Ad Manager
network/report variables are set.

In Google Cloud Console:

1. Create or select the OAuth client used by this app.
2. Enable the Google Ad Manager API for the project.
3. Add the exact authorized redirect URI:
   `https://reports.example.com/api/admin/google/oauth/callback`
4. Replace `reports.example.com` with the same host used in `APP_URL`.
5. Copy the client ID and secret into Coolify.
6. Keep `ENABLE_GOOGLE_SYNC=false` until the admin account connects OAuth from
   the deployed app and the first manual sync succeeds.

The redirect URI must match exactly, including HTTPS, hostname, path, and lack
of trailing slash.

In Google Ad Manager:

1. Make sure API access is enabled for the network.
2. Use a Google user that has permission to read the interactive report.
3. Copy the network code from the URL after `admanager.google.com/`.
   In your screenshot this is `23350042371`.
4. Open the report you want to sync and copy `report_id` from the URL.
   In your screenshot this is `7704780540`.
5. Keep the report grouped by `Site` and include Total revenue, Ad Exchange CTR,
   and Ad Exchange average eCPM.

## GitHub Auto-Deploy Notes

- Connect the Coolify resource to the production branch, usually `main`.
- Keep automatic deployments enabled only after the health check passes once.
- Use pull requests for production changes and let Coolify deploy after merge.
- Do not commit `.env` files or real Google credentials to the repository.
- If a deploy fails, keep the previous container running and inspect Coolify
  build/runtime logs before retrying.

## Smoke Check

After deployment, check the public health endpoint:

```bash
curl -fsS https://reports.example.com/health
```

Expected response:

```json
{"status":"ok"}
```

You can also validate environment variables before deployment:

```bash
node scripts/verify-deploy-env.mjs
```

Run that command in a shell where the same production environment variables are
loaded.

## Safe Production Guidance

- Keep `/data` on persistent Coolify storage. Without it, the SQLite database is
  recreated on every redeploy.
- Back up `/data/app.db` before major releases, OAuth changes, or server
  migration.
- Rotate `SESSION_SECRET` only during a maintenance window because users will be
  signed out.
- Do not rotate `TOKEN_ENCRYPTION_KEY` unless existing encrypted Google tokens
  have been migrated or can be reconnected.
- Replace seeded passwords before exposing the app publicly.
- Restrict admin access and review connected Google scopes before enabling live
  sync.
- Keep `ENABLE_GOOGLE_SYNC=false` until OAuth, Ad Manager network/report IDs,
  and optional GA4 identifiers have been verified against the production Google
  account.
