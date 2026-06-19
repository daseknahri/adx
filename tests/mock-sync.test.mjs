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

  const overview = await request(app.baseUrl, '/api/admin/overview', {
    headers: { cookie }
  });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.syncSummary.latestMetricDate, '2026-06-18');
  assert.equal(overview.body.syncSummary.firstMetricDate, '2026-06-17');
  assert.equal(overview.body.syncSummary.metricRows, domainCount * 2);

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

test('admin latest Google refresh starts at the newest stored sync date', async (t) => {
  const app = await startTestApp({ enableGoogleSync: false });
  t.after(() => app.close());

  const domainCount = app.db.prepare('SELECT COUNT(*) AS count FROM subdomains').get().count;
  const today = isoOffset(0);
  const yesterday = isoOffset(-1);
  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);

  const initial = await request(app.baseUrl, '/api/admin/sync/google', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ from: yesterday, to: yesterday })
  });

  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.ok, true);
  assert.deepEqual(initial.body.range, { from: yesterday, to: yesterday });

  const latest = await request(app.baseUrl, '/api/admin/sync/google/latest', {
    method: 'POST',
    headers: { cookie }
  });

  assert.equal(latest.response.status, 200);
  assert.equal(latest.body.ok, true);
  assert.deepEqual(latest.body.range, { from: yesterday, to: today });
  assert.equal(latest.body.rowsSynced, domainCount * listDates(yesterday, today).length);
});

function isoOffset(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function listDates(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

test('connected Google OAuth uses Ad Manager even when demo env flag is false', async (t) => {
  const app = await startTestApp({
    enableGoogleSync: false,
    googleClientId: 'client-id',
    googleClientSecret: 'client-secret',
    adManagerNetworkCode: '23350042371',
    adManagerReportId: '7704780540',
    adManagerReportMetrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
    adManagerReportDimensions: ['SITE']
  });
  t.after(() => app.close());

  app.db.prepare(`
    INSERT INTO google_connections (id, refresh_token, expires_at, account_id)
    VALUES (1, 'refresh-token', 0, '23350042371')
  `).run();

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);

  const originalFetch = globalThis.fetch;
  const patchedRanges = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith(app.baseUrl)) {
      return originalFetch(url, options);
    }
    if (target.includes('oauth2.googleapis.com')) {
      return Response.json({ access_token: 'access-token', expires_in: 3600 });
    }
    if (target.endsWith('/networks/23350042371/reports/7704780540')) {
      return Response.json({
        name: 'networks/23350042371/reports/7704780540',
        reportDefinition: {
          dimensions: ['SITE'],
          metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
          dateRange: { relative: 'TODAY' }
        }
      });
    }
    if (target.includes('/networks/23350042371/reports/7704780540?updateMask=reportDefinition.dateRange')) {
      assert.equal(options.method, 'PATCH');
      const body = JSON.parse(options.body);
      patchedRanges.push(body.reportDefinition.dateRange);
      return Response.json(body);
    }
    if (target.endsWith('/networks/23350042371/reports/7704780540:run')) {
      return Response.json({ name: 'networks/23350042371/operations/reports/runs/op-1' });
    }
    if (target.includes('/operations/reports/runs/op-1')) {
      return Response.json({
        done: true,
        response: {
          reportResult: 'networks/23350042371/reports/7704780540/results/result-1'
        }
      });
    }
    if (target.includes('/results/result-1:fetchRows')) {
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: 'news.demo.example.com' }],
            metricValueGroups: [
              {
                values: [
                  { value: 'MAD24.18' },
                  { value: '2.63%' },
                  { value: 'MAD25.42' },
                  { value: '951' }
                ]
              }
            ]
          }
        ]
      });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const sync = await request(app.baseUrl, '/api/admin/sync/google', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ from: '2026-06-19', to: '2026-06-19' })
  });

  assert.equal(sync.response.status, 200);
  assert.equal(sync.body.ok, true);
  assert.equal(sync.body.mode, 'admanager');
  assert.deepEqual(patchedRanges, [
    {
      fixed: {
        startDate: { year: 2026, month: 6, day: 19 },
        endDate: { year: 2026, month: 6, day: 19 }
      }
    }
  ]);

  const row = app.db.prepare(`
    SELECT earnings, impressions, page_views AS pageViews, adx_ctr AS adxCtr,
      adx_ecpm AS adxEcpm, source
    FROM metrics_daily m
    INNER JOIN subdomains s ON s.id = m.subdomain_id
    WHERE s.domain = 'news.demo.example.com'
      AND m.metric_date = '2026-06-19'
  `).get();

  assert.equal(row.source, 'admanager');
  assert.equal(row.earnings, 24.18);
  assert.equal(row.impressions, 951);
  assert.equal(row.pageViews, 951);
  assert.equal(row.adxCtr, 2.63);
  assert.equal(row.adxEcpm, 25.42);
});
