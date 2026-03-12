# Agent Instructions — Steadfirm

## Overview

Steadfirm is a unified personal cloud platform. One app, one login for photos, media, documents, audiobooks, reading (ebooks/comics/manga), and general file storage — backed by self-hosted open-source services (Immich, Jellyfin, Paperless-ngx, Audiobookshelf, Kavita). Auth via BetterAuth (Bun sidecar, session-based, shared Postgres). See PRD.md for full product context.

## Project Structure

```
steadfirm/
  crates/
    backend/       — Rust/Axum API server (gateway, auth, drop zone, proxying)
    app/           — Rust/Tauri 2 client (desktop + mobile, offline-first)
      src/         — App-specific React frontend (offline, data via Tauri commands + SQLite)
      src-tauri/   — Tauri Rust code (SQLite cache, sync, native features)
    shared/        — Shared Rust library (types, models, classification)
  web/             — Browser React frontend (online-only, data via HTTP to backend)
  packages/
    shared/        — Shared TS: API types, constants, validation (@steadfirm/shared)
    ui/            — Shared React components: grids, players, viewers (@steadfirm/ui)
    theme/         — Design tokens, styling (@steadfirm/theme)
  infra/           — Docker Compose, Caddyfile, service configs
  PRD.md           — Product requirements document
  SPEC.md          — Technical specification
```

`web/` and `crates/app/src/` are **separate React apps** sharing code via `packages/`.
Same monorepo pattern as Capstancloud (frontend/ vs app/ with shared packages/).

## Tech Stack

- **Language**: Rust (edition 2021) + TypeScript
- **Backend**: Axum 0.8, Tokio, Tower
- **Web frontend**: React + Vite + Bun (browser, online-only)
- **App frontend**: React + Vite (Tauri, offline-first with SQLite)
- **Client**: Tauri 2 (desktop + mobile from one codebase)
- **Auth**: BetterAuth (Bun sidecar container, session-based, Axum validates via direct Postgres read)
- **Database**: PostgreSQL via SQLx (server), SQLite (Tauri app local cache)
- **Package manager**: Bun (TS workspaces), Cargo (Rust workspace)
- **Infrastructure**: Docker Compose, Caddy, Cloudflare Tunnel

## Build & Check Commands

```bash
# Rust (from repo root)
cargo build                    # build all Rust crates
cargo test                     # test all Rust crates
cargo clippy                   # lint all Rust crates
cargo fmt --check              # format check
cargo run -p steadfirm-backend # run backend only

# Web frontend (from web/)
bun install                    # install deps
bun run dev                    # Vite dev server
bun run build                  # production build
bun run lint                   # eslint
bun run typecheck              # tsc --noEmit

# Tauri app (from crates/app/)
bun run dev                    # Vite dev server (web preview only)
bun run tauri:dev              # full Tauri dev (Vite + Rust + native window)
bun run tauri:build            # production build

# Infrastructure
cd infra && docker compose up -d
cd infra && docker compose logs -f
cd infra && docker compose down
```

## Code Style

### Rust
- **Formatter**: rustfmt — edition 2021, max_width 100, tab_spaces 4
- **Linter**: clippy (default rules)
- **Error handling**: Use `thiserror` for library errors, `anyhow` in application code. No `.unwrap()` in production paths.
- **Logging**: tracing crate. Use structured fields: `tracing::info!(user_id = %id, "provisioned user")`
- **Naming**: snake_case for functions/variables, PascalCase for types, UPPER_SNAKE for constants

### TypeScript / React
- **Runtime**: Bun
- **Imports**: Use `@steadfirm/shared`, `@steadfirm/ui`, `@steadfirm/theme` for shared code. Use `@/` alias for app-local imports.
- **Components**: Functional only. Use `'use client'` only when needed.
- **Types**: Strict TypeScript. Use `type` keyword for type-only declarations. Import types with `import type`.

## No Magic Numbers or Hardcoded Values

**This is a high-priority rule.** Never introduce magic numbers, hardcoded strings, or inline configuration values.

### Rust Backend

- **Environment-sensitive values** (paths, timeouts, pool sizes, credentials, retry limits) go in `crates/backend/src/config.rs` as fields on `Config`, read from env vars with sensible defaults via `env_or()`.
- **Tuning parameters** (page sizes, cache TTLs, image quality, password lengths) go in `crates/backend/src/constants.rs` as named `pub const` values with doc comments.
- **Branding strings** ("Steadfirm", device IDs) are acceptable inline since they are the product name, but use `env!("CARGO_PKG_VERSION")` for version strings — never hardcode `"1.0.0"`.
- When adding a new numeric literal, timeout, path, or limit — stop and ask: "Would this differ between deployments?" If yes → `config.rs`. If no but it's a tuning knob → `constants.rs`. If it's a protocol constant (HTTP status codes, JSON field names) → inline is fine.

### TypeScript Frontend

- **Theme values** (colors, shadows, spacing, gradients) go in `@steadfirm/theme` tokens — never as inline hex codes or magic pixel values. See `packages/theme/src/tokens.ts`.
- **API configuration** (base URLs, retry limits, timeouts) go in the shared API client config, not scattered across components.

## Key Design Principles

1. **Users never see infrastructure** — no Docker, no service names, no configuration
2. **Multi-tenant on shared instances** — one Immich, one Jellyfin, many users
3. **API gateway pattern** — backend proxies all requests to underlying services, injecting user-scoped credentials
4. **Two frontends, shared UI** — web/ (browser, online) and crates/app/src/ (Tauri, offline-first) share components via packages/
5. **Drop zone classification** — files uploaded to Steadfirm are auto-routed to the correct service based on MIME type + metadata + AI classification for ambiguous files
6. **Files catchall** — unclassified uploads stay in Steadfirm's own storage (no Nextcloud)
7. **Direct service access is a future roadmap item** — not in v1

## Git Conventions

- Never reference AI in commit messages
- Run `cargo clippy`, `cargo fmt --check`, `bun run lint`, and `bun run typecheck` before committing
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `infra:`
