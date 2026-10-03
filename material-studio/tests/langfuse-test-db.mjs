import { DatabaseSync } from 'node:sqlite';

// Synchronous SQLite with the small D1 interface used by the adapter. No disk/network use.
export function createTestDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE generation_jobs (
      id TEXT PRIMARY KEY, owner_id TEXT, project_id TEXT, kind TEXT, source_revision INTEGER,
      source_version INTEGER, provider TEXT, model TEXT, status TEXT, input_json TEXT,
      result_json TEXT, error_code TEXT, error_message TEXT, usage_json TEXT, created_at TEXT,
      started_at TEXT, finished_at TEXT, feedback TEXT, feedback_reason TEXT, feedback_at TEXT,
      task_id TEXT, parent_job_id TEXT, attempt_no INTEGER, input_fingerprint TEXT,
      environment TEXT, evaluation_json TEXT, workflow_version TEXT
    );
    CREATE TABLE telemetry_events (
      id TEXT PRIMARY KEY, owner_id TEXT, project_id TEXT, task_id TEXT, job_id TEXT, asset_id TEXT,
      asset_version INTEGER, input_revision INTEGER, trace_id TEXT, span_id TEXT, parent_span_id TEXT,
      name TEXT, stage TEXT, status TEXT, duration_ms INTEGER, source TEXT, environment TEXT,
      occurred_at TEXT, received_at TEXT, data_json TEXT
    );
    CREATE TABLE creative_assets (
      id TEXT PRIMARY KEY, owner_id TEXT, job_id TEXT, task_id TEXT, version INTEGER, output_index INTEGER,
      concept_id TEXT, image_url TEXT, title TEXT, subtitle TEXT, layout TEXT, metadata_json TEXT, created_at TEXT
    );
    CREATE TABLE asset_feedback (
      id TEXT PRIMARY KEY, owner_id TEXT, asset_id TEXT, job_id TEXT, task_id TEXT, feedback TEXT,
      reason_code TEXT, note TEXT, created_at TEXT, request_json TEXT
    );
    CREATE TABLE quality_reviews (
      id TEXT PRIMARY KEY, owner_id TEXT, job_id TEXT, asset_id TEXT, kind TEXT,
      rubric_version TEXT, passed INTEGER, score INTEGER, report_json TEXT, created_at TEXT
    );
    CREATE TABLE quality_badcases (
      id TEXT PRIMARY KEY, owner_id TEXT, job_id TEXT, asset_id TEXT, kind TEXT, stage TEXT, code TEXT,
      title TEXT, status TEXT, evidence_json TEXT, hypothesis TEXT, fix TEXT, version INTEGER,
      created_at TEXT, updated_at TEXT, closed_at TEXT
    );
    CREATE TABLE quality_regressions (
      id TEXT PRIMARY KEY, owner_id TEXT, badcase_id TEXT, job_id TEXT, asset_id TEXT,
      outcome TEXT, report_json TEXT, request_json TEXT, created_at TEXT
    );
    CREATE TABLE langfuse_exports (
      id TEXT PRIMARY KEY, owner_id TEXT, job_id TEXT, item_type TEXT, state TEXT,
      payload_json TEXT, occurred_at TEXT, attempts INTEGER DEFAULT 0, next_retry_at TEXT,
      last_error TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  function prepare(sql) {
    let args = [];
    const api = {
      bind(...values) { args = values; return api; },
      async all() { return {success: true, results: sqlite.prepare(sql).all(...args)}; },
      async first(column) { const row = sqlite.prepare(sql).get(...args) || null; return column ? row?.[column] ?? null : row; },
      async run() { const result = sqlite.prepare(sql).run(...args); return {success: true, meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}}; },
    };
    return api;
  }
  return {
    sqlite,
    DB: {prepare, async batch(statements) { return Promise.all(statements.map(s => s.run())); }},
    insert(table, value) {
      const entries = Object.entries(value).filter(([, x]) => x !== undefined);
      sqlite.prepare(`INSERT INTO ${table} (${entries.map(([key]) => key).join(',')}) VALUES (${entries.map(() => '?').join(',')})`).run(...entries.map(([, x]) => x));
    },
    close() { sqlite.close(); },
  };
}
