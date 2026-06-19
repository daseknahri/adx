import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'client')),
      name TEXT NOT NULL,
      client_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subdomains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'Content',
      unit_price REAL NOT NULL DEFAULT 0,
      rent_status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_subdomains (
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      subdomain_id INTEGER NOT NULL REFERENCES subdomains(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (client_id, subdomain_id)
    );

    CREATE TABLE IF NOT EXISTS metrics_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subdomain_id INTEGER NOT NULL REFERENCES subdomains(id) ON DELETE CASCADE,
      metric_date TEXT NOT NULL,
      visitors INTEGER NOT NULL DEFAULT 0,
      page_views INTEGER NOT NULL DEFAULT 0,
      bounce_rate REAL NOT NULL DEFAULT 0,
      engaged_sessions INTEGER NOT NULL DEFAULT 0,
      earnings REAL NOT NULL DEFAULT 0,
      active_users INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      rpm REAL NOT NULL DEFAULT 0,
      adx_ctr REAL NOT NULL DEFAULT 0,
      adx_ecpm REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'seed',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (subdomain_id, metric_date)
    );

    CREATE TABLE IF NOT EXISTS google_connections (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      scope TEXT,
      account_id TEXT,
      connected_email TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      message TEXT,
      rows_synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn(db, 'metrics_daily', 'adx_ctr', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'metrics_daily', 'adx_ecpm', 'REAL NOT NULL DEFAULT 0');
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function seedDatabase(db, config) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return;

  const insertClient = db.prepare(`
    INSERT INTO clients (name, company, email, notes)
    VALUES (@name, @company, @email, @notes)
  `);
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, role, name, client_id)
    VALUES (@email, @passwordHash, @role, @name, @clientId)
  `);
  const insertSubdomain = db.prepare(`
    INSERT INTO subdomains (domain, category, unit_price, rent_status, notes)
    VALUES (@domain, @category, @unitPrice, @rentStatus, @notes)
  `);
  const assign = db.prepare(`
    INSERT INTO client_subdomains (client_id, subdomain_id)
    VALUES (?, ?)
  `);
  const insertMetric = db.prepare(`
    INSERT INTO metrics_daily (
      subdomain_id, metric_date, visitors, page_views, bounce_rate,
      engaged_sessions, earnings, active_users, clicks, impressions, rpm, source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed')
  `);

  const seed = db.transaction(() => {
    const adminHash = bcrypt.hashSync(config.seedAdminPassword, 12);
    insertUser.run({
      email: config.seedAdminEmail.toLowerCase(),
      passwordHash: adminHash,
      role: 'admin',
      name: 'Admin',
      clientId: null
    });

    const clientInfo = insertClient.run({
      name: 'Demo Client',
      company: 'Demo Publishing',
      email: config.seedClientEmail.toLowerCase(),
      notes: 'Seed client for first login and QA.'
    });
    const clientId = Number(clientInfo.lastInsertRowid);
    const clientHash = bcrypt.hashSync(config.seedClientPassword, 12);
    insertUser.run({
      email: config.seedClientEmail.toLowerCase(),
      passwordHash: clientHash,
      role: 'client',
      name: 'Demo Client',
      clientId
    });

    const domains = [
      ['news.demo.example.com', 'News', 18.5],
      ['sports.demo.example.com', 'Sports', 21],
      ['finance.demo.example.com', 'Finance', 33]
    ];

    for (const [domain, category, unitPrice] of domains) {
      const result = insertSubdomain.run({
        domain,
        category,
        unitPrice,
        rentStatus: 'active',
        notes: 'Seeded sample subdomain.'
      });
      const subdomainId = Number(result.lastInsertRowid);
      assign.run(clientId, subdomainId);
      for (let offset = 0; offset < 10; offset += 1) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const metricDate = date.toISOString().slice(0, 10);
        const pageViews = 850 + offset * 41 + subdomainId * 72;
        const earnings = Number((pageViews * (0.003 + subdomainId * 0.0008)).toFixed(2));
        insertMetric.run(
          subdomainId,
          metricDate,
          210 + offset * 9 + subdomainId * 13,
          pageViews,
          0.38 + subdomainId * 0.025,
          120 + offset * 5 + subdomainId * 8,
          earnings,
          64 + subdomainId * 7,
          18 + subdomainId * 3,
          590 + subdomainId * 80,
          Number(((earnings / pageViews) * 1000).toFixed(2))
        );
      }
    }
  });

  seed();
}
