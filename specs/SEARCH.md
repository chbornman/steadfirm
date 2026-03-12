# Search Specification

> Global search across all services — federated fan-out architecture, per-service query translation, SSE streaming results, LLM-enhanced natural language queries, and the unified search UI.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [API](#api)
4. [Fan-Out Execution](#fan-out-execution)
5. [Per-Service Search](#per-service-search)
6. [LLM-Enhanced Search](#llm-enhanced-search)
7. [SSE Streaming Protocol](#sse-streaming-protocol)
8. [Frontend](#frontend)
9. [Per-Page Search](#per-page-search)
10. [Types](#types)
11. [Configuration](#configuration)
12. [Known Gaps & Future Work](#known-gaps--future-work)

---

## Overview

Steadfirm's search is a **federated fan-out** — one query is sent to up to 6 backing services concurrently, results are normalized into a unified format, and streamed back to the client as each service responds.

There is no local search index. All search is delegated to backing services at query time. This keeps the system simple and ensures results are always fresh, at the cost of per-query latency (bounded by the slowest service, with 5-second timeouts).

```
User types "vacation photos"
    │
    ▼
POST /api/v1/search { query: "vacation photos" }
    │
    ▼
Axum spawns concurrent tasks:
    ├─→ Immich:  POST /api/search/smart (CLIP semantic)
    ├─→ Jellyfin: GET /Items?searchTerm=...
    ├─→ Paperless: GET /api/documents/?query=...
    ├─→ Audiobookshelf: GET /api/libraries/{id}/search?q=...
    ├─→ Kavita: GET /api/Search/search?queryString=...
    └─→ Postgres: SELECT ... WHERE filename ILIKE '%...%'
    │
    ▼
Results stream back via SSE as each service responds
```

---

## Architecture

### Two Search Paths

1. **Fast path (always runs):** Literal query text fanned out to all provisioned services immediately. Results stream back within seconds.

2. **Smart path (LLM, optional):** Natural language query decomposed by an LLM into per-service structured queries with optimized filters. Runs concurrently with the fast path. Currently **prepared but not executing** — the system prompt and types exist, but the LLM call is a no-op that logs the prepared request.

The intent is that LLM results would replace or refine fast-path results for the same service (the frontend merges by service key).

### Why Federated, Not Indexed

- **No sync lag** — results are always current
- **No storage overhead** — no duplicate metadata
- **Leverages service-native search** — Immich CLIP embeddings, Paperless full-text OCR, Jellyfin metadata index
- **Tradeoff:** Higher per-query latency; every search hits all services

---

## API

### Endpoint

```
POST /api/v1/search
Content-Type: application/json
Accept: text/event-stream
```

### Request

```json
{
  "query": "vacation photos",
  "services": ["photos", "media"],   // optional — filter to specific services
  "limit": 10                         // optional — per-service result limit
}
```

| Field | Type | Required | Default | Notes |
| ----- | ---- | -------- | ------- | ----- |
| `query` | string | Yes | — | 1–500 characters |
| `services` | string[] | No | All 6 | Filter to specific services |
| `limit` | number | No | 10 | Max results per service |

### Response

Server-Sent Events stream. See [SSE Streaming Protocol](#sse-streaming-protocol).

### Validation

- Empty query → `400 Bad Request`
- Query over `SEARCH_MAX_QUERY_LENGTH` (500) → `400 Bad Request`
- Services without credentials are silently skipped

---

## Fan-Out Execution

```rust
// Pseudocode for the search handler
let mut tasks = JoinSet::new();

for service in [Photos, Media, Documents, Audiobooks, Reading, Files] {
    if should_search(service, &user, &request) {
        tasks.spawn(async {
            timeout(5s, search_service(service, &query, &creds, limit))
        });
    }
}

// Optionally spawn LLM-enhanced search (if AI enabled + query >= 3 words)
if ai_enabled && word_count >= 3 {
    tasks.spawn(async {
        timeout(10s, run_llm_enhanced_search(&query))
    });
}

// Stream results as each task completes
while let Some(result) = tasks.join_next().await {
    tx.send(SSE::event("results", result));
}
tx.send(SSE::event("done", summary));
```

### Timeout Strategy

| Target | Timeout | Rationale |
| ------ | ------- | --------- |
| Per-service search | 5 seconds | Most service searches return in <1s; 5s is generous |
| LLM-enhanced search | 10 seconds | LLM response + re-querying takes longer |
| SSE keep-alive | 15 seconds | Prevents proxy/browser timeouts |

### Service Eligibility

A service is searched if:
1. The user didn't filter it out via the `services` field
2. The user has active credentials for that service (except `files`, which uses Postgres directly)

---

## Per-Service Search

### Photos (Immich)

| API | `POST /api/search/smart` |
| --- | --- |
| Auth | `x-api-key: {user_api_key}` |
| Query | `{ query, page: 1, size: limit }` |
| Search type | **CLIP semantic search** — finds photos by visual/conceptual similarity, not just text matching |

**Result mapping:**
- `title` → original filename
- `subtitle` → date + type indicator (e.g., "Mar 15, 2024 - Video")
- `imageUrl` → `/api/v1/photos/{id}/thumbnail`
- `route` → `/photos` (navigates to photos page)

### Media (Jellyfin)

| API | `GET /Items` |
| --- | --- |
| Auth | MediaBrowser token header |
| Query | `searchTerm={query}`, `IncludeItemTypes=Movie,Series,Audio,MusicAlbum`, `Limit={limit}`, `Recursive=true` |
| Search type | **Text search** on titles and metadata |

**Result mapping by type:**
- **Movie:** route → `/media/movies/{id}`
- **Series:** route → `/media/shows/{id}`
- **Audio/MusicAlbum:** route → `/media/music`
- `imageUrl` → `/api/v1/media/items/{id}/image` (Jellyfin primary image)
- `subtitle` → year, or "Movie"/"Series"/"Music" label

### Documents (Paperless-ngx)

| API | `GET /api/documents/?query={query}` |
| --- | --- |
| Auth | `Token {user_token}` |
| Query | `query` param triggers Paperless full-text search (OCR content + metadata) |
| Search type | **Full-text search** across document content and metadata |

**Result mapping:**
- `title` → document title (or original filename)
- `subtitle` → correspondent + date, or just date
- `imageUrl` → `/api/v1/documents/{id}/thumbnail`
- `route` → `/documents/{id}`

### Audiobooks (Audiobookshelf)

| API | `GET /api/libraries/{library_id}/search?q={query}&limit={limit}` |
| --- | --- |
| Auth | `Bearer {user_token}` |
| Query | Searches within the user's first library |
| Search type | **Text search** on title, author, narrator |

**Result mapping:**
- `title` → book title from `libraryItem.media.metadata.title`
- `subtitle` → author name
- `imageUrl` → `/api/v1/audiobooks/items/{id}/cover`
- `route` → `/audiobooks/{id}`

### Reading (Kavita)

| API | `GET /api/Search/search?queryString={query}` |
| --- | --- |
| Auth | `x-api-key: {user_api_key}` |
| Query | Searches series and chapters |
| Search type | **Text search** on series/title names |

**Result mapping (series):**
- `title` → series name
- `subtitle` → format name (e.g., "EPUB", "PDF", "CBZ")
- `imageUrl` → `/api/v1/reading/series/{id}/cover`
- `route` → `/reading/series/{id}`

**Result mapping (chapters):**
- `title` → chapter title or filename
- `subtitle` → format name
- `route` → `/reading`

**Kavita format IDs:**
| ID | Format |
| -- | ------ |
| 0 | Image |
| 1 | Archive |
| 2 | Unknown |
| 3 | EPUB |
| 4 | PDF |
| 5 | HTML |
| 6 | CBZ |
| 7 | CBR |
| 8 | CB7 |

### Files (Steadfirm Postgres)

| API | Direct Postgres query |
| --- | --- |
| Auth | Session-validated `user_id` |
| Query | `SELECT * FROM files WHERE user_id = $1 AND filename ILIKE '%{query}%' LIMIT {limit}` |
| Search type | **Case-insensitive filename substring match** |

**Result mapping:**
- `title` → filename
- `subtitle` → file size + date
- `route` → `/files`

---

## LLM-Enhanced Search

### Status: Prepared, Not Active

The LLM search path is fully typed and prompted but the `run_llm_enhanced_search()` function currently logs the prepared request and returns empty results. The fast path handles all queries.

### System Prompt

The LLM is instructed to decompose natural language queries into per-service structured queries:

```
You are a search query compiler for Steadfirm.
Decompose the user's natural language query into targeted per-service searches.

Available services:
- photos: CLIP semantic search + metadata filters (date, favorites)
- media: Text search on titles, filter by type (Movie, Series, Audio)
- documents: Full-text search across content and metadata
- audiobooks: Text search on title, author, narrator
- reading: Text search on series/title names
- files: Filename search only
```

### Rules

- Only include services likely to have relevant results
- Convert temporal references to dates (e.g., "last summer" → date range)
- Expand synonyms where useful
- Filter progress if mentioned (e.g., "unfinished books")
- Route visual/conceptual queries to photos (CLIP handles these)

### Output Format

```json
{
  "queries": [
    {
      "service": "photos",
      "query": "beach vacation sunset",
      "filters": {
        "dateAfter": "2024-06-01",
        "dateBefore": "2024-09-01"
      }
    },
    {
      "service": "media",
      "query": "travel documentary",
      "filters": {
        "mediaType": "Movie"
      }
    }
  ]
}
```

### Filter Schema

```typescript
type SearchFilters = {
  dateAfter?: string;    // ISO date
  dateBefore?: string;   // ISO date
  isFavorite?: boolean;
  mediaType?: string;    // "Movie", "Series", "Audio"
  genre?: string;
  tag?: string;
  progressBelow?: number; // 0-1
  progressAbove?: number; // 0-1
}
```

### Trigger Conditions

LLM search is only attempted when:
1. AI classification is enabled (`ai.is_enabled()`)
2. Query has >= `SEARCH_LLM_MIN_QUERY_WORDS` (3) words

---

## SSE Streaming Protocol

### Events

| Event | Payload | When |
| ----- | ------- | ---- |
| `results` | `ServiceSearchResult` | As each service returns results |
| `done` | `SearchComplete` | After all services complete or time out |
| `error` | `{ error: string }` | If the entire search fails |

### `results` Payload

```json
{
  "service": "photos",
  "items": [
    {
      "id": "abc-123",
      "title": "IMG_4521.jpg",
      "subtitle": "Mar 15, 2024",
      "imageUrl": "/api/v1/photos/abc-123/thumbnail",
      "route": "/photos"
    }
  ],
  "total": 47
}
```

### `done` Payload

```json
{
  "totalResults": 23,
  "durationMs": 1250,
  "servicesQueried": ["photos", "media", "documents", "audiobooks", "reading", "files"],
  "servicesFailed": [
    { "service": "audiobooks", "error": "timeout after 5s" }
  ]
}
```

### Keep-Alive

SSE keep-alive comments (`: keep-alive`) are sent every 15 seconds to prevent proxy and browser timeouts.

---

## Frontend

### Search Modal (`web/src/components/SearchModal.tsx`)

A command palette triggered by **Cmd+K** / **Ctrl+K** (or the magnifying glass icon in the header).

**Behavior:**
- Auto-focuses input on open (100ms delay for animation)
- Resets query and results on close
- **Debounced search:** 300ms debounce, minimum 2 characters to trigger
- Results grouped by service with colored icons
- Clicking a result navigates to `item.route` and closes the modal
- ESC closes the modal

**Service Icons & Colors:**

| Service | Icon | Color |
| ------- | ---- | ----- |
| Photos | ImagesSquare | `#3B82F6` (blue) |
| Media | FilmSlate | `#8B5CF6` (purple) |
| Documents | FileText | `#22C55E` (green) |
| Audiobooks | Headphones | `#D97706` (amber) |
| Reading | BookOpenText | `#EC4899` (pink) |
| Files | Folder | `#737373` (gray) |

**Empty States:**
- Idle: "Type to search..."
- No results: "No results for {query}"
- Error: Error message displayed

**Footer:** Shows total result count and duration in milliseconds.

### Search Hook (`web/src/hooks/useSearch.ts`)

```typescript
const { phase, results, allResults, complete, error, search, reset } = useSearch();
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `phase` | `'idle' \| 'searching' \| 'done' \| 'error'` | Current state |
| `results` | `Map<ServiceName, ServiceSearchResult>` | Results keyed by service |
| `allResults` | `ServiceSearchResult[]` | Flat array of all results |
| `complete` | `SearchComplete \| null` | Summary after completion |
| `error` | `string \| null` | Error message if failed |
| `search` | `(query: string) => void` | Trigger a search |
| `reset` | `() => void` | Clear all state |

- Uses `AbortController` to cancel in-flight searches when a new query arrives
- Parses SSE stream via `ReadableStream` + `TextDecoder`
- Merges results by service (replaces if same service key arrives again — supports LLM refinement)

### API Client (`web/src/api/search.ts`)

```typescript
function searchStream(request: SearchRequest): Promise<Response>
```

Uses raw `fetch()` (not `ky`) to get the raw `Response` object for SSE streaming. `credentials: 'include'` sends the session cookie.

---

## Per-Page Search

In addition to global search, the Documents page has its own inline search:

| Page | Component | Backend | Service |
| ---- | --------- | ------- | ------- |
| Documents | `Input.Search` (Ant Design) | `GET /api/v1/documents?query={q}` | Paperless-ngx `query` param |

This passes the search query through to Paperless-ngx's full-text search on the documents list endpoint, separate from the global search modal.

---

## Types

### Rust (`crates/shared/src/search.rs`)

```rust
pub struct SearchRequest {
    pub query: String,
    pub services: Option<Vec<ServiceKind>>,
    pub limit: Option<u32>,
}

pub struct SearchResultItem {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub image_url: Option<String>,
    pub route: String,
}

pub struct ServiceSearchResult {
    pub service: ServiceKind,
    pub items: Vec<SearchResultItem>,
    pub total: u32,
}

pub struct SearchComplete {
    pub total_results: u32,
    pub duration_ms: u64,
    pub services_queried: Vec<ServiceKind>,
    pub services_failed: Vec<ServiceSearchError>,
}
```

### TypeScript (`packages/shared/src/types/search.ts`)

Mirrors the Rust types with camelCase field names.

---

## Configuration

### Constants (`crates/backend/src/constants.rs`)

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `SEARCH_PER_SERVICE_LIMIT` | 10 | Default max results per service |
| `SEARCH_SERVICE_TIMEOUT_SECS` | 5 | Per-service timeout |
| `SEARCH_MAX_QUERY_LENGTH` | 500 | Max query string length |
| `SEARCH_LLM_MAX_TOKENS` | 2048 | LLM response max tokens |
| `SEARCH_LLM_MIN_QUERY_WORDS` | 3 | Min words to trigger LLM path |

### LLM Configuration

Uses the same AI provider configured for file classification (`LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`, etc.). See `specs/UPLOAD.md` for provider configuration.

---

## Known Gaps & Future Work

### Active Gaps

- **LLM search not executing** — the smart path is typed and prompted but `run_llm_enhanced_search()` is a no-op. Fast path covers all queries for now.
- **No search filters in UI** — the `SearchFilters` type supports date ranges, favorites, media type, genre, tags, and progress, but the frontend only sends a plain text query.
- **Files search is basic** — `ILIKE` on filename only. No content search, no metadata, no tags.
- **No search result routing to specific items** — photos route to `/photos` (the page), not to a specific photo. Same for music and files.
- **No pagination** — results are limited to `SEARCH_PER_SERVICE_LIMIT` per service with no "load more."
- **Audiobookshelf searches first library only** — if a user has multiple libraries, only the first is searched.

### Future Considerations

| Enhancement | Description |
| ----------- | ----------- |
| **Local search index** | Periodic background sync into Postgres full-text or Meilisearch. Moves latency from query-time to sync-time. Enables cross-service ranking and unified relevance scoring. |
| **Search result deep-linking** | Route to specific photos, documents, audiobook chapters — not just service landing pages. |
| **Search history** | Track recent queries for quick re-access. |
| **Search suggestions** | Typeahead based on indexed metadata (album names, author names, document titles). |
| **Faceted filtering** | Date ranges, media types, file formats, tags — driven by the existing `SearchFilters` type. |
| **Relevance ranking** | Cross-service result ranking by relevance score (currently results are grouped by service with no inter-service ordering). |
