# Steadfirm — Backend Specification

This document specifies the Rust/Axum backend (`crates/backend/`) in full implementation detail. It covers internal architecture, authentication middleware, service client layer, every endpoint's request/response translation, streaming/binary proxying, pagination normalization, user provisioning, and error handling.

The backend is an **API gateway**. It accepts unified requests from the web frontend and Tauri app, validates the BetterAuth session, resolves the user's per-service credentials, translates the request into the target service's API format, and normalizes the response back into the Steadfirm schema.

---

## 1. Crate Structure

```
crates/backend/
  Cargo.toml
  migrations/
    20260311000000_initial_schema.sql
  src/
    main.rs                 — Server startup, pool, migrations, router assembly
    config.rs               — Environment variable configuration
    error.rs                — AppError enum, IntoResponse impl

    auth/
      mod.rs                — Session validation middleware
      extractor.rs          — AuthUser extractor (from session token → user + credentials)
      session.rs            — Direct Postgres session queries

    services/
      mod.rs                — ServiceClient trait, shared HTTP client
      immich.rs             — Immich API client
      jellyfin.rs           — Jellyfin API client
      paperless.rs          — Paperless-ngx API client
      audiobookshelf.rs     — Audiobookshelf API client

    routes/
      mod.rs                — Router assembly
      users.rs              — GET /api/v1/users/me
      photos.rs             — Photos endpoints (Immich proxy)
      media.rs              — Media endpoints (Jellyfin proxy)
      documents.rs          — Documents endpoints (Paperless proxy)
      audiobooks.rs         — Audiobooks endpoints (Audiobookshelf proxy)
      files.rs              — Files endpoints (local storage)
      dropzone.rs           — Upload + classification + confirmation
      admin.rs              — User provisioning

    proxy.rs                — Binary/streaming proxy utilities
    pagination.rs           — Pagination translation layer
    models.rs               — Shared response types (Rust structs matching frontend types)
```

---

## 2. Application State

```rust
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Config,
    pub http: reqwest::Client,  // shared HTTP client for all service calls
}
```

The `reqwest::Client` is created once at startup with sensible defaults (connection pooling, 30s timeout, gzip). All service clients receive a reference to this shared client — they do not create their own.

---

## 3. Configuration

```rust
pub struct Config {
    // Server
    pub port: u16,                          // PORT, default "3001"
    pub database_url: String,               // DATABASE_URL (required)

    // Admin credentials for user provisioning (each service's admin account)
    pub immich_url: String,                 // IMMICH_URL, default "http://immich-server:2283"
    pub immich_admin_api_key: String,       // IMMICH_ADMIN_API_KEY (required)

    pub jellyfin_url: String,              // JELLYFIN_URL, default "http://jellyfin:8096"
    pub jellyfin_admin_token: String,      // JELLYFIN_ADMIN_TOKEN (required)

    pub paperless_url: String,             // PAPERLESS_URL, default "http://paperless:8000"
    pub paperless_admin_token: String,     // PAPERLESS_ADMIN_TOKEN (required)

    pub audiobookshelf_url: String,        // AUDIOBOOKSHELF_URL, default "http://audiobookshelf:80"
    pub audiobookshelf_admin_token: String, // AUDIOBOOKSHELF_ADMIN_TOKEN (required)

    // Local file storage
    pub files_storage_path: String,        // FILES_STORAGE_PATH, default "/data/steadfirm/files"

    // Jellyfin-specific (static per backend instance)
    pub jellyfin_device_id: String,        // JELLYFIN_DEVICE_ID, default generated UUID
}
```

Key change from current config: admin-level credentials are for **provisioning only**. Per-user credentials come from the `service_connections` table at request time.

---

## 4. Authentication Middleware

### Session Validation

The backend validates sessions by reading BetterAuth's `session` table directly from Postgres. No HTTP call to BetterAuth.

**Token extraction** (checked in order):
1. Cookie: `better-auth.session_token` — extract the token portion before the `.` separator (the part after `.` is the HMAC signature used by BetterAuth internally; the raw token is what's stored in the DB)
2. Header: `Authorization: Bearer <token>` — use the token as-is

**Validation query:**
```sql
SELECT s.token, s."expiresAt", s."userId",
       u.id, u.name, u.email
FROM session s
JOIN "user" u ON s."userId" = u.id
WHERE s.token = $1
  AND s."expiresAt" > now();
```

If no row is returned, respond `401 Unauthorized`.

### AuthUser Extractor

An Axum extractor that runs the session validation and resolves the user's service credentials:

```rust
pub struct AuthUser {
    pub id: String,             // BetterAuth user.id
    pub name: String,
    pub email: String,
    pub credentials: ServiceCredentials,
}

pub struct ServiceCredentials {
    pub immich: Option<ServiceCred>,
    pub jellyfin: Option<ServiceCred>,
    pub paperless: Option<ServiceCred>,
    pub audiobookshelf: Option<ServiceCred>,
}

pub struct ServiceCred {
    pub service_user_id: String,
    pub api_key: String,
}
```

**Credentials query:**
```sql
SELECT service, service_user_id, api_key
FROM service_connections
WHERE user_id = $1 AND active = true;
```

Both queries run on every authenticated request. They're fast (indexed columns, same Postgres instance, connection-pooled). If latency becomes a concern, add a per-request cache, but premature optimization isn't needed.

### Applying the Middleware

All routes under `/api/v1/*` require auth except where noted. The `AuthUser` extractor is used directly in handler signatures — no separate middleware layer:

```rust
async fn list_photos(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<PhotoListParams>,
) -> Result<Json<PaginatedResponse<Photo>>, AppError> {
    let cred = user.credentials.immich
        .ok_or(AppError::ServiceUnavailable("photos not provisioned".into()))?;
    // ...
}
```

---

## 5. Service Client Layer

Each service gets a client module that encapsulates API calls. They share a common pattern but differ in auth headers, request/response shapes, and pagination.

### Common Interface

```rust
/// Every service client method takes:
/// - &self (holds base_url, shared reqwest::Client)
/// - api_key/token (per-user, from ServiceCred)
/// - service_user_id (per-user, some services need it in query params)
/// - endpoint-specific parameters
///
/// Every method returns Result<T, AppError> where T is either:
/// - A deserialized Rust struct (for JSON responses)
/// - A reqwest::Response (for binary/streaming responses, proxied to client)
```

### Immich Client

```rust
pub struct ImmichClient {
    base_url: String,       // e.g. "http://immich-server:2283"
    http: reqwest::Client,
}

impl ImmichClient {
    fn auth_header(api_key: &str) -> (HeaderName, HeaderValue) {
        ("x-api-key", api_key)
    }
}
```

### Jellyfin Client

```rust
pub struct JellyfinClient {
    base_url: String,
    device_id: String,      // static per backend instance
    http: reqwest::Client,
}

impl JellyfinClient {
    fn auth_header(token: &str, device_id: &str) -> (HeaderName, HeaderValue) {
        let value = format!(
            r#"MediaBrowser Client="Steadfirm", Device="Steadfirm-Backend", DeviceId="{}", Version="1.0.0", Token="{}""#,
            device_id, token
        );
        ("Authorization", value)
    }
}
```

All Jellyfin requests include `Accept: application/json; profile="CamelCase"` to get camelCase responses, matching Rust `#[serde(rename_all = "camelCase")]`.

### Paperless Client

```rust
pub struct PaperlessClient {
    base_url: String,
    http: reqwest::Client,
}

impl PaperlessClient {
    fn auth_header(token: &str) -> (HeaderName, HeaderValue) {
        ("Authorization", format!("Token {}", token))
    }
}
```

All Paperless requests include `Accept: application/json; version=9`.

### Audiobookshelf Client

```rust
pub struct AudiobookshelfClient {
    base_url: String,
    http: reqwest::Client,
}

impl AudiobookshelfClient {
    fn auth_header(token: &str) -> (HeaderName, HeaderValue) {
        ("Authorization", format!("Bearer {}", token))
    }
}
```

---

## 6. Pagination Translation

Each service paginates differently. The backend normalizes all of them into the frontend's standard shape:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub total: u64,
    pub page: u32,          // 1-indexed
    pub page_size: u32,
    pub next_page: Option<u32>,
}
```

**Frontend sends:**
```
?page=1&pageSize=50
```
Default: `page=1`, `pageSize=50`.

### Translation per service

**Immich** (page/size, 1-indexed):
```
Frontend: ?page=2&pageSize=50
Immich:   POST /api/search/metadata { page: 2, size: 50 }
Response: { items, total, count, nextPage }
Map:      total → total, items → items, nextPage null → no more pages
```

**Jellyfin** (startIndex/limit, 0-indexed):
```
Frontend: ?page=2&pageSize=50
Jellyfin:  GET /Items?startIndex=50&limit=50
Response: { Items, TotalRecordCount, StartIndex }
Map:      TotalRecordCount → total, Items → items
          nextPage = if startIndex + limit < total then page + 1 else null
```

**Paperless** (page/page_size, 1-indexed):
```
Frontend: ?page=2&pageSize=50
Paperless: GET /api/documents/?page=2&page_size=50
Response: { count, next, previous, results }
Map:      count → total, results → items
          nextPage = if next != null then page + 1 else null
```
Note: Strip the `all` field from Paperless responses (contains all matching PKs, can be large).

**Audiobookshelf** (page/limit, 0-indexed):
```
Frontend: ?page=2&pageSize=50
ABS:      GET /api/libraries/:id/items?page=1&limit=50  (0-indexed, so page-1)
Response: { results, total, limit, page }
Map:      total → total, results → items
          nextPage = if (page + 1) * limit < total then page + 1 else null
```

---

## 7. Response Normalization

The backend transforms each service's response objects into the unified types the frontend expects. All IDs become strings. All URLs become relative Steadfirm paths (the frontend never sees service URLs).

### Photos (Immich → Steadfirm)

```
Immich AssetResponseDto          →  Steadfirm Photo
─────────────────────────────────────────────────────
id                               →  id
type ("IMAGE"|"VIDEO")           →  type ("image"|"video")
originalFileName                 →  filename
originalMimeType                 →  mimeType
width (from exifInfo)            →  width
height (from exifInfo)           →  height
fileCreatedAt                    →  dateTaken (ISO 8601)
isFavorite                       →  isFavorite
duration (parse "H:MM:SS.mmm")   →  duration (seconds, only for video)
(constructed)                    →  thumbnailUrl: "/api/v1/photos/{id}/thumbnail"
```

### Media — Movies (Jellyfin → Steadfirm)

```
Jellyfin BaseItemDto (Movie)     →  Steadfirm Movie
─────────────────────────────────────────────────────
id                               →  id
name                             →  title
productionYear                   →  year
runTimeTicks / 600_000_000       →  runtime (minutes)
overview                         →  overview
officialRating                   →  rating
(constructed)                    →  imageUrl: "/api/v1/media/{id}/image"
(constructed)                    →  streamUrl: "/api/v1/media/{id}/stream"
```

### Media — TV Shows (Jellyfin → Steadfirm)

```
Jellyfin BaseItemDto (Series)    →  Steadfirm TvShow
─────────────────────────────────────────────────────
id                               →  id
name                             →  title
productionYear + status/endDate  →  year ("2020-2024" or "2020-")
overview                         →  overview
childCount (seasons)             →  seasonCount
(constructed)                    →  imageUrl: "/api/v1/media/{id}/image"
```

### Media — Seasons (Jellyfin → Steadfirm)

```
Jellyfin BaseItemDto (Season)    →  Steadfirm Season
─────────────────────────────────────────────────────
id                               →  id
name                             →  name
indexNumber                      →  seasonNumber
childCount (episodes)            →  episodeCount
```

### Media — Episodes (Jellyfin → Steadfirm)

```
Jellyfin BaseItemDto (Episode)   →  Steadfirm Episode
─────────────────────────────────────────────────────
id                               →  id
name                             →  title
parentIndexNumber                →  seasonNumber
indexNumber                      →  episodeNumber
runTimeTicks / 600_000_000       →  runtime (minutes)
overview                         →  overview
(constructed)                    →  imageUrl: "/api/v1/media/{id}/image"
(constructed)                    →  streamUrl: "/api/v1/media/{id}/stream"
```

### Media — Artists (Jellyfin → Steadfirm)

```
Jellyfin BaseItemDto (MusicArtist) →  Steadfirm Artist
─────────────────────────────────────────────────────────
id                                 →  id
name                               →  name
(constructed)                      →  imageUrl: "/api/v1/media/{id}/image"
childCount (albums)                →  albumCount
```

### Media — Albums (Jellyfin → Steadfirm)

```
Jellyfin BaseItemDto (MusicAlbum) →  Steadfirm Album
─────────────────────────────────────────────────────
id                                →  id
name                              →  name
productionYear                    →  year
albumArtist (first)               →  artistName
childCount (tracks)               →  trackCount
(constructed)                     →  imageUrl: "/api/v1/media/{id}/image"
```

### Media — Tracks (Jellyfin → Steadfirm)

```
Jellyfin BaseItemDto (Audio)     →  Steadfirm Track
─────────────────────────────────────────────────────
id                               →  id
name                             →  title
indexNumber                      →  trackNumber
runTimeTicks / 10_000_000        →  duration (seconds)
artists (first)                  →  artistName
album                            →  albumName
(constructed from albumId)       →  albumImageUrl: "/api/v1/media/{albumId}/image"
(constructed)                    →  streamUrl: "/api/v1/media/{id}/stream"
```

### Documents (Paperless → Steadfirm)

Paperless returns IDs for correspondents and tags. The backend must resolve these to names. Options:
1. **Eager**: Fetch `/api/correspondents/` and `/api/tags/` once, cache in memory, refresh periodically.
2. **Inline**: Paperless supports `?fields=` but doesn't expand FKs inline.

Use option 1: cache correspondents and tags per-user on first request, refresh on cache miss (when a returned ID isn't in cache). Store in `AppState` behind a TTL cache keyed by `(user_id, "correspondents"|"tags")`.

```
Paperless Document               →  Steadfirm Document
─────────────────────────────────────────────────────────
id (int → string)                →  id
title                            →  title
correspondent (resolve ID→name)  →  correspondent (string | null)
tags (resolve IDs→names)         →  tags (string[])
created                          →  dateCreated (ISO 8601)
added                            →  dateAdded (ISO 8601)
page_count                       →  pageCount
(constructed)                    →  thumbnailUrl: "/api/v1/documents/{id}/thumbnail"
(constructed)                    →  previewUrl: "/api/v1/documents/{id}/preview"
(constructed)                    →  downloadUrl: "/api/v1/documents/{id}/download"
```

### Audiobooks (Audiobookshelf → Steadfirm)

```
ABS LibraryItem (book type)      →  Steadfirm Audiobook
─────────────────────────────────────────────────────────
id                               →  id
media.metadata.title             →  title
media.metadata.authorName        →  author
media.metadata.narratorName      →  narrator
media.duration                   →  duration (seconds, ABS stores as float)
(constructed)                    →  coverUrl: "/api/v1/audiobooks/{id}/cover"
mediaProgress.currentTime        →  progress (seconds, from /api/me/items-in-progress or item detail)
```

### Audiobook Chapters (Audiobookshelf → Steadfirm)

```
ABS Chapter                      →  Steadfirm Chapter
─────────────────────────────────────────────────────────
id                               →  id
title                            →  title
start                            →  start (seconds)
end                              →  end (seconds)
```

### Files (Steadfirm internal)

```
Steadfirm files table            →  Steadfirm UserFile
─────────────────────────────────────────────────────────
id (UUID → string)               →  id
filename                         →  filename
mime_type                        →  mimeType
size_bytes                       →  sizeBytes
created_at                       →  createdAt (ISO 8601)
(constructed)                    →  downloadUrl: "/api/v1/files/{id}/download"
```

---

## 8. Binary & Streaming Proxy

For binary responses (images, thumbnails, PDFs, file downloads) and streaming responses (video, audio), the backend must proxy efficiently without buffering the entire response body in memory.

### Strategy

Use `reqwest`'s streaming response and convert it to an Axum streaming response:

```rust
use axum::body::Body;
use axum::response::Response;
use reqwest;

async fn proxy_binary(
    upstream_response: reqwest::Response,
) -> Result<Response<Body>, AppError> {
    let status = upstream_response.status();
    let mut builder = Response::builder().status(status.as_u16());

    // Forward relevant headers
    for header in ["content-type", "content-length", "content-disposition",
                    "accept-ranges", "content-range", "etag", "last-modified",
                    "cache-control"] {
        if let Some(val) = upstream_response.headers().get(header) {
            builder = builder.header(header, val.clone());
        }
    }

    // Stream the body without buffering
    let body = Body::from_stream(upstream_response.bytes_stream());
    builder.body(body).map_err(|e| AppError::Internal(e.into()))
}
```

### Range Request Forwarding

For video streaming (Immich video playback, Jellyfin direct stream), the client sends `Range` headers for seeking. The backend must forward these:

```rust
async fn proxy_stream(
    state: &AppState,
    url: &str,
    auth_header: (&str, &str),
    range_header: Option<&HeaderValue>,
) -> Result<Response<Body>, AppError> {
    let mut req = state.http.get(url).header(auth_header.0, auth_header.1);

    if let Some(range) = range_header {
        req = req.header("range", range.clone());
    }

    let resp = req.send().await?;
    proxy_binary(resp).await
}
```

The response will include:
- `206 Partial Content` with `Content-Range` header when range is requested
- `200 OK` with full body when no range is requested

### HLS Proxy (Jellyfin)

HLS master playlists (`master.m3u8`) contain relative URLs to segment playlists and video segments. When proxying HLS:

1. Proxy the `master.m3u8` and `main.m3u8` requests through the backend
2. Rewrite segment URLs in the playlist to point back through the backend
3. Proxy individual segment requests

Alternatively, for v1: use Jellyfin's `?static=true` direct stream mode instead of HLS. This avoids transcoding and playlist rewriting entirely. The client uses a standard `<video>` tag with progressive download + range requests. HLS can be added later if adaptive bitrate is needed.

**v1 approach: direct stream only (`?static=true`).** This is simpler, avoids transcoding, and works well on local networks.

---

## 9. Endpoint Specifications

### 9.1 Health

```
GET /health

Response: 200
{
    "status": "ok",
    "service": "steadfirm",
    "version": "0.1.0"
}

No auth required.
```

### 9.2 Users

```
GET /api/v1/users/me

Auth: required
Response: 200
{
    "id": "betterauth_user_id",
    "name": "Caleb Bornman",
    "email": "caleb@steadfirm.dev",
    "services": {
        "photos": true,       // has active immich credential
        "media": true,        // has active jellyfin credential
        "documents": true,    // has active paperless credential
        "audiobooks": true,   // has active audiobookshelf credential
        "files": true         // always true (built-in)
    }
}
```

Constructed from `AuthUser` data. The `services` map tells the frontend which sidebar items to enable.

### 9.3 Photos (Immich proxy)

**List photos:**
```
GET /api/v1/photos?page=1&pageSize=50&sort=dateTaken&order=desc&favorites=false

→ POST {immich}/api/search/metadata
  Headers: x-api-key: {user_key}
  Body: {
      page: 1,
      size: 50,
      order: "desc",
      isFavorite: true,         // only if favorites=true
      type: null,               // both IMAGE and VIDEO
      visibility: "timeline"    // exclude archived/hidden
  }

Response: PaginatedResponse<Photo>
```

**Get photo detail:**
```
GET /api/v1/photos/:id

→ GET {immich}/api/assets/{id}
  Headers: x-api-key: {user_key}

Response: Photo (full object)
```

**Get thumbnail:**
```
GET /api/v1/photos/:id/thumbnail

→ GET {immich}/api/assets/{id}/thumbnail?size=preview
  Headers: x-api-key: {user_key}

Response: binary (image/jpeg or image/webp), streamed
```

**Get original:**
```
GET /api/v1/photos/:id/original

→ GET {immich}/api/assets/{id}/original
  Headers: x-api-key: {user_key}

Response: binary (original file), streamed
```

**Stream video:**
```
GET /api/v1/photos/:id/video

→ GET {immich}/api/assets/{id}/video/playback
  Headers: x-api-key: {user_key}, Range: (forwarded from client)

Response: binary (video), streamed with range support (206/200)
```

**Toggle favorite:**
```
PUT /api/v1/photos/:id/favorite

→ GET {immich}/api/assets/{id}   (first, to get current state)
  Headers: x-api-key: {user_key}
→ PUT {immich}/api/assets/{id}
  Headers: x-api-key: {user_key}
  Body: { "isFavorite": !current_state }

Response: { "isFavorite": true|false }
```

### 9.4 Media (Jellyfin proxy)

All Jellyfin requests include:
```
Authorization: MediaBrowser Client="Steadfirm", Device="Steadfirm-Backend",
  DeviceId="{config.jellyfin_device_id}", Version="1.0.0", Token="{user_token}"
Accept: application/json; profile="CamelCase"
```

**List movies:**
```
GET /api/v1/media/movies?page=1&pageSize=50&sort=title&order=asc

→ GET {jellyfin}/Items
  Query: userId={jf_user_id}, includeItemTypes=Movie, recursive=true,
         sortBy=SortName, sortOrder=Ascending,
         startIndex=((page-1)*pageSize), limit=pageSize,
         fields=Overview,ProviderIds,PrimaryImageAspectRatio,MediaSources,
         enableUserData=true, enableTotalRecordCount=true

Response: PaginatedResponse<Movie>
```

Sort mapping:
- `title` → `SortName`
- `dateAdded` → `DateCreated`
- `year` → `ProductionYear`

**List shows:**
```
GET /api/v1/media/shows?page=1&pageSize=50

→ GET {jellyfin}/Items
  Query: userId={jf_user_id}, includeItemTypes=Series, recursive=true,
         sortBy=SortName, sortOrder=Ascending,
         startIndex=..., limit=...,
         fields=Overview,ChildCount,PrimaryImageAspectRatio,
         enableUserData=true, enableTotalRecordCount=true

Response: PaginatedResponse<TvShow>
```

**List seasons for a show:**
```
GET /api/v1/media/shows/:showId/seasons

→ GET {jellyfin}/Shows/{showId}/Seasons
  Query: userId={jf_user_id}, fields=Overview

Response: Season[] (not paginated — typically < 20 seasons)
```

**List episodes for a season:**
```
GET /api/v1/media/shows/:showId/seasons/:seasonId/episodes

→ GET {jellyfin}/Shows/{showId}/Episodes
  Query: userId={jf_user_id}, seasonId={seasonId},
         fields=Overview,MediaSources,PrimaryImageAspectRatio,
         enableUserData=true

Response: Episode[] (not paginated — typically < 30 episodes)
```

**List music artists:**
```
GET /api/v1/media/music/artists?page=1&pageSize=50

→ GET {jellyfin}/Artists/AlbumArtists
  Query: userId={jf_user_id},
         startIndex=..., limit=...,
         sortBy=SortName, sortOrder=Ascending,
         fields=PrimaryImageAspectRatio,
         enableTotalRecordCount=true

Response: PaginatedResponse<Artist>
```

**List albums for an artist:**
```
GET /api/v1/media/music/artists/:artistId/albums

→ GET {jellyfin}/Items
  Query: userId={jf_user_id}, includeItemTypes=MusicAlbum,
         recursive=true, albumArtistIds={artistId},
         sortBy=ProductionYear,SortName, sortOrder=Descending,
         fields=PrimaryImageAspectRatio,ChildCount

Response: Album[] (not paginated — typically manageable count per artist)
```

**List tracks for an album:**
```
GET /api/v1/media/music/albums/:albumId/tracks

→ GET {jellyfin}/Items
  Query: userId={jf_user_id}, includeItemTypes=Audio,
         parentId={albumId},
         sortBy=IndexNumber, sortOrder=Ascending,
         fields=MediaSources

Response: Track[] (not paginated)
```

**Get media item detail:**
```
GET /api/v1/media/:id

→ GET {jellyfin}/Items/{id}
  Query: userId={jf_user_id}

Response: Movie | TvShow | Episode | Artist | Album | Track
  (determined by item type in Jellyfin response)
```

**Get poster/cover image:**
```
GET /api/v1/media/:id/image?maxWidth=400

→ GET {jellyfin}/Items/{id}/Images/Primary
  Query: maxWidth={maxWidth}, format=Webp, quality=90

Response: binary (image/webp), streamed
```

Note: Jellyfin image endpoints don't require auth, but we proxy them anyway to hide the Jellyfin URL from the client.

**Stream video/audio:**
```
GET /api/v1/media/:id/stream

→ Check item type (from prior request or cache):
  Video: GET {jellyfin}/Videos/{id}/stream
         Query: static=true, mediaSourceId={id}
  Audio: GET {jellyfin}/Audio/{id}/stream
         Query: static=true, mediaSourceId={id}

  Forward: Range header from client, Authorization header

Response: binary (video/* or audio/*), streamed with range support
```

### 9.5 Documents (Paperless proxy)

All Paperless requests include:
```
Authorization: Token {user_token}
Accept: application/json; version=9
```

**List documents:**
```
GET /api/v1/documents?page=1&pageSize=50&sort=dateAdded&order=desc&tags=1,2&query=invoice

→ GET {paperless}/api/documents/
  Query: page=1, page_size=50,
         ordering=-added,           // prefix - for desc
         tags__id__all=1,2,         // if tags provided
         query=invoice              // if query provided

Response: PaginatedResponse<Document>
  (with correspondent names and tag names resolved from cache)
```

Sort mapping:
- `dateAdded` → `added`
- `dateCreated` → `created`
- `title` → `title`
- `correspondent` → `correspondent__name`

**Get document detail:**
```
GET /api/v1/documents/:id

→ GET {paperless}/api/documents/{id}/
  Query: truncate_content=true

Response: Document
```

**Get thumbnail:**
```
GET /api/v1/documents/:id/thumbnail

→ GET {paperless}/api/documents/{id}/thumb/

Response: binary (image/webp), streamed
```

**Get PDF preview:**
```
GET /api/v1/documents/:id/preview

→ GET {paperless}/api/documents/{id}/preview/

Response: binary (application/pdf), streamed
```

**Download original:**
```
GET /api/v1/documents/:id/download

→ GET {paperless}/api/documents/{id}/download/

Response: binary (original file), streamed with Content-Disposition: attachment
```

**List tags:**
```
GET /api/v1/documents/tags

→ GET {paperless}/api/tags/?page_size=1000

Response: Tag[] — [{ id: string, name: string, color: string }]
  (not paginated from Steadfirm's perspective — fetch all)
```

### 9.6 Audiobooks (Audiobookshelf proxy)

All Audiobookshelf requests include:
```
Authorization: Bearer {user_token}
```

Audiobookshelf organizes content by library. On provisioning, we store the user's audiobook library ID alongside their credentials. If there's only one library, use it automatically.

**List audiobooks:**
```
GET /api/v1/audiobooks?page=1&pageSize=50&sort=title&order=asc

→ GET {abs}/api/libraries/{libraryId}/items
  Query: page=((page-1)),    // ABS is 0-indexed
         limit=pageSize,
         sort=media.metadata.title, desc=0,
         include=rssfeed,progress

Response: PaginatedResponse<Audiobook>
```

Sort mapping:
- `title` → `media.metadata.title`
- `author` → `media.metadata.authorName`
- `recentlyListened` → `progress` (with `desc=1`)

**Get audiobook detail:**
```
GET /api/v1/audiobooks/:id

→ GET {abs}/api/items/{id}
  Query: include=progress,rssfeed&expanded=1

Response: Audiobook (with chapters)
  {
      id, title, author, narrator, duration, coverUrl, progress,
      chapters: Chapter[]
  }
```

**Get cover image:**
```
GET /api/v1/audiobooks/:id/cover

→ GET {abs}/api/items/{id}/cover
  Query: width=800 (optional)

Response: binary (image/*), streamed
```

**Start playback session:**
```
POST /api/v1/audiobooks/:id/play

→ POST {abs}/api/items/{id}/play
  Body: {
      deviceInfo: {
          deviceId: "steadfirm-web",
          clientName: "Steadfirm"
      },
      forceDirectPlay: true,
      forceTranscode: false,
      supportedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/flac"]
  }

Response:
  {
      sessionId: string,          // ABS playback session ID
      audioTracks: [{
          contentUrl: string,     // relative URL to audio stream
          mimeType: string,
          duration: number
      }],
      currentTime: number,        // resume position in seconds
      chapters: Chapter[]
  }

  The contentUrl needs to be rewritten to proxy through Steadfirm:
  Original: /api/items/{id}/file/{ino}
  Proxied:  /api/v1/audiobooks/{id}/stream?session={sessionId}
```

**Stream audiobook audio:**
```
GET /api/v1/audiobooks/:id/stream?session={sessionId}

→ GET {abs}{contentUrl}
  Headers: Authorization: Bearer {user_token}, Range: (forwarded)

Response: binary (audio/*), streamed with range support
```

**Sync progress:**
```
PATCH /api/v1/audiobooks/:id/progress

Body: {
    currentTime: 3456.7,      // seconds
    duration: 36000,           // total seconds
    progress: 0.096            // fraction 0-1
}

→ PATCH {abs}/api/me/progress/{id}
  Body: {
      currentTime: 3456.7,
      duration: 36000,
      progress: 0.096,
      isFinished: false
  }

Response: 200 (no body)
```

**List recent sessions:**
```
GET /api/v1/audiobooks/sessions

→ GET {abs}/api/me/listening-sessions
  Query: itemsPerPage=10

Response: ListeningSession[]
  [{
      id: string,
      bookId: string,
      bookTitle: string,
      coverUrl: string,
      currentTime: number,
      duration: number,
      updatedAt: string
  }]
```

**Create bookmark:**
```
POST /api/v1/audiobooks/:id/bookmarks

Body: {
    title: "Important passage",
    time: 1234.5
}

→ POST {abs}/api/me/item/{id}/bookmark
  Body: {
      title: "Important passage",
      time: 1234.5
  }

Response: 200 { bookmark object }
```

### 9.7 Files (Steadfirm internal — no service proxy)

Files are stored on the local filesystem and tracked in the `files` table.

**List files:**
```
GET /api/v1/files?page=1&pageSize=50&sort=createdAt&order=desc

→ SQL: SELECT * FROM files
       WHERE user_id = $1
       ORDER BY {sort_column} {order}
       LIMIT $2 OFFSET $3

Response: PaginatedResponse<UserFile>
```

**Get file detail:**
```
GET /api/v1/files/:id

→ SQL: SELECT * FROM files WHERE id = $1 AND user_id = $2

Response: UserFile
```

**Download file:**
```
GET /api/v1/files/:id/download

→ SQL: look up storage_path
→ Stream file from disk with Content-Disposition: attachment

Response: binary, streamed
```

**Delete file:**
```
DELETE /api/v1/files/:id

→ SQL: look up storage_path
→ Delete from disk
→ SQL: DELETE FROM files WHERE id = $1 AND user_id = $2

Response: 204 No Content
```

**Reclassify file:**
```
POST /api/v1/files/:id/reclassify

Body: { "service": "photos" }

→ Read file from disk
→ Upload to target service (same logic as drop zone confirmation)
→ Delete from files table and disk on success

Response: 200 { "service": "photos", "status": "routed" }
```

### 9.8 Drop Zone (Classify → Upload)

Classification happens **in the frontend** before any upload. The browser's `File` object
provides `name`, `type` (MIME), and `size` — enough for a confident first-pass classification
using filename extension, MIME type, and file size heuristics. The user reviews and
confirms/overrides the suggested destination, then the file uploads directly to its target
service — no double-hop through temp storage.

**Frontend classification heuristics** (implemented in `@steadfirm/shared`):
```
Extension .jpg/.jpeg/.heic/.png/.webp/.raw/.dng/.cr2/.arw  → photos  (0.95)
Extension .mp4/.mov + size < 500MB                          → photos  (0.90)
Extension .mp4/.mkv/.avi/.mov + size >= 500MB               → media   (0.80)
Extension .m4b                                              → audiobooks (0.95)
Extension .mp3/.flac/.ogg/.aac + MIME audio/*               → media   (0.85)
Extension .pdf/.docx/.doc/.xlsx/.xls/.odt                   → documents (0.90)
MIME image/*                                                → photos  (0.90)
MIME video/*                                                → media   (0.75)
MIME audio/* + name matches audiobook patterns               → audiobooks (0.80)
Everything else                                             → files   (1.0)
```

These rules live in `@steadfirm/shared/validation.ts` so they can be reused by the Tauri app.
No server round-trip needed.

**Upload file (per-file, after user confirms destination):**
```
POST /api/v1/upload
Content-Type: multipart/form-data

Multipart fields:
  file:     binary (required) — the file data
  service:  string (required) — confirmed destination: "photos"|"media"|"documents"|"audiobooks"|"files"
  filename: string (required) — original filename

Processing by service:
  photos     → POST {immich}/api/assets
               Multipart: assetData={file}, deviceAssetId=uuid, deviceId="steadfirm",
               fileCreatedAt=now, fileModifiedAt=now, filename={filename}
               Headers: x-api-key: {user_immich_key}

  media      → Save to Jellyfin library folder:
               /data/steadfirm/media/{user_id}/Movies/{filename}
               (future: TMDb lookup for proper folder naming)
               Trigger library scan: POST {jellyfin}/Library/Refresh

  documents  → POST {paperless}/api/documents/post_document/
               Multipart: document={file}, title={filename_without_ext}
               Headers: Authorization: Token {user_paperless_token}

  audiobooks → Save to Audiobookshelf library folder:
               /data/steadfirm/audiobooks/{user_id}/{filename}
               Trigger library scan: POST {abs}/api/libraries/{libId}/scan

  files      → Save to: {files_storage_path}/{user_id}/{uuid}_{filename}
               INSERT INTO files (user_id, filename, mime_type, size_bytes, storage_path)

Response: 200
{
    "status": "routed",
    "service": "photos",
    "filename": "IMG_4021.heic"
}

Error: 400 if service not provisioned, 502 if upstream service rejects the upload.
```

The frontend sends one `POST /api/v1/upload` per file. Files can be uploaded in parallel
(the frontend controls concurrency — e.g., 3 concurrent uploads). Each request includes the
file data and the confirmed destination, so the backend routes it directly. Per-file upload
progress is tracked via the browser's fetch/XMLHttpRequest progress events.

### 9.9 Admin — User Provisioning

```
POST /api/v1/admin/provision

Auth: required (must be an admin user — check a flag, or for v1, any authenticated user)

Body: {
    "userId": "betterauth_user_id"  // optional, defaults to current user
}

Processing:
1. Read user details from BetterAuth `user` table

2. Create Immich user:
   POST {immich}/api/admin/users
   Headers: x-api-key: {admin_key}
   Body: { email: user.email, name: user.name, password: generated_password }
   → immich_user_id

   POST {immich}/api/auth/login
   Body: { email: user.email, password: generated_password }
   → access_token

   POST {immich}/api/api-keys
   Headers: Authorization: Bearer {access_token}
   Body: { name: "steadfirm", permissions: ["all"] }
   → api_key_secret

3. Create Jellyfin user:
   POST {jellyfin}/Users/New
   Headers: Authorization: MediaBrowser ... Token="{admin_token}"
   Body: { Name: user.name, Password: generated_password }
   → jellyfin_user_id

   POST {jellyfin}/Users/{id}/Policy
   Body: { IsHidden: true, EnableMediaPlayback: true, ... }

   POST {jellyfin}/Users/AuthenticateByName
   Body: { Username: user.name, Pw: generated_password }
   → access_token

4. Create Paperless user:
   POST {paperless}/api/users/
   Headers: Authorization: Token {admin_token}
   Body: { username: user.email, password: generated_password, email: user.email }
   → paperless_user_id

   POST {paperless}/api/token/
   Body: { username: user.email, password: generated_password }
   → token

5. Create Audiobookshelf user:
   POST {abs}/api/users
   Headers: Authorization: Bearer {admin_token}
   Body: { username: user.name, password: generated_password, type: "user" }
   → abs_user_id

   POST {abs}/api/login
   Body: { username: user.name, password: generated_password }
   → token

6. Store all credentials:
   INSERT INTO service_connections (user_id, service, service_user_id, api_key)
   VALUES
     ($user_id, 'immich', $immich_user_id, $api_key_secret),
     ($user_id, 'jellyfin', $jellyfin_user_id, $access_token),
     ($user_id, 'paperless', $paperless_user_id, $token),
     ($user_id, 'audiobookshelf', $abs_user_id, $token);

Response: 200
{
    "userId": "betterauth_user_id",
    "services": {
        "immich": { "status": "provisioned", "userId": "..." },
        "jellyfin": { "status": "provisioned", "userId": "..." },
        "paperless": { "status": "provisioned", "userId": "..." },
        "audiobookshelf": { "status": "provisioned", "userId": "..." }
    }
}

Errors: if any service fails, report partial success:
{
    "userId": "...",
    "services": {
        "immich": { "status": "provisioned", "userId": "..." },
        "jellyfin": { "status": "failed", "error": "connection refused" },
        ...
    }
}
```

Password generation: use a random 32-character alphanumeric string. These passwords are never shown to the user — only the API keys/tokens are stored. The passwords exist solely to satisfy the services' user creation requirements.

---

## 10. Error Handling

### AppError Variants

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("upstream error: {service} returned {status}")]
    UpstreamError {
        service: String,
        status: u16,
        message: String,
    },

    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
```

### Status Code Mapping

| AppError variant | HTTP status | When |
|---|---|---|
| `Unauthorized` | 401 | Invalid/expired session token |
| `BadRequest` | 400 | Malformed request params |
| `NotFound` | 404 | Resource not found (or upstream 404) |
| `ServiceUnavailable` | 503 | User not provisioned for service, or service unreachable |
| `UpstreamError` | Pass through | Map upstream status: 403→403, 404→404, 5xx→502 |
| `Internal` | 500 | Unexpected errors |

### Upstream Error Propagation

When a service returns an error:
- **404**: Return `AppError::NotFound` (resource doesn't exist in that service)
- **401/403**: Log a warning (credentials may have expired), return `AppError::ServiceUnavailable` with a message suggesting reprovisioning
- **429**: Return 429 to client (rate limit)
- **5xx**: Return `502 Bad Gateway` (upstream service is broken, not our fault)
- **Connection refused / timeout**: Return `AppError::ServiceUnavailable`

### Response Format

All errors return JSON:
```json
{
    "error": "not_found",
    "message": "Photo not found"
}
```

The `error` field is a machine-readable snake_case code. The `message` field is human-readable.

---

## 11. Database Schema

### BetterAuth Tables (read-only from backend)

```sql
-- user (id TEXT PK, name TEXT, email TEXT, emailVerified BOOL, image TEXT,
--        createdAt TIMESTAMPTZ, updatedAt TIMESTAMPTZ)
-- session (id TEXT PK, expiresAt TIMESTAMPTZ, token TEXT, createdAt TIMESTAMPTZ,
--          updatedAt TIMESTAMPTZ, ipAddress TEXT, userAgent TEXT, userId TEXT FK)
-- account (id TEXT PK, accountId TEXT, providerId TEXT, userId TEXT FK, ...)
-- verification (id TEXT PK, identifier TEXT, value TEXT, expiresAt TIMESTAMPTZ, ...)
```

### Steadfirm Tables

```sql
CREATE TABLE service_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,        -- references BetterAuth user.id
    service         TEXT NOT NULL,        -- 'immich', 'jellyfin', 'paperless', 'audiobookshelf'
    service_user_id TEXT NOT NULL,        -- user ID within the service
    api_key         TEXT NOT NULL,        -- service API key/token (encrypted at rest in future)
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, service)
);

CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_connections_user_id ON service_connections(user_id);
CREATE INDEX idx_files_user_id ON files(user_id);
```

### Future Tables (add via migrations when needed)

```sql
-- Pending uploads (drop zone staging)
CREATE TABLE pending_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,        -- temp path
    suggested_service TEXT NOT NULL,
    confidence      REAL NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL  -- auto-cleanup after 24h
);

CREATE INDEX idx_pending_uploads_user_id ON pending_uploads(user_id);
```

---

## 12. Caching Strategy

### Paperless Name Resolution Cache

Correspondents and tags are referenced by ID in document responses but the frontend needs names. Cache these per-user in an in-memory map with a 5-minute TTL:

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

struct NameCache {
    correspondents: HashMap<u64, String>,   // id → name
    tags: HashMap<u64, TagInfo>,            // id → { name, color }
    fetched_at: Instant,
}

// Keyed by user_id in AppState
type PerUserCache = Arc<RwLock<HashMap<String, NameCache>>>;
```

Refresh on cache miss (a returned ID isn't in cache) or after TTL expires.

### No Other Caching in v1

Don't cache service responses, thumbnails, or assets. The services handle their own caching, and adding a cache layer introduces staleness bugs. If performance becomes an issue, add targeted caching later.

---

## 13. Implementation Order

Follow the SPEC.md milestones but in this implementation sequence within M1 and M2:

### M1: Infrastructure + Auth (complete the foundation)

1. **Auth extractor** — `AuthUser` extractor with session validation + credential loading
2. **`GET /api/v1/users/me`** — first real authenticated endpoint, proves the auth chain works
3. **Service clients** — `ImmichClient`, `JellyfinClient`, `PaperlessClient`, `AudiobookshelfClient` with auth header injection and health check methods
4. **Provisioning endpoint** — `POST /api/v1/admin/provision` creates users across all services and stores credentials
5. **Binary proxy utility** — `proxy_binary()` and `proxy_stream()` functions

### M2: Backend API Proxy (endpoint by endpoint)

6. **Photos** — list, detail, thumbnail, original, video stream, favorite toggle
7. **Documents** — list, detail, thumbnail, preview, download, tags
8. **Media** — movies list/detail, shows/seasons/episodes, music artists/albums/tracks, images, streaming
9. **Audiobooks** — list, detail, cover, playback sessions, progress sync, bookmarks
10. **Files** — list, detail, download, delete, reclassify

### M3: Drop Zone

11. **Upload** — multipart receive, temp storage, MIME detection, classification
12. **Confirm** — route files to services or local storage

Each step should be buildable, testable with curl, and demoable before moving to the next.
