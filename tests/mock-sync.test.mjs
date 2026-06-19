import assert from 'node:assert/strict';
import test from 'node:test';

import { login, request, startTestApp } from './helpers.mjs';

test('admin mock Google sync writes one metric row per domain per date', async (t) => {
  const app = await startTestApp({ enableGoogleSync: false });
  t.after(() => app.close());

  const domainCount = app.db.prepare('SELECT COUNT(*) AS count FROM subdomains').get().count;
  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);

  const sync = await request(app.baseUrl, '/api/admin/sync/google', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ from: '2026-06-17', to: '2026-06-18' })
  });

  assert.equal(sync.response.status, 200);
  assert.equal(sync.body.ok, true);
  assert.equal(sync.body.mode, 'mock');
  assert.equal(sync.body.rowsSynced, domainCount * 2);

  const rows = app.db.prepare(`
    SELECT metric_date AS metricDate, source, page_views AS pageViews, active_users AS activeUsers,
      earnings, clicks, impressions, rpm, adx_ctr AS adxCtr, adx_ecpm AS adxEcpm
    FROM metrics_daily
    WHERE metric_date BETWEEN '2026-06-17' AND '2026-06-18'
    ORDER BY subdomain_id, metric_date
  `).all();

  assert.equal(rows.length, domainCount * 2);
  assert.equal(rows.every((row) => row.source === 'mock'), true);
  assert.equal(rows.every((row) => row.pageViews > 0), true);
  assert.equal(rows.every((row) => row.activeUsers > 0), true);
  assert.equal(rows.every((row) => row.earnings > 0), true);
  assert.equal(rows.every((row) => row.clicks > 0), true);
  assert.equal(rows.every((row) => row.impressions > 0), true);
  assert.equal(rows.every((row) => row.rpm > 0), true);
  assert.equal(rows.every((row) => row.adxCtr > 0), true);
  assert.equal(rows.every((row) => row.adxEcpm > 0), true);

  const syncRun = app.db.prepare(`
    SELECT provider, status, rows_synced AS rowsSynced, message
    FROM sync_runs
    WHERE id = ?
  `).get(sync.body.syncRunId);

  assert.equal(syncRun.provider, 'google');
  assert.equal(syncRun.status, 'success');
  assert.equal(syncRun.rowsSynced, domainCount * 2);
  assert.match(syncRun.message, /Synced \d+ domain rows/);
});

test('clients cannot run mock Google sync', async (t) => {
  const app = await startTestApp({ enableGoogleSync: false });
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedClientEmail, app.config.seedClientPassword);
  const sync = await request(app.baseUrl, '/api/admin/sync/google', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ from: '2026-06-17', to: '2026-06-18' })
  });

  assert.equal(sync.response.status, 403);
  assert.equal(sync.body.error, 'forbidden');
});
