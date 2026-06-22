import { syncGoogleBackfill, syncGoogleLatest, syncGoogleReports } from './sync.js';

export function createSyncJobRunner(db, config) {
  recoverInterruptedJobs(db);
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (true) {
        const job = claimNextJob(db);
        if (!job) break;
        await runJob(db, config, job);
      }
    } finally {
      running = false;
      if (hasQueuedJobs(db)) {
        setTimeout(() => {
          drain().catch((error) => console.error('Sync job drain failed:', error));
        }, 0);
      }
    }
  }

  function queue(type, payload = {}, requestedBy = null) {
    const normalizedPayload = normalizePayload(type, payload);
    const duplicate = findActiveDuplicate(db, type, normalizedPayload);
    if (duplicate) {
      return { job: duplicate, duplicate: true };
    }

    const result = db.prepare(`
      INSERT INTO sync_jobs (type, status, requested_by, payload_json, message)
      VALUES (?, 'queued', ?, ?, ?)
    `).run(
      type,
      requestedBy,
      JSON.stringify(normalizedPayload),
      queuedMessage(type, normalizedPayload)
    );
    const job = getJob(db, Number(result.lastInsertRowid));
    setTimeout(() => {
      drain().catch((error) => console.error('Sync job drain failed:', error));
    }, 0);
    return { job, duplicate: false };
  }

  return {
    queue,
    list: (limit = 8) => listJobs(db, limit),
    get: (id) => getJob(db, id),
    active: () => activeJobs(db),
    drain
  };
}

function normalizePayload(type, payload = {}) {
  if (type !== 'range') return {};
  return { range: normalizeRange(payload.range || payload) };
}

function normalizeRange(range = {}) {
  const today = new Date().toISOString().slice(0, 10);
  let from = cleanDate(range.from) || today;
  let to = cleanDate(range.to) || from;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

function cleanDate(value) {
  const candidate = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? null : candidate;
}

function queuedMessage(type, payload) {
  if (type === 'range') return `Queued selected range ${payload.range.from} - ${payload.range.to}`;
  if (type === 'backfill') return 'Queued historical backfill';
  return 'Queued latest refresh';
}

function claimNextJob(db) {
  const job = db.prepare(`
    SELECT *
    FROM sync_jobs
    WHERE status = 'queued'
    ORDER BY id ASC
    LIMIT 1
  `).get();
  if (!job) return null;

  const claimed = db.prepare(`
    UPDATE sync_jobs
    SET status = 'running', started_at = CURRENT_TIMESTAMP, message = ?
    WHERE id = ? AND status = 'queued'
  `).run(runningMessage(job.type, parsePayload(job.payload_json)), job.id);

  return claimed.changes ? normalizeJob({ ...job, status: 'running' }) : null;
}

async function runJob(db, config, job) {
  const payload = job.payload || parsePayload(job.payloadJson);
  try {
    const result = await executeSync(db, config, job.type, payload);
    const status = result.ok ? 'success' : 'failed';
    db.prepare(`
      UPDATE sync_jobs
      SET status = @status,
          sync_run_id = @syncRunId,
          range_from = @rangeFrom,
          range_to = @rangeTo,
          rows_synced = @rowsSynced,
          message = @message,
          error = @error,
          finished_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      id: job.id,
      status,
      syncRunId: result.syncRunId || null,
      rangeFrom: result.range?.from || null,
      rangeTo: result.range?.to || null,
      rowsSynced: Number(result.rowsSynced || 0),
      message: result.ok ? syncJobMessage(result) : 'Sync failed',
      error: result.ok ? null : result.error || 'Sync failed'
    });
  } catch (error) {
    db.prepare(`
      UPDATE sync_jobs
      SET status = 'failed',
          message = 'Sync failed',
          error = ?,
          finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(error.message || 'Sync failed', job.id);
  }
}

function executeSync(db, config, type, payload) {
  if (type === 'range') {
    return syncGoogleReports(db, config, payload.range, { preferDateDimension: true });
  }
  if (type === 'backfill') {
    return syncGoogleBackfill(db, config);
  }
  return syncGoogleLatest(db, config);
}

function runningMessage(type, payload) {
  if (type === 'range') return `Syncing ${payload.range.from} - ${payload.range.to}`;
  if (type === 'backfill') return 'Backfilling stored history';
  return 'Refreshing latest AdX data';
}

function syncJobMessage(result) {
  const range = result.range ? ` (${result.range.from} - ${result.range.to})` : '';
  return `Synced ${Number(result.rowsSynced || 0)} rows from ${result.mode || 'google'}${range}`;
}

function findActiveDuplicate(db, type, payload) {
  const jobs = db.prepare(`
    SELECT *
    FROM sync_jobs
    WHERE type = ?
      AND status IN ('queued', 'running')
    ORDER BY id DESC
  `).all(type);
  const payloadJson = JSON.stringify(payload);
  const duplicate = jobs.find((job) => type !== 'range' || String(job.payload_json || '{}') === payloadJson);
  return duplicate ? normalizeJob(duplicate) : null;
}

function activeJobs(db) {
  return db.prepare(`
    SELECT ${jobColumns()}
    FROM sync_jobs
    WHERE status IN ('queued', 'running')
    ORDER BY id ASC
  `).all().map(normalizeJob);
}

function listJobs(db, limit = 8) {
  return db.prepare(`
    SELECT ${jobColumns()}
    FROM sync_jobs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit).map(normalizeJob);
}

function getJob(db, id) {
  const job = db.prepare(`
    SELECT ${jobColumns()}
    FROM sync_jobs
    WHERE id = ?
  `).get(id);
  return job ? normalizeJob(job) : null;
}

function hasQueuedJobs(db) {
  return Boolean(db.prepare("SELECT 1 FROM sync_jobs WHERE status = 'queued' LIMIT 1").get());
}

function recoverInterruptedJobs(db) {
  db.prepare(`
    UPDATE sync_jobs
    SET status = 'failed',
        message = 'Interrupted by server restart',
        error = 'Server restarted before this job finished',
        finished_at = CURRENT_TIMESTAMP
    WHERE status IN ('queued', 'running')
  `).run();
}

function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function jobColumns() {
  return `
    id, type, status, requested_by AS requestedBy, payload_json AS payloadJson,
    sync_run_id AS syncRunId, range_from AS rangeFrom, range_to AS rangeTo,
    rows_synced AS rowsSynced, message, error,
    created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
  `;
}

function normalizeJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    requestedBy: job.requestedBy ?? job.requested_by ?? null,
    payload: parsePayload(job.payloadJson ?? job.payload_json),
    syncRunId: job.syncRunId ?? job.sync_run_id ?? null,
    rangeFrom: job.rangeFrom ?? job.range_from ?? null,
    rangeTo: job.rangeTo ?? job.range_to ?? null,
    rowsSynced: Number(job.rowsSynced ?? job.rows_synced ?? 0),
    message: job.message || '',
    error: job.error || '',
    createdAt: job.createdAt ?? job.created_at ?? null,
    startedAt: job.startedAt ?? job.started_at ?? null,
    finishedAt: job.finishedAt ?? job.finished_at ?? null
  };
}
