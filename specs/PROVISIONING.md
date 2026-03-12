# Provisioning Specification

> Multi-service account creation — how a BetterAuth user becomes a fully provisioned Steadfirm user with credentials for Immich, Jellyfin, Paperless-ngx, Audiobookshelf, and Kavita.

---

## Table of Contents

1. [Overview](#overview)
2. [Trigger Points](#trigger-points)
3. [Provisioning Service](#provisioning-service)
4. [Per-Service Flows](#per-service-flows)
5. [Admin Bootstrap (Startup)](#admin-bootstrap-startup)
6. [Credential Storage](#credential-storage)
7. [Password Generation](#password-generation)
8. [Retry & Error Handling](#retry--error-handling)
9. [Frontend Polling](#frontend-polling)
10. [Configuration](#configuration)
11. [Database Schema](#database-schema)
12. [Complete Flow Diagram](#complete-flow-diagram)
13. [Known Gaps](#known-gaps)

---

## Overview

When a user signs up, Steadfirm must create accounts on 5 backing services and store per-user API credentials. This happens automatically in the background — the user sees a brief loading state, then full access.

The provisioning system has three layers:

1. **Admin bootstrap** (`startup.rs`) — runs once on first backend boot; initializes admin accounts on all 5 services and stores admin credentials
2. **User provisioning** (`provisioning.rs`) — creates per-user accounts using the admin credentials, runs in a background `tokio::spawn` task
3. **Credential loading** (`auth/session.rs`) — loads per-user credentials on every authenticated request from the `service_connections` table

```
Backend Boot                     User Signup
     │                               │
     ▼                               ▼
Admin Bootstrap               BetterAuth Webhook
(startup.rs)                       │
     │                               ▼
     ▼                        ProvisioningService
Initialize 5 services         (provisioning.rs)
     │                               │
     ▼                               ▼
admin_credentials table       Create user on 5 services
(1 row per service)                  │
                                     ▼
                              service_connections table
                              (1 row per user per service)
```

---

## Trigger Points

Three paths feed into the same `ProvisioningService.ensure_provisioned()`:

### 1. BetterAuth Webhook (Primary)

**Route:** `POST /api/v1/hooks/user-created`

After signup, BetterAuth fires a webhook with HMAC-SHA256 signature. The backend validates the signature and spawns provisioning. This is fire-and-forget from BetterAuth's perspective.

See `specs/AUTH.md` for webhook details.

### 2. `/users/me` Fallback (Safety Net)

**Route:** `GET /api/v1/users/me`

If the user has no service connections, this endpoint calls `ensure_provisioned()` as a safety net. This handles cases where the webhook failed (network error, backend was restarting, etc.).

```rust
if !has_any_service {
    state.provisioner.ensure_provisioned(...);
}
```

### 3. Manual Admin Endpoint

**Route:** `POST /api/v1/admin/provision`

Accepts optional `userId` in the body (defaults to the authenticated user). Looks up the user from BetterAuth's `user` table and triggers provisioning. Returns `"provisioning"` or `"already_in_progress"`.

---

## Provisioning Service

**File:** `crates/backend/src/provisioning.rs`

### Concurrency Control

```rust
pub struct ProvisioningService {
    in_progress: Arc<Mutex<HashSet<String>>>,
}
```

- Uses a per-user mutex-guarded set to prevent duplicate provisioning
- `ensure_provisioned()` checks the set, spawns a `tokio::spawn` task if not already running
- Returns `true` if spawned, `false` if already in progress
- User ID is removed from the set when provisioning completes (success or exhausted retries)

### Execution Flow

```
ensure_provisioned(user_id, name, email)
    │
    ├─ Check in_progress set → if present, return false (already running)
    │
    ├─ Add user_id to in_progress set
    │
    ├─ tokio::spawn background task:
    │      │
    │      ▼
    │  provision_with_retry(max_retries=3)
    │      │
    │      ├─ Attempt 1: try all 5 services sequentially
    │      │   ├─ Immich: create user + get API key
    │      │   ├─ Jellyfin: create user + get token
    │      │   ├─ Paperless: create user + get token
    │      │   ├─ Audiobookshelf: create user + get token
    │      │   └─ Kavita: invite + confirm + get API key
    │      │
    │      ├─ If any failed: sleep 2^1 = 2 seconds
    │      │   Re-check DB for missing services (another path may have succeeded)
    │      │   Retry only missing services
    │      │
    │      ├─ Attempt 2: retry failed services, sleep 2^2 = 4 seconds
    │      │
    │      └─ Attempt 3: retry failed services
    │
    └─ Remove user_id from in_progress set
```

---

## Per-Service Flows

Each service has a different user creation API. All follow the same pattern: create user → obtain a user-scoped API key/token → store in `service_connections`.

### Immich (Photos)

| Step | API Call | Auth | Notes |
| ---- | -------- | ---- | ----- |
| 1 | `POST /api/admin/users` | Admin API key (`x-api-key`) | `{ email, name, password }` |
| 2 | `POST /api/auth/login` | None | `{ email, password }` → `accessToken` |
| 3 | `POST /api/api-keys` | `Bearer {accessToken}` | `{ name: "steadfirm", permissions: ["all"] }` → `secret` |

**Identity field:** User's email address
**Stored:** `(immich_user_id, api_key_secret)`
**Ongoing auth header:** `x-api-key: {secret}`

### Jellyfin (Media)

| Step | API Call | Auth | Notes |
| ---- | -------- | ---- | ----- |
| 1 | `POST /Users/New` | Admin MediaBrowser token | `{ Name, Password }` |
| 2 | `POST /Users/{id}/Policy` | Admin MediaBrowser token | See policy below |
| 3 | `POST /Users/AuthenticateByName` | MediaBrowser header | `{ Username, Pw }` → `AccessToken` |

**User policy:**
- `IsHidden: true` — user doesn't appear in server's public user list
- `EnableMediaPlayback: true`
- `EnableAudioPlaybackTranscoding: true`
- `EnableVideoPlaybackTranscoding: true`
- `EnablePlaybackRemuxing: true`
- `EnableContentDownloading: true`
- `EnableRemoteAccess: true`

**Identity field:** User's name
**Stored:** `(jellyfin_user_id, access_token)`
**Ongoing auth header:** `MediaBrowser Token="{access_token}", ...`

### Paperless-ngx (Documents)

| Step | API Call | Auth | Notes |
| ---- | -------- | ---- | ----- |
| 1 | `POST /api/users/` | Admin `Token` header | `{ username: email, password, email }` |
| 2 | `PATCH /api/users/{id}/` | Admin `Token` header | Set 12 permissions |
| 3 | `POST /api/token/` | None | `{ username: email, password }` → `token` |

**Permissions granted:**
`view_document`, `add_document`, `change_document`, `delete_document`,
`view_tag`, `add_tag`, `change_tag`,
`view_correspondent`, `add_correspondent`, `change_correspondent`,
`view_documenttype`, `add_documenttype`, `change_documenttype`

**Identity field:** User's email (used as both username and email)
**Stored:** `(paperless_user_id, token)`
**Ongoing auth header:** `Token {token}`

### Audiobookshelf (Audiobooks)

| Step | API Call | Auth | Notes |
| ---- | -------- | ---- | ----- |
| 1 | `POST /api/users` | Admin `Bearer` token | `{ username: name, password, type: "user" }` → includes `user.token` |
| 2 | `PATCH /api/users/{id}` | Admin `Bearer` token | `{ isActive: true }` (ABS creates users inactive) |

Token is extracted directly from the creation response — no separate auth call needed.

**Identity field:** User's name
**Stored:** `(abs_user_id, token)`
**Ongoing auth header:** `Bearer {token}`

### Kavita (Reading)

Most complex flow — Kavita uses an invite-confirm pattern:

| Step | API Call | Auth | Notes |
| ---- | -------- | ---- | ----- |
| 1 | `POST /api/Account/login` | None | Login as admin → admin JWT |
| 2 | `POST /api/Account/invite` | Admin JWT | `{ email: "{username}@steadfirm.local", roles: ["Pleb"], ... }` → invite token |
| 3 | `POST /api/Account/confirm-email` | None | `{ username, password, email, token: invite_link }` |
| 4 | `POST /api/Account/login` | None | Login as new user → user JWT |
| 5 | `POST /api/Plugin/authenticate` | User JWT | `{ pluginName: "Steadfirm" }` → API key (plain text) |

**Username sanitization:** `sanitize_kavita_username(name)` strips non-alphanumeric characters. If the result is empty, falls back to `user{hex_hash}`.

**Identity field:** `{sanitized_username}@steadfirm.local` (synthetic email)
**Stored:** `("{username}@steadfirm.local", api_key)`
**Ongoing auth header:** `x-api-key: {api_key}`

---

## Admin Bootstrap (Startup)

**File:** `crates/backend/src/startup.rs`

On every backend boot, the startup sequence:

1. Loads existing admin credentials from the `admin_credentials` table
2. For each service missing a credential, runs first-time initialization
3. Stores new admin credentials via `UPSERT`

### Per-Service Init

| Service | First-Time Setup | How Admin Is Created |
| ------- | ---------------- | -------------------- |
| **Immich** | Check `GET /api/server/config` → `isInitialized`. If false: `POST /api/auth/admin-sign-up` → login → create API key | Via admin sign-up endpoint |
| **Jellyfin** | Check `GET /System/Info/Public` → `StartupWizardCompleted`. If false: run 4-step wizard (Configuration → User → RemoteAccess → Complete) → authenticate | Via startup wizard |
| **Paperless** | Try `POST /api/token/` with admin credentials. Admin created automatically by Docker env vars (`PAPERLESS_ADMIN_USER`, `PAPERLESS_ADMIN_PASSWORD`) | Via Docker env vars |
| **Audiobookshelf** | Check `GET /status` → `isInit`. If false: `POST /init` with root user → login → create "Audiobooks" library (type `book`, folder `/audiobooks`) | Via init endpoint |
| **Kavita** | Try login first. If fails: `POST /api/Account/register`. Then create "Reading" library (type `2`, folder `/books`) if none exists | Via register endpoint |

All admin initialization is **idempotent** — safe to run on every restart.

### Jellyfin Wizard Details

When Jellyfin hasn't completed its startup wizard, the backend runs:

1. `POST /Startup/Configuration` — set server metadata language
2. `POST /Startup/User` — create admin with `{ Name, Password }` from config
3. `POST /Startup/RemoteAccess` — enable remote access, disable UPnP
4. `POST /Startup/Complete` — finalize wizard
5. Sleep `JELLYFIN_WIZARD_SETTLE_SECS` (2 seconds)
6. `POST /Users/AuthenticateByName` — get admin token

---

## Credential Storage

### Admin Credentials

```sql
CREATE TABLE admin_credentials (
    service         TEXT PRIMARY KEY,         -- "immich", "jellyfin", etc.
    admin_user_id   TEXT NOT NULL,
    admin_token     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

One row per service. Written on first boot, updated via `UPSERT`.

### User Credentials

```sql
CREATE TABLE service_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,            -- BetterAuth user.id
    service         TEXT NOT NULL,            -- "immich", "jellyfin", etc.
    service_user_id TEXT NOT NULL,            -- user ID within the service
    api_key         TEXT NOT NULL,            -- per-user token/key
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, service)
);
CREATE INDEX idx_service_connections_user ON service_connections(user_id);
```

Written via `UPSERT` — re-provisioning is safe:

```sql
INSERT INTO service_connections (user_id, service, service_user_id, api_key)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, service)
DO UPDATE SET service_user_id = $3, api_key = $4, active = true
```

---

## Password Generation

Service accounts need passwords to satisfy API requirements, but users never see or type them. Passwords are:

- **32 characters** (`GENERATED_PASSWORD_LENGTH`)
- **Alphanumeric** (a-z, A-Z, 0-9)
- **Random** (generated per service per user)
- **Not stored** — only the resulting API key/token is stored

The passwords exist only transiently during the provisioning flow (create user → login → get token → discard password).

---

## Retry & Error Handling

### Retry Strategy

- **Max retries:** `PROVISION_MAX_RETRIES` (default 3)
- **Backoff:** Exponential — `2^attempt` seconds (2s, 4s, 8s)
- **Base:** `PROVISION_RETRY_BACKOFF_BASE_SECS` (default 2)
- **Granularity:** Per-service. Only failed services are retried.
- **DB re-check:** Between retries, the system queries `service_connections` to see if another code path (e.g., `/users/me` fallback or admin endpoint) has already succeeded.

### Failure Modes

| Failure | Behavior |
| ------- | -------- |
| Service temporarily down | Retried up to 3 times with backoff |
| Service permanently broken | All retries exhausted; user_id removed from in_progress set. Next `/users/me` call will re-trigger. |
| Network error | Treated same as service down |
| Duplicate user (already exists) | Depends on service — most return an error that fails the create step. Re-provisioning via UPSERT handles this if credentials can be re-obtained. |
| Webhook missed entirely | `/users/me` fallback triggers provisioning on first authenticated request |

### Idempotency

The system is designed to be re-runnable:
- `ensure_provisioned()` is safe to call multiple times (dedup via in_progress set)
- `store_credential()` uses `UPSERT` — re-storing is safe
- Admin bootstrap runs on every backend boot — skips already-initialized services

---

## Frontend Polling

The frontend doesn't actively poll for provisioning status. Instead:

1. Route guard calls `GET /api/v1/users/me` on every page navigation (with TanStack Query, 5-minute stale time)
2. Response includes `services: { photos: boolean, media: boolean, ... }`
3. If any service is `false`, the frontend can show a loading indicator
4. The `/users/me` endpoint itself triggers provisioning as a safety net
5. On next navigation or manual refresh, the user sees updated status

---

## Configuration

### Constants (`crates/backend/src/constants.rs`)

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `GENERATED_PASSWORD_LENGTH` | 32 | Random password length |
| `PROVISION_RETRY_BACKOFF_BASE_SECS` | 2 | Exponential backoff base |
| `EXPECTED_SERVICE_COUNT` | 5 | Number of services needing admin init |
| `JELLYFIN_WIZARD_SETTLE_SECS` | 2 | Delay after Jellyfin wizard completion |

### Config (`crates/backend/src/config.rs`)

| Field | Env Var | Default | Purpose |
| ----- | ------- | ------- | ------- |
| `admin_password` | `ADMIN_PASSWORD` | Required | Master password for all service admins |
| `provision_max_retries` | `PROVISION_MAX_RETRIES` | 3 | Max retry attempts per service |
| `immich_admin_email` | `IMMICH_ADMIN_EMAIL` | `admin@steadfirm.local` | |
| `jellyfin_admin_username` | `JELLYFIN_ADMIN_USERNAME` | `admin` | |
| `paperless_admin_username` | `PAPERLESS_ADMIN_USERNAME` | `admin` | |
| `audiobookshelf_admin_username` | `AUDIOBOOKSHELF_ADMIN_USERNAME` | `root` | |
| `kavita_admin_username` | `KAVITA_ADMIN_USERNAME` | `admin` | |

Admin API keys/tokens are loaded from the `admin_credentials` DB table on startup, not from environment variables (env vars serve as fallbacks with empty defaults).

---

## Database Schema

See `crates/backend/migrations/20260311000000_initial_schema.sql` for the full schema.

**Tables relevant to provisioning:**

| Table | Purpose | Key Columns |
| ----- | ------- | ----------- |
| `"user"` | BetterAuth user accounts | `id`, `name`, `email` |
| `admin_credentials` | Admin tokens for service APIs | `service` (PK), `admin_token` |
| `service_connections` | Per-user service credentials | `user_id`, `service`, `api_key`, `active` |

---

## Complete Flow Diagram

```
FIRST BOOT (admin bootstrap)
═══════════════════════════════════════════════════════
Backend starts
    │
    ▼
Connect to Postgres, run migrations
    │
    ▼
Load admin_credentials table (empty on first boot)
    │
    ▼
For each of 5 services:
    ├─ Immich: admin sign-up → login → API key
    ├─ Jellyfin: startup wizard → authenticate
    ├─ Paperless: get admin token (Docker created admin)
    ├─ Audiobookshelf: init → login → create library
    └─ Kavita: register → login → create library
    │
    ▼
Store admin credentials in admin_credentials table
    │
    ▼
Backend ready, accepting requests


USER SIGNUP (provisioning)
═══════════════════════════════════════════════════════
User signs up via /api/auth/sign-up
    │
    ▼
BetterAuth: create user + session in Postgres
    │
    ├──→ Set session cookie → redirect to app
    │
    └──→ Webhook: POST /api/v1/hooks/user-created
              │
              ▼
         Validate HMAC signature
              │
              ▼
         provisioner.ensure_provisioned()
              │
              ▼
         tokio::spawn background task
              │
              ▼
         For each of 5 services (sequentially):
              │
              ├─ Immich: POST admin/users → login → create API key
              │   └─ store_credential(user_id, "immich", immich_id, api_key)
              │
              ├─ Jellyfin: POST Users/New → set policy → authenticate
              │   └─ store_credential(user_id, "jellyfin", jf_id, token)
              │
              ├─ Paperless: POST api/users → set permissions → get token
              │   └─ store_credential(user_id, "paperless", pl_id, token)
              │
              ├─ Audiobookshelf: POST api/users → activate
              │   └─ store_credential(user_id, "audiobookshelf", abs_id, token)
              │
              └─ Kavita: admin login → invite → confirm → user login → plugin auth
                  └─ store_credential(user_id, "kavita", email, api_key)
              │
              ▼
         Remove user_id from in_progress set
              │
              ▼
         Done — next /api/v1/users/me returns all services: true


EVERY REQUEST (credential loading)
═══════════════════════════════════════════════════════
AuthUser extractor runs:
    │
    ├─ Validate session token against session table
    │
    └─ Load service_connections for user_id
         └─ Map rows to ServiceCredentials struct
              ├─ immich: Some(ServiceCred { service_user_id, api_key })
              ├─ jellyfin: Some(ServiceCred { ... })
              ├─ paperless: Some(ServiceCred { ... })
              ├─ audiobookshelf: Some(ServiceCred { ... })
              └─ kavita: Some(ServiceCred { ... })
```

---

## Known Gaps

- **No user deletion** — no way to deprovision a user (delete accounts across all 5 services)
- **No credential rotation** — API keys/tokens are created once and never refreshed
- **No provisioning status API** — frontend can only check boolean service connectivity via `/users/me`, no progress percentage or per-service status
- **Sequential provisioning** — services are provisioned one at a time; parallel provisioning would be faster
- **Single admin password** — all 5 services use the same `ADMIN_PASSWORD`; compromising one compromises all
- **Kavita username sanitization** — edge case where two different names sanitize to the same username
- **No retry persistence** — if the backend restarts mid-provisioning, in-progress state is lost (the `/users/me` fallback recovers this)
- **Reclassify endpoint** — `POST /api/v1/files/:id/reclassify` is a stub; moving files between services after initial routing is not implemented
