import express from 'express';
import { hashPassword } from '../auth.js';
import { audit, requireAdmin } from '../middleware.js';
import { getGoogleStatus, startOAuth, handleOAuthCallback } from '../services/google-oauth.js';
import { syncGoogleReports } from '../services/sync.js';

export function adminRouter(db, config) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/overview', (req, res) => {
    const range = parseRange(req.query);
    const rows = domainRows(db, range);
    const totals = rows.reduce((acc, row) => {
      acc.earnings += row.earnings;
      acc.pageViews += row.pageViews;
      acc.visitors += row.visitors;
      acc.activeUsers += row.activeUsers;
      return acc;
    }, { earnings: 0, pageViews: 0, visitors: 0, activeUsers: 0 });
    totals.adxCtr = averageNonZero(rows.map((row) => row.adxCtr));
    totals.adxEcpm = averageNonZero(rows.map((row) => row.adxEcpm));

    const latestSync = db.prepare(`
      SELECT provider, status, started_at AS startedAt, finished_at AS finishedAt, message, rows_synced AS rowsSynced
      FROM sync_runs
      ORDER BY id DESC
      LIMIT 5
    `).all();

    res.json({ range, totals, rows, latestSync });
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
    const result = db.transaction(() => {
      const update = db.prepare(`
        UPDATE clients
        SET name = @name, company = @company, email = @email, status = @status, notes = @notes
        WHERE id = @id
      `).run({ ...input, id });
      if (update.changes) {
        db.prepare(`
          UPDATE users
          SET email = @email, name = @name, active = CASE WHEN @status = 'ended' THEN 0 ELSE active END
          WHERE client_id = @id AND role = 'client'
        `).run({ ...input, id });
      }
      return update;
    })();
    if (!result.changes) return res.status(404).json({ error: 'not_found' });
    audit(db, req, 'client.updated', 'client', id, input);
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
    res.json({ subdomains: domainRows(db, parseRange(req.query)) });
  });

  router.get('/subdomains/:id/daily', (req, res) => {
    const range = parseRange(req.query);
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

  router.post('/subdomains/:id/assign', (req, res) => {
    const subdomainId = Number(req.params.id);
    const clientId = Number(req.body?.clientId);
    if (!clientId) return res.status(400).json({ error: 'missing_client' });
    db.prepare(`
      INSERT OR IGNORE INTO client_subdomains (client_id, subdomain_id)
      VALUES (?, ?)
    `).run(clientId, subdomainId);
    audit(db, req, 'subdomain.assigned', 'subdomain', subdomainId, { clientId });
    res.json({ ok: true });
  });

  router.post('/subdomains/:id/unassign', (req, res) => {
    const subdomainId = Number(req.params.id);
    const clientId = Number(req.body?.clientId);
    db.prepare(`
      DELETE FROM client_subdomains
      WHERE client_id = ? AND subdomain_id = ?
    `).run(clientId, subdomainId);
    audit(db, req, 'subdomain.unassigned', 'subdomain', subdomainId, { clientId });
    res.json({ ok: true });
  });

  router.post('/sync/google', async (req, res) => {
    const range = parseRange(req.body || {});
    const result = await syncGoogleReports(db, config, range);
    audit(db, req, 'sync.google', 'sync_run', result.syncRunId, result);
    res.json(result);
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

function parseRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: String(query.from || today),
    to: String(query.to || today)
  };
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

function domainRows(db, range) {
  return db.prepare(`
    SELECT
      s.id,
      s.domain,
      s.category,
      s.unit_price AS unitPrice,
      s.rent_status AS rentStatus,
      c.id AS clientId,
      c.name AS clientName,
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
    LEFT JOIN client_subdomains cs ON cs.subdomain_id = s.id
    LEFT JOIN clients c ON c.id = cs.client_id
    LEFT JOIN metrics_daily m
      ON m.subdomain_id = s.id
      AND m.metric_date BETWEEN @from AND @to
    GROUP BY s.id, c.id
    ORDER BY earnings DESC, pageViews DESC
  `).all(range);
}

function averageNonZero(values) {
  const clean = values.map(Number).filter((value) => value > 0);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}
