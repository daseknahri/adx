import crypto from 'node:crypto';

export function encryptSecret(value, key) {
  if (!value || !key) return value || '';
  const normalizedKey = normalizeKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', normalizedKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(value, key) {
  if (!value || !key || !String(value).startsWith('v1:')) return value || '';
  const [, ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    normalizeKey(key),
    Buffer.from(ivRaw, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function normalizeKey(key) {
  if (/^[a-f0-9]{64}$/i.test(key)) return Buffer.from(key, 'hex');
  return crypto.createHash('sha256').update(String(key)).digest();
}

