import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { config } from './config.js';
import { openDb, seedDatabase } from './db.js';
import { attachAuth, requireAuth } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { clientRouter } from './routes/client.js';
import { cronRouter } from './routes/cron.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, config: appConfig = config }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: appConfig.isProd ? undefined : false
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(appConfig.sessionSecret));
  app.use(rateLimit({
    windowMs: 60_000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false
  }));
  app.use(attachAuth(db, appConfig));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', app: 'adsense-tracker', time: new Date().toISOString() });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        name: req.user.name,
        clientId: req.user.clientId
      }
    });
  });

  app.use('/api/auth', authRouter(db, appConfig));
  app.use('/api/cron', cronRouter(db, appConfig));
  app.use('/api/admin', adminRouter(db, appConfig));
  app.use('/api/client', clientRouter(db, appConfig));

  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'not_found' });
    });
  });

  return app;
}

export function startServer(appConfig = config) {
  const db = openDb(appConfig.dbPath);
  seedDatabase(db, appConfig);
  const app = createApp({ db, config: appConfig });
  return app.listen(appConfig.port, '0.0.0.0', () => {
    console.log(`AdSense Tracker listening on :${appConfig.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
