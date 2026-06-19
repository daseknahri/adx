import express from 'express';
import { requireClient } from '../middleware.js';

export function clientRouter(db) {
  const router = express.Router();
  router.use(requireClient);

  router.get('/dashboard', (req, res) => {
    const range = parseRange(req.query);
    const rows = db.prepare(`
      SELECT
        s.id,
        s.domain,
        s.category,
        s.unit_price AS unitPrice,
        s.rent_status AS rentStatus,
        COALESCE(cs.visible_from, substr(cs.assigned_at, 1, 10)) AS visibleFrom,
        COALESCE(SUM(m.visitors), 0) AS visitors,
        COALESCE(SUM(m.page_views), 0) AS pageViews,
        COALESCE(AVG(NULLIF(m.bounce_rate, 0)), 0) AS bounceRate,
        COALESCE(SUM(m.engaged_sessions), 0) AS engagedSessions,
        COALESCE(SUM(m.earnings), 0) AS earnings,
        COALESCE(SUM(m.active_users), 0) AS activeUsers,
        COALESCE(SUM(m.clicks), 0) AS clicks,
        COALESCE(SUM(m.impressions), 0) AS impressions,
        COALESCE(AVG(NULLIF(m.rpm, 0)), 0) AS rpm,
        COALESCE(AVG(NULLIF(m.adx_ctr, 0)), 0) AS adxCtr,
        COALESCE(AVG(NULLIF(m.adx_ecpm, 0)), 0) AS adxEcpm,
        COALESCE(MAX(m.source), 'empty') AS source
      FROM subdomains s
      INNER JOIN client_subdomains cs ON cs.subdomain_id = s.id
      LEFT JOIN metrics_daily m
        ON m.subdomain_id = s.id
        AND m.metric_date BETWEEN @from AND @to
        AND m.metric_date >= COALESCE(cs.visible_from, substr(cs.assigned_at, 1, 10))
      WHERE cs.client_id = @clientId
      GROUP BY s.id
      ORDER BY earnings DESC, pageViews DESC
    `).all({ ...range, clientId: req.user.clientId });

    const totals = rows.reduce((acc, row) => {
      acc.earnings += row.earnings;
      acc.pageViews += row.pageViews;
      acc.visitors += row.visitors;
      acc.activeUsers += row.activeUsers;
      return acc;
    }, { earnings: 0, pageViews: 0, visitors: 0, activeUsers: 0 });
    totals.adxCtr = averageNonZero(rows.map((row) => row.adxCtr));
    totals.adxEcpm = averageNonZero(rows.map((row) => row.adxEcpm));

    res.json({ range, totals, rows });
  });

  router.get('/subdomains/:id/daily', (req, res) => {
    const range = parseRange(req.query);
    const subdomainId = Number(req.params.id);
    if (!Number.isInteger(subdomainId) || subdomainId < 1) {
      return res.status(400).json({ error: 'invalid_domain' });
    }
    const assignment = db.prepare(`
      SELECT COALESCE(visible_from, substr(assigned_at, 1, 10)) AS visibleFrom
      FROM client_subdomains
      WHERE client_id = ? AND subdomain_id = ?
    `).get(req.user.clientId, subdomainId);
    if (!assignment) return res.status(404).json({ error: 'not_found' });

    const rows = db.prepare(`
      SELECT metric_date AS date, visitors, page_views AS pageViews, bounce_rate AS bounceRate,
        engaged_sessions AS engagedSessions, earnings, active_users AS activeUsers,
        clicks, impressions, rpm, adx_ctr AS adxCtr, adx_ecpm AS adxEcpm, source
      FROM metrics_daily
      WHERE subdomain_id = @subdomainId
        AND metric_date BETWEEN @from AND @to
        AND metric_date >= @visibleFrom
      ORDER BY metric_date ASC
    `).all({ subdomainId, visibleFrom: assignment.visibleFrom, ...range });

    res.json({ range, rows });
  });

  return router;
}

function averageNonZero(values) {
  const clean = values.map(Number).filter((value) => value > 0);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function parseRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: String(query.from || today),
    to: String(query.to || today)
  };
}
