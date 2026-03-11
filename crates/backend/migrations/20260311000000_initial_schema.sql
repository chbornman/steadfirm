-- BetterAuth tables (must exist before BetterAuth starts)
CREATE TABLE IF NOT EXISTS "user" (
    "id"              text         PRIMARY KEY NOT NULL,
    "name"            text         NOT NULL,
    "email"           text         NOT NULL UNIQUE,
    "emailVerified"   boolean      NOT NULL DEFAULT false,
    "image"           text,
    "createdAt"       timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "session" (
    "id"          text         PRIMARY KEY NOT NULL,
    "expiresAt"   timestamptz  NOT NULL,
    "token"       text         NOT NULL UNIQUE,
    "createdAt"   timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress"   text,
    "userAgent"   text,
    "userId"      text         NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_userId ON "session"("userId");
CREATE INDEX IF NOT EXISTS idx_session_token ON "session"("token");

CREATE TABLE IF NOT EXISTS "account" (
    "id"                     text         PRIMARY KEY NOT NULL,
    "accountId"              text         NOT NULL,
    "providerId"             text         NOT NULL,
    "userId"                 text         NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accessToken"            text,
    "refreshToken"           text,
    "idToken"                text,
    "accessTokenExpiresAt"   timestamptz,
    "refreshTokenExpiresAt"  timestamptz,
    "scope"                  text,
    "password"               text,
    "createdAt"              timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_account_userId ON "account"("userId");

CREATE TABLE IF NOT EXISTS "verification" (
    "id"          text         PRIMARY KEY NOT NULL,
    "identifier"  text         NOT NULL,
    "value"       text         NOT NULL,
    "expiresAt"   timestamptz  NOT NULL,
    "createdAt"   timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"("identifier");

-- Steadfirm application tables

CREATE TABLE IF NOT EXISTS admin_credentials (
    service         TEXT PRIMARY KEY,
    admin_user_id   TEXT NOT NULL,
    admin_token     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
