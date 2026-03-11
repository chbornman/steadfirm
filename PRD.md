# Steadfirm — Product Requirements Document

## One-liner

A single app and managed server that gives non-technical people a private, unified digital life — photos, media, documents, and audiobooks — backed by best-in-class open-source services they never need to know about.

## The Problem

People's digital lives are fragmented across services that spy on them:

- **Photos** are in iCloud or Google Photos — scanned, analyzed, used for training
- **Movies and music** are rented, not owned — they disappear when licenses expire
- **Documents** are in Google Drive or Dropbox — searchable by the provider
- **Audiobooks** are in Audible — DRM-locked, non-transferable
- **Files** are scattered across devices with no unified access

Self-hosted alternatives exist for every one of these (Immich, Jellyfin, Paperless-ngx, Audiobookshelf). They're excellent. But setting them up requires Docker knowledge, Linux experience, DNS configuration, SSL certificates, ongoing maintenance, and the willingness to debug things at 11pm.

**The gap:** There is no product that gives normal people the benefits of self-hosting without any of the complexity. Every existing solution (Umbrel, CasaOS, Cloudron, YunoHost) is an app store for tinkerers. They sell autonomy and choice. Most people don't want choice — they want it to work.

## The Solution

**Steadfirm** is an opinionated layer on top of proven open-source services. One app, one login, one place for everything. The user never sees Docker, never configures a service, never thinks about infrastructure.

The pitch to friends and family: **"I'll handle everything. You open the app, and your digital life is there. $10/month."**

### What the user sees

- A web app (Tauri desktop + mobile to follow)
- Sign in once with Clerk
- Five tabs: Photos, Media, Documents, Audiobooks, Files
- A universal **drop zone**: upload any file, confirm the suggested destination, done
- Beautiful display and playback for photos, video, audio, and documents

### What the user never sees

- Docker containers
- Service configuration
- Database management
- SSL certificates
- Backup schedules
- Any of the words "Immich," "Jellyfin," or "Paperless"

## Product Decisions (v1.0)

| Decision | Answer |
|----------|--------|
| Target users | 5-10 friends and family, individuals only |
| Account model | Individual private accounts across all services. No shared/household accounts in v1. |
| Jellyfin media | Per-user libraries. Each user uploads their own content. No shared media library. |
| Audiobook library | Per-user. No sharing between users. |
| Photo sharing | No sharing in v1. Each user's photos are private. |
| Drop zone behavior | Show MIME-based recommendation, ask user to confirm/edit destination. Improve over time toward seamless auto-routing. |
| File catchall | Unclassified files stay in Steadfirm's own storage (Postgres metadata + local disk). No Nextcloud. |
| Music | Handled by Jellyfin. No separate music service. |
| Budgeting | Future roadmap. Not in v1. |
| Power user access | Future roadmap. No direct service UI access in v1. |
| Client platform | Web app only for v1. Tauri desktop + mobile in v2. |
| Backups | Manual for POC. Proper backup strategy before accepting real user data. |
| Uptime SLA | None for POC. Best-effort. |

## Architecture

### Service layer (not built by us)

Single shared instances, multi-tenant by design:

| Service | Tab | Purpose | Multi-user? |
|---------|-----|---------|-------------|
| Immich | Photos | Photos & home videos | Yes — per-user libraries |
| Jellyfin | Media | Movies, TV shows, music | Yes — per-user accounts and libraries |
| Paperless-ngx | Documents | PDFs, receipts, scanned docs, OCR | Yes — per-user ownership and permissions |
| Audiobookshelf | Audiobooks | Audiobook library and player | Yes — per-user accounts, progress tracking |
| Steadfirm (itself) | Files | Unclassified uploads, review queue | N/A — built into the backend |

### Steadfirm layer (built by us)

| Component | Technology | Purpose |
|-----------|-----------|---------|
| `steadfirm-backend` | Rust / Axum | API gateway, Clerk auth, user provisioning, drop zone classification, service proxying |
| `steadfirm-app` | Rust / Tauri 2 | Desktop + mobile client (future — v2) |
| `steadfirm-shared` | Rust library | Shared types, models, file classification logic |
| `web/` | TBD framework | Web frontend for v1 |
| `infra/` | Docker Compose + Caddy | Service orchestration, reverse proxy |

### Container architecture

~10 containers total (not per user):

```
Caddy (reverse proxy + TLS)
Steadfirm Backend (Axum)
Steadfirm Web Frontend
Immich Server
Immich Machine Learning
Jellyfin
Paperless-ngx
Audiobookshelf
PostgreSQL (shared: steadfirm + immich + paperless databases)
Redis (shared: immich + paperless)
```

All containers on a single Docker network. All service ports bound to localhost only. Caddy handles TLS and routing. Cloudflare Tunnel for external access (no port forwarding needed).

### Authentication flow

1. User signs in via Clerk (web app)
2. Client stores Clerk JWT
3. Every API request includes the JWT
4. Backend validates JWT against Clerk's JWKS public keys
5. Backend looks up user in `service_connections` table
6. Backend makes API calls to underlying services using that user's service-specific credentials
7. User never authenticates directly with any underlying service

### User provisioning

When a new user is added:

1. User signs up via Clerk
2. Backend receives Clerk webhook (or manual trigger)
3. Backend calls each service's admin API to create an account:
   - Immich: `POST /api/admin/users`
   - Jellyfin: `POST /Users/New`
   - Paperless: `POST /api/users/`
   - Audiobookshelf: `POST /api/users`
4. Backend stores returned user IDs and API keys/tokens (encrypted) in the `service_connections` table
5. User opens the app — everything works

### Drop zone — universal file routing

The user uploads files to Steadfirm. The backend classifies and presents a recommendation. The user confirms or edits the destination.

| Detection | Suggested destination |
|-----------|----------------------|
| JPEG, HEIC, PNG, RAW (image MIME types) | Photos (Immich) |
| MP4, MOV (video, short duration, phone metadata) | Photos (Immich) |
| MP4, MKV (video, long duration, movie-like filename) | Media (Jellyfin video library) |
| MP3, FLAC, M4A (audio, short-form, ID3 tags) | Media (Jellyfin music library) |
| M4B, MP3 (audio, long-form, author/title metadata) | Audiobooks (Audiobookshelf) |
| PDF, DOCX, images of documents | Documents (Paperless-ngx) |
| Anything else | Files (Steadfirm storage) |

v1 classification: MIME type + file extension + basic metadata heuristics. User always confirms. Over time, reduce confirmation friction as classification improves.

**Jellyfin media ingestion note:** Movies and shows require correct folder structure and naming for Jellyfin to scrape metadata. The drop zone must handle TMDb/MusicBrainz lookup, rename, and placement into the correct library path within the user's Jellyfin media directory.

## Proof of Concept — Phase 1

### Goal

Prove the unified experience works for 5-10 friends and family on a single dedicated server. Free access during this phase.

### Scope

**In scope:**
- Web app with five tabs: Photos, Media, Documents, Audiobooks, Files
- Display and playback: photo grid + lightbox, video streaming, audio playback, document viewer
- Clerk authentication (signup/signin)
- Backend API proxying to all four services
- Drop zone with MIME-based classification + user confirmation
- Unclassified file storage in Steadfirm
- Docker Compose infrastructure with all services running
- Caddy reverse proxy with Cloudflare Tunnel
- User provisioning (semi-automated via backend endpoint)

**Out of scope (v1):**
- Tauri desktop/mobile app
- Automated backups
- Billing / payments
- Budgeting (Actual Budget)
- Bank sync (SimpleFIN)
- Sharing between users
- Household/combined accounts
- Direct access to underlying service UIs
- Advanced cross-service search
- CI/CD pipeline
- Camera roll auto-sync

### Hardware

Single dedicated server:
- NVMe storage (large — photos and media are storage-heavy)
- 32GB+ RAM (comfortable for all containers + Postgres)
- Cloudflare Tunnel for external access
- UPS for power protection
- ZFS mirror or RAID1 for data safety

### Success criteria

1. 5 real users actively using the service for 30 days
2. Users can upload files via drop zone and files arrive in the correct service
3. Users can browse photos, watch video, listen to music/audiobooks, read documents — all from one login
4. No data cross-contamination between users
5. Operator (Caleb) spends < 1 hour/week on maintenance

## Future Roadmap

### Phase 2 — Native apps and reliability

- Tauri 2 app (desktop + mobile from one codebase)
- Camera roll auto-sync from mobile
- Automated backups to Backblaze B2
- Automated user provisioning via Clerk webhooks
- Monitoring and alerting (Prometheus + Grafana)
- Improved drop zone classification (reduce confirmation prompts)

### Phase 3 — Monetization and growth

- $10/month billing via Stripe or Clerk payments
- Onboard additional friend/family groups
- Per-user storage quotas and usage tracking
- Uptime commitment and proper SLA

### Phase 4 — Expanded services

- Budgeting via Actual Budget
- SimpleFIN bank sync integration
- Household/combined accounts with shared libraries
- Sharing between users (photos, media, documents)
- Additional services: Vaultwarden (passwords), Kavita (ebooks)
- Power user mode: direct access to underlying service UIs

### Phase 5 — Scale

- Hybrid hosting (heavy storage on-prem, lightweight services on VPS)
- Multi-server support
- Polished onboarding flow
- Public-facing marketing and sign-up

## Business model

**Not a startup. Not seeking VC. This is a sustainable service.**

| Item | Cost |
|------|------|
| Dedicated server hardware (one-time) | ~$500-800 |
| Electricity | ~$10-15/month |
| Cloudflare Tunnel | Free |
| Backblaze B2 (backups, ~2TB, Phase 2) | ~$10/month |
| Clerk (auth) | Free tier covers < 10k MAU |
| steadfirm.io domain | ~$30/year |
| **Total operating cost (POC)** | **~$15/month** |

Revenue at 10 users x $10/month = $100/month (Phase 3). Covers costs with margin from day one of billing.

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend language | Rust | Performance, safety, single binary deployment |
| Backend framework | Axum | Tokio-native, tower middleware, best Rust web framework |
| Client framework | Tauri 2 (Phase 2) | Desktop + mobile from one Rust codebase |
| Auth | Clerk | Proven, handles signup/signin/JWT, already used in Pavo prototype |
| Database | PostgreSQL | Shared with Immich and Paperless, proven at scale |
| Cache | Redis | Shared with Immich and Paperless |
| Reverse proxy | Caddy | Automatic HTTPS, simple config, lighter than Traefik |
| Orchestration | Docker Compose | Simple, sufficient at this scale, no K8s needed |
| External access | Cloudflare Tunnel | Free, no port forwarding, handles SSL |

## What we learned from predecessors

| Project | What they did wrong | How Steadfirm avoids it |
|---------|-------------------|----------------------|
| Sandstorm | Built infrastructure (sandboxing), not a product. Took VC, couldn't monetize. Dependency chain rotted. | We build a skin over existing services. No VC. Each service is independently maintained by its community. |
| Umbrel / CasaOS | App store for tinkerers — too many choices, requires user maintenance | We make all the choices. Users see one app, not an app store. |
| Cloudron | Sysadmin dashboard — users still configure services | Zero configuration for end users |
| Helm | Sold hardware, killed by margins | Software-only, runs on any hardware |
| FreedomBox | List of apps, no unified UX, feels like 2012 | Single unified interface, modern design |

## Non-goals

- We are not building a platform for strangers to deploy apps
- We are not building an app store or marketplace
- We are not giving users infrastructure choices or configuration
- We are not competing with iCloud/Google at scale
- We are not seeking venture funding
- We are not building our own photo/media/document/audio engines
- We are not integrating Nextcloud (too heavy, does too much, hard to maintain)

## Open questions

1. **Web frontend framework** — TBD. Options: Leptos (Rust WASM, full-stack), a JS framework in the Tauri web view, or standalone React/Svelte. Decision needed before Phase 1 frontend work begins.
2. **Media ingestion pipeline** — Jellyfin needs specific folder structures and naming. How sophisticated does the TMDb/MusicBrainz lookup need to be for v1? Minimum viable: rename file, place in user's library folder, let Jellyfin scan.
3. **File storage backend** — Unclassified files in the "Files" tab: local disk with Postgres metadata is simplest. Is that sufficient, or do we want S3-compatible storage (MinIO) from the start?
4. **Mobile camera sync feasibility** — Tauri 2 mobile is young. Need to evaluate whether photo library access plugins are mature enough for Phase 2, or if a native thin client is needed.
