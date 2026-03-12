# Backend Refactor Plan

## Core Principle

Steadfirm is **aggregation software**. The underlying services (Immich, Jellyfin, Audiobookshelf, Kavita, Paperless-ngx) do the real work — storage, playback, OCR, metadata providers, readers. Steadfirm's backend is a thin orchestration layer on top.

The backend has two layers:

1. **Services layer** — dumb HTTP clients. One per backing service. They know how to call an API and return the response. No business logic.
2. **Functions layer** — smart high-level features. Each function is a user-facing capability (classify, upload, browse, search, metadata) that orchestrates across services and optionally uses LLMs for intelligent input.

## High-Level Features

These are the **features Steadfirm provides** — each one is a first-class module:

| Feature      | What it does                                        | LLM role                                         |
|------------- |---------------------------------------------------- |------------------------------------------------- |
| **Classify** | Determine which service a file belongs to           | Disambiguate files heuristics can't resolve       |
| **Upload**   | Put files into the right service with correct shape | Folder naming, metadata prep for brand media      |
| **Browse**   | Show what's in each service through a unified UI    | None (pure proxy)                                 |
| **Search**   | Find content across all services at once            | Decompose natural language → per-service queries  |
| **Metadata** | Enrich/correct metadata after upload                | Suggest matches, generate descriptions, tag       |

Each feature has **per-service implementations** because every service has a different API, different expectations, and different capabilities. But the feature module owns the orchestration and the LLM integration.

## The Features × Services Matrix

```
              Photos   Media    Audiobooks  Documents  Reading   Files
              (Immich) (Jelly)  (ABS)       (Paper)    (Kavita)  (Postgres)
─────────────────────────────────────────────────────────────────────────────
classify      ext→svc  ext→svc  ext→svc     ext→svc    ext→svc   catchall
upload        API      fs+scan  API         API        fs+scan   fs+DB
browse        proxy    proxy    proxy       proxy      proxy     DB query
search        CLIP     text     text        full-text  text      ILIKE
metadata      n/a*     refresh  match       tags       refresh   n/a
─────────────────────────────────────────────────────────────────────────────

* Photos are personal media — no metadata enrichment needed.
```

Each cell is a small, focused file. The architecture makes this matrix **visible in the file tree**.

### How LLMs fit in

LLMs are a **tool available to any feature**, not a feature themselves. The `services/ai.rs` client provides the LLM connection; feature modules decide when and how to use it:

- **Classify**: LLM disambiguates files that heuristics score below threshold (PDFs, ambiguous audio). Extracts structured metadata (title, year, series, season/episode) for group detection.
- **Upload**: LLM could suggest proper folder names for brand media (e.g., "this looks like Season 2 of Breaking Bad"), prep metadata fields before upload so service-native providers match correctly.
- **Search**: LLM decomposes natural language queries into per-service structured queries with filters (dates, types, progress). "photos from last summer of the beach" → Immich CLIP query with date filter.
- **Metadata**: LLM could suggest metadata corrections, generate descriptions, identify unmatched items. "This movie file looks like The Matrix (1999)" → trigger Jellyfin identify.

The point is: the LLM is always in service of a specific feature's goal, not a standalone thing.

## Growth Model

The architecture must support three dimensions of growth without requiring surgery on existing code:

### 1. New features (new `functions/` directories)

Future features we'll likely add:
- **`sync/`** — bidirectional sync between local device and services (Tauri app offline support)
- **`share/`** — sharing links, album collaboration, multi-user access to media
- **`organize/`** — bulk operations: move between services, merge duplicates, auto-tag
- **`notify/`** — activity feed: new content detected, processing complete, metadata matched
- **`import/`** — bulk import from external sources (Google Photos, Plex, Calibre)

Each one follows the same pattern: one directory, per-service files, optional LLM integration, one `router()` function, one line in `routes/mod.rs`.

### 2. New services (new file per feature + new service client)

If we add a service (e.g., Navidrome for dedicated music, Komga as Kavita alternative):
- Add `services/navidrome.rs` — HTTP client
- Add one file in each relevant feature module
- Register in each `mod.rs`

No existing feature code changes.

### 3. Deeper service integration (more endpoints in existing features)

This is the most common growth path. Today we proxy a fraction of each service's API. Over time, the frontend will incorporate more and more of each service's capabilities:

- **Jellyfin**: user preferences, watch history, subtitle management, library management, collections, playlists, live TV, scheduled tasks
- **Immich**: albums, shared links, face recognition, map view, memories, partner sharing, trash management
- **Audiobookshelf**: podcast support, collections, RSS feeds, listening statistics, batch metadata editing
- **Kavita**: reading lists, bookmarks, collections, reading settings, user preferences, OPDS
- **Paperless**: custom fields, saved views, workflows, mail rules, storage paths
- **Kavita + ABS**: granular progress tracking, cross-device sync

This growth happens naturally: the per-service browse file gets more handlers, the service client gets more methods. Each service file stays focused on one service, so adding 10 new Jellyfin endpoints doesn't touch Immich code. If a per-service file grows too large (500+ lines), it can split into a sub-directory (e.g., `browse/media/` with `movies.rs`, `shows.rs`, `music.rs`).

## Current Problem

The current codebase mixes concerns:

- **`routes/classify.rs` (2298 lines)**: heuristic classifiers + LLM pipeline + SSE streaming + 5 group detectors + 4 filename parsers + ffprobe endpoint + AI provider endpoints. One file doing 7 different jobs.
- **`routes/search.rs` (844 lines)**: SSE orchestrator + 6 per-service search implementations + LLM query compiler + formatting helpers. All jammed together.
- **`routes/dropzone.rs` (746 lines)**: multipart parsing repeated 4 times + per-service upload logic in one big match + 3 specialized upload endpoints.
- **Browse files (photos/media/documents/audiobooks/reading/files)**: Already clean (200-555 lines each), but they live in `routes/` alongside classify/search/upload which makes the structure confusing.

The `routes/` directory has 16 files with no organizational principle — some are per-service (photos.rs), some are per-function (classify.rs), some are mixed (dropzone.rs).

## Target Architecture

```
crates/backend/src/
├── main.rs                 — server startup, app assembly
├── config.rs               — env-based configuration
├── constants.rs            — named constants (no magic numbers)
├── error.rs                — AppError type
├── models.rs               — response models (Photo, Movie, etc.)
├── pagination.rs           — pagination helpers
├── proxy.rs                — binary response proxying
├── middleware.rs            — request ID middleware
│
├── auth/                   — session validation (unchanged)
│   └── mod.rs
│
├── services/               — thin HTTP clients per service (unchanged)
│   ├── mod.rs
│   ├── ai.rs               — LLM client (classify + search)
│   ├── immich.rs            — Immich HTTP client
│   ├── jellyfin.rs          — Jellyfin HTTP client
│   ├── audiobookshelf.rs    — ABS HTTP client
│   ├── kavita.rs            — Kavita HTTP client
│   ├── paperless.rs         — Paperless HTTP client
│   └── ffprobe.rs           — ffprobe subprocess
│
├── provision/              — user provisioning (extracted from provisioning.rs + startup.rs)
│   ├── mod.rs              — ProvisioningService
│   └── startup.rs          — service initialization on boot
│
├── routes/                 — THIN: only Router assembly + handler fn signatures
│   ├── mod.rs              — api_router() nesting all sub-routers
│   ├── admin.rs            — admin endpoints (unchanged, already thin)
│   ├── hooks.rs            — webhook endpoints (unchanged, already thin)
│   └── users.rs            — user endpoints (unchanged, already thin)
│
└── functions/              — BUSINESS LOGIC organized by what Steadfirm does
    │
    ├── mod.rs              — pub mod for each function
    │
    ├── classify/           — "What service does this file belong to?"
    │   ├── mod.rs          — router(), re-exports
    │   ├── heuristics.rs   — extension/MIME heuristic classifier
    │   ├── parsers.rs      — filename parsing: S##E##, movie names, series names, title folders
    │   ├── llm.rs          — LLM result parsing, service mapping, LlmMetadataMap
    │   ├── stream.rs       — POST /classify/stream — SSE streaming endpoint
    │   ├── json.rs         — POST /classify — JSON endpoint (backwards compat)
    │   ├── probe.rs        — POST /classify/probe — ffprobe for audiobook files
    │   ├── provider.rs     — GET/PUT /classify/provider — AI provider switching
    │   └── groups/         — group detectors (one per service that has groupable content)
    │       ├── mod.rs      — build_all_groups(), AllGroups type
    │       ├── audiobooks.rs  — detect_audiobook_groups()
    │       ├── tv_shows.rs    — detect_tv_show_groups()
    │       ├── movies.rs      — detect_movie_groups()
    │       ├── music.rs       — detect_music_groups()
    │       └── reading.rs     — detect_reading_groups()
    │
    ├── upload/             — "Put this file into the right service"
    │   ├── mod.rs          — router(), shared multipart helpers
    │   ├── photos.rs       — Immich asset upload (API multipart)
    │   ├── media.rs        — Jellyfin media upload (fs write + library refresh)
    │   ├── audiobooks.rs   — ABS book upload (API multipart)
    │   ├── documents.rs    — Paperless document upload (API multipart)
    │   ├── reading.rs      — Kavita reading upload (fs write + library scan)
    │   └── files.rs        — Steadfirm files catchall (fs + Postgres)
    │
    ├── browse/             — "Show me what's in this service"
    │   ├── mod.rs          — router(), re-exports
    │   ├── photos.rs       — Immich browse/view/stream (moved from routes/photos.rs)
    │   ├── media.rs        — Jellyfin browse/view/stream (moved from routes/media.rs)
    │   ├── audiobooks.rs   — ABS browse/play/progress (moved from routes/audiobooks.rs)
    │   ├── documents.rs    — Paperless browse/preview/download (moved from routes/documents.rs)
    │   ├── reading.rs      — Kavita browse/read/progress (moved from routes/reading.rs)
    │   └── files.rs        — Steadfirm files list/download/delete (moved from routes/files.rs)
    │
    ├── search/             — "Find something across all services"
    │   ├── mod.rs          — router(), orchestrator (SSE fan-out)
    │   ├── photos.rs       — Immich CLIP smart search
    │   ├── media.rs        — Jellyfin text search
    │   ├── audiobooks.rs   — ABS text search
    │   ├── documents.rs    — Paperless full-text search
    │   ├── reading.rs      — Kavita text search
    │   ├── files.rs        — Postgres ILIKE search
    │   ├── llm.rs          — LLM query compiler (natural language → structured queries)
    │   └── helpers.rs      — formatting, should_search(), flatten_timeout()
    │
    └── metadata/           — "Enrich this item's metadata" (NEW — stubs for v1)
        ├── mod.rs          — router(), shared types (MetadataRefreshRequest, etc.)
        ├── media.rs        — Jellyfin: trigger library refresh, identify item, search providers
        ├── audiobooks.rs   — ABS: trigger metadata match, update book metadata
        ├── documents.rs    — Paperless: update tags, correspondent, document type
        ├── reading.rs      — Kavita: trigger series refresh, update metadata
        └── files.rs        — Steadfirm: reclassify file to another service
```

## Key Design Rules

### 1. Each function/ module owns its routes

The `classify/mod.rs` defines `pub fn router() -> Router<AppState>` that returns all routes for `/api/v1/classify/*`. Same for upload, browse (each sub-service), search, metadata. The top-level `routes/mod.rs` just nests them.

### 2. Services layer is dumb

`services/` files are **pure HTTP clients** — they know how to call an API endpoint and return the response. No business logic, no response transformation, no routing decisions. They don't know about users, classification, or metadata. They just make HTTP requests.

### 3. Functions layer is smart

`functions/` files contain **all business logic**: deciding what to do, transforming data, orchestrating multi-step flows. They import from `services/` to make the actual calls.

### 4. Per-service files are small and focused

Each per-service file in a function module does exactly ONE thing for ONE service. `upload/photos.rs` knows how to upload to Immich. `search/documents.rs` knows how to search Paperless. Nothing else.

### 5. Adding a new service = add one file per function

If we add a new service (e.g., Navidrome for music), we add:
- `services/navidrome.rs` — HTTP client
- `functions/upload/music.rs` — upload logic
- `functions/browse/music.rs` — browse logic
- `functions/search/music.rs` — search logic
- `functions/metadata/music.rs` — metadata logic
- `functions/classify/groups/music.rs` — group detection
- One line in each `mod.rs` to register it

No existing file needs major surgery. That's extensibility.

### 6. Adding a new feature = add one directory

If we add a new feature (e.g., `sync/` for bidirectional sync), we add:
- `functions/sync/mod.rs` — orchestrator + LLM integration if needed
- `functions/sync/photos.rs`, etc. — per-service sync logic
- One nest in `routes/mod.rs`

### 7. Deeper integration = grow per-service files

As the frontend incorporates more of a service's API, the corresponding per-service files grow. When a browse file exceeds ~500 lines, split it into a sub-directory:

```
functions/browse/media/       — was browse/media.rs
├── mod.rs                    — router() combining sub-routers
├── movies.rs                 — movie endpoints
├── shows.rs                  — TV show endpoints
├── music.rs                  — music endpoints
└── playback.rs               — streaming + progress
```

This is a natural evolution, not a crisis. The per-service boundary stays clean.

### 8. LLM integration is per-feature, not centralized

Each feature module decides if/when/how to use LLMs. The `services/ai.rs` provides the raw LLM client; feature modules bring the prompts and the orchestration. This means:
- `classify/` has its own classification system prompt
- `search/` has its own query compiler prompt
- `metadata/` will have its own metadata suggestion prompt
- Future features bring their own prompts

No shared "LLM orchestrator" — each feature knows its own domain best.

Again, no existing code needs to change.

## Migration Strategy

This is a **move-and-split** refactor, not a rewrite. The code itself is correct — it just needs to be in the right files.

### Phase 1: Extract classify/ (biggest win — 2298 lines → ~8 files)

1. Create `functions/classify/heuristics.rs` — move `heuristic_classify()`, `heuristic_classify_audio()`, `heuristic_classify_video()`
2. Create `functions/classify/parsers.rs` — move `parse_season_episode()`, `parse_movie_name()`, `parse_series_name_from_filename()`, `parse_title_folder()`, `extract_sequence()`, `parse_episode_title()`, `infer_series_name()`, `folder_of()`, `extract_year_from_folder_or_name()`, `infer_reading_series()`, `parse_reading_volume()`
3. Create `functions/classify/llm.rs` — move `LlmMetadataMap` type, `parse_llm_result()`, `parse_service()`, SSE event structs
4. Create `functions/classify/groups/*.rs` — move each `detect_*_groups()` function
5. Create `functions/classify/stream.rs` — move `classify_stream()` handler
6. Create `functions/classify/json.rs` — move `classify()` handler
7. Create `functions/classify/probe.rs` — move `probe_audiobook_files()` handler
8. Create `functions/classify/provider.rs` — move `get_provider()`, `set_provider()` handlers

### Phase 2: Extract search/ (844 lines → ~8 files)

1. Create per-service files — move each `search_*()` function
2. Create `search/llm.rs` — move `SEARCH_SYSTEM_PROMPT`, `run_llm_enhanced_search()`
3. Create `search/helpers.rs` — move `should_search()`, `flatten_timeout()`, formatting fns
4. Create `search/mod.rs` — keep the `search()` SSE orchestrator

### Phase 3: Extract upload/ (746 lines → ~7 files)

1. Create per-service files — extract each match arm from `upload_file()`
2. Move specialized endpoints: `upload_audiobook()` → `upload/audiobooks.rs`, `upload_media()` → `upload/media.rs`, `upload_reading()` → `upload/reading.rs`

### Phase 4: Move browse/ (already clean — just relocate)

Move `routes/photos.rs` → `functions/browse/photos.rs`, etc. These files need minimal changes (just import path updates).

### Phase 5: Create metadata/ (new — stubs only)

Create stub files with router and placeholder handlers for:
- `POST /metadata/media/{id}/refresh` — trigger Jellyfin library refresh
- `POST /metadata/media/{id}/identify` — trigger Jellyfin identify dialog
- `POST /metadata/audiobooks/{id}/match` — trigger ABS metadata match
- `POST /metadata/reading/{id}/refresh` — trigger Kavita series refresh
- `PUT /metadata/documents/{id}` — update Paperless tags/correspondent
- `POST /metadata/files/{id}/reclassify` — move file to another service

### Phase 6: Extract provision/ (medium priority)

Move `provisioning.rs` → `provision/mod.rs` and `startup.rs` → `provision/startup.rs`. Minimal code changes.

### Phase 7: Thin out routes/mod.rs

Replace the current `routes/mod.rs` with a clean router assembly that just imports from `functions/`:

```rust
pub fn api_router() -> Router<AppState> {
    Router::new()
        // Thin routes (stay in routes/)
        .nest("/users", users::router())
        .nest("/admin", admin::router())
        .nest("/hooks", hooks::router())
        // Function modules (all logic in functions/)
        .nest("/classify", crate::functions::classify::router())
        .nest("/upload", crate::functions::upload::router())
        .nest("/photos", crate::functions::browse::photos::router())
        .nest("/media", crate::functions::browse::media::router())
        .nest("/documents", crate::functions::browse::documents::router())
        .nest("/audiobooks", crate::functions::browse::audiobooks::router())
        .nest("/reading", crate::functions::browse::reading::router())
        .nest("/files", crate::functions::browse::files::router())
        .nest("/search", crate::functions::search::router())
        .nest("/metadata", crate::functions::metadata::router())
}
```

## What Gets Deleted

After extraction, these files become empty and are removed:
- `routes/classify.rs` — fully extracted to `functions/classify/`
- `routes/dropzone.rs` — fully extracted to `functions/upload/`
- `routes/search.rs` — fully extracted to `functions/search/`
- `routes/photos.rs` — moved to `functions/browse/photos.rs`
- `routes/media.rs` — moved to `functions/browse/media.rs`
- `routes/documents.rs` — moved to `functions/browse/documents.rs`
- `routes/audiobooks.rs` — moved to `functions/browse/audiobooks.rs`
- `routes/reading.rs` — moved to `functions/browse/reading.rs`
- `routes/files.rs` — moved to `functions/browse/files.rs`
- `routes/proxy.rs` — dead code (superseded by the real service files)
- `provisioning.rs` — moved to `provision/mod.rs`
- `startup.rs` — moved to `provision/startup.rs`

What stays in `routes/`:
- `mod.rs` — thin router assembly
- `admin.rs` — already thin (55 lines)
- `hooks.rs` — already thin (104 lines)
- `users.rs` — already thin (55 lines)

## Verification

After each phase:
1. `cargo check` — compiles
2. `cargo clippy` — no warnings
3. `cargo test` — all pass
4. `cargo fmt --check` — formatted

No behavioral changes. Same endpoints, same request/response shapes, same logic. Just better organized.
