import assert from 'node:assert/strict';
import test from 'node:test';

import { applyProductionConfiguration } from '../server/db.js';
import { login, request, startTestApp } from './helpers.mjs';

test('production config updates the existing admin credentials', async (t) => {
  const app = await startTestApp({
    isProd: true,
    adminEmail: 'owner@example.com',
    adminPassword: 'OwnerPassword123!',
    adminCredentialsProvided: true
  });
  t.after(() => app.close());

  applyProductionConfiguration(app.db, app.config);

  const { user } = await login(app.baseUrl, 'owner@example.com', 'OwnerPassword123!');
  assert.equal(user.role, 'admin');

  const oldLogin = await request(app.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' })
  });
  assert.equal(oldLogin.response.status, 401);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'client'").get().count, 0);
});
