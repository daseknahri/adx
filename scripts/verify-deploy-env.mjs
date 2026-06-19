import { randomBytes } from 'node:crypto';

const required = [
  'APP_URL',
  'SESSION_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
  'SEED_CLIENT_EMAIL',
  'SEED_CLIENT_PASSWORD'
];

const optionalGoogle = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'ADSENSE_ACCOUNT_ID',
  'GA4_PROPERTY_ID'
];

const missing = required.filter((name) => !process.env[name]);
const warnings = [];

if (process.env.PORT && process.env.PORT !== '8080') {
  warnings.push('Coolify should route to container port 8080. Use APP_URL for the public URL.');
}

if (process.env.DB_PATH && process.env.DB_PATH !== '/data/app.db') {
  warnings.push('DB_PATH should be /data/app.db so SQLite survives redeploys.');
}

if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  warnings.push('SESSION_SECRET should be at least 32 characters.');
}

if (process.env.TOKEN_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY)) {
  warnings.push('TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters.');
}

if (process.env.APP_URL && process.env.GOOGLE_REDIRECT_URI) {
  const expected = `${process.env.APP_URL.replace(/\/$/, '')}/api/admin/google/oauth/callback`;
  if (process.env.GOOGLE_REDIRECT_URI !== expected) {
    warnings.push(`GOOGLE_REDIRECT_URI should normally be ${expected}`);
  }
}

const googleMissing = optionalGoogle.filter((name) => !process.env[name]);
if (googleMissing.length) {
  warnings.push(`Google sync is not fully configured. Missing: ${googleMissing.join(', ')}`);
}

if (missing.length) {
  console.error(`Missing required deployment variables: ${missing.join(', ')}`);
  console.error('Generate secrets with:');
  console.error(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
  console.error(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

console.log('Deployment environment check passed.');
