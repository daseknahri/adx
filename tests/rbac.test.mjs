import assert from 'node:assert/strict';
import test from 'node:test';

import { login, request, startTestApp } from './helpers.mjs';

test('RBAC protects admin and client APIs by role', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const unauthAdmin = await request(app.baseUrl, '/api/admin/overview');
  assert.equal(unauthAdmin.response.status, 401);
  assert.equal(unauthAdmin.body.error, 'unauthorized');

  const { cookie: clientCookie } = await login(app.baseUrl, app.config.seedClientEmail, app.config.seedClientPassword);
  const clientAdmin = await request(app.baseUrl, '/api/admin/overview', {
    headers: { cookie: clientCookie }
  });
  assert.equal(clientAdmin.response.status, 403);
  assert.equal(clientAdmin.body.error, 'forbidden');

  const { cookie: adminCookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const adminClient = await request(app.baseUrl, '/api/client/dashboard', {
    headers: { cookie: adminCookie }
  });
  assert.equal(adminClient.response.status, 403);
  assert.equal(adminClient.body.error, 'forbidden');

  const adminOverview = await request(app.baseUrl, '/api/admin/overview', {
    headers: { cookie: adminCookie }
  });
  assert.equal(adminOverview.response.status, 200);
  assert.ok(Array.isArray(adminOverview.body.rows));
  assert.ok(adminOverview.body.syncSummary);
  assert.equal(typeof adminOverview.body.syncSummary.metricRows, 'number');
});

test('client dashboard only returns assigned subdomains', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  app.db.prepare(`
    INSERT INTO subdomains (domain, category, unit_price, rent_status, notes)
    VALUES ('private.example.com', 'Private', 10, 'active', '')
  `).run();

  const { cookie } = await login(app.baseUrl, app.config.seedClientEmail, app.config.seedClientPassword);
  const dashboard = await request(app.baseUrl, '/api/client/dashboard', {
    headers: { cookie }
  });

  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.rows.length > 0);
  assert.equal(dashboard.body.rows.some((row) => row.domain === 'private.example.com'), false);
});

test('client assignments show all stored metrics and reassignment revokes the previous client', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie: adminCookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const { cookie: originalClientCookie } = await login(app.baseUrl, app.config.seedClientEmail, app.config.seedClientPassword);
  const originalClient = app.db.prepare('SELECT id FROM clients WHERE email = ?').get(app.config.seedClientEmail);
  const domain = app.db.prepare(`
    SELECT s.id, MIN(m.metric_date) AS firstDate, MAX(m.metric_date) AS latestDate
    FROM subdomains s
    INNER JOIN client_subdomains cs ON cs.subdomain_id = s.id
    INNER JOIN metrics_daily m ON m.subdomain_id = s.id
    WHERE cs.client_id = ?
    GROUP BY s.id
    ORDER BY s.id
    LIMIT 1
  `).get(originalClient.id);

  const createdClient = await request(app.baseUrl, '/api/admin/clients', {
    method: 'POST',
    headers: { cookie: adminCookie },
    body: JSON.stringify({
      name: 'Date Scoped Client',
      company: '',
      email: 'date-scoped@example.com',
      password: 'DateScoped123!',
      status: 'active',
      notes: ''
    })
  });
  assert.equal(createdClient.response.status, 201);
  const nextClientId = createdClient.body.client.id;

  const assignment = await request(app.baseUrl, `/api/admin/subdomains/${domain.id}/assignment`, {
    method: 'PUT',
    headers: { cookie: adminCookie },
    body: JSON.stringify({ clientId: nextClientId, ownerCutPercent: 25 })
  });
  assert.equal(assignment.response.status, 200);
  assert.equal(assignment.body.assignment.clientId, nextClientId);
  assert.match(assignment.body.assignment.visibleFrom, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(assignment.body.assignment.ownerCutPercent, 25);

  const assignmentHistory = await request(app.baseUrl, `/api/admin/subdomains/${domain.id}/assignment-history`, {
    headers: { cookie: adminCookie }
  });
  assert.equal(assignmentHistory.response.status, 200);
  assert.equal(assignmentHistory.body.assignments[0].clientName, 'Date Scoped Client');
  assert.equal(assignmentHistory.body.assignments[0].ownerCutPercent, 25);
  assert.equal(assignmentHistory.body.assignments[0].endedAt, null);
  assert.equal(assignmentHistory.body.assignments[1].clientName, 'Demo Client');
  assert.ok(assignmentHistory.body.assignments[1].endedAt);

  const originalDashboard = await request(app.baseUrl, `/api/client/dashboard?from=${domain.firstDate}&to=${domain.latestDate}`, {
    headers: { cookie: originalClientCookie }
  });
  assert.equal(originalDashboard.response.status, 200);
  assert.equal(originalDashboard.body.rows.some((row) => row.id === domain.id), false);

  const { cookie: nextClientCookie } = await login(app.baseUrl, 'date-scoped@example.com', 'DateScoped123!');
  const dashboard = await request(app.baseUrl, '/api/client/dashboard', {
    headers: { cookie: nextClientCookie }
  });
  assert.deepEqual(dashboard.body.range, { from: domain.firstDate, to: domain.latestDate });
  const scopedRow = dashboard.body.rows.find((row) => row.id === domain.id);
  const storedMetrics = app.db.prepare(`
    SELECT SUM(page_views) AS pageViews, SUM(earnings) AS earnings
    FROM metrics_daily
    WHERE subdomain_id = ?
  `).get(domain.id);
  assert.equal(scopedRow.ownerCutPercent, 25);
  assert.equal(scopedRow.pageViews, storedMetrics.pageViews);
  assert.equal(scopedRow.grossEarnings, storedMetrics.earnings);
  assert.equal(scopedRow.ownerCut, Number((storedMetrics.earnings * 0.25).toFixed(2)));
  assert.equal(scopedRow.earnings, Number((storedMetrics.earnings * 0.75).toFixed(2)));

  const latestOnly = await request(app.baseUrl, `/api/client/dashboard?from=${domain.latestDate}&to=${domain.latestDate}`, {
    headers: { cookie: nextClientCookie }
  });
  assert.deepEqual(latestOnly.body.range, { from: domain.latestDate, to: domain.latestDate });
  const latestRow = latestOnly.body.rows.find((row) => row.id === domain.id);
  const latestMetrics = app.db.prepare(`
    SELECT page_views AS pageViews, earnings
    FROM metrics_daily
    WHERE subdomain_id = ? AND metric_date = ?
  `).get(domain.id, domain.latestDate);
  assert.equal(latestRow.pageViews, latestMetrics.pageViews);
  assert.equal(latestRow.grossEarnings, latestMetrics.earnings);
  assert.equal(latestRow.earnings, Number((latestMetrics.earnings * 0.75).toFixed(2)));

  const reversedRange = await request(app.baseUrl, `/api/client/dashboard?from=${domain.latestDate}&to=${domain.firstDate}`, {
    headers: { cookie: nextClientCookie }
  });
  assert.deepEqual(reversedRange.body.range, { from: domain.firstDate, to: domain.latestDate });

  const daily = await request(app.baseUrl, `/api/client/subdomains/${domain.id}/daily`, {
    headers: { cookie: nextClientCookie }
  });
  assert.equal(daily.response.status, 200);
  assert.deepEqual(daily.body.rows.map((row) => row.date), app.db.prepare(`
    SELECT metric_date AS date
    FROM metrics_daily
    WHERE subdomain_id = ?
    ORDER BY metric_date ASC
  `).all(domain.id).map((row) => row.date));
  assert.equal(daily.body.rows.reduce((sum, row) => sum + row.grossEarnings, 0), storedMetrics.earnings);

  const filteredDaily = await request(app.baseUrl, `/api/client/subdomains/${domain.id}/daily?from=${domain.latestDate}&to=${domain.latestDate}`, {
    headers: { cookie: nextClientCookie }
  });
  assert.equal(filteredDaily.response.status, 200);
  assert.deepEqual(filteredDaily.body.rows.map((row) => row.date), [domain.latestDate]);
  assert.equal(filteredDaily.body.rows[0].grossEarnings, latestMetrics.earnings);

  const removed = await request(app.baseUrl, `/api/admin/subdomains/${domain.id}/assignment`, {
    method: 'PUT',
    headers: { cookie: adminCookie },
    body: JSON.stringify({ clientId: null })
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.assignment, null);

  const closedHistory = await request(app.baseUrl, `/api/admin/subdomains/${domain.id}/assignment-history`, {
    headers: { cookie: adminCookie }
  });
  assert.ok(closedHistory.body.assignments.every((item) => item.endedAt));

  const afterRemoval = await request(app.baseUrl, `/api/client/dashboard?from=${domain.firstDate}&to=${domain.latestDate}`, {
    headers: { cookie: nextClientCookie }
  });
  assert.equal(afterRemoval.body.rows.some((row) => row.id === domain.id), false);
});

test('admin and client date filters read the same stored AdX rows', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie: adminCookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const { cookie: clientCookie } = await login(app.baseUrl, app.config.seedClientEmail, app.config.seedClientPassword);
  const client = app.db.prepare('SELECT id FROM clients WHERE email = ?').get(app.config.seedClientEmail);
  const metricDate = app.db.prepare(`
    SELECT MAX(m.metric_date) AS date
    FROM client_subdomains cs
    INNER JOIN metrics_daily m ON m.subdomain_id = cs.subdomain_id
    WHERE cs.client_id = ?
  `).get(client.id).date;

  const adminOverview = await request(app.baseUrl, `/api/admin/overview?from=${metricDate}&to=${metricDate}`, {
    headers: { cookie: adminCookie }
  });
  const clientDashboard = await request(app.baseUrl, `/api/client/dashboard?from=${metricDate}&to=${metricDate}`, {
    headers: { cookie: clientCookie }
  });

  assert.equal(adminOverview.response.status, 200);
  assert.equal(clientDashboard.response.status, 200);
  assert.deepEqual(adminOverview.body.range, { from: metricDate, to: metricDate });
  assert.deepEqual(clientDashboard.body.range, { from: metricDate, to: metricDate });

  for (const clientRow of clientDashboard.body.rows) {
    const adminRow = adminOverview.body.rows.find((row) => row.id === clientRow.id);
    assert.ok(adminRow, `admin row missing for ${clientRow.domain}`);
    assert.equal(clientRow.grossEarnings, adminRow.earnings);
    assert.equal(clientRow.earnings, adminRow.clientEarnings);
    assert.equal(clientRow.pageViews, adminRow.pageViews);
    assert.equal(clientRow.impressions, adminRow.impressions);
    assert.equal(clientRow.adxCtr, adminRow.adxCtr);
    assert.equal(clientRow.adxEcpm, adminRow.adxEcpm);
  }

  const assignedAdminRows = adminOverview.body.rows.filter((row) => row.clientId === client.id);
  const adminClientNetTotal = Number(assignedAdminRows.reduce((sum, row) => sum + row.clientEarnings, 0).toFixed(2));
  const clientNetTotal = Number(clientDashboard.body.totals.earnings.toFixed(2));
  assert.equal(clientNetTotal, adminClientNetTotal);
});

test('root /api/me matches the contract and returns the current user', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const unauth = await request(app.baseUrl, '/api/me');
  assert.equal(unauth.response.status, 401);

  const { cookie } = await login(app.baseUrl, app.config.seedClientEmail, app.config.seedClientPassword);
  const me = await request(app.baseUrl, '/api/me', {
    headers: { cookie }
  });

  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.email, app.config.seedClientEmail);
  assert.equal(me.body.user.role, 'client');
  assert.ok(me.body.user.clientId);
});

test('paused clients cannot login or continue using client APIs', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie: clientCookie } = await login(app.baseUrl, app.config.seedClientEmail, app.config.seedClientPassword);
  const { cookie: adminCookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const client = app.db.prepare('SELECT * FROM clients WHERE email = ?').get(app.config.seedClientEmail);

  const pause = await request(app.baseUrl, `/api/admin/clients/${client.id}`, {
    method: 'PATCH',
    headers: { cookie: adminCookie },
    body: JSON.stringify({
      name: client.name,
      company: client.company || '',
      email: client.email,
      status: 'paused',
      notes: client.notes || ''
    })
  });
  assert.equal(pause.response.status, 200);

  const existingSession = await request(app.baseUrl, '/api/client/dashboard', {
    headers: { cookie: clientCookie }
  });
  assert.equal(existingSession.response.status, 403);
  assert.equal(existingSession.body.error, 'client_paused');

  const loginPaused = await request(app.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: app.config.seedClientEmail,
      password: app.config.seedClientPassword
    })
  });
  assert.equal(loginPaused.response.status, 403);
  assert.equal(loginPaused.body.error, 'client_paused');
});

test('admin can edit client details and reset login password', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const client = app.db.prepare('SELECT * FROM clients WHERE email = ?').get(app.config.seedClientEmail);

  const updated = await request(app.baseUrl, `/api/admin/clients/${client.id}`, {
    method: 'PATCH',
    headers: { cookie },
    body: JSON.stringify({
      name: 'Updated Client',
      company: 'Updated Publishing',
      email: 'updated-client@example.com',
      status: 'active',
      notes: 'Edited in admin test',
      password: 'UpdatedClient123!'
    })
  });
  assert.equal(updated.response.status, 200);

  const clients = await request(app.baseUrl, '/api/admin/clients', {
    headers: { cookie }
  });
  const row = clients.body.clients.find((item) => item.id === client.id);
  assert.equal(row.name, 'Updated Client');
  assert.equal(row.company, 'Updated Publishing');
  assert.equal(row.email, 'updated-client@example.com');
  assert.equal(row.notes, 'Edited in admin test');

  const oldLogin = await request(app.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: app.config.seedClientEmail,
      password: app.config.seedClientPassword
    })
  });
  assert.equal(oldLogin.response.status, 401);

  const { user } = await login(app.baseUrl, 'updated-client@example.com', 'UpdatedClient123!');
  assert.equal(user.name, 'Updated Client');
  assert.equal(user.role, 'client');
  assert.equal(user.clientId, client.id);

  const ended = await request(app.baseUrl, `/api/admin/clients/${client.id}`, {
    method: 'PATCH',
    headers: { cookie },
    body: JSON.stringify({
      name: 'Updated Client',
      company: 'Updated Publishing',
      email: 'updated-client@example.com',
      status: 'ended',
      notes: 'Edited in admin test'
    })
  });
  assert.equal(ended.response.status, 200);

  const disabledLogin = await request(app.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'updated-client@example.com',
      password: 'UpdatedClient123!'
    })
  });
  assert.notEqual(disabledLogin.response.status, 200);

  const reactivated = await request(app.baseUrl, `/api/admin/clients/${client.id}`, {
    method: 'PATCH',
    headers: { cookie },
    body: JSON.stringify({
      name: 'Updated Client',
      company: 'Updated Publishing',
      email: 'updated-client@example.com',
      status: 'active',
      notes: 'Edited in admin test'
    })
  });
  assert.equal(reactivated.response.status, 200);

  const reactivatedLogin = await login(app.baseUrl, 'updated-client@example.com', 'UpdatedClient123!');
  assert.equal(reactivatedLogin.user.clientId, client.id);
});

test('admin can inspect daily metrics for any subdomain', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const subdomain = app.db.prepare('SELECT id FROM subdomains ORDER BY id LIMIT 1').get();
  const daily = await request(app.baseUrl, `/api/admin/subdomains/${subdomain.id}/daily`, {
    headers: { cookie }
  });

  assert.equal(daily.response.status, 200);
  assert.ok(Array.isArray(daily.body.rows));
  assert.ok(daily.body.rows.length > 0);
  assert.ok(daily.body.rows[0].date);

  const bounds = app.db.prepare(`
    SELECT MIN(metric_date) AS firstDate, MAX(metric_date) AS latestDate
    FROM metrics_daily
    WHERE subdomain_id = ?
  `).get(subdomain.id);
  assert.deepEqual(daily.body.range, { from: bounds.firstDate, to: bounds.latestDate });

  const filtered = await request(app.baseUrl, `/api/admin/subdomains/${subdomain.id}/daily?from=${bounds.latestDate}&to=${bounds.latestDate}`, {
    headers: { cookie }
  });
  assert.equal(filtered.response.status, 200);
  assert.deepEqual(filtered.body.rows.map((row) => row.date), [bounds.latestDate]);

  const reversed = await request(app.baseUrl, `/api/admin/subdomains/${subdomain.id}/daily?from=${bounds.latestDate}&to=${bounds.firstDate}`, {
    headers: { cookie }
  });
  assert.equal(reversed.response.status, 200);
  assert.deepEqual(reversed.body.range, { from: bounds.firstDate, to: bounds.latestDate });
});

test('admin can update and reassign a subdomain', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const sourceClient = app.db.prepare('SELECT * FROM clients WHERE email = ?').get(app.config.seedClientEmail);
  const createdClient = await request(app.baseUrl, '/api/admin/clients', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({
      name: 'Second Client',
      company: 'Second Publisher',
      email: 'second@example.com',
      password: 'Second123!',
      status: 'active',
      notes: ''
    })
  });
  assert.equal(createdClient.response.status, 201);
  const nextClientId = createdClient.body.client.id;
  const subdomain = app.db.prepare(`
    SELECT s.*
    FROM subdomains s
    INNER JOIN client_subdomains cs ON cs.subdomain_id = s.id
    WHERE cs.client_id = ?
    ORDER BY s.id
    LIMIT 1
  `).get(sourceClient.id);

  const updated = await request(app.baseUrl, `/api/admin/subdomains/${subdomain.id}`, {
    method: 'PATCH',
    headers: { cookie },
    body: JSON.stringify({
      domain: subdomain.domain,
      category: 'Premium Recipes',
      unitPrice: 44.5,
      rentStatus: 'paused',
      notes: 'Updated by test'
    })
  });
  assert.equal(updated.response.status, 200);

  const unassigned = await request(app.baseUrl, `/api/admin/subdomains/${subdomain.id}/unassign`, {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ clientId: sourceClient.id })
  });
  assert.equal(unassigned.response.status, 200);

  const assigned = await request(app.baseUrl, `/api/admin/subdomains/${subdomain.id}/assign`, {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ clientId: nextClientId })
  });
  assert.equal(assigned.response.status, 200);
  assert.equal(assigned.body.assignment.ownerCutPercent, 0);

  const overview = await request(app.baseUrl, '/api/admin/overview', {
    headers: { cookie }
  });
  const row = overview.body.rows.find((item) => item.id === subdomain.id);
  assert.equal(row.clientId, nextClientId);
  assert.equal(row.clientName, 'Second Client');
  assert.equal(row.category, 'Premium Recipes');
  assert.equal(row.unitPrice, 44.5);
  assert.equal(row.rentStatus, 'paused');
  assert.equal(row.notes, 'Updated by test');
  assert.equal(row.ownerCutPercent, 0);
});

test('admin can delete a client account without deleting subdomains', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const client = app.db.prepare('SELECT * FROM clients WHERE email = ?').get(app.config.seedClientEmail);
  const subdomainCount = app.db.prepare('SELECT COUNT(*) AS count FROM subdomains').get().count;

  const deleted = await request(app.baseUrl, `/api/admin/clients/${client.id}`, {
    method: 'DELETE',
    headers: { cookie }
  });

  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.ok, true);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM clients WHERE id = ?').get(client.id).count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM users WHERE client_id = ?').get(client.id).count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM client_subdomains WHERE client_id = ?').get(client.id).count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM subdomains').get().count, subdomainCount);
});

test('admin can delete a subdomain and its stored metrics without deleting clients', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const subdomain = app.db.prepare('SELECT id FROM subdomains ORDER BY id LIMIT 1').get();
  const clientCount = app.db.prepare('SELECT COUNT(*) AS count FROM clients').get().count;

  const deleted = await request(app.baseUrl, `/api/admin/subdomains/${subdomain.id}`, {
    method: 'DELETE',
    headers: { cookie }
  });

  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.ok, true);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM subdomains WHERE id = ?').get(subdomain.id).count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM client_subdomains WHERE subdomain_id = ?').get(subdomain.id).count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM metrics_daily WHERE subdomain_id = ?').get(subdomain.id).count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM clients').get().count, clientCount);
});

test('admin can clear workspace data while preserving admin and Google connection', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  app.db.prepare(`
    INSERT INTO google_connections (id, refresh_token, account_id)
    VALUES (1, 'encrypted-token', '23350042371')
  `).run();

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const rejected = await request(app.baseUrl, '/api/admin/workspace/clear', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ confirm: 'wrong' })
  });
  assert.equal(rejected.response.status, 400);

  const cleared = await request(app.baseUrl, '/api/admin/workspace/clear', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ confirm: 'CLEAR' })
  });

  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.ok, true);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ?').get('admin').count, 1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ?').get('client').count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM clients').get().count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM subdomains').get().count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM metrics_daily').get().count, 0);
  assert.equal(app.db.prepare('SELECT account_id AS accountId FROM google_connections WHERE id = 1').get().accountId, '23350042371');
});

test('missing Google OAuth config returns a friendly admin error', async (t) => {
  const app = await startTestApp({ googleClientId: '', googleClientSecret: '' });
  t.after(() => app.close());

  const { cookie } = await login(app.baseUrl, app.config.seedAdminEmail, app.config.seedAdminPassword);
  const start = await request(app.baseUrl, '/api/admin/google/oauth/start', {
    headers: { cookie }
  });

  assert.equal(start.response.status, 400);
  assert.equal(start.body.error, 'google_oauth_not_configured');
});
