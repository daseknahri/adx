import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchAdManagerReport, normalizeAdManagerRows } from '../server/services/admanager.js';

test('normalizes Ad Manager report rows with configured Site metrics', () => {
  const rows = normalizeAdManagerRows({
    rows: [
      {
        dimensionValues: [{ value: 'allrecipe.panrecipe.com' }],
        metricValueGroups: [
          {
            values: [
              { value: 'MAD23.48' },
              { value: '5.98%' },
              { value: 'MAD36.97' }
            ]
          }
        ]
      }
    ]
  }, {
    range: { from: '2026-06-18', to: '2026-06-18' },
    dimensions: ['SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM']
  });

  assert.deepEqual(rows, [
    {
      date: '2026-06-18',
      domain: 'allrecipe.panrecipe.com',
      earnings: 23.48,
      pageViews: 635,
      activeUsers: 0,
      clicks: 38,
      impressions: 635,
      rpm: 36.97,
      adxCtr: 5.98,
      adxEcpm: 36.97
    }
  ]);
});

test('normalizes named Ad Manager row values when date is included', () => {
  const rows = normalizeAdManagerRows({
    rows: [
      {
        DATE: { value: '20260618' },
        SITE: { value: 'https://beste-oppskrifter.panrecipe.com/' },
        REVENUE: { microsValue: '829420000' },
        AD_EXCHANGE_CTR: { doubleValue: 1.84 },
        AD_EXCHANGE_AVERAGE_ECPM: { value: 'MAD19.96' },
        PAGE_VIEWS: { intValue: 1200 }
      }
    ]
  }, {
    range: { from: '2026-06-18', to: '2026-06-18' },
    dimensions: ['DATE', 'SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'PAGE_VIEWS']
  });

  assert.equal(rows[0].date, '2026-06-18');
  assert.equal(rows[0].domain, 'beste-oppskrifter.panrecipe.com');
  assert.equal(rows[0].earnings, 829.42);
  assert.equal(rows[0].adxCtr, 1.84);
  assert.equal(rows[0].adxEcpm, 19.96);
  assert.equal(rows[0].pageViews, 1200);
});

test('normalizes Ad Manager total impressions by metric position', () => {
  const rows = normalizeAdManagerRows({
    rows: [
      {
        dimensionValues: [{ value: 'allrecipes.panrecipe.com' }],
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
  }, {
    range: { from: '2026-06-19', to: '2026-06-19' },
    dimensions: ['SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS']
  });

  assert.equal(rows[0].domain, 'allrecipes.panrecipe.com');
  assert.equal(rows[0].date, '2026-06-19');
  assert.equal(rows[0].earnings, 24.18);
  assert.equal(rows[0].adxCtr, 2.63);
  assert.equal(rows[0].adxEcpm, 25.42);
  assert.equal(rows[0].impressions, 951);
  assert.equal(rows[0].pageViews, 951);
});

test('fetches site-only Ad Manager reports once per day for range accuracy', async (t) => {
  const originalFetch = globalThis.fetch;
  const patchedDates = [];
  let currentDate = '';
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/networks/23350042371/reports/7704780540')) {
      return Response.json({
        name: 'networks/23350042371/reports/7704780540',
        reportDefinition: {
          dimensions: ['DATE', 'SITE'],
          metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
          dateRange: { relative: 'TODAY' }
        }
      });
    }
    if (target.includes('/networks/23350042371/reports/7704780540?updateMask=reportDefinition.dateRange')) {
      assert.equal(options.method, 'PATCH');
      const body = JSON.parse(options.body);
      const startDate = body.reportDefinition.dateRange.fixed.startDate;
      currentDate = `${startDate.year}-${String(startDate.month).padStart(2, '0')}-${String(startDate.day).padStart(2, '0')}`;
      patchedDates.push(currentDate);
      return Response.json(body);
    }
    if (target.endsWith('/networks/23350042371/reports/7704780540:run')) {
      return Response.json({ name: `networks/23350042371/operations/reports/runs/${currentDate}` });
    }
    if (target.includes('/operations/reports/runs/')) {
      return Response.json({
        done: true,
        response: {
          reportResult: `networks/23350042371/reports/7704780540/results/${currentDate}`
        }
      });
    }
    if (target.includes('/results/2026-06-18:fetchRows')) {
      return Response.json({
        rows: [{
          dimensionValues: [{ value: 'allrecipes.panrecipe.com' }],
          metricValueGroups: [{ values: [{ value: 'MAD10.00' }, { value: '2.00%' }, { value: 'MAD20.00' }, { value: '500' }] }]
        }]
      });
    }
    if (target.includes('/results/2026-06-19:fetchRows')) {
      return Response.json({
        rows: [{
          dimensionValues: [{ value: 'allrecipes.panrecipe.com' }],
          metricValueGroups: [{ values: [{ value: 'MAD24.18' }, { value: '2.63%' }, { value: 'MAD25.42' }, { value: '951' }] }]
        }]
      });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const rows = await fetchAdManagerReport({
    accessToken: 'access-token',
    networkCode: '23350042371',
    reportId: '7704780540',
    from: '2026-06-18',
    to: '2026-06-19',
    dimensions: ['SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS']
  });

  assert.deepEqual(patchedDates, ['2026-06-18', '2026-06-19']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.date), ['2026-06-18', '2026-06-19']);
  assert.deepEqual(rows.map((row) => row.earnings), [10, 24.18]);
  assert.deepEqual(rows.map((row) => row.impressions), [500, 951]);
});

test('fast Ad Manager backfill requests date and site dimensions in one range run', async (t) => {
  const originalFetch = globalThis.fetch;
  let runCount = 0;
  const patchedDefinitions = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/networks/23350042371/reports/7704780540')) {
      return Response.json({
        name: 'networks/23350042371/reports/7704780540',
        reportDefinition: {
          dimensions: ['DATE', 'SITE'],
          metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
          dateRange: { relative: 'TODAY' }
        }
      });
    }
    if (target.includes('/networks/23350042371/reports/7704780540?updateMask=')) {
      assert.equal(options.method, 'PATCH');
      assert.match(target, /reportDefinition\.dateRange/);
      assert.doesNotMatch(target, /reportDefinition\.dimensions/);
      assert.doesNotMatch(target, /reportDefinition\.metrics/);
      const body = JSON.parse(options.body);
      patchedDefinitions.push(body.reportDefinition);
      return Response.json(body);
    }
    if (target.endsWith('/networks/23350042371/reports/7704780540:run')) {
      runCount += 1;
      return Response.json({ name: 'networks/23350042371/operations/reports/runs/range' });
    }
    if (target.includes('/operations/reports/runs/range')) {
      return Response.json({
        done: true,
        response: {
          reportResult: 'networks/23350042371/reports/7704780540/results/range'
        }
      });
    }
    if (target.includes('/results/range:fetchRows')) {
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: '20260618' }, { value: 'allrecipes.panrecipe.com' }],
            metricValueGroups: [{ values: [{ value: 'MAD10.00' }, { value: '2.00%' }, { value: 'MAD20.00' }, { value: '500' }] }]
          },
          {
            dimensionValues: [{ value: '20260619' }, { value: 'allrecipes.panrecipe.com' }],
            metricValueGroups: [{ values: [{ value: 'MAD24.18' }, { value: '2.63%' }, { value: 'MAD25.42' }, { value: '951' }] }]
          }
        ]
      });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const rows = await fetchAdManagerReport({
    accessToken: 'access-token',
    networkCode: '23350042371',
    reportId: '7704780540',
    from: '2026-06-18',
    to: '2026-06-19',
    dimensions: ['SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
    preferDateDimension: true
  });

  assert.equal(runCount, 1);
  assert.equal(patchedDefinitions.length, 1);
  assert.deepEqual(patchedDefinitions[0].dateRange, {
    fixed: {
      startDate: { year: 2026, month: 6, day: 18 },
      endDate: { year: 2026, month: 6, day: 19 }
    }
  });
  assert.deepEqual(rows.map((row) => row.date), ['2026-06-18', '2026-06-19']);
  assert.deepEqual(rows.map((row) => row.earnings), [10, 24.18]);
});

test('date-dimension Ad Manager sync skips fast path when saved report lacks date', async (t) => {
  const originalFetch = globalThis.fetch;
  const patchedTargets = [];
  let currentDate = '';
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
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
    if (target.includes('/networks/23350042371/reports/7704780540?updateMask=')) {
      patchedTargets.push(target);
      const body = JSON.parse(options.body);
      if (target.includes('reportDefinition.dimensions')) {
        throw new Error('Dimensions should not be patched');
      }
      const startDate = body.reportDefinition.dateRange.fixed.startDate;
      currentDate = `${startDate.year}-${String(startDate.month).padStart(2, '0')}-${String(startDate.day).padStart(2, '0')}`;
      return Response.json(body);
    }
    if (target.endsWith('/networks/23350042371/reports/7704780540:run')) {
      return Response.json({ name: `networks/23350042371/operations/reports/runs/${currentDate}` });
    }
    if (target.includes('/operations/reports/runs/')) {
      return Response.json({
        done: true,
        response: {
          reportResult: `networks/23350042371/reports/7704780540/results/${currentDate}`
        }
      });
    }
    if (target.includes('/results/2026-06-18:fetchRows')) {
      return Response.json({
        rows: [{
          dimensionValues: [{ value: 'allrecipes.panrecipe.com' }],
          metricValueGroups: [{ values: [{ value: 'MAD10.00' }, { value: '2.00%' }, { value: 'MAD20.00' }, { value: '500' }] }]
        }]
      });
    }
    if (target.includes('/results/2026-06-19:fetchRows')) {
      return Response.json({
        rows: [{
          dimensionValues: [{ value: 'allrecipes.panrecipe.com' }],
          metricValueGroups: [{ values: [{ value: 'MAD24.18' }, { value: '2.63%' }, { value: 'MAD25.42' }, { value: '951' }] }]
        }]
      });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const rows = await fetchAdManagerReport({
    accessToken: 'access-token',
    networkCode: '23350042371',
    reportId: '7704780540',
    from: '2026-06-18',
    to: '2026-06-19',
    dimensions: ['DATE', 'SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
    preferDateDimension: true
  });

  assert.equal(patchedTargets.some((target) => target.includes('reportDefinition.dimensions')), false);
  assert.equal(patchedTargets.filter((target) => target.endsWith('updateMask=reportDefinition.dateRange')).length, 2);
  assert.deepEqual(rows.map((row) => row.date), ['2026-06-18', '2026-06-19']);
  assert.deepEqual(rows.map((row) => row.earnings), [10, 24.18]);
});

test('creates a hidden Ad Manager API report when no saved report id is configured', async (t) => {
  const originalFetch = globalThis.fetch;
  const createdReports = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/networks/23350042371/reports')) {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      createdReports.push(body);
      assert.equal(body.visibility, 'HIDDEN');
      assert.deepEqual(body.reportDefinition.dimensions, ['DATE', 'SITE']);
      assert.deepEqual(body.reportDefinition.metrics, [
        'REVENUE',
        'AD_EXCHANGE_CTR',
        'AD_EXCHANGE_AVERAGE_ECPM',
        'IMPRESSIONS'
      ]);
      return Response.json({ name: 'networks/23350042371/reports/generated-1' });
    }
    if (target.endsWith('/networks/23350042371/reports/generated-1:run')) {
      return Response.json({ name: 'networks/23350042371/operations/reports/runs/generated-1' });
    }
    if (target.includes('/operations/reports/runs/generated-1')) {
      return Response.json({
        done: true,
        response: {
          reportResult: 'networks/23350042371/reports/generated-1/results/range'
        }
      });
    }
    if (target.includes('/results/range:fetchRows')) {
      return Response.json({
        rows: [{
          dimensionValues: [{ value: '20260619' }, { value: 'allrecipes.panrecipe.com' }],
          metricValueGroups: [{ values: [{ value: 'MAD24.18' }, { value: '2.63%' }, { value: 'MAD25.42' }, { value: '951' }] }]
        }]
      });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const rows = await fetchAdManagerReport({
    accessToken: 'access-token',
    networkCode: '23350042371',
    reportId: '',
    from: '2026-06-18',
    to: '2026-06-19',
    dimensions: ['SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
    preferDateDimension: true
  });

  assert.equal(createdReports.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-06-19');
  assert.equal(rows[0].impressions, 951);
});

test('falls back to a generated Ad Manager API report when saved report id is stale', async (t) => {
  const originalFetch = globalThis.fetch;
  let createCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/networks/23350042371/reports/7704780540')) {
      return Response.json({
        error: {
          code: 404,
          message: 'Entity was not found.',
          status: 'NOT_FOUND'
        }
      }, { status: 404 });
    }
    if (target.endsWith('/networks/23350042371/reports')) {
      createCount += 1;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.reportDefinition.dimensions, ['DATE', 'SITE']);
      return Response.json({ name: 'networks/23350042371/reports/generated-stale' });
    }
    if (target.endsWith('/networks/23350042371/reports/generated-stale:run')) {
      return Response.json({ name: 'networks/23350042371/operations/reports/runs/generated-stale' });
    }
    if (target.includes('/operations/reports/runs/generated-stale')) {
      return Response.json({
        done: true,
        response: {
          reportResult: 'networks/23350042371/reports/generated-stale/results/range'
        }
      });
    }
    if (target.includes('/results/range:fetchRows')) {
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: '20260618' }, { value: 'allrecipes.panrecipe.com' }],
            metricValueGroups: [{ values: [{ value: 'MAD10.00' }, { value: '2.00%' }, { value: 'MAD20.00' }, { value: '500' }] }]
          },
          {
            dimensionValues: [{ value: '20260619' }, { value: 'allrecipes.panrecipe.com' }],
            metricValueGroups: [{ values: [{ value: 'MAD24.18' }, { value: '2.63%' }, { value: 'MAD25.42' }, { value: '951' }] }]
          }
        ]
      });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };

  const rows = await fetchAdManagerReport({
    accessToken: 'access-token',
    networkCode: '23350042371',
    reportId: '7704780540',
    from: '2026-06-18',
    to: '2026-06-19',
    dimensions: ['SITE'],
    metrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
    preferDateDimension: true
  });

  assert.equal(createCount, 1);
  assert.deepEqual(rows.map((row) => row.date), ['2026-06-18', '2026-06-19']);
  assert.deepEqual(rows.map((row) => row.impressions), [500, 951]);
});
