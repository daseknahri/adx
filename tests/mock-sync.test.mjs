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
  const storedBounds = app.db.prepare(`
    SELECT MIN(metric_date) AS firstMetricDate, MAX(metric_date) AS latestMetricDate, COUNT(*) AS metricRows
    FROM metrics_daily
  `).get();
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.syncSummary.latestMetricDate, storedBounds.latestMetricDate);
  assert.equal(overview.body.syncSummary.firstMetricDate, storedBounds.firstMetricDate);
  assert.equal(overview.body.syncSummary.metricRows, storedBounds.metricRows);

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

test('cron latest sync requires the configured secret', async (t) => {
  const disabled = await startTestApp({ enableGoogleSync: false });
  t.after(() => disabled.close());

  const disabledSync = await request(disabled.baseUrl, '/api/cron/sync/google/latest', {
    method: 'POST'
  });
  assert.equal(disabledSync.response.status, 404);

  const app = await startTestApp({
    enableGoogleSync: false,
    cronSecret: 'test-cron-secret-value-123'
  });
  t.after(() => app.close());

  const unauthorized = await request(app.baseUrl, '/api/cron/sync/google/latest', {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-secret' }
  });
  assert.equal(unauthorized.response.status, 401);

  const sync = await request(app.baseUrl, '/api/cron/sync/google/latest', {
    method: 'POST',
    headers: { authorization: 'Bearer test-cron-secret-value-123' }
  });
  assert.equal(sync.response.status, 200);
  assert.equal(sync.body.ok, true);
  assert.equal(sync.body.mode, 'mock');
  assert.ok(sync.body.rowsSynced > 0);
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

test('admin backfill fills newly tracked domains from earliest stored sync date', async (t) => {
  const app = await startTestApp({ enableGoogleSync: false });
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const firstSync = await request(app.baseUrl, '/api/admin/sync/google', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ from: '2026-06-15', to: '2026-06-16' })
  });
  assert.equal(firstSync.response.status, 200);
  assert.equal(firstSync.body.ok, true);

  const inserted = app.db.prepare(`
    INSERT INTO subdomains (domain, category, unit_price, rent_status, notes)
    VALUES ('fresh.example.com', 'Content', 0, 'active', '')
  `).run();
  const freshId = Number(inserted.lastInsertRowid);

  const backfill = await request(app.baseUrl, '/api/admin/sync/google/backfill', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(backfill.response.status, 200);
  assert.equal(backfill.body.ok, true);
  assert.equal(backfill.body.range.from, '2026-06-15');
  assert.ok(backfill.body.range.to >= '2026-06-16');

  const freshRows = app.db.prepare(`
    SELECT metric_date AS metricDate, earnings, impressions
    FROM metrics_daily
    WHERE subdomain_id = ?
      AND metric_date BETWEEN '2026-06-15' AND '2026-06-16'
    ORDER BY metric_date ASC
  `).all(freshId);
  assert.deepEqual(freshRows.map((row) => row.metricDate), ['2026-06-15', '2026-06-16']);
  assert.equal(freshRows.every((row) => row.earnings > 0 && row.impressions > 0), true);
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
            dimensionValues: [{ value: 'https://www.news.demo.example.com/report-path' }],
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
  assert.equal(sync.body.rowsSynced, 1);
  assert.equal(sync.body.stats.adRowsReturned, 1);
  assert.equal(sync.body.stats.unmatchedRows, 0);
  assert.equal(sync.body.stats.skippedEmptyRows, 2);
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

test('live sync keeps existing stored metrics when Ad Manager omits a tracked domain', async (t) => {
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
  const sportsId = app.db.prepare('SELECT id FROM subdomains WHERE domain = ?').get('sports.demo.example.com').id;
  app.db.prepare(`
    INSERT INTO metrics_daily (
      subdomain_id, metric_date, visitors, page_views, bounce_rate, engaged_sessions,
      earnings, active_users, clicks, impressions, rpm, adx_ctr, adx_ecpm, source
    )
    VALUES (?, '2026-06-19', 0, 777, 0, 0, 77.77, 0, 0, 0, 0, 0, 0, 'admanager')
    ON CONFLICT(subdomain_id, metric_date) DO UPDATE SET
      earnings = excluded.earnings,
      page_views = excluded.page_views,
      source = excluded.source
  `).run(sportsId);

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);

  const originalFetch = globalThis.fetch;
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
      return Response.json(JSON.parse(options.body));
    }
    if (target.endsWith('/networks/23350042371/reports/7704780540:run')) {
      return Response.json({ name: 'networks/23350042371/operations/reports/runs/op-keep-existing' });
    }
    if (target.includes('/operations/reports/runs/op-keep-existing')) {
      return Response.json({
        done: true,
        response: {
          reportResult: 'networks/23350042371/reports/7704780540/results/result-keep-existing'
        }
      });
    }
    if (target.includes('/results/result-keep-existing:fetchRows')) {
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: 'news.demo.example.com' }],
            metricValueGroups: [
              {
                values: [
                  { value: 'MAD9.50' },
                  { value: '1.1%' },
                  { value: 'MAD10.00' },
                  { value: '950' }
                ]
              }
            ]
          },
          {
            dimensionValues: [{ value: 'untracked.example.com' }],
            metricValueGroups: [
              {
                values: [
                  { value: 'MAD99.00' },
                  { value: '2.2%' },
                  { value: 'MAD11.00' },
                  { value: '9000' }
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
  assert.equal(sync.body.rowsSynced, 1);
  assert.equal(sync.body.stats.adRowsReturned, 2);
  assert.equal(sync.body.stats.unmatchedRows, 1);
  assert.equal(sync.body.stats.skippedEmptyRows, 2);

  const sports = app.db.prepare(`
    SELECT earnings, page_views AS pageViews, source
    FROM metrics_daily
    WHERE subdomain_id = (SELECT id FROM subdomains WHERE domain = 'sports.demo.example.com')
      AND metric_date = '2026-06-19'
  `).get();

  assert.equal(sports.earnings, 77.77);
  assert.equal(sports.pageViews, 777);
  assert.equal(sports.source, 'admanager');
});
