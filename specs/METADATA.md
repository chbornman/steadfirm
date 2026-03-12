# Metadata Enrichment Specification

> Authoritative reference for Steadfirm's metadata enrichment system — how metadata is extracted, looked up, applied, and kept in sync across backing services.

---

## Table of Contents

1. [Overview](#overview)
2. [Design Principles](#design-principles)
3. [Architecture](#architecture)
4. [Service Metadata Setup](#service-metadata-setup)
5. [Enrichment Jobs](#enrichment-jobs)
6. [Per-Service Enrichment](#per-service-enrichment)
7. [Pre-Upload Enrichment (Drop Zone)](#pre-upload-enrichment-drop-zone)
8. [Post-Upload Enrichment (Native Refresh)](#post-upload-enrichment-native-refresh)
9. [API Surface](#api-surface)
10. [Job Queue & Scheduling](#job-queue--scheduling)
11. [Configuration](#configuration)
12. [Frontend Integration](#frontend-integration)

---

## Overview

Steadfirm takes a **hybrid approach** to metadata enrichment: extract what we can before upload to give backing services a head start, then lean on each service's native metadata capabilities for refinement. Critically, enrichment is modeled as **standalone jobs** — not as a step fused into the upload pipeline. Jobs can be triggered on first upload, manually by a user for specific items, or in bulk across a library.

### Why Hybrid?

Each backing service has mature metadata infrastructure that we don't want to replicate:

| Service | Native Capability | What Steadfirm Adds |
| --- | --- | --- |
| Immich | EXIF extraction, face recognition, CLIP search, reverse geocoding | Nothing — Immich handles photos/videos comprehensively on ingest |
| Jellyfin | TMDb, OMDb, TheTVDB, AniDB, fanart.tv, local .nfo | Pre-upload file renaming/structuring so Jellyfin's scanner identifies content correctly |
| Audiobookshelf | Audible, Google Books, Open Library, iTunes | ffprobe metadata extraction → folder naming so ABS auto-populates on scan |
| Kavita | ComicInfo.xml, OPF parsing; AniList via Kavita+ | Nothing at ingest — metadata lives in the files. External tools (Komf, ComicTagger) handle pre-tagging |
| Paperless-ngx | OCR, auto-tagging, correspondent detection, ASN | Filename-derived tag/correspondent suggestions passed as upload metadata |

The guiding rule: **if the service already does it well, don't duplicate it — just make sure content arrives in a form the service can work with.**

---

## Design Principles

1. **Jobs, not pipeline steps.** Enrichment is a discrete, re-runnable operation. It is not welded to the upload flow. A user can enrich a single item, a batch, or trigger a library-wide refresh at any time.

2. **Native-first.** Each service has its own metadata provider ecosystem. Steadfirm's role is to (a) prepare files so native providers succeed on first scan, and (b) expose native refresh/match actions through our unified UI.

3. **Idempotent and non-destructive.** Running an enrichment job twice produces the same result. Jobs never delete user-set metadata — they fill gaps and offer suggestions.

4. **User confirms destructive changes.** Auto-enrichment on upload fills empty fields silently. Overwriting existing metadata (e.g. re-matching a misidentified movie) always requires user confirmation.

5. **Steadfirm stores minimal metadata.** Rich metadata lives in the backing services. Steadfirm's database stores only what's needed for the unified UI: display titles, thumbnails (cached), and search index entries. This avoids dual-source-of-truth drift.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Steadfirm Backend                        │
│                                                              │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐  │
│  │ Drop Zone   │───▶│ Enrichment Jobs  │───▶│ Service    │  │
│  │ (classify)  │    │                  │    │ Clients    │  │
│  └─────────────┘    │  ┌────────────┐  │    │            │  │
│                     │  │ Extractors │  │    │ • Immich   │  │
│  ┌─────────────┐    │  │ • ffprobe  │  │    │ • Jellyfin │  │
│  │ User Action │───▶│  │ • EXIF     │  │    │ • ABS      │  │
│  │ (manual     │    │  │ • filename │  │    │ • Kavita   │  │
│  │  refresh)   │    │  └────────────┘  │    │ • Paperless│  │
│  └─────────────┘    │                  │    └────────────┘  │
│                     │  ┌────────────┐  │                    │
│  ┌─────────────┐    │  │ Providers  │  │    ┌────────────┐  │
│  │ Scheduled   │───▶│  │ • TMDb     │  │    │ PostgreSQL │  │
│  │ Job         │    │  │ • Audible  │  │    │ (job queue │  │
│  └─────────────┘    │  │ • OMDb     │  │    │  + status) │  │
│                     │  └────────────┘  │    └────────────┘  │
│                     └──────────────────┘                    │
└──────────────────────────────────────────────────────────────┘
```

Three triggers, one system:

- **Drop Zone** — automatic on upload. Extracts what's available from the file itself and uses it to structure the upload so the service's own scanner succeeds.
- **User Action** — manual. User selects one or more items in the UI and says "refresh metadata" or "match." Steadfirm proxies to the service's native match/refresh API.
- **Scheduled Job** — periodic. Optional background task that triggers native library scans or checks for unmatched items.

---

## Service Metadata Setup

Each backing service has its own metadata provider ecosystem that must be configured before Steadfirm's enrichment system can work. Some services accept configuration via environment variables; others require programmatic setup via their admin APIs after first boot. This section documents exactly what each service needs and when/how Steadfirm provisions it.

### Setup Timing

```
Docker Compose Up
    │
    ▼
Services start with env vars (Paperless OCR, Immich ML, etc.)
    │
    ▼
Steadfirm backend starts, runs migrations
    │
    ▼
User provisioning (POST /api/v1/admin/provision)
    │
    ├─ Creates service accounts (already specified in ARCHITECTURE.md)
    │
    └─ Runs metadata setup for each service ◄── NEW
        ├─ Jellyfin: create libraries with metadata providers enabled
        ├─ ABS: create library with preferred metadata provider
        ├─ Kavita: create libraries with correct types
        ├─ Paperless: matching rules exist at instance level (no per-user setup)
        └─ Immich: no setup needed (ML pipeline runs automatically)
```

Metadata setup is **idempotent** — it can be called multiple times safely (e.g. on backend restart). It checks for existing configuration before creating new resources.

---

### Immich (Photos & Videos)

#### Infrastructure (Docker Compose)

Immich's metadata pipeline is the most hands-off. The ML container handles everything automatically on asset ingest.

**Required containers:**
- `immich-server` — main API server
- `immich-machine-learning` — runs CLIP, facial recognition, and object detection

**Current docker-compose.yml status:** Both containers are present and running. The ML cache volume is mounted at `/cache` for model persistence.

**Environment variables to add:**

| Variable | Value | Purpose |
| --- | --- | --- |
| `TZ` | `${TZ:-UTC}` | Correct EXIF timestamp interpretation |

**ML pipeline (runs automatically on ingest):**

| Feature | Model/Provider | Configurable? | Default |
| --- | --- | --- | --- |
| Smart Search (CLIP) | `ViT-B-32__openai` | Yes, via admin UI | On by default |
| Facial Recognition | `buffalo_l` | Yes, via admin UI | On by default |
| Reverse Geocoding | Embedded GeoNames dataset | No | On by default |
| OCR (text in images) | Built-in | Yes, via admin UI | On by default |
| Object Detection | CLIP-derived | No separate config | On by default |

**Programmatic setup required: None.**

Immich's ML features are all enabled by default. No API calls needed during provisioning. The admin can optionally upgrade the CLIP model (e.g. to `ViT-L-16-SigLIP2-256__webli` for better search quality) via the admin UI at `Administration > Settings > Machine Learning Settings > Smart Search`.

**Per-user setup:** Immich creates a user-scoped environment automatically. No per-user metadata configuration needed — all ML features apply to all users equally.

---

### Jellyfin (Media — Movies, TV, Music)

#### Infrastructure (Docker Compose)

Jellyfin is the **least auto-configured** service. TMDb, OMDb, and other metadata providers are configured through the admin dashboard or XML config files — not environment variables.

**Environment variables to add:**

| Variable | Value | Purpose |
| --- | --- | --- |
| `TZ` | `${TZ:-UTC}` | Correct metadata date handling |
| `JELLYFIN_PublishedServerUrl` | `http://jellyfin:8096` | URL generation behind proxy |

**Metadata providers (built-in, no API key needed):**

| Provider | Content Type | Requires API Key? | Notes |
| --- | --- | --- | --- |
| TMDb | Movies, TV | No (built-in) | Default provider, ships with Jellyfin |
| OMDb | Movies, TV | Yes (free tier) | English-only, optional supplement |
| Local .nfo files | Any | No | Reads sidecar XML files alongside media |

TMDb is available out of the box with no API key required — Jellyfin bundles its own access. OMDb requires a free API key from omdbapi.com if desired.

**Plugins (optional, installed via admin UI or API):**

| Plugin | Purpose | Auto-install? |
| --- | --- | --- |
| TheTVDB | TV show metadata (alternative to TMDb) | No — manual install |
| fanart.tv | Additional artwork (logos, banners, clearart) | No — manual install |
| AniDB / AniList / Kitsu | Anime metadata | No — manual install |
| TMDb Box Sets | Auto-create movie collections from TMDb | No — manual install |

For v1, Steadfirm does **not** auto-install Jellyfin plugins. TMDb (built-in) is sufficient.

#### Programmatic Setup (During User Provisioning)

When a user is provisioned, Steadfirm creates per-user Jellyfin libraries pointing to the user's media directories. These libraries must be configured with the correct content type so Jellyfin's scanner knows which metadata providers to use.

**Library creation via Jellyfin API:**

```
POST /Library/VirtualFolders/Add?name={name}&collectionType={type}&refreshLibrary=false
Content-Type: application/json

{
    "LibraryOptions": {
        "EnableArchiveMediaFiles": false,
        "EnablePhotos": false,
        "EnableRealtimeMonitor": true,
        "EnableChapterImageExtraction": false,
        "ExtractChapterImagesDuringLibraryScan": false,
        "EnableInternetProviders": true,
        "SaveLocalMetadata": false,
        "EnableAutomaticSeriesGrouping": true,
        "PreferredMetadataLanguage": "en",
        "MetadataCountryCode": "US",
        "PathInfos": [
            { "Path": "/media/{user_id}/Movies" }
        ],
        "TypeOptions": [
            {
                "Type": "Movie",
                "MetadataFetchers": ["TheMovieDb"],
                "ImageFetchers": ["TheMovieDb"]
            }
        ]
    }
}
```

**Libraries to create per user:**

| Library Name | `collectionType` | Path | Metadata Fetchers |
| --- | --- | --- | --- |
| Movies | `movies` | `/media/{user_id}/Movies` | `TheMovieDb` |
| TV Shows | `tvshows` | `/media/{user_id}/Shows` | `TheMovieDb` |
| Music | `music` | `/media/{user_id}/Music` | (default audio providers) |

**Post-creation:** Trigger a library scan via `POST /Library/Refresh` to start metadata fetching.

**Scanner settings** (configured at the library level):

| Setting | Value | Why |
| --- | --- | --- |
| `EnableRealtimeMonitor` | `true` | Detect new files added by Steadfirm's upload pipeline |
| `EnableInternetProviders` | `true` | Enable TMDb lookups on scan |
| `SaveLocalMetadata` | `false` | Don't write .nfo sidecar files (Steadfirm manages the filesystem) |
| `PreferredMetadataLanguage` | `en` | Default; user-configurable in future |
| `MetadataCountryCode` | `US` | Default; user-configurable in future |

---

### Audiobookshelf (Audiobooks)

#### Infrastructure (Docker Compose)

ABS has almost no environment-variable-based metadata configuration. Everything is set via the admin UI or API.

**Environment variables to add:**

| Variable | Value | Purpose |
| --- | --- | --- |
| `TZ` | `${TZ:-UTC}` | Correct timestamp handling |

**Server settings (configured via API after first boot):**

ABS exposes server settings that affect metadata behavior globally. These are read from the login response (`serverSettings` object) and updated via `PATCH /api/settings`:

| Setting | Value | Purpose |
| --- | --- | --- |
| `scannerFindCovers` | `true` | Fetch cover art from metadata providers during scan |
| `scannerCoverProvider` | `"audible"` | Default cover image source |
| `scannerParseSubtitle` | `false` | Don't split subtitle from title |
| `scannerPreferMatchedMetadata` | `true` | Prefer provider metadata over folder-derived metadata after a match |
| `storeCoverWithItem` | `true` | Save cover images alongside audio files |
| `storeMetadataWithItem` | `false` | Don't write metadata JSON files to the library folder |

#### Programmatic Setup (During User Provisioning)

**Library creation via ABS API:**

```
POST /api/libraries
Authorization: Bearer {admin_token}

{
    "name": "Audiobooks",
    "folders": [{ "fullPath": "/audiobooks/{user_id}" }],
    "icon": "audiobookshelf",
    "mediaType": "book",
    "provider": "audible",
    "settings": {
        "coverAspectRatio": 1,
        "disableWatcher": false,
        "skipMatchingMediaWithAsin": false,
        "skipMatchingMediaWithIsbn": false,
        "autoScanCronExpression": null
    }
}
```

**Key library settings:**

| Setting | Value | Why |
| --- | --- | --- |
| `provider` | `"audible"` | Default metadata provider for matching |
| `disableWatcher` | `false` | Watch for new files added by Steadfirm |
| `skipMatchingMediaWithAsin` | `false` | Allow re-matching even if ASIN is set |
| `skipMatchingMediaWithIsbn` | `false` | Allow re-matching even if ISBN is set |
| `autoScanCronExpression` | `null` | No auto-scan — Steadfirm triggers scans explicitly after upload |

**Metadata providers available in ABS:**

| Provider | Content | API Key? | Notes |
| --- | --- | --- | --- |
| `audible` | Audiobooks | No (built-in) | Title, author, narrator, cover, ASIN, description, genres |
| `google` | Books | No (built-in) | Title, author, cover, ISBN, description |
| `openlibrary` | Books | No (built-in) | Title, author, cover, ISBN |
| `itunes` | Podcasts | No (built-in) | Podcast title, author, cover, episode list |
| `fantlab` | Books (Russian) | No (built-in) | Russian-language book metadata |

All providers are built-in — no API keys needed. The `provider` field on the library sets the default, but users can pick any provider when doing a manual match.

**Match endpoints (for post-upload enrichment):**

| Endpoint | Purpose |
| --- | --- |
| `POST /api/items/{id}/match` | Match a single item — accepts `{ title, author, provider }`, applies result |
| `GET /api/search/books?title=X&author=Y&provider=audible` | Search without applying — returns candidates |
| `GET /api/search/covers?title=X&author=Y&provider=audible` | Search for cover images only |
| `POST /api/libraries/{id}/matchall` | Bulk match all unmatched items in a library |
| `POST /api/items/{id}/scan` | Re-scan a single item (re-reads folder structure + ID3 tags) |

---

### Kavita (Reading — Ebooks, Comics, Manga)

#### Infrastructure (Docker Compose)

Kavita has minimal environment-variable configuration. Library types and scanner behavior are all API/UI configured.

**Current environment variables:** `TZ=UTC` (already set).

**Library types** — the most important Kavita configuration decision:

| Type | Use Case | Metadata Source | Kavita+ Features |
| --- | --- | --- | --- |
| `Manga` | Manga, webtoons | ComicInfo.xml, filename parsing | Metadata, Scrobbling, Reviews, Recommendations |
| `Comic` | Western comics (strict ComicVine adherence) | ComicInfo.xml | Metadata |
| `Comic (Flexible)` | Western comics (flexible grouping) | ComicInfo.xml, filename parsing | Metadata |
| `Book` | General ebooks | OPF, filename parsing | — |
| `Light Novels` | Japanese light novels | OPF, filename parsing | Metadata, Scrobbling, Reviews, Recommendations |
| `Image` | Loose image folders | Folder structure | Metadata |

#### Programmatic Setup (During User Provisioning)

**Library creation via Kavita API:**

```
POST /api/Library
Authorization: ...

{
    "name": "Manga",
    "type": 2,
    "folders": ["/books/{user_id}/manga"],
    "folderWatching": true,
    "includeInDashboard": true,
    "includeInSearch": true,
    "manageCollections": true,
    "manageReadingLists": true,
    "allowScrobbling": true,
    "collapseSeriesRelationships": false
}
```

**Libraries to create per user:**

| Library Name | Type | Type ID | Path | Notes |
| --- | --- | --- | --- | --- |
| Manga | Manga | `2` | `/books/{user_id}/manga` | Manga + webtoons |
| Comics | Comic (Flexible) | `8` | `/books/{user_id}/comics` | Western comics with flexible grouping |
| Books | Book | `4` | `/books/{user_id}/books` | General ebooks (EPUB, PDF) |

**Why multiple libraries?** Kavita's library type controls how the scanner parses filenames and groups series. A single "Reading" library would force all content into one parsing mode. Separating by type ensures correct parsing for each format.

**Alternative (simpler v1):** Create a single library of type `Comic (Flexible)` that handles both comics and manga. Add a separate `Book` library for ebooks. This reduces provisioning complexity at the cost of slightly less optimal manga parsing.

**Scanner behavior** (configured at library level):

| Setting | Value | Why |
| --- | --- | --- |
| `folderWatching` | `true` | Detect files added by Steadfirm's upload pipeline |
| `manageCollections` | `true` | Create collections from `SeriesGroup` tags in ComicInfo.xml |
| `manageReadingLists` | `true` | Create reading lists from `StoryArc` tags |
| `allowScrobbling` | `true` | Enable Kavita+ scrobbling if user has a license |

**Metadata flow:**
1. Steadfirm uploads files to `/books/{user_id}/{type}/` with correct folder structure
2. Kavita's folder watcher detects new files (triggers after ~10 minute delay)
3. Alternatively, Steadfirm triggers `POST /api/Library/scan` immediately after upload
4. Kavita's scanner reads embedded metadata (ComicInfo.xml, OPF) and filename patterns
5. If the user has Kavita+ configured, AniList matching runs automatically

**Kavita+ integration:**

Kavita+ is a paid subscription tied to the Kavita instance, not to Steadfirm. If the Steadfirm admin wants Kavita+ features:

1. Purchase a Kavita+ license at kavitareader.com
2. Enter the license key in Kavita's admin settings (via Kavita UI, not Steadfirm)
3. Kavita+ features (AniList metadata, scrobbling, recommendations) become available to all Kavita users on that instance

Steadfirm does **not** manage Kavita+ licensing or configuration. It is an optional enhancement the admin sets up independently.

---

### Paperless-ngx (Documents)

#### Infrastructure (Docker Compose)

Paperless is the **best-configured** service for metadata out of the box. OCR and document conversion are already set up.

**Current environment variables (metadata-relevant):**

| Variable | Value | Purpose |
| --- | --- | --- |
| `PAPERLESS_OCR_LANGUAGE` | `eng` | Tesseract OCR language |
| `PAPERLESS_TIKA_ENABLED` | `1` | Enable Office document conversion |
| `PAPERLESS_TIKA_ENDPOINT` | `http://tika:9998` | Apache Tika for docx/xlsx/pptx/odt |
| `PAPERLESS_TIKA_GOTENBERG_ENDPOINT` | `http://gotenberg:3000` | Gotenberg for Office → PDF conversion |

**Supporting containers (already present):**
- `gotenberg:8.21.0` — converts Office documents to PDF for OCR
- `tika:3.1.0.0` — extracts text from Office documents

**Environment variables to add:**

| Variable | Value | Purpose |
| --- | --- | --- |
| `PAPERLESS_TIME_ZONE` | `${TZ:-UTC}` | Correct document date handling |
| `PAPERLESS_CONSUMER_RECURSIVE` | `true` | Watch subdirectories in consume folder |
| `PAPERLESS_FILENAME_FORMAT` | `{created_year}/{correspondent}/{title}` | Organize stored documents by year/correspondent |
| `PAPERLESS_FILENAME_FORMAT_REMOVE_NONE` | `true` | Skip empty placeholders in filename format |
| `PAPERLESS_OCR_MODE` | `skip` | Only OCR pages without existing text (default, explicit) |

**Optional (consider for future):**

| Variable | Value | Purpose |
| --- | --- | --- |
| `PAPERLESS_OCR_LANGUAGES` | `eng deu fra spa` | Install additional Tesseract language packs (Docker only) |
| `PAPERLESS_ENABLE_NLTK` | `true` | Natural Language Toolkit for improved auto-classification |

#### Programmatic Setup (During User Provisioning)

Paperless operates at the **instance level** — it does not have per-user libraries like Jellyfin, ABS, or Kavita. Each user gets their own Paperless account, and document ownership is tracked per-user, but configuration (tags, correspondents, document types, matching rules) is shared across the instance.

**No per-user metadata setup needed during provisioning.** The Paperless user account creation (already implemented) is sufficient.

**Instance-level setup (one-time, done by admin or automated on first boot):**

Paperless has a powerful matching system for auto-tagging. Steadfirm can pre-create useful tags and matching rules:

```
POST /api/tags/
Authorization: Token {admin_token}

{
    "name": "Invoice",
    "matching_algorithm": 1,
    "match": "invoice,bill,receipt,statement",
    "is_insensitive": true
}
```

**Recommended default tags to create:**

| Tag | Match Pattern | Algorithm | Purpose |
| --- | --- | --- | --- |
| Invoice | `invoice,bill,receipt,statement` | Any (1) | Financial documents |
| Tax | `tax,w2,1099,1040` | Any (1) | Tax documents |
| Medical | `medical,health,prescription,insurance` | Any (1) | Health records |
| Contract | `contract,agreement,lease` | Any (1) | Legal documents |

These are **suggestions only** — the admin can customize or remove them. Paperless's own auto-matching will learn from user corrections over time.

**Matching algorithms in Paperless:**

| ID | Name | Behavior |
| --- | --- | --- |
| 1 | Any | Match if any word in the pattern appears in the document |
| 2 | All | Match if all words appear |
| 3 | Exact | Match if the exact string appears |
| 4 | Regular expression | Match against a regex |
| 5 | Fuzzy | Match with fuzzy string matching |
| 6 | Auto | Machine learning classifier (trains over time) |

**Auto-classification:** Paperless includes a built-in ML classifier (algorithm 6) that trains on user-assigned tags. Once a user has ~20 tagged documents, Paperless can start auto-suggesting tags for new documents. This happens automatically — no Steadfirm intervention needed.

**Metadata flow:**
1. Steadfirm uploads document via `POST /api/documents/post_document/` with optional `title`, `tags[]`, `correspondent` fields
2. Paperless queues the document for processing
3. Gotenberg/Tika converts Office formats to PDF (if needed)
4. Tesseract OCR extracts text
5. Paperless's matching engine applies tag/correspondent rules
6. ML classifier suggests additional tags (if trained)
7. Document is searchable via full-text search

---

### Setup Summary

| Service | Env Vars | API Provisioning | Libraries Per User | Metadata Providers |
| --- | --- | --- | --- | --- |
| **Immich** | Add `TZ` | None needed | N/A (user-scoped automatically) | Built-in ML (CLIP, faces, geocoding) |
| **Jellyfin** | Add `TZ`, `PublishedServerUrl` | Create 3 libraries (Movies, Shows, Music) with TMDb enabled | Yes (3) | TMDb (built-in, no key) |
| **ABS** | Add `TZ` | Create 1 library, configure server scanner settings | Yes (1) | Audible, Google Books, OpenLibrary (built-in) |
| **Kavita** | `TZ` already set | Create 2-3 libraries with correct types | Yes (2-3) | Embedded metadata (free), AniList (Kavita+ paid) |
| **Paperless** | Add `TZ`, filename format, consumer settings | Optional: pre-create default tags/matching rules | N/A (instance-level) | OCR + ML classifier (built-in) |

---

## Enrichment Jobs

An enrichment job is the core unit of work. Every metadata operation — whether triggered by upload, user action, or schedule — creates a job.

### Job Model

```sql
CREATE TABLE enrichment_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES "user"(id),
    job_type    TEXT NOT NULL,       -- 'pre_upload' | 'native_refresh' | 'native_match'
    service     TEXT NOT NULL,       -- 'media' | 'audiobooks' | 'reading' | 'documents' | 'photos'
    target_id   TEXT,                -- service-specific item ID (NULL for batch/library-wide)
    target_ids  JSONB,              -- array of IDs for multi-item jobs
    status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    input       JSONB,              -- job-specific parameters (search query, provider preference, etc.)
    result      JSONB,              -- job output (matched metadata, errors, skipped items)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error       TEXT
);

CREATE INDEX idx_enrichment_jobs_user_status ON enrichment_jobs(user_id, status);
CREATE INDEX idx_enrichment_jobs_service ON enrichment_jobs(service, status);
```

### Job Types

| Type | Trigger | What It Does |
| --- | --- | --- |
| `pre_upload` | Drop zone, before file is sent to service | Extracts metadata from the file, structures folder/filename for the service |
| `native_refresh` | User action or schedule | Calls the service's own "refresh metadata" / "scan library" API |
| `native_match` | User action | Calls the service's own "match" / "identify" API with a search query |

### Job Lifecycle

```
pending → running → completed
                  → failed (with error message, retryable)
pending → cancelled (user cancelled before execution)
```

Jobs are **retryable**. A failed job can be re-queued. The `input` field contains everything needed to replay the job.

---

## Per-Service Enrichment

### Photos (Immich)

**Pre-upload enrichment: None.**

Immich's ingest pipeline is comprehensive — EXIF extraction, GPS reverse geocoding, face detection, object recognition, CLIP embedding. Steadfirm adds nothing here. Files are uploaded as-is via `POST /api/assets`.

**Native refresh:** Immich handles this automatically on ingest. No manual "refresh metadata" action is needed in v1.

**What Steadfirm does at upload time:**
- Pass through `deviceAssetId`, `deviceId`, `fileCreatedAt`, `fileModifiedAt` from the original file timestamps so Immich places the asset correctly on the timeline.
- If the user uploaded a folder, use the folder name as the album name via `POST /api/albums` → `PUT /api/albums/{id}/assets`.

### Media (Jellyfin)

**Pre-upload enrichment: File structuring.**

Jellyfin's scanner relies heavily on correct folder structure and naming conventions to match against TMDb/TVDB. Steadfirm's pre-upload job ensures files land in the right shape.

| Media Type | Expected Structure | What Steadfirm Does |
| --- | --- | --- |
| Movie | `Movies/Title (Year)/Title (Year).ext` | Parse title + year from filename/classification, create folder |
| TV Show | `Shows/Title/Season XX/Title - S##E## - Episode.ext` | Parse show/season/episode from filename patterns |
| Music | `Music/Artist/Album/## - Track.ext` | Extract from ID3/Vorbis tags via ffprobe |

**Extraction sources (pre-upload):**
- Filename parsing (year, resolution, source tags, S##E## patterns — already implemented in `classify.rs`)
- ffprobe for music files (ID3/Vorbis tags: artist, album, track number, year, genre)
- Video container metadata (title tag, if present)

**Native refresh:**
- `POST /Library/Refresh` — triggers Jellyfin's full library scan, which runs all configured metadata providers (TMDb, OMDb, etc.)
- Per-item: Jellyfin doesn't expose a single-item "re-identify" via API cleanly, but `POST /Items/{id}/Refresh` forces a metadata refresh for one item.

**Native match (user-initiated):**
- Steadfirm does **not** replicate TMDb/TVDB lookup. Instead, if a movie/show is misidentified, the user triggers a refresh through our UI, which calls Jellyfin's refresh API.
- Future consideration: expose Jellyfin's `GET /Items/RemoteSearch/{type}` for manual search-and-pick, proxied through Steadfirm's UI.

### Audiobooks (Audiobookshelf)

**Pre-upload enrichment: Folder naming from ffprobe.**

ABS parses folder structure to populate title, author, series, and narrator. Steadfirm's existing ffprobe extraction (already implemented) provides these fields. The pre-upload job uses extracted metadata to create the correct folder structure:

```
Author Name/
  Series Name/
    Book ## - Title {Narrator}/
      Chapter 01.mp3
      Chapter 02.mp3
      cover.jpg
```

**Extraction sources (pre-upload):**
- ffprobe ID3 tags: `artist`/`album-artist` → author, `album`/`title` → title, `composer` → narrator, `series`/`mvnm` → series, `series-part`/`mvin` → sequence
- Filename patterns (already parsed in `classify.rs`)
- LLM classification output (provides `audiobook_metadata` with title, author, series)

**Native refresh:**
- `POST /api/libraries/{id}/scan` — triggers ABS library scan (already implemented as `scan_library()`)
- ABS auto-matches on scan if "Auto Scan" is enabled in library settings

**Native match (user-initiated):**
- `POST /api/items/{id}/match` — ABS's built-in match endpoint. Accepts a search query and provider preference (Audible, Google Books, Open Library, iTunes).
- `GET /api/search/books?title=X&author=Y&provider=audible` — search without applying results.
- Steadfirm proxies these through the gateway, presenting results in our UI for user confirmation.

**Quick Match (bulk):**
- `POST /api/libraries/{id}/matchall` — ABS matches all unmatched items in a library.
- Surfaced in Steadfirm as a "Match All Unmatched" action.

### Reading (Kavita)

**Pre-upload enrichment: Minimal.**

Kavita reads metadata from inside the files themselves — `ComicInfo.xml` embedded in CBZ/CBR archives, `.opf` metadata in EPUBs. Steadfirm doesn't modify file contents. The pre-upload job only ensures correct folder structure:

```
Library Root/
  Series Name/
    Series Name Vol 01.cbz
    Series Name Ch 001.cbz
```

**Extraction sources (pre-upload):**
- Filename parsing for series name, volume/chapter numbers (already handled by classification)
- No file-content extraction — embedded metadata is the source of truth for Kavita

**Native refresh:**
- `POST /api/Library/scan` — triggers Kavita's library scan (already implemented as `scan_library()`)
- Kavita re-reads embedded metadata on each scan

**Native match (Kavita+ only):**
- Kavita+ subscribers get AniList matching via the Kavita+ service. This is managed entirely within Kavita's own UI/settings.
- Steadfirm does **not** proxy Kavita+ metadata matching — it's a paid service tied to the Kavita instance's license. Users who want this configure it in Kavita directly.
- For free users: external tools like **Komf** or **ComicTagger** can be recommended in the UI (documentation/help text) but are outside Steadfirm's scope.

### Documents (Paperless-ngx)

**Pre-upload enrichment: Tag and correspondent suggestions.**

Paperless-ngx has powerful post-ingest processing (OCR, auto-tagging, correspondent detection). Steadfirm adds lightweight pre-upload hints derived from the filename and folder structure.

**What Steadfirm extracts:**
- **Tags** from filename keywords and folder names (e.g. `invoices/2024-03-acme.pdf` → tags: `invoice`, `2024`, folder: `invoices`)
- **Correspondent** from filename patterns (e.g. `acme-corp-invoice.pdf` → correspondent suggestion: `Acme Corp`)
- **Title** cleaned from filename (strip date prefixes, extensions, underscores → spaces)

**How it's applied:**
- Paperless `POST /api/documents/post_document/` accepts `tags`, `correspondent`, and `title` fields in the multipart upload.
- Steadfirm passes suggestions as upload metadata. Paperless may override via its own matching rules — that's fine and expected.

**Native refresh:**
- Paperless doesn't have a "re-process" API for existing documents in the same way. Re-uploading triggers new OCR.
- Tag and correspondent rules in Paperless run automatically on ingest.
- No periodic scan needed — Paperless processes on upload.

---

## Pre-Upload Enrichment (Drop Zone)

Pre-upload enrichment runs after classification but before files are sent to the backing service. It is **automatic but fast** — no external API calls, only local extraction.

### What Happens

```
Files → Classification → Pre-Upload Enrichment → User Confirmation → Upload to Service
                              │
                              ├─ ffprobe (audio files → ID3 tags)
                              ├─ Filename parsing (already done in classification)
                              ├─ Folder structure generation (service-specific naming)
                              └─ Tag/correspondent suggestion (documents)
```

### Rules

1. **No external API calls during pre-upload.** No TMDb lookups, no Audible searches. These are slow, rate-limited, and the service will do them itself.
2. **Extract from the file itself.** ffprobe for audio, EXIF headers for images (if Immich doesn't handle it), filename patterns for everything.
3. **Generate upload structure.** The primary output is a correctly-named folder structure that the service's scanner will recognize.
4. **Surface extracted metadata to the user.** The drop zone UI shows what was extracted so the user can correct it before upload.

### Pre-Upload Data Flow

The enrichment result is attached to the classification response so the frontend can display and edit it before confirming the upload:

```rust
pub struct PreUploadEnrichment {
    /// Extracted metadata fields (title, author, year, etc.)
    pub extracted: HashMap<String, String>,
    /// Suggested folder path within the service's storage
    pub suggested_path: String,
    /// Suggested tags (documents only)
    pub suggested_tags: Vec<String>,
    /// Suggested correspondent (documents only)
    pub suggested_correspondent: Option<String>,
    /// Confidence in the extraction (0.0–1.0)
    pub confidence: f64,
}
```

---

## Post-Upload Enrichment (Native Refresh)

After upload, the backing service takes over. Steadfirm exposes the service's own metadata operations through a unified interface.

### Actions Available Per Service

| Action | Immich | Jellyfin | ABS | Kavita | Paperless |
| --- | --- | --- | --- | --- | --- |
| **Refresh item** | Auto on ingest | `POST /Items/{id}/Refresh` | `POST /api/libraries/{id}/scan` | `POST /api/Library/scan` | Auto on ingest |
| **Match/identify item** | N/A | `POST /Items/RemoteSearch/{type}` | `POST /api/items/{id}/match` | Kavita+ only | N/A |
| **Bulk match** | N/A | Library refresh | `POST /api/libraries/{id}/matchall` | Library scan | N/A |
| **Search providers** | N/A | TMDb, OMDb, TVDB | Audible, Google Books, OpenLibrary | AniList (K+) | N/A |
| **Update metadata** | `PUT /api/assets/{id}` | `POST /Items/{id}` | `PATCH /api/items/{id}/media` | Locked field system | `PATCH /api/documents/{id}/` |

### Native Refresh Flow

```
User selects item(s) → "Refresh Metadata" action
    │
    ▼
Steadfirm creates enrichment_job (type: native_refresh)
    │
    ▼
Backend calls service's native refresh API
    │
    ▼
Job marked completed (service handles async processing internally)
```

### Native Match Flow (Interactive)

```
User selects item → "Match" action → enters search query (or uses existing title)
    │
    ▼
Steadfirm creates enrichment_job (type: native_match)
    │
    ▼
Backend calls service's search/match API → returns candidates
    │
    ▼
User picks correct match from list
    │
    ▼
Backend applies selected match via service API
    │
    ▼
Job marked completed with result
```

---

## API Surface

### Enrichment Endpoints

```
POST   /api/v1/metadata/enrich           -- Create an enrichment job (single or batch)
GET    /api/v1/metadata/jobs              -- List jobs for current user (filterable by status, service)
GET    /api/v1/metadata/jobs/:id          -- Get job status and result
POST   /api/v1/metadata/jobs/:id/retry    -- Retry a failed job
DELETE /api/v1/metadata/jobs/:id          -- Cancel a pending job
```

### Enrich Request

```json
{
  "service": "audiobooks",
  "action": "native_match",
  "target_id": "abs-item-uuid",
  "params": {
    "query": "Project Hail Mary",
    "author": "Andy Weir",
    "provider": "audible"
  }
}
```

```json
{
  "service": "media",
  "action": "native_refresh",
  "target_ids": ["jellyfin-item-1", "jellyfin-item-2"]
}
```

```json
{
  "service": "audiobooks",
  "action": "native_match",
  "target_id": "abs-item-uuid",
  "params": {
    "provider": "audible"
  }
}
```

### Enrich Response (Match — returns candidates)

```json
{
  "job_id": "uuid",
  "status": "completed",
  "candidates": [
    {
      "provider": "audible",
      "title": "Project Hail Mary",
      "author": "Andy Weir",
      "narrator": "Ray Porter",
      "year": 2021,
      "cover_url": "https://...",
      "provider_id": "B08GB58KD5",
      "match_confidence": 0.95
    }
  ]
}
```

### Apply Match

```
POST /api/v1/metadata/apply
```

```json
{
  "job_id": "uuid",
  "service": "audiobooks",
  "target_id": "abs-item-uuid",
  "selected_candidate_index": 0
}
```

This calls the service's native apply/update API with the selected match.

### Service-Specific Proxy Endpoints

For services with rich match APIs, Steadfirm also exposes thin proxies so the frontend can drive the interaction:

```
GET  /api/v1/audiobooks/:id/match?q=...&provider=audible    -- proxy to ABS match search
POST /api/v1/audiobooks/:id/match                           -- apply ABS match
POST /api/v1/media/:id/refresh                              -- proxy to Jellyfin item refresh
GET  /api/v1/media/:id/remote-search?type=movie&q=...       -- proxy to Jellyfin remote search
POST /api/v1/media/library/refresh                          -- proxy to Jellyfin library refresh
POST /api/v1/audiobooks/library/scan                        -- proxy to ABS library scan
POST /api/v1/audiobooks/library/match-all                   -- proxy to ABS bulk match
POST /api/v1/reading/library/scan                           -- proxy to Kavita library scan
```

---

## Job Queue & Scheduling

### Implementation

Use **PostgreSQL-backed job queue** (via `apalis` with `apalis-sql` or a simple custom implementation). Jobs are rows in the `enrichment_jobs` table, polled by a background worker.

Why not Redis/in-memory: jobs must survive restarts, and the job table doubles as an audit log the user can inspect.

### Worker Behavior

- Single worker thread processing jobs sequentially per service (avoid hammering a single service with concurrent requests).
- Configurable concurrency per service type (e.g. allow 2 concurrent Jellyfin refreshes but only 1 ABS match).
- Jobs expire after a configurable timeout (default: 5 minutes for match, 30 minutes for library scan).

### Scheduled Jobs (Optional)

Users can enable periodic enrichment via settings:

| Schedule | What It Does |
| --- | --- |
| Jellyfin library scan | Triggers `POST /Library/Refresh` on a cron schedule |
| ABS library scan | Triggers `POST /api/libraries/{id}/scan` |
| Kavita library scan | Triggers `POST /api/Library/scan` |

These are opt-in. Default is off — services have their own scan schedules, and doubling up is wasteful unless the user is adding files outside Steadfirm.

---

## Configuration

### config.rs additions

```rust
/// Metadata enrichment configuration
pub metadata_enrichment_enabled: bool,       // default: true
pub metadata_job_timeout_secs: u64,          // default: 300 (5 min)
pub metadata_library_scan_timeout_secs: u64, // default: 1800 (30 min)
pub metadata_max_concurrent_jobs: usize,     // default: 2
```

### constants.rs additions

```rust
/// Maximum number of match candidates to return from a provider search
pub const METADATA_MAX_CANDIDATES: usize = 10;

/// Maximum number of items in a single batch enrichment job
pub const METADATA_MAX_BATCH_SIZE: usize = 100;

/// Default ffprobe timeout for audio metadata extraction (seconds)
pub const METADATA_PROBE_TIMEOUT_SECS: u64 = 30;
```

---

## Frontend Integration

### Drop Zone (Pre-Upload)

The classification response already includes group metadata (title, author, year, etc. from filename parsing and ffprobe). The pre-upload enrichment extends this with:

- Editable metadata fields shown in the confirmation step
- Suggested folder structure preview
- "This is what we'll tell [Service] about your files" transparency

No new UI patterns needed — the existing drop zone confirmation step gains richer metadata display.

### Item Detail Views

Each service's item detail page gains a **"Metadata" action menu**:

- **Refresh** — triggers a `native_refresh` job. Shows a brief "Refreshing..." indicator.
- **Match** (where supported) — opens a search dialog. User types a query, sees candidates, picks one. Calls `native_match` then `apply`.
- **View enrichment history** — shows past jobs for this item (optional, lower priority).

### Bulk Actions

Library/collection views support multi-select with:

- **Refresh Selected** — creates a batch `native_refresh` job
- **Match All Unmatched** (ABS only) — triggers ABS bulk match

### Job Status

A lightweight notification/toast system shows job progress:

- "Refreshing metadata for 5 items..." → "Done — 5 items updated"
- "Matching 'Project Hail Mary'..." → "Found 3 candidates" → opens picker
- Failed jobs show an error with a retry option

---

## What Steadfirm Does NOT Do

To be explicit about scope:

1. **No metadata database.** Steadfirm does not maintain its own copy of item metadata. The backing services are the source of truth. The `enrichment_jobs` table tracks operations, not content metadata.

2. **No provider API keys.** Steadfirm does not hold TMDb, Audible, or MusicBrainz API keys. All provider lookups go through the backing service's own integration.

3. **No file content modification.** Steadfirm never writes ComicInfo.xml into CBZ files, embeds ID3 tags, or modifies uploaded content. Files go to services as-is (or with correct naming/structure).

4. **No Kavita+ proxy.** Kavita+ metadata matching is a paid service between the user and Kavita. Steadfirm doesn't intermediate this.

5. **No duplicate detection.** Deduplication is a separate concern (tracked in TODO.md). Metadata enrichment assumes items are already correctly placed.
