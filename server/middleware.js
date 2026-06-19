import { config } from './config.js';
import { readSession } from './auth.js';

export function attachAuth(db, appConfig = config) {
  return (req, res, next) => {
    const session = readSession(req, appConfig);
    if (!session) return next();

    const user = db.prepare(`
      SELECT u.id, u.email, u.role, u.name, u.client_id AS clientId, u.active,
        c.status AS clientStatus
      FROM users u
      LEFT JOIN clients c ON c.id = u.client_id
      WHERE u.id = ? AND u.active = 1
    `).get(session.userId);

    if (user) req.user = user;
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

export function requireClient(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'client') return res.status(403).json({ error: 'forbidden' });
  if (req.user.clientStatus !== 'active') return res.status(403).json({ error: 'client_paused' });
  next();
}

export function audit(db, req, action, targetType, targetId, details = {}) {
  db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user?.id || null, action, targetType, targetId || null, JSON.stringify(details));
}
