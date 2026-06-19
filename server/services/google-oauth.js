import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../crypto.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export function getGoogleStatus(db, config) {
  const row = db.prepare('SELECT * FROM google_connections WHERE id = 1').get();
  const scopes = googleScopes(config);
  const connected = Boolean(row?.refresh_token);
  return {
    connected,
    connectedEmail: row?.connected_email || null,
    accountId: row?.account_id || config.adManagerNetworkCode || config.adsenseAccountId || null,
    syncEnabled: config.enableGoogleSync || connected,
    demoMode: !config.enableGoogleSync && !connected,
    hasClientConfig: Boolean(config.googleClientId && config.googleClientSecret),
    provider: config.adManagerNetworkCode && config.adManagerReportId ? 'admanager' : 'adsense',
    reportId: config.adManagerReportId || null,
    currency: config.reportCurrency,
    scopes: row?.scope || scopes.join(' ')
  };
}

export function startOAuth(db, config, userId) {
  if (!config.googleClientId) throw new Error('GOOGLE_CLIENT_ID is missing');
  const state = crypto.randomBytes(18).toString('hex');
  db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, target_type, details)
    VALUES (?, 'google.oauth.started', 'google_connection', ?)
  `).run(userId, JSON.stringify({ state }));

  const redirectUri = config.googleRedirectUri || `${config.appUrl}/api/admin/google/oauth/callback`;
  const scopes = googleScopes(config);
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes.join(' '),
    state
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export async function handleOAuthCallback(db, config, query) {
  if (query.error) throw new Error(`Google OAuth failed: ${query.error}`);
  const code = String(query.code || '');
  if (!code) throw new Error('Missing Google OAuth code');
  const redirectUri = config.googleRedirectUri || `${config.appUrl}/api/admin/google/oauth/callback`;

  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  }

  const token = await response.json();
  const expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
  const scopes = googleScopes(config);
  db.prepare(`
    INSERT INTO google_connections (
      id, access_token, refresh_token, expires_at, scope, account_id, updated_at
    )
    VALUES (1, @accessToken, @refreshToken, @expiresAt, @scope, @accountId, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, google_connections.refresh_token),
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      account_id = excluded.account_id,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    accessToken: encryptSecret(token.access_token || '', config.tokenEncryptionKey),
    refreshToken: encryptSecret(token.refresh_token || '', config.tokenEncryptionKey),
    expiresAt,
    scope: token.scope || scopes.join(' '),
    accountId: config.adManagerNetworkCode || config.adsenseAccountId || ''
  });
}

export async function getAccessToken(db, config) {
  const row = db.prepare('SELECT * FROM google_connections WHERE id = 1').get();
  if (!row?.refresh_token) return null;
  if (row.access_token && row.expires_at > Date.now() + 60_000) {
    return decryptSecret(row.access_token, config.tokenEncryptionKey);
  }

  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: decryptSecret(row.refresh_token, config.tokenEncryptionKey),
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    throw new Error(`Google refresh failed: ${response.status} ${await response.text()}`);
  }

  const token = await response.json();
  const expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
  db.prepare(`
    UPDATE google_connections
    SET access_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(encryptSecret(token.access_token, config.tokenEncryptionKey), expiresAt);
  return token.access_token;
}

function googleScopes(config) {
  const scopes = [];
  if (config.adManagerNetworkCode || config.adManagerReportId) {
    scopes.push('https://www.googleapis.com/auth/admanager.readonly');
  }
  if (config.adsenseAccountId) {
    scopes.push('https://www.googleapis.com/auth/adsense.readonly');
  }
  if (config.ga4PropertyId) {
    scopes.push('https://www.googleapis.com/auth/analytics.readonly');
  }
  return scopes.length ? scopes : ['https://www.googleapis.com/auth/admanager.readonly'];
}
