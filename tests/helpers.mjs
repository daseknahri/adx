import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../server/index.js';
import { openDb, seedDatabase } from '../server/db.js';

export function testConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adsense-tracker-'));
  return {
    isProd: false,
    port: 0,
    appUrl: 'http://localhost:0',
    dbPath: path.join(dir, 'app.db'),
    sessionSecret: 'test-session-secret-value-32-bytes',
    tokenEncryptionKey: '',
    seedAdminEmail: 'admin@example.com',
    seedAdminPassword: 'ChangeMe123!',
    seedClientEmail: 'client@example.com',
    seedClientPassword: 'Client123!',
    googleClientId: '',
    googleClientSecret: '',
    googleRedirectUri: '',
    adsenseAccountId: '',
    ga4PropertyId: '',
    adManagerNetworkCode: '',
    adManagerReportId: '',
    adManagerReportMetrics: ['REVENUE', 'AD_EXCHANGE_CTR', 'AD_EXCHANGE_AVERAGE_ECPM', 'TOTAL_IMPRESSIONS'],
    adManagerReportDimensions: ['SITE'],
    reportCurrency: 'MAD',
    enableGoogleSync: false,
    ...overrides
  };
}

export async function startTestApp(overrides = {}) {
  const config = testConfig(overrides);
  const db = openDb(config.dbPath);
  seedDatabase(db, config);
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    config,
    db,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      db.close();
    }
  };
}

export async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body, cookie: response.headers.get('set-cookie') };
}

export async function login(baseUrl, email, password) {
  const { response, body, cookie } = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200);
  assert.ok(cookie);
  return { user: body.user, cookie: cookie.split(';')[0] };
}
