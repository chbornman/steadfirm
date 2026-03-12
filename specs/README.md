# Steadfirm Specifications

Living documentation for every major subsystem. Each spec is the authoritative reference for its domain — keep them updated as the implementation evolves.

> **PRD.md** and **TODO.md** remain at the repo root. PRD is the product-level "what and why"; specs are the technical "how". TODO tracks debt and future work.

---

## Existing Specs

| Spec | File | Status | Covers |
| ---- | ---- | ------ | ------ |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | Complete | System overview, auth model, database schema, API surface, classification pipeline, storage layout, deployment milestones |
| Backend | [BACKEND.md](BACKEND.md) | Complete | Axum crate structure, auth middleware, service clients, every endpoint's request/response translation, proxy layer, pagination, error handling |
| Web Frontend | [WEB_FRONTEND.md](WEB_FRONTEND.md) | Complete | React SPA architecture, monorepo structure, every page/component, data fetching, state management, animation, theme system |
| Upload & Classification | [UPLOAD.md](UPLOAD.md) | Complete | Supported file types by service, heuristic decision tree, LLM integration, group detection, SSE streaming protocol, service routing, storage layout |
| Auth | [AUTH.md](AUTH.md) | Complete | BetterAuth sidecar, session lifecycle, Axum validation, OAuth, cookie handling, signup/login flows, webhook |
| Infrastructure | [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Complete | Docker Compose topology, Caddy routing, networking, ports, volumes, health checks, startup ordering, dev setup |
| User Provisioning | [PROVISIONING.md](PROVISIONING.md) | Complete | Multi-service account creation, per-service flows, admin bootstrap, credential storage, retry strategy |
| Search | [SEARCH.md](SEARCH.md) | Complete | Federated fan-out, per-service query translation, SSE streaming, LLM-enhanced search, search modal UI |
| Metadata Enrichment | [METADATA.md](METADATA.md) | Complete | Hybrid metadata strategy, pre-upload extraction, native service refresh/match proxying, enrichment jobs, per-service capabilities, job queue, API surface |

---

## Missing Specs

Specs we need but don't have yet. Roughly ordered by priority.

### Medium Priority

| Spec | Proposed File | What It Should Cover |
| ---- | ------------- | -------------------- |
| **Tauri App** | `APP.md` | Tauri 2 desktop + mobile client, Rust sidecar code, SQLite local cache, offline-first sync strategy, native features (file picker, notifications, system tray), how it differs from web/ |
| **Service Proxy** | `PROXY.md` | How the backend translates unified API calls to per-service APIs, credential injection, response normalization, binary/streaming proxy, pagination translation, the planned signed-URL migration |
| **API Reference** | `API.md` | Complete endpoint catalog with request/response schemas, auth requirements, error codes — a single place to look up any endpoint (currently spread across BACKEND.md sections) |
| **Database** | `DATABASE.md` | Postgres schema (Steadfirm's own tables), migrations strategy, SQLx usage patterns, connection pooling, which tables belong to which service, BetterAuth schema coexistence |

### Lower Priority (needed as features mature)

| Spec | Proposed File | What It Should Cover |
| ---- | ------------- | -------------------- |
| **Theme & Design System** | `DESIGN.md` | Design tokens, color system, typography, spacing scale, component conventions, dark mode strategy, how `@steadfirm/theme` and `@steadfirm/ui` packages work, Ant Design customization |
| **Backup & Recovery** | `BACKUP.md` | Backup strategy for Postgres, media volumes, config; restore procedures, offsite sync, WAL archiving, testing strategy |
| **Security** | `SECURITY.md` | Threat model, trust boundaries, network segmentation (internal-only services), session security, CSRF/XSS mitigations, rate limiting, input validation, secrets handling |
| **Deployment & Ops** | `DEPLOYMENT.md` | How to deploy from scratch, upgrade procedures, monitoring, log aggregation, alerting, domain/DNS setup, SSL/TLS |
| **Testing** | `TESTING.md` | Testing strategy per crate/package, integration test setup, how to test against real services, CI pipeline |

---

## Conventions

- **One spec per major subsystem.** If a spec grows beyond ~2000 lines, consider splitting.
- **Specs are prescriptive, not aspirational.** They describe how the system works (or should work for the next milestone). Future ideas go in `TODO.md`.
- **Keep code references current.** When you change an endpoint, schema, or component — update the relevant spec.
- **AGENTS.md points here.** The agent instructions reference `specs/` so AI assistants can find the right context.
