import express from 'express';
import { clearSession, issueSession, verifyPassword } from '../auth.js';
import { requireAuth } from '../middleware.js';

export function authRouter(db, config) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

    const user = db.prepare(`
      SELECT u.id, u.email, u.password_hash AS passwordHash, u.role, u.name,
        u.client_id AS clientId, u.active, c.status AS clientStatus
      FROM users u
      LEFT JOIN clients c ON c.id = u.client_id
      WHERE u.email = ?
    `).get(email);

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    if (user.role === 'client' && user.clientStatus !== 'active') {
      return res.status(403).json({ error: 'client_paused' });
    }

    issueSession(res, user, config);
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  return router;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    clientId: user.clientId
  };
}
