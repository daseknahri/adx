import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAdManagerRows } from '../server/services/admanager.js';

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
      clicks: 0,
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
