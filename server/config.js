import crypto from 'node:crypto';
import path from 'node:path';

function mustBeSecret(value, fallback) {
  return value && value.length >= 24 ? value : fallback;
}

const fallbackSecret = crypto.createHash('sha256')
  .update(process.cwd())
  .digest('hex');

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 8080),
  appUrl: process.env.APP_URL || 'http://localhost:8080',
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db'),
  sessionSecret: mustBeSecret(process.env.SESSION_SECRET, fallbackSecret),
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  seedClientEmail: process.env.SEED_CLIENT_EMAIL || 'client@example.com',
  seedClientPassword: process.env.SEED_CLIENT_PASSWORD || 'Client123!',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  adsenseAccountId: process.env.ADSENSE_ACCOUNT_ID || '',
  ga4PropertyId: process.env.GA4_PROPERTY_ID || '',
  adManagerNetworkCode: process.env.AD_MANAGER_NETWORK_CODE || '',
  adManagerReportId: process.env.AD_MANAGER_REPORT_ID || '',
  adManagerReportMetrics: (process.env.AD_MANAGER_REPORT_METRICS || 'REVENUE,AD_EXCHANGE_CTR,AD_EXCHANGE_AVERAGE_ECPM,TOTAL_IMPRESSIONS')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  adManagerReportDimensions: (process.env.AD_MANAGER_REPORT_DIMENSIONS || 'SITE')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  reportCurrency: process.env.REPORT_CURRENCY || 'MAD',
  enableGoogleSync: process.env.ENABLE_GOOGLE_SYNC === 'true'
};
