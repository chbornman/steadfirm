-- Steadfirm application tables
-- BetterAuth manages its own tables (user, session, account, verification).
-- These tables reference BetterAuth's user.id via user_id TEXT columns.

CREATE TABLE IF NOT EXISTS service_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    service         TEXT NOT NULL,
    service_user_id TEXT NOT NULL,
    api_key         TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, service)
);

CREATE TABLE IF NOT EXISTS files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_service_connections_user_id ON service_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
