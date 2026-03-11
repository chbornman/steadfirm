# Steadfirm — Technical Specification

## Quick Links

### Underlying Service APIs

| Service | API Documentation | OpenAPI / Swagger | GitHub |
|---------|------------------|-------------------|--------|
| **Immich** | [immich.app/docs/api](https://immich.app/docs/api/) | [Swagger UI (your-instance/api)](https://immich.app/docs/api/introduction) | [immich-app/immich](https://github.com/immich-app/immich) |
| **Jellyfin** | [jellyfin.org/docs/general/server/api](https://jellyfin.org/docs/general/server/api/) | [api.jellyfin.org (OpenAPI)](https://api.jellyfin.org/) | [jellyfin/jellyfin](https://github.com/jellyfin/jellyfin) |
| **Paperless-ngx** | [docs.paperless-ngx.com/api](https://docs.paperless-ngx.com/api/) | [Swagger (your-instance/api/schema/swagger-ui)](https://docs.paperless-ngx.com/api/#the-api) | [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) |
| **Audiobookshelf** | [api.audiobookshelf.org](https://api.audiobookshelf.org/) | N/A (REST docs only, OpenAPI planned) | [advplyr/audiobookshelf](https://github.com/advplyr/audiobookshelf) |

### Our Stack

| Tool | Documentation |
|------|--------------|
| **Axum** | [docs.rs/axum](https://docs.rs/axum/latest/axum/) |
| **Tauri 2** | [v2.tauri.app](https://v2.tauri.app/) |
| **SQLx** | [docs.rs/sqlx](https://docs.rs/sqlx/latest/sqlx/) |
| **BetterAuth** | [better-auth.com/docs](https://www.better-auth.com/docs) — [Session management](https://www.better-auth.com/docs/concepts/session-management) — [Plugins](https://www.better-auth.com/docs/plugins) |
| **React** | [react.dev](https://react.dev/) |
| **Vite** | [vite.dev](https://vite.dev/) |
| **Bun** | [bun.sh/docs](https://bun.sh/docs) |
| **Docker Compose** | [docs.docker.com/compose](https://docs.docker.com/compose/) |
| **Caddy** | [caddyserver.com/docs](https://caddyserver.com/docs/) |
| **Cloudflare Tunnel** | [developers.cloudflare.com/cloudflare-one/connections/connect-networks](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) |

---

## 1. System Overview

Steadfirm is a unified personal cloud. Users interact with a single app (web or native) that proxies requests through a Rust/Axum backend to underlying self-hosted services. Each service handles one domain of the user's digital life. Steadfirm owns auth, routing, file classification, and the unified UI.

```
┌─────────────────────────────────────────────────────────┐
│                        Clients                          │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │  web/        │    │  crates/app/                 │   │
│  │  (browser)   │    │  (Tauri: desktop + mobile)   │   │
│  │  online-only │    │  offline-first + SQLite      │   │
│  └──────┬───────┘    └──────────────┬───────────────┘   │
│         │                           │                   │
│         │  HTTP + session token     │  HTTP + session token │
│         │                           │  (when online)       │
└─────────┼───────────────────────────┼───────────────────┘
          │                           │
          ▼                           ▼
┌─────────────────────────────────────────────────────────┐
│               Steadfirm Backend (Axum)                  │
│                                                         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────────┐  │
│  │ Session  │ │ Drop Zone  │ │ Service Proxy         │  │
│  │ Auth (PG)│ │ Classifier │ │ (per-user credentials)│  │
│  └──────────┘ └────────────┘ └───────────┬───────────┘  │
│                                          │              │
│  ┌──────────────────────────────────┐    │              │
│  │ PostgreSQL (steadfirm database)  │    │              │
│  │ - users                          │    │              │
│  │ - service_connections            │    │              │
│  │ - files (unclassified uploads)   │    │              │
│  └──────────────────────────────────┘    │              │
└──────────────────────────────────────────┼──────────────┘
                                           │
          ┌──────────┬──────────┬──────────┼──────────┐
          ▼          ▼          ▼          ▼          ▼
      ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐
      │ Immich │ │Jellyfin│ │Paperless │ │ Audio- │ │ Local Disk │
      │        │ │        │ │  -ngx    │ │ book-  │ │  (files)   │
      │ :2283  │ │ :8096  │ │  :8000   │ │ shelf  │ │            │
      └────────┘ └────────┘ └──────────┘ │ :13378 │ └────────────┘
                                         └────────┘
```

---

## 2. Authentication

### Architecture

BetterAuth runs as a Bun sidecar container in Docker Compose. It owns signup, signin, session creation, and social OAuth (Google). It writes directly to the shared Postgres instance (`betterauth` database or `steadfirm` database — same cluster).

The Axum backend never calls BetterAuth over the network for session validation. Instead, it reads the `session` table directly via SQLx. This is fast, zero-latency, and avoids a runtime dependency on the BetterAuth process.

### Flow

1. User opens web/ or Tauri app
2. Client redirects to BetterAuth for signup/signin (email + password, or Google OAuth)
3. BetterAuth creates a session row in Postgres, returns session token (cookie or header)
4. Client includes session token in every request (cookie or `Authorization: Bearer <session_token>`)
5. Axum backend reads the `session` table in Postgres to validate the token (direct DB query, no network call)
6. Backend extracts `user_id` from the session row
7. Backend queries `service_connections` table to get user's credentials for each service
8. Backend makes proxied API calls using those service-specific credentials

### Database Schema

BetterAuth manages its own tables (`user`, `session`, `account`, `verification`). Steadfirm adds application-specific tables that reference BetterAuth's `user.id`:

```sql
-- Managed by BetterAuth (do not modify directly):
-- user (id, name, email, emailVerified, image, createdAt, updatedAt)
-- session (id, expiresAt, token, ipAddress, userAgent, userId)
-- account (id, accountId, providerId, userId, ...)
-- verification (id, identifier, value, expiresAt, ...)

-- Managed by Steadfirm:
CREATE TABLE service_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,  -- references BetterAuth user.id
    service         TEXT NOT NULL,  -- 'immich', 'jellyfin', 'paperless', 'audiobookshelf'
    service_user_id TEXT NOT NULL,  -- user ID within the service
    api_key         TEXT NOT NULL,  -- encrypted service API key/token
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, service)
);

CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,  -- references BetterAuth user.id
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### User Provisioning

Triggered by BetterAuth webhook/hook (`user.created`), DB polling, or manual admin endpoint:

```
POST /api/v1/admin/provision
{
    "user_id": "betterauth_user_id"
}
```

Backend:
1. Reads user details from BetterAuth's `user` table in Postgres
2. Creates accounts in each service via admin APIs:
   - Immich: `POST /api/admin/users` → returns user ID + API key
   - Jellyfin: `POST /Users/New` → returns user ID, then generate API key
   - Paperless: `POST /api/users/` → returns user ID + token
   - Audiobookshelf: `POST /api/users` → returns user ID + token
3. Stores all credentials in `service_connections` (encrypted)
4. Returns success

---

## 3. Backend API (Steadfirm)

The backend exposes a unified REST API. All endpoints require session auth except `/health` and `/api/auth/*` (handled by BetterAuth).

### Core Endpoints

```
GET  /health                          → { status, version }

POST /api/v1/admin/provision          → provision a new user
```

### Photos (proxied to Immich)

```
GET  /api/v1/photos                   → list user's photos (paginated)
GET  /api/v1/photos/:id               → get photo metadata
GET  /api/v1/photos/:id/thumbnail     → proxy thumbnail image
GET  /api/v1/photos/:id/original      → proxy full-resolution image
GET  /api/v1/photos/:id/video         → proxy video stream (range requests)
PUT  /api/v1/photos/:id/favorite      → toggle favorite
```

**Immich API endpoints used:**
- `GET /api/assets` — list assets with pagination, filtering
- `GET /api/assets/:id` — asset metadata
- `GET /api/assets/:id/thumbnail` — thumbnail (with size param)
- `GET /api/assets/:id/original` — original file
- `PUT /api/assets/:id` — update asset (favorite toggle)
- `POST /api/assets` — upload new asset
- `POST /api/search/smart` — AI-powered search

### Media (proxied to Jellyfin)

```
GET  /api/v1/media/movies             → list user's movies
GET  /api/v1/media/shows              → list user's TV shows
GET  /api/v1/media/shows/:id/seasons  → list seasons for a show
GET  /api/v1/media/shows/:id/seasons/:seasonId/episodes → list episodes
GET  /api/v1/media/music/artists      → list artists
GET  /api/v1/media/music/artists/:id/albums → list albums for artist
GET  /api/v1/media/music/albums/:id/tracks  → list tracks for album
GET  /api/v1/media/:id                → get item metadata
GET  /api/v1/media/:id/stream         → proxy video/audio stream (HLS or direct)
GET  /api/v1/media/:id/image          → proxy poster/cover image
```

**Jellyfin API endpoints used:**
- `GET /Users/:userId/Items` — list items with filters (type, parent, sort, search)
- `GET /Users/:userId/Items/:itemId` — item details
- `GET /Videos/:itemId/stream` — video streaming (HLS, direct)
- `GET /Audio/:itemId/stream` — audio streaming
- `GET /Items/:itemId/Images/Primary` — poster/cover image
- `POST /Users/New` — create user (admin)
- `GET /Users/Me` — current user info

### Documents (proxied to Paperless-ngx)

```
GET  /api/v1/documents                → list user's documents (paginated, sorted)
GET  /api/v1/documents/:id            → get document metadata
GET  /api/v1/documents/:id/thumbnail  → proxy document thumbnail
GET  /api/v1/documents/:id/preview    → proxy document PDF preview
GET  /api/v1/documents/:id/download   → proxy document download
GET  /api/v1/documents/tags           → list user's tags
```

**Paperless API endpoints used:**
- `GET /api/documents/` — list documents with pagination, filtering, ordering
- `GET /api/documents/:id/` — document details
- `GET /api/documents/:id/thumb/` — thumbnail image
- `GET /api/documents/:id/preview/` — PDF preview
- `GET /api/documents/:id/download/` — original file download
- `GET /api/tags/` — list tags
- `POST /api/documents/post_document/` — upload document
- `POST /api/users/` — create user (admin)

### Audiobooks (proxied to Audiobookshelf)

```
GET  /api/v1/audiobooks               → list user's audiobooks
GET  /api/v1/audiobooks/:id           → get audiobook metadata
GET  /api/v1/audiobooks/:id/cover     → proxy cover image
POST /api/v1/audiobooks/:id/play      → start playback session (returns stream URL + chapters)
PATCH /api/v1/audiobooks/:id/progress → sync playback progress
GET  /api/v1/audiobooks/sessions      → list recent listening sessions
POST /api/v1/audiobooks/:id/bookmarks → create bookmark
```

**Audiobookshelf API endpoints used:**
- `GET /api/libraries/:libId/items` — list library items (paginated, filtered, sorted)
- `GET /api/items/:itemId` — item details
- `GET /api/items/:itemId/cover` — cover image
- `POST /api/items/:itemId/play` — start playback session
- `PATCH /api/me/progress/:itemId` — update progress
- `GET /api/me/listening-sessions` — recent sessions
- `POST /api/me/item/:itemId/bookmark` — create bookmark
- `POST /api/users` — create user (admin)

### Files (Steadfirm internal)

```
GET  /api/v1/files                    → list user's unclassified files
GET  /api/v1/files/:id                → get file metadata
GET  /api/v1/files/:id/download       → download file
DELETE /api/v1/files/:id              → delete file
POST /api/v1/files/:id/reclassify     → move file to a service (re-trigger drop zone)
```

### Drop Zone

```
POST /api/v1/upload                   → upload file(s)
```

**Request:** Multipart form data with file(s).

**Response:**
```json
{
    "files": [
        {
            "filename": "IMG_4021.heic",
            "mime_type": "image/heic",
            "size_bytes": 3542891,
            "suggested_service": "photos",
            "confidence": 0.95,
            "status": "pending_confirmation"
        }
    ]
}
```

**Confirmation:**
```
POST /api/v1/upload/confirm
{
    "files": [
        { "upload_id": "uuid", "service": "photos" }
    ]
}
```

Backend then routes each file to the confirmed service's upload API:
- Photos → `POST /api/assets` (Immich)
- Media → place in user's Jellyfin library folder + trigger library scan
- Documents → `POST /api/documents/post_document/` (Paperless)
- Audiobooks → copy to user's Audiobookshelf library folder + trigger scan
- Files → store locally, record in `files` table

---

## 4. Frontend Architecture

### Two apps, shared packages

```
packages/
  shared/          @steadfirm/shared
    src/
      types/         API request/response types
      constants.ts   service names, routes, limits
      validation.ts  shared validation logic
  ui/              @steadfirm/ui
    src/
      PhotoGrid/     responsive photo grid with lazy loading
      MediaPlayer/   video + audio player (HLS, direct)
      DocumentViewer/ PDF viewer, image viewer
      AudiobookPlayer/ playback with chapters, progress, bookmarks
      DropZone/      drag-and-drop file upload with classification UI
      FileList/      simple file browser for unclassified files
  theme/           @steadfirm/theme
    src/
      tokens.ts      colors, spacing, typography
      global.css     base styles

web/               Browser app (online-only)
  src/
    pages/           Photos, Media, Documents, Audiobooks, Files
    hooks/           useApi() — HTTP fetch to Steadfirm backend
    lib/
      api.ts         typed API client (fetch + session token)

crates/app/src/    Tauri app (offline-first)
  src/
    pages/           Photos, Media, Documents, Audiobooks, Files
    hooks/           useData() — Tauri commands to local SQLite
    lib/
      tauri.ts       typed Tauri command bindings
      sync.ts        background sync when online
      platform.ts    isTauri() detection
```

### Data flow comparison

**web/ (browser):**
```
User action → React hook → HTTP GET /api/v1/photos → Axum backend → Immich API → response → render
```

**crates/app/ (Tauri):**
```
User action → React hook → Tauri command → SQLite (cached data) → render
                                        ↕ (background sync when online)
                              Axum backend → Immich API
```

### Shared UI components

Components in `packages/ui/` accept data via props — they don't care where the data comes from (HTTP or SQLite). Each app provides its own data-fetching hooks but renders the same UI:

```tsx
// packages/ui/src/PhotoGrid/PhotoGrid.tsx
export function PhotoGrid({ photos, onSelect, onLoadMore }: PhotoGridProps) {
    // Pure presentation — no data fetching
}

// web/src/pages/Photos.tsx
function PhotosPage() {
    const { data, fetchMore } = usePhotosApi();  // HTTP
    return <PhotoGrid photos={data} onLoadMore={fetchMore} />;
}

// crates/app/src/pages/Photos.tsx
function PhotosPage() {
    const { data, fetchMore } = usePhotosLocal();  // SQLite via Tauri
    return <PhotoGrid photos={data} onLoadMore={fetchMore} />;
}
```

---

## 5. Tauri App — Offline Strategy

### Local cache (SQLite)

The Tauri Rust backend maintains a SQLite database mirroring the user's metadata:

- Photo thumbnails + metadata (not full-resolution originals)
- Media library index (posters, metadata — not video files)
- Document list + thumbnails (not full PDFs)
- Audiobook library + progress + bookmarks
- Unclassified files list

### Sync model

- **On launch:** background sync pulls latest metadata from Steadfirm backend
- **On action:** uploads (drop zone) are queued locally, synced when online
- **On interval:** periodic sync every 5 minutes when online
- **Conflict resolution:** server wins (last-write-wins for metadata). Upload queue is append-only — no conflicts possible for new files.

### What works offline

- Browse cached photo grid (thumbnails)
- Browse media library (posters, metadata)
- Browse document list (thumbnails)
- Browse audiobook library, resume playback of downloaded audiobooks
- View unclassified files list
- Queue files for upload (synced when back online)

### What requires online

- Full-resolution photo viewing
- Video/audio streaming (unless explicitly downloaded)
- Document PDF viewing (unless cached)
- Drop zone confirmation and routing
- Any write operations that affect server state

---

## 6. Drop Zone — Classification Pipeline

```
File received
    │
    ▼
MIME type detection (from Content-Type header + magic bytes)
    │
    ▼
Metadata extraction (EXIF for images, ID3/Vorbis for audio, PDF metadata for docs)
    │
    ▼
Heuristic classification:
    ├─ Image MIME (jpeg, heic, png, raw, webp)     → Photos (confidence: 0.95)
    ├─ Video MIME + short duration + phone EXIF     → Photos (confidence: 0.90)
    ├─ Video MIME + long duration + movie filename  → Media/Movies (confidence: 0.80)
    ├─ Audio MIME + ID3 tags + < 20min              → Media/Music (confidence: 0.85)
    ├─ Audio MIME + long duration + author metadata  → Audiobooks (confidence: 0.85)
    ├─ M4B extension                                → Audiobooks (confidence: 0.95)
    ├─ PDF/DOCX MIME                                → Documents (confidence: 0.90)
    ├─ CSV/OFX/QFX with financial headers           → Files (confidence: 0.70)
    └─ Anything else                                → Files (confidence: 1.0)
    │
    ▼
Return suggestion to user with confidence score
    │
    ▼
User confirms or edits destination
    │
    ▼
Route to confirmed service API
```

### Jellyfin media ingestion

Movies and TV shows need special handling because Jellyfin relies on folder structure for metadata scraping:

```
/media/{user_id}/Movies/{Movie Name} ({Year})/{filename}.mkv
/media/{user_id}/Shows/{Show Name}/Season {XX}/{Show Name} S{XX}E{XX}.mkv
/media/{user_id}/Music/{Artist}/{Album}/{Track}.mp3
```

For movies/shows, the drop zone does a TMDb lookup by filename to get the correct title and year, then renames and places the file. For music, it reads ID3 tags to determine artist/album/track and organizes accordingly. After placing files, the backend triggers a Jellyfin library scan for the user's libraries.

---

## 7. Infrastructure

### Docker Compose services

| Service | Image | Port (localhost) | Shares |
|---------|-------|-----------------|--------|
| postgres | ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0 | 5432 | DBs: steadfirm, immich, paperless |
| valkey | valkey/valkey:9.0.3-alpine | — | Used by: immich, paperless |
| immich-server | ghcr.io/immich-app/immich-server:v2.5.6 | 2283 | |
| immich-ml | ghcr.io/immich-app/immich-machine-learning:v2.5.6 | — | |
| jellyfin | jellyfin/jellyfin:10.11.6 | 8096 | |
| paperless | ghcr.io/paperless-ngx/paperless-ngx:2.20.10 | 8000 | |
| audiobookshelf | ghcr.io/advplyr/audiobookshelf:2.32.1 | 13378 | |
| caddy | caddy:2.11.2-alpine | 80, 443 | |

### Storage layout

```
/data/steadfirm/
  files/                  unclassified user uploads
    {user_id}/
  media/                  Jellyfin per-user media libraries
    {user_id}/
      Movies/
      Shows/
      Music/
  audiobooks/             Audiobookshelf per-user libraries
    {user_id}/
```

Immich and Paperless manage their own storage volumes internally. Jellyfin and Audiobookshelf need host-mounted directories for per-user library isolation.

### External access

Cloudflare Tunnel (`cloudflared`) connects the server to the internet without port forwarding:

```bash
cloudflared tunnel --url http://localhost:80
```

Caddy handles routing. Cloudflare handles TLS termination and DDoS protection. Domain: `steadfirm.io` (once registered).

---

## 8. Service API Authentication Summary

How the backend authenticates with each underlying service on behalf of a user:

| Service | Auth header | Per-user? | Created during provisioning |
|---------|------------|-----------|---------------------------|
| Immich | `x-api-key: {key}` | Yes — each user gets their own API key | Admin creates user → user gets API key |
| Jellyfin | `Authorization: MediaBrowser Token="{key}"` + UserId param | Yes — per-user API token | Admin creates user → generate token for user |
| Paperless | `Authorization: Token {token}` | Yes — per-user auth token | Admin creates user → user gets token |
| Audiobookshelf | `Authorization: Bearer {token}` | Yes — per-user JWT/token | Admin creates user → login as user → store token |

All credentials are stored encrypted in the `service_connections` table. The backend is the only component that ever touches these credentials.

---

## 9. Milestones (v1 POC)

### M1: Infrastructure + Auth
- [ ] Docker Compose runs all services (including BetterAuth sidecar)
- [ ] Caddy routes traffic (including /api/auth/* to BetterAuth)
- [ ] Axum backend starts with health endpoint
- [ ] BetterAuth session validation middleware works (direct Postgres read)
- [ ] User provisioning creates accounts in all services
- [ ] `service_connections` table stores credentials

### M2: Backend API Proxy
- [ ] Photos proxy (list, thumbnail, original, video)
- [ ] Media proxy (movies, shows, music, streaming)
- [ ] Documents proxy (list, thumbnail, preview, download)
- [ ] Audiobooks proxy (list, play, progress, bookmarks)
- [ ] Files CRUD (list, download, delete)

### M3: Drop Zone
- [ ] File upload endpoint (multipart)
- [ ] MIME-based classification with confidence
- [ ] User confirmation flow
- [ ] Routing to correct service API after confirmation
- [ ] Jellyfin folder structure + TMDb rename for movies

### M4: Web Frontend
- [ ] BetterAuth login/signup (email + password, Google OAuth)
- [ ] Photos tab with grid + lightbox + video playback
- [ ] Media tab with movies/shows/music + streaming
- [ ] Documents tab with grid + PDF viewer
- [ ] Audiobooks tab with player + progress + chapters
- [ ] Files tab with list + download
- [ ] Drop zone UI with classification suggestions

### M5: Tauri App (offline-first)
- [ ] Tauri project scaffolded, points at app-specific frontend
- [ ] SQLite local cache for metadata
- [ ] Background sync with Steadfirm backend
- [ ] Offline browsing of cached content
- [ ] Upload queue (synced when online)
- [ ] Shared UI components rendering from local data

### M6: User Testing
- [ ] 5 users provisioned
- [ ] 30-day trial period
- [ ] Feedback collection
- [ ] Bug fixes and polish
