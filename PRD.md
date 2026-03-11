# Steadfirm — Product Requirements Document

## One-liner

A single app and managed server that gives non-technical people a private, unified digital life — photos, media, documents, audiobooks, and budgeting — backed by best-in-class open-source services they never need to know about.

## The Problem

People's digital lives are fragmented across services that spy on them:

- **Photos** are in iCloud or Google Photos — scanned, analyzed, used for training
- **Movies and music** are rented, not owned — they disappear when licenses expire
- **Documents** are in Google Drive or Dropbox — searchable by the provider
- **Finances** are in YNAB at $15/month — data held hostage by a subscription
- **Audiobooks** are in Audible — DRM-locked, non-transferable

Self-hosted alternatives exist for every one of these (Immich, Jellyfin, Paperless-ngx, Actual Budget, Audiobookshelf). They're excellent. But setting them up requires Docker knowledge, Linux experience, DNS configuration, SSL certificates, ongoing maintenance, and the willingness to debug things at 11pm.

**The gap:** There is no product that gives normal people the benefits of self-hosting without any of the complexity. Every existing solution (Umbrel, CasaOS, Cloudron, YunoHost) is an app store for tinkerers. They sell autonomy and choice. Most people don't want choice — they want it to work.

## The Solution

**Steadfirm** is an opinionated layer on top of proven open-source services. One app, one login, one place for everything. The user never sees Docker, never configures a service, never thinks about infrastructure.

The pitch to friends and family: **"I'll handle everything. You open the app, and your digital life is there. $10/month."**

### What the user sees

- A single app (web first, then Tauri desktop + mobile)
- Sign in once with Clerk
- Tabs: Photos, Media, Documents, Audiobooks, Budget
- A universal **drop zone**: drag/drop or upload any file, it goes to the right place automatically
- Optional: direct access to underlying services (e.g., full Paperless UI) for power users

### What the user never sees

- Docker containers
- Service configuration
- Database management
- SSL certificates
- Backup schedules
- Any of the words "Immich," "Jellyfin," or "Paperless"

## Architecture

### Service layer (not built by us)

Single shared instances, multi-tenant by design:

| Service | Purpose | Multi-user? |
|---------|---------|-------------|
| Immich | Photos & home videos | Yes — per-user libraries |
| Jellyfin | Movies, TV, music | Yes — per-user accounts, libraries, parental controls |
| Paperless-ngx | Documents, receipts, OCR | Yes — per-user ownership and permissions |
| Audiobookshelf | Audiobooks | Yes — per-user accounts, progress tracking |
| Actual Budget | Envelope budgeting | Per-file on shared sync server |

### Steadfirm layer (built by us)

| Component | Technology | Purpose |
|-----------|-----------|---------|
| `steadfirm-backend` | Rust / Axum | API gateway, auth, user provisioning, drop zone classification, service proxying |
| `steadfirm-app` | Rust / Tauri 2 | Desktop + mobile client (single codebase) |
| `steadfirm-shared` | Rust library | Shared types, models, file classification logic |
| `web/` | Tauri web view or standalone | Web frontend |
| `infra/` | Docker Compose + Caddy | Service orchestration, reverse proxy |

### Container architecture

~12 containers total (not per user):

```
Caddy (reverse proxy)
Steadfirm Backend (Axum)
Steadfirm Web Frontend
Immich Server
Immich Machine Learning
Jellyfin
Paperless-ngx
Audiobookshelf
Actual Budget
PostgreSQL (shared: steadfirm + immich + paperless databases)
Redis (shared: immich + paperless)
```

All containers on a single Docker network. All service ports bound to localhost only. Caddy handles TLS and routing. Cloudflare Tunnel for external access (no port forwarding needed).

### Authentication flow

1. User signs into Steadfirm via Clerk (web or app)
2. Backend validates Clerk JWT
3. Backend maps Clerk user to service-specific credentials
4. All API calls to underlying services are made server-side with scoped credentials
5. User never authenticates directly with underlying services

### User provisioning

When a new user is added:

1. Create Steadfirm user record in Postgres
2. Create Immich account via admin API
3. Create Jellyfin account via admin API
4. Create Paperless account via admin API
5. Create Audiobookshelf account via admin API
6. Create Actual Budget file on sync server
7. Store service credentials (encrypted) in Steadfirm database

### Drop zone — universal file routing

The user drops files into Steadfirm. The backend classifies and routes:

| Detection | Routes to |
|-----------|-----------|
| JPEG, HEIC, PNG, RAW (EXIF data present) | Immich |
| MP4, MOV (short duration, phone metadata) | Immich |
| MP4, MKV (long duration, movie filename patterns, TMDb match) | Jellyfin |
| MP3, FLAC, M4A (ID3/audio tags, short-form) | Jellyfin music library |
| M4B, MP3 (long-form audio, author/title metadata) | Audiobookshelf |
| PDF, DOCX, receipt patterns | Paperless-ngx |
| CSV, OFX, QFX (financial headers) | Actual Budget import |
| Everything else | Prompt user for classification; learn for next time |

Classification pipeline: MIME detection -> metadata extraction -> heuristic rules -> confidence score -> route (or ask).

## Proof of Concept — Phase 1

### Goal

Prove the unified experience works for 5-10 friends and family on a single dedicated server with NVMe storage. Free access during this phase.

### Scope

**In scope:**
- Web app with all service tabs (read + browse)
- Clerk authentication
- Backend API proxying to all services
- Drop zone with file classification
- Docker Compose infrastructure with all services running
- Caddy reverse proxy with Cloudflare Tunnel
- Direct service access URLs for power users
- User provisioning (manual or semi-automated)

**Out of scope (Phase 1):**
- Tauri desktop/mobile app (web only first)
- Automated backups (manual for now)
- Billing / payments
- SimpleFIN bank sync for Actual Budget (manual CSV import)
- Advanced search across services
- Sharing between users
- CI/CD pipeline

### Hardware

Single dedicated server:
- NVMe storage (large — photos and media are storage-heavy)
- 32GB+ RAM (comfortable for all containers + Postgres)
- Cloudflare Tunnel for external access
- UPS for power protection
- ZFS mirror or RAID1 for data safety

### Success criteria

1. 5 real users actively using the service for 30 days
2. Users can upload files via drop zone and they arrive in the correct service
3. Users can browse their photos, watch media, read documents, track budget — all from one login
4. No data cross-contamination between users
5. Operator (Caleb) spends < 1 hour/week on maintenance

## Phase 2 — After POC validation

- Tauri app (desktop + mobile from one codebase)
- Automated user provisioning via backend API
- Automated backups to Backblaze B2
- SimpleFIN integration for bank transaction sync
- Camera roll auto-sync from mobile
- Monitoring and alerting (Prometheus + Grafana)
- $10/month billing via Clerk payments or Stripe

## Phase 3 — Growth

- Onboard additional friend/family groups
- Per-user storage quotas and usage tracking
- Hybrid hosting (heavy storage on-prem, lightweight services on VPS)
- Additional service integrations (Vaultwarden for passwords, Kavita for ebooks)
- Polished onboarding flow

## Business model

**Not a startup. Not seeking VC. This is a sustainable service.**

| Item | Cost |
|------|------|
| Dedicated server hardware (one-time) | ~$500-800 |
| Electricity | ~$10-15/month |
| Cloudflare Tunnel | Free |
| Backblaze B2 (backups, ~2TB) | ~$10/month |
| SimpleFIN (bank sync) | ~$1.50/month per user |
| Clerk (auth) | Free tier covers < 10k MAU |
| steadfirm.io domain | ~$30/year |
| **Total operating cost** | **~$25-30/month** |

Revenue at 10 users x $10/month = $100/month. Covers costs with margin from day one.

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend language | Rust | Performance, safety, single binary deployment, you know it |
| Backend framework | Axum | Tokio-native, tower middleware, best Rust web framework |
| Client framework | Tauri 2 | Desktop + mobile from one Rust codebase, web view for UI |
| Auth | Clerk | Already working from Pavo, handles signup/signin/JWT |
| Database | PostgreSQL | Shared with Immich and Paperless, proven |
| Cache | Redis | Shared with Immich and Paperless |
| Reverse proxy | Caddy | Automatic HTTPS, simple config, lighter than Traefik |
| Orchestration | Docker Compose | Simple, sufficient at this scale, no K8s needed |
| External access | Cloudflare Tunnel | Free, no port forwarding, handles SSL |

## What we learned from predecessors

| Project | What they did wrong | How Steadfirm avoids it |
|---------|-------------------|----------------------|
| Sandstorm | Built infrastructure (sandboxing), not a product. Took VC, couldn't monetize. | We build a skin over existing services. No VC. Charge friends $10. |
| Umbrel / CasaOS | App store for tinkerers — too many choices, requires maintenance | We make all the choices. Users see one app. |
| Cloudron | Sysadmin dashboard — users still configure services | Zero configuration for end users |
| Helm | Sold hardware, killed by margins | Software-only, runs on any hardware |
| FreedomBox | List of apps, no unified UX, feels like 2012 | Single unified interface, modern design |

## Non-goals

- We are not building a platform for strangers to deploy apps
- We are not building an app store
- We are not giving users infrastructure choices
- We are not competing with iCloud/Google at scale
- We are not seeking venture funding
- We are not building our own photo/media/document engines — we use the best ones that exist

## Open questions

1. **Web frontend framework** — Tauri web view uses standard HTML/CSS/JS. Leptos (Rust WASM)? Or a JS framework for the web layer?
2. **Mobile camera sync** — Tauri 2 mobile is young. May need native photo access plugins. Evaluate maturity.
3. **Actual Budget API** — Actual's API is less documented than the others. May need to contribute upstream or work with their sync protocol directly.
4. **Apple Card** — SimpleFIN coverage for Apple Card is spotty. May remain a manual CSV import. Acceptable for POC.
5. **Media ingestion for Jellyfin** — Movies/shows need correct folder structure and naming for Jellyfin to scrape metadata. The drop zone needs to handle this (TMDb lookup + rename + place in correct library path).
