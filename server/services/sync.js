import { getAccessToken } from './google-oauth.js';
import { fetchAdManagerReport } from './admanager.js';
import { fetchAdsenseDomainReport } from './adsense.js';
import { fetchGa4DomainReport } from './ga4.js';

export async function syncGoogleReports(db, config, range) {
  const syncRunId = startRun(db, 'google');
  try {
    const domains = db.prepare('SELECT id, domain FROM subdomains').all();
    let revenueRows = [];
    let ga4Rows = [];
    let sourceMode = 'mock';
    const canUseLiveSync = config.enableGoogleSync || hasGoogleConnection(db);

    if (canUseLiveSync) {
      const accessToken = await getAccessToken(db, config);
      if (!accessToken) throw new Error('Google is not connected');
      if (config.adManagerNetworkCode && config.adManagerReportId) {
        revenueRows = await fetchAdManagerReport({
          accessToken,
          networkCode: config.adManagerNetworkCode,
          reportId: config.adManagerReportId,
          from: range.from,
          to: range.to,
          metrics: config.adManagerReportMetrics,
          dimensions: config.adManagerReportDimensions
        });
        sourceMode = 'admanager';
      } else {
        revenueRows = await fetchAdsenseDomainReport({
          accessToken,
          accountId: config.adsenseAccountId,
          from: range.from,
          to: range.to
        });
        sourceMode = 'adsense';
      }
      if (config.ga4PropertyId) {
        ga4Rows = await fetchGa4DomainReport({
          accessToken,
          propertyId: config.ga4PropertyId,
          from: range.from,
          to: range.to
        });
      }
    } else {
      revenueRows = createMockRevenue(domains, range);
      ga4Rows = createMockGa4(domains, range);
      sourceMode = 'mock';
    }

    const writeResult = writeMetrics(
      db,
      domains,
      range,
      revenueRows,
      ga4Rows,
      sourceMode
    );
    const message = syncSuccessMessage(writeResult, sourceMode);
    finishRun(db, syncRunId, 'success', message, writeResult.rowsSynced);
    return {
      ok: true,
      syncRunId,
      rowsSynced: writeResult.rowsSynced,
      mode: sourceMode,
      range,
      stats: writeResult
    };
  } catch (error) {
    finishRun(db, syncRunId, 'failed', error.message, 0);
    return { ok: false, syncRunId, error: error.message };
  }
}

export async function syncGoogleLatest(db, config) {
  const today = todayIso();
  const latest = latestSyncedDate(db);
  const from = latest && latest <= today ? latest : today;
  return syncGoogleReports(db, config, { from, to: today });
}

export async function syncGoogleBackfill(db, config) {
  const today = todayIso();
  const earliest = earliestSyncedDate(db);
  const from = earliest || offsetIso(-Number(config.adxBackfillDays || 90));
  return syncGoogleReports(db, config, { from, to: today });
}

function startRun(db, provider) {
  const result = db.prepare(`
    INSERT INTO sync_runs (provider, status)
    VALUES (?, 'running')
  `).run(provider);
  return Number(result.lastInsertRowid);
}

function finishRun(db, id, status, message, rowsSynced) {
  db.prepare(`
    UPDATE sync_runs
    SET status = ?, message = ?, rows_synced = ?, finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, message, rowsSynced, id);
}

function hasGoogleConnection(db) {
  const row = db.prepare('SELECT refresh_token AS refreshToken FROM google_connections WHERE id = 1').get();
  return Boolean(row?.refreshToken);
}

function latestSyncedDate(db) {
  const row = db.prepare(`
    SELECT MAX(metric_date) AS latestDate
    FROM metrics_daily
    WHERE source IN ('admanager', 'adsense', 'ga4', 'mock')
  `).get();
  return row?.latestDate || null;
}

function earliestSyncedDate(db) {
  const row = db.prepare(`
    SELECT MIN(metric_date) AS earliestDate
    FROM metrics_daily
    WHERE source IN ('admanager', 'adsense', 'ga4', 'mock')
  `).get();
  return row?.earliestDate || null;
}

function writeMetrics(db, domains, range, revenueRows, ga4Rows, sourceMode) {
  const dates = listDates(range.from, range.to);
  const domainIndex = buildDomainIndex(domains);
  const revenueByKey = new Map();
  const ga4ByKey = new Map();
  let unmatchedRows = 0;

  for (const row of revenueRows) {
    const indexedDomain = domainIndex.get(normalizeDomain(row.domain));
    if (!indexedDomain) {
      unmatchedRows += 1;
      continue;
    }
    revenueByKey.set(metricKey(indexedDomain.domain, row.date || range.to), row);
  }

  for (const row of ga4Rows) {
    const indexedDomain = domainIndex.get(normalizeDomain(row.domain));
    if (!indexedDomain) {
      unmatchedRows += 1;
      continue;
    }
    ga4ByKey.set(metricKey(indexedDomain.domain, row.date || range.to), row);
  }

  const keysToWrite = sourceMode === 'mock'
    ? domains.flatMap((domain) => dates.map((metricDate) => metricKey(domain.domain, metricDate)))
    : Array.from(new Set([...revenueByKey.keys(), ...ga4ByKey.keys()]));
  const upsert = db.prepare(`
    INSERT INTO metrics_daily (
      subdomain_id, metric_date, visitors, page_views, bounce_rate, engaged_sessions,
      earnings, active_users, clicks, impressions, rpm, adx_ctr, adx_ecpm, source, updated_at
    )
    VALUES (@subdomainId, @metricDate, @visitors, @pageViews, @bounceRate, @engagedSessions,
      @earnings, @activeUsers, @clicks, @impressions, @rpm, @adxCtr, @adxEcpm, @source, CURRENT_TIMESTAMP)
    ON CONFLICT(subdomain_id, metric_date) DO UPDATE SET
      visitors = excluded.visitors,
      page_views = excluded.page_views,
      bounce_rate = excluded.bounce_rate,
      engaged_sessions = excluded.engaged_sessions,
      earnings = excluded.earnings,
      active_users = excluded.active_users,
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      rpm = excluded.rpm,
      adx_ctr = excluded.adx_ctr,
      adx_ecpm = excluded.adx_ecpm,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `);

  const tx = db.transaction(() => {
    let count = 0;
    for (const key of keysToWrite) {
      const [domainName, metricDate] = splitMetricKey(key);
      const domain = domainIndex.get(normalizeDomain(domainName));
      if (!domain) continue;
      const ad = revenueByKey.get(key) || {};
      const ga = ga4ByKey.get(key) || {};
      upsert.run({
        subdomainId: domain.id,
        metricDate,
        visitors: ga.activeUsers || 0,
        pageViews: ad.pageViews || ga.pageViews || 0,
        bounceRate: ga.bounceRate || 0,
        engagedSessions: ga.engagedSessions || 0,
        earnings: ad.earnings || 0,
        activeUsers: ga.activeUsers || 0,
        clicks: ad.clicks || 0,
        impressions: ad.impressions || 0,
        rpm: ad.rpm || 0,
        adxCtr: ad.adxCtr || 0,
        adxEcpm: ad.adxEcpm || 0,
        source: metricSource(ad, ga, sourceMode)
      });
      count += 1;
    }
    return count;
  });
  const rowsSynced = tx();
  return {
    rowsSynced,
    datesRequested: dates.length,
    domainsTracked: domains.length,
    adRowsReturned: revenueRows.length,
    analyticsRowsReturned: ga4Rows.length,
    unmatchedRows,
    skippedEmptyRows: sourceMode === 'mock' ? 0 : Math.max(0, domains.length * dates.length - rowsSynced)
  };
}

function syncSuccessMessage(result, sourceMode) {
  const returned = result.adRowsReturned + result.analyticsRowsReturned;
  const parts = [`Synced ${result.rowsSynced} domain rows`];
  if (sourceMode !== 'mock') {
    parts.push(sourceMode);
    parts.push(`${returned} returned`);
    if (result.unmatchedRows) parts.push(`${result.unmatchedRows} unmatched`);
    if (result.skippedEmptyRows) parts.push(`${result.skippedEmptyRows} unchanged`);
  }
  return parts.join(' · ');
}

function metricSource(ad, ga, sourceMode) {
  if (sourceMode === 'mock' && (ad.domain || ga.domain)) return 'mock';
  if (ad.domain) return sourceMode;
  if (ga.domain) return 'ga4';
  return 'empty';
}

function createMockRevenue(domains, range) {
  return domains.flatMap((domain, index) => listDates(range.from, range.to).map((date, dayIndex) => {
    const pageViews = 900 + index * 370 + dayIndex * 27;
    const earnings = Number((pageViews * (0.004 + index * 0.001)).toFixed(2));
    const adxEcpm = Number(((earnings / pageViews) * 1000).toFixed(2));
    return {
      date,
      domain: domain.domain,
      earnings,
      pageViews,
      clicks: 20 + index * 7 + dayIndex,
      impressions: pageViews * 2,
      rpm: adxEcpm,
      adxCtr: Number(((20 + index * 7 + dayIndex) / (pageViews * 2) * 100).toFixed(2)),
      adxEcpm
    };
  }));
}

function createMockGa4(domains, range) {
  return domains.flatMap((domain, index) => listDates(range.from, range.to).map((date, dayIndex) => ({
    date,
    domain: domain.domain,
    activeUsers: 70 + index * 16 + dayIndex,
    pageViews: 1000 + index * 250 + dayIndex * 33,
    bounceRate: 0.34 + index * 0.04,
    engagedSessions: 150 + index * 32 + dayIndex * 3
  })));
}

function metricKey(domain, date) {
  return `${normalizeDomain(domain)}|${date}`;
}

function splitMetricKey(key) {
  const separatorIndex = key.lastIndexOf('|');
  return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

function buildDomainIndex(domains) {
  const index = new Map();
  for (const domain of domains) {
    const normalized = normalizeDomain(domain.domain);
    index.set(normalized, domain);
    if (normalized.startsWith('www.')) {
      index.set(normalized.slice(4), domain);
    } else {
      index.set(`www.${normalized}`, domain);
    }
  }
  return index;
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/:\d+$/, '');
}

function listDates(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates.length ? dates : [to];
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function offsetIso(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
