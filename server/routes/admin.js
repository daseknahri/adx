import express from 'express';
import { hashPassword } from '../auth.js';
import { audit, requireAdmin } from '../middleware.js';
import { getGoogleStatus, startOAuth, handleOAuthCallback } from '../services/google-oauth.js';
import { syncGoogleBackfill, syncGoogleLatest, syncGoogleReports } from '../services/sync.js';

export function adminRouter(db, config, syncJobs = null) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/overview', (req, res) => {
    const range = parseRange(db, req.query);
    const rows = domainRows(db, range);
    const totals = rows.reduce((acc, row) => {
      acc.earnings += row.earnings;
      acc.clientEarnings += row.clientEarnings;
      acc.ownerCut += row.ownerCut;
      acc.pageViews += row.pageViews;
      acc.visitors += row.visitors;
      acc.activeUsers += row.activeUsers;
      acc.clicks += row.clicks;
      acc.impressions += row.impressions;
      return acc;
    }, { earnings: 0, clientEarnings: 0, ownerCut: 0, pageViews: 0, visitors: 0, activeUsers: 0, clicks: 0, impressions: 0 });
    applyAdTotals(totals, rows, 'earnings');

    const latestSync = db.prepare(`
      SELECT provider, status, started_at AS startedAt, finished_at AS finishedAt, message, rows_synced AS rowsSynced
      FROM sync_runs
      ORDER BY id DESC
      LIMIT 5
    `).all();
    const syncSummary = dataFreshness(db);
    const jobSummary = syncJobs ? {
      active: syncJobs.active(),
      recent: syncJobs.list(5)
    } : { active: [], recent: [] };

    res.json({ range, totals, rows, latestSync, syncSummary, syncJobs: jobSummary });
  });

  router.get('/clients', (req, res) => {
    const clients = db.prepare(`
      SELECT c.id, c.name, c.company, c.email, c.status, c.notes,
        COUNT(cs.subdomain_id) AS subdomainCount
      FROM clients c
      LEFT JOIN client_subdomains cs ON cs.client_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all();
    res.json({ clients });
  });

  router.get('/clients/:id/subdomains', (req, res) => {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId < 1) {
      return res.status(400).json({ error: 'invalid_client' });
    }
    const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(clientId);
    if (!client) return res.status(404).json({ error: 'not_found' });

    const assigned = db.prepare(`
      SELECT s.id, s.domain, s.category, s.rent_status AS rentStatus,
        COALESCE(cs.visible_from, substr(cs.assigned_at, 1, 10)) AS visibleFrom,
        COALESCE(cs.owner_cut_percent, 0) AS ownerCutPercent
      FROM client_subdomains cs
      INNER JOIN subdomains s ON s.id = cs.subdomain_id
      WHERE cs.client_id = ?
      ORDER BY s.domain ASC
    `).all(clientId);
    const available = db.prepare(`
      SELECT s.id, s.domain, s.category, s.rent_status AS rentStatus
      FROM subdomains s
      WHERE NOT EXISTS (
        SELECT 1
        FROM client_subdomains cs
        WHERE cs.subdomain_id = s.id
      )
      ORDER BY s.domain ASC
    `).all();

    res.json({ client, assigned, available });
  });

  router.post('/workspace/clear', (req, res) => {
    if (String(req.body?.confirm || '').trim() !== 'CLEAR') {
      return res.status(400).json({ error: 'confirmation_required' });
    }

    const result = db.transaction(() => {
      const before = {
        clients: db.prepare('SELECT COUNT(*) AS count FROM clients').get().count,
        subdomains: db.prepare('SELECT COUNT(*) AS count FROM subdomains').get().count,
        metricRows: db.prepare('SELECT COUNT(*) AS count FROM metrics_daily').get().count
      };

      db.prepare('DELETE FROM metrics_daily').run();
      db.prepare('DELETE FROM client_subdomains').run();
      db.prepare('DELETE FROM users WHERE role = ?').run('client');
      db.prepare('DELETE FROM clients').run();
      db.prepare('DELETE FROM subdomains').run();
      db.prepare('DELETE FROM sync_jobs').run();
      db.prepare('DELETE FROM sync_runs').run();
      audit(db, req, 'workspace.cleared', 'workspace', null, before);
      return before;
    })();

    res.json({ ok: true, cleared: result });
  });

  router.post('/clients', (req, res) => {
    const input = cleanClientInput(req.body);
    if (!input.name || !input.email) return res.status(400).json({ error: 'invalid_client' });

    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO clients (name, company, email, status, notes)
        VALUES (@name, @company, @email, @status, @notes)
      `).run(input);
      const clientId = Number(result.lastInsertRowid);

      if (req.body.password) {
        db.prepare(`
          INSERT INTO users (email, password_hash, role, name, client_id)
          VALUES (?, ?, 'client', ?, ?)
        `).run(input.email, hashPassword(String(req.body.password)), input.name, clientId);
      }

      audit(db, req, 'client.created', 'client', clientId, input);
      return clientId;
    });

    res.status(201).json({ client: { id: tx(), ...input } });
  });

  router.patch('/clients/:id', (req, res) => {
    const id = Number(req.params.id);
    const input = cleanClientInput(req.body);
    const password = String(req.body?.password || '').trim();
    const result = db.transaction(() => {
      const update = db.prepare(`
        UPDATE clients
        SET name = @name, company = @company, email = @email, status = @status, notes = @notes
        WHERE id = @id
      `).run({ ...input, id });
      if (update.changes) {
        const existingUser = db.prepare('SELECT id FROM users WHERE client_id = ? AND role = ?').get(id, 'client');
        const passwordHash = password ? hashPassword(password) : null;
        if (existingUser && passwordHash) {
          db.prepare(`
            UPDATE users
            SET email = @email, name = @name, password_hash = @passwordHash,
                active = CASE WHEN @status = 'ended' THEN 0 ELSE 1 END
            WHERE client_id = @id AND role = 'client'
          `).run({ ...input, id, passwordHash });
        } else if (existingUser) {
          db.prepare(`
            UPDATE users
            SET email = @email, name = @name, active = CASE WHEN @status = 'ended' THEN 0 ELSE 1 END
            WHERE client_id = @id AND role = 'client'
          `).run({ ...input, id });
        } else if (passwordHash) {
          db.prepare(`
            INSERT INTO users (email, password_hash, role, name, client_id, active)
            VALUES (@email, @passwordHash, 'client', @name, @id, CASE WHEN @status = 'ended' THEN 0 ELSE 1 END)
          `).run({ ...input, id, passwordHash });
        }
      }
      return update;
    })();
    if (!result.changes) return res.status(404).json({ error: 'not_found' });
    audit(db, req, 'client.updated', 'client', id, { ...input, passwordChanged: Boolean(password) });
    res.json({ ok: true });
  });

  router.delete('/clients/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_client' });

    const result = db.transaction(() => {
      const client = db.prepare('SELECT id, name, email FROM clients WHERE id = ?').get(id);
      if (!client) return { changes: 0 };
      db.prepare('DELETE FROM users WHERE client_id = ? AND role = ?').run(id, 'client');
      db.prepare('DELETE FROM client_subdomains WHERE client_id = ?').run(id);
      const deleted = db.prepare('DELETE FROM clients WHERE id = ?').run(id);
      audit(db, req, 'client.deleted', 'client', id, client);
      return deleted;
    })();

    if (!result.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  router.get('/subdomains', (req, res) => {
    res.json({ subdomains: domainRows(db, parseRange(db, req.query)) });
  });

  router.get('/subdomains/:id/daily', (req, res) => {
    const range = parseRange(db, req.query);
    const subdomainId = Number(req.params.id);
    if (!Number.isInteger(subdomainId) || subdomainId < 1) {
      return res.status(400).json({ error: 'invalid_domain' });
    }

    const domain = db.prepare('SELECT id FROM subdomains WHERE id = ?').get(subdomainId);
    if (!domain) return res.status(404).json({ error: 'not_found' });

    const rows = db.prepare(`
      SELECT metric_date AS date, visitors, page_views AS pageViews, bounce_rate AS bounceRate,
        engaged_sessions AS engagedSessions, earnings, active_users AS activeUsers,
        clicks, impressions, rpm, adx_ctr AS adxCtr, adx_ecpm AS adxEcpm, source
      FROM metrics_daily
      WHERE subdomain_id = @subdomainId
        AND metric_date BETWEEN @from AND @to
      ORDER BY metric_date ASC
    `).all({ subdomainId, ...range });

    res.json({ range, rows });
  });

  router.post('/subdomains', (req, res) => {
    const input = cleanSubdomainInput(req.body);
    if (!input.domain) return res.status(400).json({ error: 'invalid_domain' });

    const result = db.prepare(`
      INSERT INTO subdomains (domain, category, unit_price, rent_status, notes)
      VALUES (@domain, @category, @unitPrice, @rentStatus, @notes)
    `).run(input);
    const id = Number(result.lastInsertRowid);
    audit(db, req, 'subdomain.created', 'subdomain', id, input);
    res.status(201).json({ subdomain: { id, ...input } });
  });

  router.patch('/subdomains/:id', (req, res) => {
    const id = Number(req.params.id);
    const input = cleanSubdomainInput(req.body);
    const result = db.prepare(`
      UPDATE subdomains
      SET domain = @domain, category = @category, unit_price = @unitPrice,
          rent_status = @rentStatus, notes = @notes
      WHERE id = @id
    `).run({ ...input, id });
    if (!result.changes) return res.status(404).json({ error: 'not_found' });
    audit(db, req, 'subdomain.updated', 'subdomain', id, input);
    res.json({ ok: true });
  });

  router.delete('/subdomains/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_domain' });

    const result = db.transaction(() => {
      const subdomain = db.prepare('SELECT id, domain FROM subdomains WHERE id = ?').get(id);
      if (!subdomain) return { changes: 0 };
      db.prepare('DELETE FROM metrics_daily WHERE subdomain_id = ?').run(id);
      db.prepare('DELETE FROM client_subdomains WHERE subdomain_id = ?').run(id);
      const deleted = db.prepare('DELETE FROM subdomains WHERE id = ?').run(id);
      audit(db, req, 'subdomain.deleted', 'subdomain', id, subdomain);
      return deleted;
    })();

    if (!result.changes) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  router.get('/subdomains/:id/assignment-history', (req, res) => {
    const subdomainId = Number(req.params.id);
    if (!Number.isInteger(subdomainId) || subdomainId < 1) {
      return res.status(400).json({ error: 'invalid_domain' });
    }
    const subdomain = db.prepare('SELECT id FROM subdomains WHERE id = ?').get(subdomainId);
    if (!subdomain) return res.status(404).json({ error: 'not_found' });

    const assignments = db.prepare(`
      SELECT id, client_id AS clientId, client_name AS clientName,
        visible_from AS visibleFrom, visible_until AS visibleUntil,
        owner_cut_percent AS ownerCutPercent,
        created_at AS createdAt, ended_at AS endedAt
      FROM subdomain_assignment_history
      WHERE subdomain_id = ?
      ORDER BY CASE WHEN ended_at IS NULL THEN 0 ELSE 1 END, id DESC
    `).all(subdomainId);
    res.json({ assignments });
  });

  router.put('/subdomains/:id/assignment', (req, res) => {
    const subdomainId = Number(req.params.id);
    const clientId = Number(req.body?.clientId || 0);
    const visibleFrom = cleanVisibleFrom(req.body?.visibleFrom);
    const ownerCutPercent = cleanOwnerCutPercent(req.body?.ownerCutPercent);
    if (!Number.isInteger(subdomainId) || subdomainId < 1) {
      return res.status(400).json({ error: 'invalid_domain' });
    }
    if (!visibleFrom) return res.status(400).json({ error: 'invalid_visible_from' });
    if (ownerCutPercent === null) return res.status(400).json({ error: 'invalid_owner_cut_percent' });

    const result = db.transaction(() => {
      const subdomain = db.prepare('SELECT id FROM subdomains WHERE id = ?').get(subdomainId);
      if (!subdomain) return { error: 'not_found' };
      const previous = db.prepare(`
        SELECT client_id AS clientId, visible_from AS visibleFrom,
          owner_cut_percent AS ownerCutPercent
        FROM client_subdomains
        WHERE subdomain_id = ?
      `).all(subdomainId);

      if (!clientId) {
        closeActiveAssignmentHistory(db, subdomainId, visibleFrom);
        db.prepare('DELETE FROM client_subdomains WHERE subdomain_id = ?').run(subdomainId);
        return { previous, assignment: null };
      }

      const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(clientId);
      if (!client) return { error: 'client_not_found' };

      closeActiveAssignmentHistory(db, subdomainId, visibleFrom, clientId);
      db.prepare('DELETE FROM client_subdomains WHERE subdomain_id = ? AND client_id != ?')
        .run(subdomainId, clientId);
      const current = db.prepare(`
        SELECT 1
        FROM client_subdomains
        WHERE client_id = ? AND subdomain_id = ?
      `).get(clientId, subdomainId);
      if (current) {
        db.prepare(`
          UPDATE client_subdomains
          SET visible_from = ?, owner_cut_percent = ?
          WHERE client_id = ? AND subdomain_id = ?
        `).run(visibleFrom, ownerCutPercent, clientId, subdomainId);
      } else {
        db.prepare(`
          INSERT INTO client_subdomains (client_id, subdomain_id, visible_from, owner_cut_percent)
          VALUES (?, ?, ?, ?)
        `).run(clientId, subdomainId, visibleFrom, ownerCutPercent);
      }
      const history = db.prepare(`
        SELECT id
        FROM subdomain_assignment_history
        WHERE subdomain_id = ? AND client_id = ? AND ended_at IS NULL
      `).get(subdomainId, clientId);
      if (history) {
        db.prepare(`
          UPDATE subdomain_assignment_history
          SET visible_from = ?, visible_until = NULL, owner_cut_percent = ?
          WHERE id = ?
        `).run(visibleFrom, ownerCutPercent, history.id);
      } else {
        db.prepare(`
          INSERT INTO subdomain_assignment_history (
            subdomain_id, client_id, client_name, visible_from, owner_cut_percent
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(subdomainId, clientId, client.name, visibleFrom, ownerCutPercent);
      }
      return { previous, assignment: { clientId, visibleFrom, ownerCutPercent } };
    })();

    if (result.error === 'not_found') return res.status(404).json({ error: result.error });
    if (result.error === 'client_not_found') return res.status(404).json({ error: result.error });
    audit(db, req, result.assignment ? 'subdomain.assigned' : 'subdomain.unassigned', 'subdomain', subdomainId, result);
    res.json({ ok: true, assignment: result.assignment });
  });

  router.post('/subdomains/:id/assign', (req, res) => {
    req.url = `/subdomains/${req.params.id}/assignment`;
    req.method = 'PUT';
    router.handle(req, res);
  });

  router.post('/subdomains/:id/unassign', (req, res) => {
    req.body = { ...(req.body || {}), clientId: null };
    req.url = `/subdomains/${req.params.id}/assignment`;
    req.method = 'PUT';
    router.handle(req, res);
  });

  router.post('/sync/google', async (req, res) => {
    const range = parseRange(db, req.body || {});
    const result = await syncGoogleReports(db, config, range, { preferDateDimension: true });
    audit(db, req, 'sync.google', 'sync_run', result.syncRunId, result);
    res.json(result);
  });

  router.post('/sync/google/latest', async (req, res) => {
    const result = await syncGoogleLatest(db, config);
    audit(db, req, 'sync.google.latest', 'sync_run', result.syncRunId, result);
    res.json(result);
  });

  router.post('/sync/google/backfill', async (req, res) => {
    const result = await syncGoogleBackfill(db, config);
    audit(db, req, 'sync.google.backfill', 'sync_run', result.syncRunId, result);
    res.json(result);
  });

  router.get('/sync-jobs', (req, res) => {
    if (!syncJobs) return res.json({ active: [], jobs: [] });
    res.json({
      active: syncJobs.active(),
      jobs: syncJobs.list(8)
    });
  });

  router.get('/sync-jobs/:id', (req, res) => {
    if (!syncJobs) return res.status(404).json({ error: 'not_found' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_job' });
    const job = syncJobs.get(id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json({ job });
  });

  router.post('/sync-jobs/range', (req, res) => {
    if (!syncJobs) return res.status(503).json({ error: 'sync_jobs_unavailable' });
    const range = parseRange(db, req.body || {});
    const result = syncJobs.queue('range', { range }, req.user.id);
    audit(db, req, 'sync.job.range', 'sync_job', result.job.id, { range, duplicate: result.duplicate });
    res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result });
  });

  router.post('/sync-jobs/latest', (req, res) => {
    if (!syncJobs) return res.status(503).json({ error: 'sync_jobs_unavailable' });
    const result = syncJobs.queue('latest', {}, req.user.id);
    audit(db, req, 'sync.job.latest', 'sync_job', result.job.id, { duplicate: result.duplicate });
    res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result });
  });

  router.post('/sync-jobs/backfill', (req, res) => {
    if (!syncJobs) return res.status(503).json({ error: 'sync_jobs_unavailable' });
    const result = syncJobs.queue('backfill', {}, req.user.id);
    audit(db, req, 'sync.job.backfill', 'sync_job', result.job.id, { duplicate: result.duplicate });
    res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result });
  });

  router.get('/google/status', (req, res) => {
    res.json(getGoogleStatus(db, config));
  });

  router.get('/google/oauth/start', (req, res) => {
    try {
      res.redirect(startOAuth(db, config, req.user.id));
    } catch (error) {
      res.status(400).json({ error: 'google_oauth_not_configured', message: error.message });
    }
  });

  router.get('/google/oauth/callback', async (req, res) => {
    await handleOAuthCallback(db, config, req.query);
    res.redirect('/admin?connected=google');
  });

  return router;
}

function parseRange(db, query) {
  return normalizeRange(query, metricBounds(db));
}

function cleanClientInput(body) {
  return {
    name: String(body?.name || '').trim(),
    company: String(body?.company || '').trim(),
    email: String(body?.email || '').trim().toLowerCase(),
    status: ['active', 'paused', 'ended'].includes(body?.status) ? body.status : 'active',
    notes: String(body?.notes || '').trim()
  };
}

function cleanSubdomainInput(body) {
  return {
    domain: String(body?.domain || '').trim().toLowerCase(),
    category: String(body?.category || 'Content').trim(),
    unitPrice: Number(body?.unitPrice || body?.unit_price || 0),
    rentStatus: ['active', 'paused', 'ended'].includes(body?.rentStatus || body?.rent_status)
      ? (body.rentStatus || body.rent_status)
      : 'active',
    notes: String(body?.notes || '').trim()
  };
}

function cleanVisibleFrom(value) {
  const candidate = String(value || new Date().toISOString().slice(0, 10)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? null : candidate;
}

function cleanOwnerCutPercent(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return Number(numeric.toFixed(2));
}

function closeActiveAssignmentHistory(db, subdomainId, nextVisibleFrom, keepClientId = null) {
  const params = {
    subdomainId,
    nextVisibleFrom,
    keepClientId
  };
  db.prepare(`
    UPDATE subdomain_assignment_history
    SET visible_until = CASE
          WHEN visible_from < @nextVisibleFrom THEN date(@nextVisibleFrom, '-1 day')
          ELSE visible_from
        END,
        ended_at = CURRENT_TIMESTAMP
    WHERE subdomain_id = @subdomainId
      AND ended_at IS NULL
      AND (@keepClientId IS NULL OR client_id != @keepClientId)
  `).run(params);
}

function domainRows(db, range) {
  return db.prepare(`
    SELECT
      s.id,
      s.domain,
      s.category,
      s.unit_price AS unitPrice,
      s.rent_status AS rentStatus,
      s.notes,
      c.id AS clientId,
      c.name AS clientName,
      COALESCE(cs.visible_from, substr(cs.assigned_at, 1, 10)) AS visibleFrom,
      COALESCE(cs.owner_cut_percent, 0) AS ownerCutPercent,
      COALESCE(SUM(m.visitors), 0) AS visitors,
      COALESCE(SUM(m.page_views), 0) AS pageViews,
      COALESCE(AVG(NULLIF(m.bounce_rate, 0)), 0) AS bounceRate,
      COALESCE(SUM(m.engaged_sessions), 0) AS engagedSessions,
      COALESCE(SUM(m.earnings), 0) AS earnings,
      ROUND(COALESCE(SUM(m.earnings), 0) * COALESCE(cs.owner_cut_percent, 0) / 100, 2) AS ownerCut,
      ROUND(COALESCE(SUM(m.earnings), 0) * (100 - COALESCE(cs.owner_cut_percent, 0)) / 100, 2) AS clientEarnings,
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
    LEFT JOIN client_subdomains cs ON cs.subdomain_id = s.id
    LEFT JOIN clients c ON c.id = cs.client_id
    LEFT JOIN metrics_daily m
      ON m.subdomain_id = s.id
      AND m.metric_date BETWEEN @from AND @to
    GROUP BY s.id, c.id, cs.owner_cut_percent
    ORDER BY earnings DESC, pageViews DESC
  `).all(range);
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

function dataFreshness(db) {
  const row = metricBounds(db);
  const count = db.prepare(`
    SELECT
      MAX(updated_at) AS latestUpdatedAt,
      COUNT(*) AS metricRows
    FROM metrics_daily
  `).get();
  const today = new Date().toISOString().slice(0, 10);
  const latestMetricDate = row?.latestMetricDate || null;
  return {
    firstMetricDate: row?.firstMetricDate || null,
    latestMetricDate,
    latestUpdatedAt: count?.latestUpdatedAt || null,
    metricRows: Number(count?.metricRows || 0),
    staleDays: latestMetricDate ? daysBetween(latestMetricDate, today) : null
  };
}

function metricBounds(db) {
  return db.prepare(`
    SELECT
      MIN(metric_date) AS firstMetricDate,
      MAX(metric_date) AS latestMetricDate
    FROM metrics_daily
  `).get();
}

function normalizeRange(query = {}, bounds = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const fallbackFrom = bounds?.firstMetricDate || bounds?.latestMetricDate || today;
  const fallbackTo = bounds?.latestMetricDate || bounds?.firstMetricDate || today;
  let from = cleanDate(query.from) || fallbackFrom;
  let to = cleanDate(query.to) || fallbackTo;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

function cleanDate(value) {
  const candidate = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? null : candidate;
}

function daysBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}
