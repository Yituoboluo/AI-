CREATE TABLE IF NOT EXISTS asset_uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  pathname TEXT NOT NULL UNIQUE,
  canonical_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 12582912),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  ready_at TEXT
);
CREATE INDEX IF NOT EXISTS asset_uploads_owner_created ON asset_uploads (owner_id, created_at);
CREATE INDEX IF NOT EXISTS asset_uploads_expiry ON asset_uploads (status, expires_at);
