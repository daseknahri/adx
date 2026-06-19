# Build Flow

## Agent Ownership

- Orchestrator: contract, scaffolding, integration, QA, browser verification.
- Backend worker: `server/config.js`, `server/db.js`, `server/auth.js`,
  `server/routes/auth.js`, `server/routes/admin.js`, `server/routes/client.js`,
  `tests/backend.test.mjs`.
- Integration worker: `server/services/google-oauth.js`,
  `server/services/adsense.js`, `server/services/ga4.js`,
  `server/services/sync.js`, `tests/sync.test.mjs`.
- UI worker: `client/**`.
- Deploy worker: `Dockerfile`, `docker-compose.yml`, `DEPLOY-COOLIFY.md`,
  `scripts/**`, deployment-related README updates.

## Completion Checklist

- [ ] App installs dependencies.
- [ ] API serves `/health`.
- [ ] Auth and role access control work.
- [ ] Admin can manage clients/subdomains.
- [ ] Client sees only assigned subdomains.
- [ ] AdSense/GA4 sync has live path and safe mock fallback.
- [ ] React UI has client and admin surfaces.
- [ ] Production build serves static app.
- [ ] Docker/Coolify docs are complete.
- [ ] Tests/checks pass.
- [ ] Browser QA covers desktop and mobile.

