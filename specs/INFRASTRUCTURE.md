# Infrastructure Specification

> Docker Compose topology, Caddy routing, networking, volumes, environment variables, health checks, startup ordering, and local development setup.

---

## Table of Contents

1. [Overview](#overview)
2. [Container Topology](#container-topology)
3. [Caddy Routing](#caddy-routing)
4. [Network](#network)
5. [Port Map](#port-map)
6. [Volume Mounts](#volume-mounts)
7. [Startup Ordering](#startup-ordering)
8. [Health Checks](#health-checks)
9. [Environment Variables](#environment-variables)
10. [Database Initialization](#database-initialization)
11. [Backend Docker Build](#backend-docker-build)
12. [Image Pinning](#image-pinning)
13. [Local Development](#local-development)
14. [Dev Scripts](#dev-scripts)
15. [External Access (Cloudflare Tunnel)](#external-access-cloudflare-tunnel)
16. [Secrets Management](#secrets-management)
17. [Known Gaps](#known-gaps)

---

## Overview

Steadfirm runs as a single Docker Compose stack with 13 containers on a `steadfirm` bridge network. Caddy is the sole external entry point — all backing services are internal-only. The backend and BetterAuth sidecar are built from source; everything else uses pinned upstream images.

```
Internet
    │
    ▼
Cloudflare Tunnel (planned)
    │
    ▼
┌─── Caddy (:80/:443) ───────────────────────────────────┐
│                                                         │
│  /api/auth/*  ──→  BetterAuth (:3002)                   │
│  /api/*       ──→  Axum Backend (:3001)                  │
│  /*           ──→  Web frontend (pending)                │
│                                                         │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─── Internal Network (steadfirm) ────────────────────────┐
│                                                         │
│  Immich (:2283)    Jellyfin (:8096)    Paperless (:8000) │
│  Audiobookshelf (:80)    Kavita (:5000)                  │
│  Postgres (:5432)    Valkey (:6379)                      │
│  Immich ML    Gotenberg (:3000)    Tika (:9998)          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Container Topology

| # | Container | Image | Purpose | Internal Port |
| - | --------- | ----- | ------- | ------------- |
| 1 | `postgres` | `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0` | Shared database (Steadfirm, BetterAuth, Immich, Paperless) | 5432 |
| 2 | `valkey` | `docker.io/valkey/valkey:9.0.3-alpine` | Shared cache/queue (Immich, Paperless) | 6379 |
| 3 | `betterauth` | Built: `services/betterauth/Dockerfile` | Auth sidecar (signup, login, OAuth, sessions) | 3002 |
| 4 | `steadfirm-backend` | Built: `infra/Dockerfile.backend` | API gateway (Rust/Axum) | 3001 |
| 5 | `immich-server` | `ghcr.io/immich-app/immich-server:v2.5.6` | Photo/video management | 2283 |
| 6 | `immich-machine-learning` | `ghcr.io/immich-app/immich-machine-learning:v2.5.6` | ML inference (CLIP, face detection) | — |
| 7 | `jellyfin` | `docker.io/jellyfin/jellyfin:10.11.6` | Media streaming (movies, TV, music) | 8096 |
| 8 | `paperless` | `ghcr.io/paperless-ngx/paperless-ngx:2.20.10` | Document management + OCR | 8000 |
| 9 | `gotenberg` | `docker.io/gotenberg/gotenberg:8.21.0` | Document conversion (for Paperless) | 3000 |
| 10 | `tika` | `docker.io/apache/tika:3.1.0.0` | Content extraction (for Paperless) | 9998 |
| 11 | `audiobookshelf` | `ghcr.io/advplyr/audiobookshelf:2.32.1` | Audiobook library + player | 80 |
| 12 | `kavita` | `ghcr.io/kareadita/kavita:latest` | Ebook/comic/manga reader | 5000 |
| 13 | `caddy` | `docker.io/caddy:2.11.2-alpine` | Reverse proxy / TLS termination | 80, 443 |

---

## Caddy Routing

**File:** `infra/Caddyfile`

```caddyfile
{$DOMAIN:localhost} {
    handle /api/auth/* {
        reverse_proxy betterauth:3002
    }

    handle /api/* {
        reverse_proxy steadfirm-backend:3001
    }

    handle {
        respond "Steadfirm web frontend — pending" 200
        # reverse_proxy steadfirm-web:3000  (when frontend container is added)
    }
}
```

- `{$DOMAIN}` is set via environment variable; defaults to `localhost`
- v1: All traffic goes through Caddy → Backend. No direct service access.
- Planned: signed URL bypass for media streaming (see TODO.md — Streaming Proxy Bottleneck)

---

## Network

Single Docker bridge network named `steadfirm`. All 13 containers are attached. Services reference each other by container name (e.g., `postgres`, `valkey`, `immich-server`).

No containers have `host` networking. Only Caddy and the admin ports (Postgres, Valkey) are exposed to the host.

---

## Port Map

### Production

| Host Port | Container | Purpose |
| --------- | --------- | ------- |
| `0.0.0.0:18080` → 80 | Caddy | HTTP entry point (public) |
| `0.0.0.0:18443` → 443 | Caddy | HTTPS entry point (public) |
| `127.0.0.1:18432` → 5432 | Postgres | Host admin access only |
| `127.0.0.1:18379` → 6379 | Valkey | Host admin access only |

All backing services (Immich, Jellyfin, Paperless, Audiobookshelf, Kavita) have **no host port** in production — accessible only through the `steadfirm` network via Caddy → Backend.

### Development Override

The dev compose file (`docker-compose.dev.yml`) exposes backing services for direct access:

| Host Port | Container | Purpose |
| --------- | --------- | ------- |
| `127.0.0.1:18283` → 2283 | Immich | Direct API access |
| `127.0.0.1:18096` → 8096 | Jellyfin | Direct API/UI access |
| `127.0.0.1:18000` → 8000 | Paperless | Direct API/UI access |
| `127.0.0.1:18378` → 80 | Audiobookshelf | Direct API/UI access |
| `127.0.0.1:18500` → 5000 | Kavita | Direct API/UI access |

### Locally-Run Services (Dev Mode)

| Port | Service | Notes |
| ---- | ------- | ----- |
| 3001 | Axum Backend | `cargo run -p steadfirm-backend` |
| 3002 | BetterAuth | `bun run dev` in `services/betterauth/` |
| 5173 | Web Frontend | `bun run dev` in `web/` |

---

## Volume Mounts

### Named Volumes (18 total)

| Volume | Container Mount | Purpose |
| ------ | --------------- | ------- |
| `postgres_data` | `/var/lib/postgresql/data` | Database storage |
| `valkey_data` | `/data` | Cache persistence |
| `immich_upload` | `/usr/src/app/upload` | Immich photo/video storage |
| `immich_ml_cache` | `/cache` | ML model cache |
| `jellyfin_config` | `/config` | Jellyfin configuration |
| `jellyfin_cache` | `/cache` | Jellyfin transcode cache |
| `media_library` | `/media` (Jellyfin) | Per-user movie/TV/music libraries |
| `paperless_data` | `/usr/src/paperless/data` | Paperless DB + index |
| `paperless_media` | `/usr/src/paperless/media` | Paperless document storage |
| `paperless_consume` | `/usr/src/paperless/consume` | Paperless inbox |
| `audiobooks_library` | `/audiobooks` (ABS) | Per-user audiobook files |
| `audiobookshelf_config` | `/config` (ABS) | ABS configuration |
| `audiobookshelf_metadata` | `/metadata` (ABS) | ABS metadata/cache |
| `kavita_library` | `/books` (Kavita) | Per-user ebook/comic files |
| `kavita_config` | `/kavita/config` | Kavita configuration |
| `steadfirm_files` | `/data/steadfirm/files` (Backend) | Unclassified file storage |
| `caddy_data` | `/data` | Caddy TLS certificates |
| `caddy_config` | `/config` | Caddy auto-config |

### Bind Mounts

| Source | Container Mount | Purpose |
| ------ | --------------- | ------- |
| `./init-databases.sql` | `/docker-entrypoint-initdb.d/init.sql` (Postgres) | Multi-database init |
| `./Caddyfile` | `/etc/caddy/Caddyfile` (Caddy) | Routing config |
| `/etc/localtime` | `/etc/localtime:ro` (Immich) | Timezone sync |

### Dev Override Bind Mounts

In dev mode, some volumes are replaced with host directories for easier inspection:

| Source | Container Mount | Replaces |
| ------ | --------------- | -------- |
| `/tmp/steadfirm-media` | `/media` (Jellyfin) | `media_library` volume |
| `/tmp/steadfirm-audiobooks` | `/audiobooks` (ABS) | `audiobooks_library` volume |
| `/tmp/steadfirm-reading` | `/books` (Kavita) | `kavita_library` volume |

---

## Startup Ordering

```
postgres ─────────────→ (healthy)
    │                       │
    ├─→ valkey ────────→ (healthy)
    │       │                │
    │       ├─→ immich-server  (postgres healthy + valkey healthy)
    │       │
    │       ├─→ paperless      (postgres healthy + valkey healthy + gotenberg started + tika started)
    │       │
    │       └─→ steadfirm-backend (postgres healthy + betterauth healthy + valkey healthy)
    │                               │
    ├─→ betterauth ───→ (healthy)   │
    │                               │
    └───────────────────────────────┘
                                    │
                              caddy (steadfirm-backend healthy + betterauth healthy)
```

Services without explicit dependencies start immediately: `jellyfin`, `audiobookshelf`, `kavita`, `immich-machine-learning`, `gotenberg`, `tika`.

**Backend startup sequence** (`crates/backend/src/main.rs` → `startup.rs`):
1. Connect to Postgres + run migrations
2. Load admin credentials from `admin_credentials` table
3. For each uninitialized service: run first-time setup wizard (Immich admin signup, Jellyfin wizard, Paperless token, ABS init, Kavita register)
4. Store admin credentials in `admin_credentials` table
5. Start Axum HTTP server

---

## Health Checks

| Container | Check | Interval | Timeout | Retries |
| --------- | ----- | -------- | ------- | ------- |
| `postgres` | `pg_isready -U steadfirm` | 10s | 5s | 5 |
| `valkey` | `valkey-cli ping` | 10s | 5s | 5 |
| `betterauth` | `wget -q --spider http://localhost:3002/health` | 10s | 5s | 5 |
| `steadfirm-backend` | `curl -f http://localhost:3001/health` | 10s | 5s | 5 |

### Health Endpoints

| Service | Endpoint | Response |
| ------- | -------- | -------- |
| Backend | `GET /health` | `{ status: "ok", service: "steadfirm", version: "<pkg_version>" }` |
| BetterAuth | `GET /health` | `{ status: "ok", service: "betterauth" }` |

### Services Without Health Checks

Immich, Jellyfin, Paperless, Audiobookshelf, Kavita, Gotenberg, Tika, and Caddy have no Docker health checks configured. The backend handles unavailability of these services gracefully at request time. See TODO.md for planned health check additions.

---

## Environment Variables

### Global (`.env`)

| Variable | Example | Purpose |
| -------- | ------- | ------- |
| `DB_USER` | `steadfirm` | Postgres username |
| `DB_PASSWORD` | `changeme` | Postgres password |
| `ADMIN_PASSWORD` | `<random>` | Master admin password for all service accounts |
| `BETTERAUTH_SECRET` | `<openssl rand -hex 32>` | BetterAuth session signing |
| `WEBHOOK_SECRET` | `<openssl rand -hex 32>` | HMAC for signup webhook |
| `DOMAIN` | `localhost` | Caddy domain |
| `GOOGLE_CLIENT_ID` | *(optional)* | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | *(optional)* | Google OAuth |

### Per-Container Environment

See each container's section in `docker-compose.yml` for full variable lists. Key patterns:

- **Postgres:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- **BetterAuth:** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_DATABASE`, `WEBHOOK_SECRET`, `BACKEND_INTERNAL_URL`
- **Backend:** `DATABASE_URL`, `ADMIN_PASSWORD`, `WEBHOOK_SECRET`, service URLs (`IMMICH_URL`, `JELLYFIN_URL`, etc.), storage paths
- **Immich:** `DB_HOSTNAME`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE_NAME=immich`, `REDIS_HOSTNAME=valkey`
- **Paperless:** `PAPERLESS_DBHOST`, `PAPERLESS_DBNAME=paperless`, `PAPERLESS_REDIS`, `PAPERLESS_ADMIN_USER`, `PAPERLESS_ADMIN_PASSWORD`, Tika/Gotenberg endpoints

### Backend Config Reference

Full backend environment variables are documented in the `config.rs` section of `specs/BACKEND.md`. Key defaults:

| Variable | Default |
| -------- | ------- |
| `PORT` | `3001` |
| `DB_MAX_CONNECTIONS` | `10` |
| `HTTP_TIMEOUT_SECS` | `30` |
| `MAX_UPLOAD_BYTES` | `2147483648` (2 GB) |
| `IMMICH_URL` | `http://immich-server:2283` |
| `JELLYFIN_URL` | `http://jellyfin:8096` |
| `PAPERLESS_URL` | `http://paperless:8000` |
| `AUDIOBOOKSHELF_URL` | `http://audiobookshelf:80` |
| `KAVITA_URL` | `http://kavita:5000` |

---

## Database Initialization

**File:** `infra/init-databases.sql`

Runs once on first Postgres startup via the Docker `initdb.d` mechanism:

```sql
-- Immich needs its own database with vector extensions
CREATE DATABASE immich;
\c immich
CREATE EXTENSION IF NOT EXISTS vchord;
CREATE EXTENSION IF NOT EXISTS vectors;
CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;

-- Paperless needs its own database
CREATE DATABASE paperless;

-- Return to default database (steadfirm)
\c steadfirm
```

**Databases created:**
| Database | Used By |
| -------- | ------- |
| `steadfirm` | BetterAuth tables + Steadfirm tables (default `POSTGRES_DB`) |
| `immich` | Immich (with VectorChord + pgvectors extensions) |
| `paperless` | Paperless-ngx |

The `immich-app/postgres` image is used specifically because it bundles VectorChord and pgvectors extensions that Immich requires. Shared memory is set to 128MB (`shm_size`) for these extensions.

---

## Backend Docker Build

**File:** `infra/Dockerfile.backend`

Multi-stage Rust build:

1. **Builder stage** (`rust:1-bookworm`):
   - Dependency caching: copies `Cargo.toml`/`Cargo.lock` + dummy source files first, builds deps, then copies real source
   - Builds `steadfirm-backend` in release mode

2. **Runtime stage** (`debian:bookworm-slim`):
   - Installs `ca-certificates`, `libssl3`, `curl` (curl needed for health check)
   - Copies release binary to `/usr/local/bin/steadfirm-backend`
   - Exposes port 3001

Build context is the repo root (`..` from `infra/`) to access the full Cargo workspace.

---

## Image Pinning

**Rule:** Never use `latest` or floating tags for production deployments. Every image must be pinned to a specific version.

### Current Status

| Image | Version | Status |
| ----- | ------- | ------ |
| `immich-app/postgres` | `14-vectorchord0.4.3-pgvectors0.2.0` | Pinned |
| `valkey/valkey` | `9.0.3-alpine` | Pinned |
| `immich-app/immich-server` | `v2.5.6` | Pinned |
| `immich-app/immich-machine-learning` | `v2.5.6` | Pinned |
| `jellyfin/jellyfin` | `10.11.6` | Pinned |
| `paperless-ngx/paperless-ngx` | `2.20.10` | Pinned |
| `gotenberg/gotenberg` | `8.21.0` | Pinned |
| `apache/tika` | `3.1.0.0` | Pinned |
| `advplyr/audiobookshelf` | `2.32.1` | Pinned |
| `kareadita/kavita` | **`latest`** | **Not pinned — needs fix** |
| `caddy` | `2.11.2-alpine` | Pinned |
| `oven/bun` (BetterAuth) | `1-alpine` | Floating (acceptable for builder) |
| `rust` (Backend builder) | `1-bookworm` | Floating (acceptable for builder) |
| `debian` (Backend runtime) | `bookworm-slim` | Floating (acceptable for base) |

---

## Local Development

### Dev Compose Override

```bash
# Start backing services only (no backend, betterauth, or caddy)
cd infra
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

The dev override (`docker-compose.dev.yml`):
- Disables `betterauth`, `steadfirm-backend`, `caddy` (moved to `[prod]` profile)
- Exposes service ports to localhost for direct access
- Replaces named volumes with `/tmp/steadfirm-*` bind mounts for easy inspection/reset

### Running Locally

```bash
# Terminal 1: BetterAuth
cd services/betterauth && bun run dev   # port 3002

# Terminal 2: Backend
cargo run -p steadfirm-backend          # port 3001

# Terminal 3: Web frontend
cd web && bun run dev                   # port 5173
```

Or use the orchestration script: `./infra/dev.sh`

---

## Dev Scripts

### `infra/dev.sh`

Full dev orchestration. Usage: `./infra/dev.sh [--no-reset] [--no-seed]`

1. Optionally runs `reset-dev.sh` (unless `--no-reset`)
2. Waits for Docker services (Postgres/Valkey first, then all 5 backing services with 120s timeout)
3. Kills stale processes on ports 3001, 3002, 5173
4. Starts BetterAuth, Backend, and Web frontend as background processes
5. Waits for health endpoints
6. Optionally runs `seed-dev.sh` (unless `--no-seed`)
7. Prints URL summary and demo credentials
8. Ctrl+C cleanly kills all background processes

**Demo credentials:** `demo@steadfirm.local` / `demo-password-2026`

### `infra/reset-dev.sh`

Full reset: `docker compose down -v`, removes `/tmp/steadfirm-*` directories, recreates them, brings stack back up.

### `infra/seed-dev.sh`

Seeds demo content:
- Creates demo user via BetterAuth signup API
- Waits for service provisioning to complete
- Downloads public domain content (photos, PDFs, EPUBs, videos, audiobooks, music)
- Uploads via the backend API to each service

---

## External Access (Cloudflare Tunnel)

**Status:** Documented but not yet implemented. No `cloudflared` container, config, or tunnel credentials exist.

**Planned approach:**

```bash
cloudflared tunnel --url http://localhost:80
```

Cloudflare Tunnel connects to Caddy's port 80. Caddy handles internal routing. Cloudflare handles TLS termination, DDoS protection, and DNS.

Planned domain: `steadfirm.io`

---

## Secrets Management

### Current State (POC)

- All secrets in `.env` files (gitignored)
- `infra/.env` for Docker Compose variables
- `crates/backend/.env` for local backend development
- `services/betterauth/.env` for local BetterAuth development
- `.env.example` provides a template with generation instructions

### Generation

```bash
# Generate secrets
openssl rand -hex 32   # BETTERAUTH_SECRET
openssl rand -hex 32   # WEBHOOK_SECRET
# ADMIN_PASSWORD: choose a strong password
```

### Planned Phases

1. **Current:** gitignored `.env` files — acceptable for POC
2. **Phase 2:** Docker secrets or SOPS-encrypted env files
3. **Phase 3:** HashiCorp Vault (if multi-server)

---

## Known Gaps

- **Kavita uses `latest` tag** — needs pinning to a specific version
- **No health checks** on Immich, Jellyfin, Paperless, Audiobookshelf, Kavita, Gotenberg, Tika, Caddy
- **No backup strategy** — no pg_dump, no volume backups, no offsite sync
- **No Cloudflare Tunnel** — documented but not configured
- **No PgBouncer** — all services connect to Postgres directly
- **No email provider** — BetterAuth can't send password reset or verification emails
- **Single Postgres instance** — all services share one database server
- **Web frontend not containerized** — Caddy placeholder response, no container in compose
- **BetterAuth Bun image not pinned** — uses `oven/bun:1-alpine` floating tag
