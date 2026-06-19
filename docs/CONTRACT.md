# Product Contract

## Product

AdSense Tracker is a two-role dashboard:

- **Client:** sees only assigned subdomains and their metrics.
- **Admin:** manages clients, subdomains, assignments, sync state, and Google connection.

The app is independent from `D:\za-post-main` and deploys as its own Coolify service.

## Data Sources

Google Ad Manager / AdX provides monetization metrics such as revenue, CTR,
average eCPM, impressions, clicks, and optional page views.

GA4 is optional and provides traffic/engagement metrics such as active users,
screen/page views, bounce rate, and engaged sessions.

If Google sync is disabled or not connected, the app uses seeded demo rows and allows
manual/domain management to remain usable.

## Roles

### Admin

- Create and edit clients.
- Create and edit subdomains.
- Assign subdomains to clients.
- Set status, category, unit price, and notes.
- Connect Google OAuth.
- Run manual range sync for backfilling exact selected dates/ranges.
- Run latest refresh from the newest stored AdX date through today.
- View all metrics and sync errors.

### Client

- Login with client account.
- View assigned subdomains only.
- Filter by date range.
- Open domain detail rows.

## Metrics Columns

| UI Column | Source |
| --- | --- |
| Domain | Local DB |
| Visitors | GA4 `activeUsers` |
| Page Views | Ad Manager page views, AdX impressions fallback, or GA4 `screenPageViews` |
| Bounce Rate | GA4 `bounceRate` |
| Engaged Sessions | GA4 `engagedSessions` |
| Category | Local DB |
| Unit Price | Local DB |
| Earnings | Ad Manager / AdX `REVENUE` |
| Active Users | GA4 `activeUsers` |
| Actions | Local UI/API |

## API

All endpoints return JSON unless serving the React app.

### Public/Auth

- `GET /health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

### Client

- `GET /api/client/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/client/subdomains/:id/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`

### Admin

- `GET /api/admin/overview?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/admin/clients`
- `POST /api/admin/clients`
- `PATCH /api/admin/clients/:id`
- `GET /api/admin/subdomains`
- `POST /api/admin/subdomains`
- `PATCH /api/admin/subdomains/:id`
- `POST /api/admin/subdomains/:id/assign`
- `POST /api/admin/subdomains/:id/unassign`
- `POST /api/admin/sync/google`
- `POST /api/admin/sync/google/latest`
- `GET /api/admin/google/status`
- `GET /api/admin/google/oauth/start`
- `GET /api/admin/google/oauth/callback`

## Deployment Contract

- Single Node service.
- Build command: `npm install && npm run build`.
- Start command: `npm start`.
- Exposed port: `$PORT` default `8080`.
- Persistent mount: `/data`.
