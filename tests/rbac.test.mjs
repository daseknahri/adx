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
