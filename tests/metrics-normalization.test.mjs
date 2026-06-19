import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchAdsenseDomainReport, normalizeAdsenseRows } from '../server/services/adsense.js';
import { normalizeGa4Rows } from '../server/services/ga4.js';

test('normalizes AdSense rows by header name, including dates and numeric metrics', () => {
  const rows = normalizeAdsenseRows({
    headers: [
      { name: 'PAGE_VIEWS_RPM' },
      { name: 'DOMAIN_NAME' },
      { name: 'DATE' },
      { name: 'IMPRESSIONS' },
      { name: 'ESTIMATED_EARNINGS' },
      { name: 'CLICKS' },
      { name: 'PAGE_VIEWS' }
    ],
    rows: [
      {
        cells: [
          { value: '4.25' },
          { value: 'news.example.com' },
          { value: '20260618' },
          { value: '2000' },
          { value: '8.50' },
          { value: '12' },
          { value: '1000' }
        ]
      },
      {
        cells: [
          { value: '0' },
          { value: '' },
          { value: '20260618' },
          { value: '0' },
          { value: '0' },
          { value: '0' },
          { value: '0' }
        ]
      }
    ]
  });

  assert.deepEqual(rows, [
    {
      date: '2026-06-18',
      domain: 'news.example.com',
      earnings: 8.5,
      pageViews: 1000,
      clicks: 12,
      impressions: 2000,
      rpm: 4.25
    }
  ]);
});

test('normalizes GA4 rows by positional dimensions and metrics', () => {
  const rows = normalizeGa4Rows({
    rows: [
      {
        dimensionValues: [{ value: '20260617' }, { value: 'sports.example.com' }],
        metricValues: [
          { value: '81' },
          { value: '1240' },
          { value: '0.42' },
          { value: '300' }
        ]
      },
      {
        dimensionValues: [{ value: '20260617' }, { value: '' }],
        metricValues: []
      }
    ]
  });

  assert.deepEqual(rows, [
    {
      date: '2026-06-17',
      domain: 'sports.example.com',
      activeUsers: 81,
      pageViews: 1240,
      bounceRate: 0.42,
      engagedSessions: 300
    }
  ]);
});

test('AdSense report request includes all contracted metrics', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return Response.json({ headers: [], rows: [] });
  };

  await fetchAdsenseDomainReport({
    accessToken: 'token',
    accountId: 'accounts/pub-123',
    from: '2026-06-01',
    to: '2026-06-18'
  });

  assert.deepEqual(requestedUrl.searchParams.getAll('metrics'), [
    'ESTIMATED_EARNINGS',
    'PAGE_VIEWS',
    'CLICKS',
    'IMPRESSIONS',
    'PAGE_VIEWS_RPM'
  ]);
  assert.deepEqual(requestedUrl.searchParams.getAll('dimensions'), ['DATE', 'DOMAIN_NAME']);
});
