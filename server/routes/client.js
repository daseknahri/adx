import express from 'express';
import { requireClient } from '../middleware.js';

export function clientRouter(db) {
  const router = express.Router();
  router.use(requireClient);

  router.get('/dashboard', (req, res) => {
    const rows = db.prepare(`
      SELECT
        s.id,
        s.domain,
        s.category,
        s.unit_price AS unitPrice,
        s.rent_status AS rentStatus,
        COALESCE(cs.owner_cut_percent, 0) AS ownerCutPercent,
        100 - COALESCE(cs.owner_cut_percent, 0) AS clientSharePercent,
        COALESCE(SUM(m.visitors), 0) AS visitors,
        COALESCE(SUM(m.page_views), 0) AS pageViews,
        COALESCE(AVG(NULLIF(m.bounce_rate, 0)), 0) AS bounceRate,
        COALESCE(SUM(m.engaged_sessions), 0) AS engagedSessions,
        COALESCE(SUM(m.earnings), 0) AS grossEarnings,
        ROUND(COALESCE(SUM(m.earnings), 0) * COALESCE(cs.owner_cut_percent, 0) / 100, 2) AS ownerCut,
        ROUND(COALESCE(SUM(m.earnings), 0) * (100 - COALESCE(cs.owner_cut_percent, 0)) / 100, 2) AS earnings,
        COALESCE(SUM(m.active_users), 0) AS activeUsers,
        COALESCE(SUM(m.clicks), 0) AS clicks,
        COALESCE(SUM(m.impressions), 0) AS impressions,
        COALESCE(AVG(NULLIF(m.rpm, 0)), 0) AS rpm,
        COALESCE(AVG(NULLIF(m.adx_ctr, 0)), 0) AS adxCtr,
        CASE
          WHEN COALESCE(SUM(m.impressions), 0) > 0
          THEN ROUND(COALESCE(SUM(m.earnings), 0) / SUM(m.impressions) * 1000, 2)
          ELSE COALESCE(AVG(NULLIF(m.adx_ecpm, 0)), 0)
        END AS adxEcpm,
        COALESCE(MAX(m.source), 'empty') AS source
      FROM subdomains s
      INNER JOIN client_subdomains cs ON cs.subdomain_id = s.id
      LEFT JOIN metrics_daily m
        ON m.subdomain_id = s.id
      WHERE cs.client_id = @clientId
      GROUP BY s.id, cs.owner_cut_percent
      ORDER BY earnings DESC, pageViews DESC
    `).all({ clientId: req.user.clientId });

    const totals = rows.reduce((acc, row) => {
      acc.earnings += row.earnings;
      acc.grossEarnings += row.grossEarnings;
      acc.ownerCut += row.ownerCut;
      acc.pageViews += row.pageViews;
      acc.visitors += row.visitors;
      acc.activeUsers += row.activeUsers;
      acc.clicks += row.clicks;
      acc.impressions += row.impressions;
      return acc;
    }, { earnings: 0, grossEarnings: 0, ownerCut: 0, pageViews: 0, visitors: 0, activeUsers: 0, clicks: 0, impressions: 0 });
    applyAdTotals(totals, rows, 'grossEarnings');

    res.json({ totals, rows });
  });

  router.get('/subdomains/:id/daily', (req, res) => {
    const subdomainId = Number(req.params.id);
    if (!Number.isInteger(subdomainId) || subdomainId < 1) {
      return res.status(400).json({ error: 'invalid_domain' });
    }
    const assignment = db.prepare(`
      SELECT COALESCE(owner_cut_percent, 0) AS ownerCutPercent
      FROM client_subdomains
      WHERE client_id = ? AND subdomain_id = ?
    `).get(req.user.clientId, subdomainId);
    if (!assignment) return res.status(404).json({ error: 'not_found' });

    const rows = db.prepare(`
      SELECT metric_date AS date, visitors, page_views AS pageViews, bounce_rate AS bounceRate,
        engaged_sessions AS engagedSessions,
        earnings AS grossEarnings,
        ROUND(earnings * @ownerCutPercent / 100, 2) AS ownerCut,
        ROUND(earnings * (100 - @ownerCutPercent) / 100, 2) AS earnings,
        active_users AS activeUsers,
        clicks, impressions, rpm, adx_ctr AS adxCtr, adx_ecpm AS adxEcpm, source
      FROM metrics_daily
      WHERE subdomain_id = @subdomainId
      ORDER BY metric_date ASC
    `).all({
      subdomainId,
      ownerCutPercent: assignment.ownerCutPercent
    });

    res.json({ rows });
  });

  return router;
}

function averageNonZero(values) {
  const clean = values.map(Number).filter((value) => value > 0);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function applyAdTotals(totals, rows, revenueKey) {
  totals.adxCtr = totals.clicks > 0 && totals.impressions > 0
    ? (totals.clicks / totals.impressions) * 100
    : averageNonZero(rows.map((row) => row.adxCtr));
  totals.adxEcpm = totals.impressions > 0
    ? (totals[revenueKey] / totals.impressions) * 1000
    : averageNonZero(rows.map((row) => row.adxEcpm));
}
