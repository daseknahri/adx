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

    if (config.enableGoogleSync) {
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

    const rowsSynced = writeMetrics(
      db,
      domains,
      range,
      revenueRows,
      ga4Rows,
      sourceMode
    );
    finishRun(db, syncRunId, 'success', `Synced ${rowsSynced} domain rows`, rowsSynced);
    return { ok: true, syncRunId, rowsSynced, mode: sourceMode };
  } catch (error) {
    finishRun(db, syncRunId, 'failed', error.message, 0);
    return { ok: false, syncRunId, error: error.message };
  }
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

function writeMetrics(db, domains, range, revenueRows, ga4Rows, sourceMode) {
  const dates = listDates(range.from, range.to);
  const revenueByKey = new Map(revenueRows.map((row) => [metricKey(row.domain, row.date || range.to), row]));
  const ga4ByKey = new Map(ga4Rows.map((row) => [metricKey(row.domain, row.date || range.to), row]));
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
    for (const domain of domains) {
      for (const metricDate of dates) {
        const key = metricKey(domain.domain, metricDate);
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
    }
    return count;
  });
  return tx();
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
  return `${domain}|${date}`;
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
