import crypto from 'node:crypto';
import express from 'express';

import { syncGoogleLatest } from '../services/sync.js';

export function cronRouter(db, config) {
  const router = express.Router();

  router.post('/sync/google/latest', async (req, res) => {
    if (!config.cronSecret) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (!isAuthorized(req, config.cronSecret)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await syncGoogleLatest(db, config);
    res.status(result.ok ? 200 : 502).json(result);
  });

  return router;
}

function isAuthorized(req, expectedSecret) {
  const header = String(req.get('authorization') || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = bearer || String(req.get('x-cron-secret') || '');
  if (!provided) return false;
  return safeEqual(provided, expectedSecret);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
