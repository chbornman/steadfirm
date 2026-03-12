# Auth Specification

> Authentication and session management in Steadfirm — BetterAuth sidecar, session validation, OAuth, cookie handling, and the full signup/login lifecycle.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [BetterAuth Sidecar](#betterauth-sidecar)
4. [Session Lifecycle](#session-lifecycle)
5. [Axum Session Validation](#axum-session-validation)
6. [Token Extraction](#token-extraction)
7. [User Model](#user-model)
8. [Signup Flow](#signup-flow)
9. [Login Flow](#login-flow)
10. [OAuth (Google)](#oauth-google)
11. [Session Management](#session-management)
12. [Password & Email](#password--email)
13. [Webhook (Signup → Provisioning)](#webhook-signup--provisioning)
14. [Frontend Auth](#frontend-auth)
15. [Database Schema](#database-schema)
16. [Configuration](#configuration)
17. [Security Considerations](#security-considerations)

---

## Overview

Steadfirm uses **BetterAuth** as an external authentication sidecar. BetterAuth runs as a standalone Bun service that handles signup, login, OAuth callbacks, and session creation. It writes directly to Postgres tables (`user`, `session`, `account`, `verification`).

The Axum backend **never calls BetterAuth over HTTP** for session validation. Instead, it reads the same Postgres `session` and `user` tables directly — zero-latency, no network hop. This is the key architectural decision: BetterAuth is a write-path dependency only.

```
Browser ──── /api/auth/* ───→ Caddy ──→ BetterAuth (:3002) ──→ Postgres
Browser ──── /api/v1/*   ───→ Caddy ──→ Axum (:3001) ──────→ Postgres (reads session table)
```

---

## Architecture

```
┌──────────────┐     ┌────────────────────┐     ┌──────────┐
│   Browser    │────→│  Caddy (reverse    │────→│ BetterAuth│  (signup, login, OAuth)
│              │     │  proxy)             │     │  :3002   │
│  cookie:     │     │                    │     │          │──→ Postgres
│  better-auth │     │  /api/auth/* → :3002│     └──────────┘    (writes user, session,
│  .session_   │     │  /api/*     → :3001│                       account tables)
│  token       │     └────────────────────┘
│              │               │
│              │               ▼
│              │     ┌──────────────────┐
│              │────→│  Axum Backend    │──→ Postgres
│              │     │  :3001           │    (reads session table directly)
│              │     │                  │
│              │     │  AuthUser        │──→ service_connections table
│              │     │  extractor       │    (loads per-service credentials)
│              │     └──────────────────┘
└──────────────┘
```

### Design Rationale

- **Why a sidecar?** BetterAuth is a JS/TS library. Running it in Bun keeps auth logic in its native ecosystem (OAuth provider SDKs, password hashing, session management). Axum doesn't reimplement any of this.
- **Why direct Postgres reads?** Eliminates a network hop on every authenticated request. The `session` table is indexed on `token` — lookups are sub-millisecond.
- **Why not JWT?** Session-based auth with Postgres-backed sessions gives us instant revocation. No token refresh complexity, no JWT secret rotation concerns.

---

## BetterAuth Sidecar

**Location:** `services/betterauth/`

### Runtime

- **Image:** `oven/bun:1-alpine`
- **Port:** 3002 (internal only — not exposed to host in production)
- **Health check:** `GET /health` → `{ status: "ok", service: "betterauth" }`
- **Base path:** `/api/auth` (all BetterAuth routes live here)

### Configuration

| Env Var | Purpose |
| ------- | ------- |
| `BETTER_AUTH_SECRET` | Signs session tokens (HMAC) |
| `BETTER_AUTH_URL` | Public base URL (for OAuth callbacks) |
| `BETTER_AUTH_DATABASE` | Postgres connection string |
| `GOOGLE_CLIENT_ID` | Google OAuth (optional) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth (optional) |
| `WEBHOOK_SECRET` | HMAC secret for signup webhook |
| `BACKEND_INTERNAL_URL` | Where to POST the signup webhook |

### Features Enabled

- **Email + password auth:** Always enabled
- **Google OAuth:** Conditionally enabled if both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- **Session config:** 30-day expiry, refreshes every 24 hours (`updateAge`)

### Trusted Origins

BetterAuth is configured with trusted origins for CORS:

- `BETTER_AUTH_URL` (production)
- `http://localhost:5173` (Vite dev)
- `http://localhost:18003` (alt dev)
- `http://localhost:3001` (Axum backend)
- `http://localhost:18080` (Caddy)
- `http://192.168.0.99:5173` (LAN dev)

---

## Session Lifecycle

```
1. User signs up or logs in via /api/auth/*
    │
2. BetterAuth creates a session row in Postgres:
    │  - token: random string
    │  - expiresAt: now() + 30 days
    │  - userId, ipAddress, userAgent
    │
3. BetterAuth sets cookie:
    │  better-auth.session_token = "{token}.{hmac}"
    │
4. Browser sends cookie on every /api/v1/* request
    │
5. Axum AuthUser extractor:
    │  a. Reads cookie, strips HMAC suffix (part after ".")
    │  b. Queries: SELECT userId FROM session WHERE token = $1 AND expiresAt > now()
    │  c. Queries: SELECT * FROM service_connections WHERE user_id = $1
    │  d. Populates AuthUser struct
    │
6. Session auto-refreshes every 24 hours (BetterAuth updateAge)
    │
7. Session expires after 30 days of inactivity
    │
8. User can manually revoke sessions via Settings page
```

---

## Axum Session Validation

**File:** `crates/backend/src/auth/session.rs`

Two queries run on every authenticated request:

### 1. Validate Session

```sql
SELECT s."userId" as user_id, u.name, u.email
FROM session s
JOIN "user" u ON s."userId" = u.id
WHERE s.token = $1
  AND s."expiresAt" > now()
```

Returns `Unauthorized` if no matching unexpired session found.

### 2. Load Service Credentials

```sql
SELECT service, service_user_id, api_key
FROM service_connections
WHERE user_id = $1
  AND active = true
```

Returns credential rows mapped into the `ServiceCredentials` struct.

Both queries hit indexed columns (`session.token`, `service_connections.user_id`) — sub-millisecond on any reasonable dataset.

---

## Token Extraction

**File:** `crates/backend/src/auth/extractor.rs`

The `AuthUser` extractor tries two sources in order:

### 1. Cookie (Primary)

Cookie name: `better-auth.session_token`

BetterAuth sets the cookie value as `{token}.{hmac_suffix}`. Axum splits on `.` and takes only the token portion (the part before the first dot). The HMAC suffix is a BetterAuth implementation detail — Axum validates against Postgres, not against the HMAC.

### 2. Authorization Header (Fallback)

```
Authorization: Bearer {token}
```

Used by non-browser clients (Tauri app, API testing). The raw token value is used directly.

### Result

If neither source provides a valid token, the request returns `401 Unauthorized`.

---

## User Model

### AuthUser Struct

```rust
pub struct AuthUser {
    pub id: String,          // BetterAuth user ID
    pub name: String,
    pub email: String,
    pub credentials: ServiceCredentials,
}

pub struct ServiceCredentials {
    pub immich: Option<ServiceCred>,
    pub jellyfin: Option<ServiceCred>,
    pub paperless: Option<ServiceCred>,
    pub audiobookshelf: Option<ServiceCred>,
    pub kavita: Option<ServiceCred>,
}

pub struct ServiceCred {
    pub service_user_id: String,
    pub api_key: String,
}
```

`AuthUser` is an Axum extractor — any handler that includes it in its function signature automatically requires authentication.

### TypeScript Types

```typescript
type User = { id: string; name: string; email: string; image?: string }

type UserProfile = {
  id: string; name: string; email: string;
  services: {
    photos: boolean; media: boolean; documents: boolean;
    audiobooks: boolean; reading: boolean; files: boolean;
  }
}
```

---

## Signup Flow

```
Browser                    Caddy              BetterAuth           Postgres         Axum Backend
  │                          │                    │                   │                  │
  │ POST /api/auth/sign-up   │                    │                   │                  │
  │ { name, email, password }│                    │                   │                  │
  │─────────────────────────→│───────────────────→│                   │                  │
  │                          │                    │ INSERT user        │                  │
  │                          │                    │ INSERT account     │                  │
  │                          │                    │ INSERT session     │                  │
  │                          │                    │──────────────────→│                  │
  │                          │                    │                   │                  │
  │                          │                    │ after-hook fires:  │                  │
  │                          │                    │ POST /api/v1/hooks/user-created       │
  │                          │                    │ X-Webhook-Signature: HMAC-SHA256      │
  │                          │                    │ { userId, name, email }               │
  │                          │                    │─────────────────────────────────────→│
  │                          │                    │                   │                  │
  │   Set-Cookie: better-auth.session_token       │                  │ validate HMAC    │
  │←─────────────────────────│←──────────────────│                   │ spawn provision  │
  │                          │                    │                   │                  │
  │ GET /api/v1/users/me     │                    │                   │                  │
  │─────────────────────────→│ → Axum validates session via Postgres  │                  │
  │                          │   returns { services: { photos: false, ... } }            │
  │                          │                    │                   │                  │
  │ (poll until services ready)                   │                   │                  │
```

---

## Login Flow

```
Browser                    Caddy              BetterAuth           Postgres
  │                          │                    │                   │
  │ POST /api/auth/sign-in   │                    │                   │
  │ { email, password }      │                    │                   │
  │─────────────────────────→│───────────────────→│                   │
  │                          │                    │ Verify password    │
  │                          │                    │ (bcrypt in account)│
  │                          │                    │ INSERT session     │
  │                          │                    │──────────────────→│
  │                          │                    │                   │
  │   Set-Cookie: better-auth.session_token       │                   │
  │←─────────────────────────│←──────────────────│                   │
```

No webhook fires on login — provisioning only triggers on signup (or as a fallback from `/users/me`).

---

## OAuth (Google)

### Enable

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the BetterAuth environment. If either is missing, Google OAuth is silently disabled.

### Flow

1. Frontend calls `signIn.social({ provider: 'google', callbackURL: '/photos' })`
2. BetterAuth redirects to Google's consent screen
3. Google redirects back to `{BETTER_AUTH_URL}/api/auth/callback/google`
4. BetterAuth creates/links the account, creates a session, sets the cookie
5. BetterAuth redirects to `callbackURL`
6. The signup after-hook fires (same as email signup) if this is a new account

---

## Session Management

The Settings page (`web/src/pages/Settings.tsx`) exposes session management via BetterAuth's client SDK:

| Action | Method | Notes |
| ------ | ------ | ----- |
| List sessions | `authClient.listSessions()` | Shows device, creation date, current indicator |
| Revoke other sessions | `authClient.revokeOtherSessions()` | Keep current, invalidate all others |
| Revoke specific session | `authClient.revokeSession({ token })` | Invalidate one session |
| Sign out | `signOut()` | Deletes current session, clears cookie |

---

## Password & Email

| Action | Method | Notes |
| ------ | ------ | ----- |
| Change password | `authClient.changePassword({ currentPassword, newPassword })` | Requires current password |
| Change email | `authClient.changeEmail({ newEmail })` | Via BetterAuth client |
| Update name | `authClient.updateUser({ name })` | Profile update |
| Password reset | Not yet implemented | Needs Resend email integration (see TODO.md) |
| Email verification | Not yet implemented | Needs Resend email integration |

### Password Requirements

- Minimum 8 characters (client-side validation)
- BetterAuth handles hashing (bcrypt, stored in `account.password`)

---

## Webhook (Signup → Provisioning)

**Purpose:** When a user signs up, BetterAuth notifies the Axum backend to begin provisioning per-service accounts.

### Sender (BetterAuth)

After any `/sign-up` path (email or OAuth), BetterAuth:

1. Constructs payload: `{ userId, name, email }`
2. Signs with HMAC-SHA256: `HMAC(WEBHOOK_SECRET, JSON.stringify(payload))`
3. POSTs to `{BACKEND_INTERNAL_URL}/api/v1/hooks/user-created`
4. Sets `X-Webhook-Signature` header with hex-encoded signature
5. Fire-and-forget — does not block the signup response

### Receiver (Axum)

`POST /api/v1/hooks/user-created`:

1. Reads raw body bytes
2. Computes HMAC-SHA256 with the shared `WEBHOOK_SECRET`
3. Constant-time comparison (`constant_time_eq`) against `X-Webhook-Signature`
4. If valid: spawns provisioning via `state.provisioner.ensure_provisioned()`
5. Returns `200 OK` immediately

**No `AuthUser` extractor** — this endpoint authenticates via HMAC, not session.

---

## Frontend Auth

### Client Setup

```typescript
// web/src/hooks/useAuth.ts
import { createAuthClient } from 'better-auth/react';

const authClient = createAuthClient({
  baseURL: window.location.origin,
});

export const { useSession, signIn, signUp, signOut } = authClient;
```

### Route Guards

| Guard | Used On | Behavior |
| ----- | ------- | -------- |
| `requireAuth()` | All app routes | Checks `authClient.getSession()`, redirects to `/login` if missing. Pre-fetches `/api/v1/users/me`. |
| `requireGuest()` | `/login`, `/signup` | Checks `authClient.getSession()`, redirects to `/photos` if already logged in. |

### HTTP Client

- Uses `ky` with `credentials: 'include'` (sends cookies automatically)
- On `401` response: redirects to `/login`
- On `403`: shows access denied message

---

## Database Schema

### BetterAuth Tables

These tables are created by the Steadfirm migration but managed (read/write) by BetterAuth:

```sql
-- User accounts
CREATE TABLE "user" (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    image         TEXT,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active sessions
CREATE TABLE session (
    id            TEXT PRIMARY KEY,
    "expiresAt"   TIMESTAMPTZ NOT NULL,
    token         TEXT NOT NULL UNIQUE,  -- indexed, used for validation
    "userId"      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "ipAddress"   TEXT,
    "userAgent"   TEXT,
    ...
);
CREATE INDEX idx_session_token ON session(token);
CREATE INDEX idx_session_user_id ON session("userId");

-- Auth providers (email, google, etc.)
CREATE TABLE account (
    id            TEXT PRIMARY KEY,
    "accountId"   TEXT NOT NULL,
    "providerId"  TEXT NOT NULL,  -- "email", "google", etc.
    "userId"      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    password      TEXT,           -- bcrypt hash (email provider only)
    "accessToken" TEXT,           -- OAuth tokens
    ...
);

-- Email verification tokens
CREATE TABLE verification (
    id            TEXT PRIMARY KEY,
    identifier    TEXT NOT NULL,
    value         TEXT NOT NULL,
    "expiresAt"   TIMESTAMPTZ NOT NULL,
    ...
);
```

### Steadfirm Tables (Auth-Related)

```sql
-- Per-user credentials for each backing service
CREATE TABLE service_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,       -- references user.id
    service         TEXT NOT NULL,       -- "immich", "jellyfin", etc.
    service_user_id TEXT NOT NULL,       -- user ID within that service
    api_key         TEXT NOT NULL,       -- per-user API key/token
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, service)
);
CREATE INDEX idx_service_connections_user ON service_connections(user_id);
```

---

## Configuration

### Backend (`crates/backend/src/config.rs`)

| Field | Env Var | Default | Required |
| ----- | ------- | ------- | -------- |
| `database_url` | `DATABASE_URL` | — | Yes |
| `webhook_secret` | `WEBHOOK_SECRET` | — | Yes |
| `admin_password` | `ADMIN_PASSWORD` | — | Yes |

### BetterAuth (`services/betterauth/.env`)

| Env Var | Required | Notes |
| ------- | -------- | ----- |
| `BETTER_AUTH_SECRET` | Yes | Session signing key |
| `BETTER_AUTH_URL` | Yes | Public URL for OAuth callbacks |
| `BETTER_AUTH_DATABASE` | Yes | Postgres connection string |
| `WEBHOOK_SECRET` | Yes | Must match backend's `WEBHOOK_SECRET` |
| `BACKEND_INTERNAL_URL` | Yes | Backend URL for webhook delivery |
| `GOOGLE_CLIENT_ID` | No | Enables Google OAuth |
| `GOOGLE_CLIENT_SECRET` | No | Enables Google OAuth |

---

## Security Considerations

### Current Protections

- **HMAC webhook validation** with constant-time comparison (prevents timing attacks)
- **Session-based auth** — no JWTs, instant revocation via DB delete
- **Cookie-based token transport** — `better-auth.session_token` set by BetterAuth
- **Credentials: include** on all API requests (cookie sent automatically)
- **401 → redirect** — expired sessions are caught and redirected to login
- **Per-service credential isolation** — each user's service API keys are stored separately

### Known Gaps

- **No CSRF protection** — BetterAuth handles this for its own routes, but the Axum API relies on cookie-based auth without CSRF tokens
- **No rate limiting** — neither BetterAuth nor Axum rate-limit login attempts
- **No email verification** — `emailVerified` defaults to `false`, not enforced
- **No password reset flow** — needs Resend email integration
- **Cookie settings** — `Secure`, `SameSite`, `HttpOnly` flags are managed by BetterAuth defaults; not explicitly configured
- **Session tokens in service_connections** — API keys stored as plaintext in Postgres (acceptable for a single-server deployment, but not ideal at scale)
