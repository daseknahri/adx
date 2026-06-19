import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'adt_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

export function issueSession(res, user, config) {
  const payload = {
    userId: user.id,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS
  };
  const raw = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = sign(raw, config.sessionSecret);
  res.cookie(COOKIE_NAME, `${raw}.${sig}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    signed: false,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readSession(req, config) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || !token.includes('.')) return null;
  const [raw, sig] = token.split('.');
  if (sign(raw, config.sessionSecret) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

