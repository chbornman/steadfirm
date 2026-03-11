# Agent Instructions — Steadfirm

## Overview

Steadfirm is a unified personal cloud platform. One app, one login for photos, media, documents, audiobooks, and budgeting — backed by self-hosted open-source services (Immich, Jellyfin, Paperless-ngx, Audiobookshelf, Actual Budget).

## Project Structure

```
steadfirm/
  crates/
    backend/     — Rust/Axum API server (gateway, auth, drop zone, proxying)
    app/         — Rust/Tauri 2 client (desktop + mobile)
    shared/      — Shared Rust library (types, models, classification)
  web/           — Web frontend (TBD framework)
  mobile/        — Reserved for mobile-specific assets if needed
  infra/         — Docker Compose, Caddyfile, service configs
  PRD.md         — Product requirements document
```

## Tech Stack

- **Language**: Rust (edition 2021)
- **Backend**: Axum 0.8, Tokio, Tower
- **Client**: Tauri 2 (desktop + mobile from one codebase)
- **Auth**: Clerk (JWT validation)
- **Database**: PostgreSQL via SQLx
- **Infrastructure**: Docker Compose, Caddy, Cloudflare Tunnel

## Build & Check Commands

```bash
# From repo root
cargo build                    # build all crates
cargo test                     # test all crates
cargo clippy                   # lint all crates
cargo fmt --check              # format check

# Backend only
cargo run -p steadfirm-backend

# Infrastructure
cd infra && docker compose up -d
cd infra && docker compose logs -f
cd infra && docker compose down
```

## Code Style

- **Formatter**: rustfmt — edition 2021, max_width 100, tab_spaces 4
- **Linter**: clippy (default rules)
- **Error handling**: Use `thiserror` for library errors, `anyhow` in application code. No `.unwrap()` in production paths.
- **Logging**: tracing crate. Use structured fields: `tracing::info!(user_id = %id, "provisioned user")`
- **Naming**: snake_case for functions/variables, PascalCase for types, UPPER_SNAKE for constants

## Key Design Principles

1. **Users never see infrastructure** — no Docker, no service names, no configuration
2. **Multi-tenant on shared instances** — one Immich, one Jellyfin, many users
3. **API gateway pattern** — backend proxies all requests to underlying services, injecting user-scoped credentials
4. **Drop zone classification** — files uploaded to Steadfirm are auto-routed to the correct service based on MIME type + metadata
5. **Direct access available** — power users can access underlying service UIs via subpaths (e.g., /immich, /jellyfin)

## Git Conventions

- Never reference AI in commit messages
- Run `cargo clippy` and `cargo fmt --check` before committing
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `infra:`
