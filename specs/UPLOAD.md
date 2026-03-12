# Upload & Classification Specification

> Authoritative reference for Steadfirm's file upload pipeline — supported formats, heuristic classification, LLM integration, group detection, and service routing.

---

## Table of Contents

1. [Overview](#overview)
2. [Upload Endpoints](#upload-endpoints)
3. [Classification Pipeline](#classification-pipeline)
4. [Supported File Types by Service](#supported-file-types-by-service)
5. [Heuristic Classification](#heuristic-classification)
6. [LLM Classification](#llm-classification)
7. [Group Detection](#group-detection)
8. [Service Routing](#service-routing)
9. [Storage Layout](#storage-layout)
10. [Configuration](#configuration)
11. [Client-Side Validation](#client-side-validation)
12. [SSE Streaming Protocol](#sse-streaming-protocol)

---

## Overview

Every file uploaded to Steadfirm passes through the **Drop Zone** — a classification pipeline that determines which backing service should own the file. The pipeline operates in three stages:

1. **Heuristic classification** — MIME type, file extension, and filename/path metadata produce a service suggestion with a confidence score (0.0–1.0).
2. **LLM classification** — Files below the confidence threshold (`0.85`) are batched and sent to an LLM for disambiguation.
3. **User confirmation** — The frontend presents all suggestions; the user confirms or overrides each before routing proceeds.

Files that cannot be classified (or that the user declines to route) land in **Files** — Steadfirm's own unclassified storage.

### Service Map

| Service        | Backing Platform   | UI Label         | Purpose                             |
| -------------- | ------------------ | ---------------- | ----------------------------------- |
| `photos`       | Immich             | Personal Media   | Photos and personal video           |
| `media`        | Jellyfin           | Film & TV        | Movies, TV shows, music             |
| `documents`    | Paperless-ngx      | Documents        | Scanned docs, office files, OCR     |
| `audiobooks`   | Audiobookshelf     | Audiobooks       | Audiobooks and podcasts             |
| `reading`      | Kavita             | Reading          | Ebooks, comics, manga               |
| `files`        | Steadfirm (local)  | Files            | Unclassified catchall               |

---

## Upload Endpoints

### Generic Upload

```
POST /api/v1/upload
Content-Type: multipart/form-data
```

Accepts one or more files plus a `service` field. Routes to the appropriate backing service API. Used after classification + user confirmation.

### Specialized Uploads

These endpoints accept richer metadata and handle service-specific folder structures:

| Endpoint                       | Purpose                | Key Fields                                             |
| ------------------------------ | ---------------------- | ------------------------------------------------------ |
| `POST /api/v1/upload/audiobook`| Audiobook batch upload | `title` (required), `author`, `series`, numbered files |
| `POST /api/v1/upload/media`    | Media with structure   | `media_type` (tv_show/movie/music), `title`, `year`, `artist`, `season` |
| `POST /api/v1/upload/reading`  | Reading with series    | `series_name`, files                                   |
| `POST /api/v1/upload/batch`    | Batch multi-file       | Multiple files in one request                          |
| `POST /api/v1/upload/confirm`  | Confirm classification | Confirms routing after classification                  |

### Classification Endpoints

| Endpoint                       | Purpose                          | Method   |
| ------------------------------ | -------------------------------- | -------- |
| `POST /api/v1/classify`        | JSON request/response            | Sync     |
| `POST /api/v1/classify/stream` | SSE streaming classification     | Streaming|
| `POST /api/v1/classify/probe`  | ffprobe audio metadata extraction| Sync     |
| `GET  /api/v1/classify/provider`| Current AI provider info        | Sync     |
| `PUT  /api/v1/classify/provider`| Switch LLM provider at runtime  | Sync     |

### Files Management (Unclassified Storage)

| Endpoint                         | Purpose                          |
| -------------------------------- | -------------------------------- |
| `GET    /api/v1/files`           | Paginated list (sort by name/size/type/date) |
| `GET    /api/v1/files/:id`       | Single file metadata             |
| `GET    /api/v1/files/:id/download` | Stream file with correct Content-Type |
| `DELETE /api/v1/files/:id`       | Delete from disk and database    |
| `POST   /api/v1/files/:id/reclassify` | Re-trigger drop zone (stub) |

### Limits

| Parameter         | Default   | Env Var            |
| ----------------- | --------- | ------------------ |
| Max upload size   | 2 GB      | `MAX_UPLOAD_BYTES` |
| Client-side limit | 10 GB     | —                  |

---

## Classification Pipeline

```
File received
    │
    ▼
MIME type detection (Content-Type header + magic bytes)
    │
    ▼
Metadata extraction
  ├─ Images: EXIF data
  ├─ Audio: ID3 / Vorbis tags via ffprobe (duration, artist, album, genre, track, series)
  ├─ Video: filename parsing (S##E##, year, resolution, source tags)
  └─ PDF: document metadata
    │
    ▼
Heuristic classification → (service, confidence)
    │
    ├─ confidence ≥ 0.85 → return immediately as "heuristic" result
    │
    └─ confidence < 0.85 → batch for LLM classification
                               │
                               ▼
                           LLM classifies using filename, MIME, path context, batch context
                               │
                               ▼
                           Return with ai_classified = true
    │
    ▼
Group detection (audiobook chapters, TV episodes, movie + subs, albums, reading series)
    │
    ▼
Return all results + groups to client
    │
    ▼
User confirms or overrides each suggestion
    │
    ▼
Route to confirmed service API
```

---

## Supported File Types by Service

### Photos (Immich)

| Extension                                    | MIME Pattern   | Confidence | Notes                          |
| -------------------------------------------- | -------------- | ---------- | ------------------------------ |
| jpg, jpeg, heic, png, webp, gif              | `image/*`      | 0.95       | Standard photo formats         |
| raw, dng, cr2, arw, nef, orf                 | `image/*`      | 0.95       | Camera RAW formats             |
| *(any unknown extension with `image/*` MIME)* | `image/*`     | 0.90       | Fallback for image MIME        |
| mp4, mov                                     | `video/*`      | 0.90       | Short duration + phone EXIF    |

**Phone video indicators** (routed to Photos instead of Media):
- Camera-generated filenames: `IMG_*`, `VID_*`, `PXL_*`, `MVI_*`
- Timestamp-based names (e.g., `20240315_143022.mp4`)
- Small/medium file size
- `DCIM` in path
- Short duration

### Media (Jellyfin)

#### Video — Movies

| Extension                                    | Confidence | Detection Method                           |
| -------------------------------------------- | ---------- | ------------------------------------------ |
| mp4, mkv, avi, mov, wmv, webm, flv, m4v, ts | 0.70–0.92  | Scene naming, year, resolution, source tags|

**Movie filename indicators:**
- Year in parentheses: `Movie Name (2024)`
- Resolution tags: `2160p`, `4k`, `uhd`, `1080p`, `1080i`, `720p`, `576p`, `480p`
- Source tags: `bluray`, `blu-ray`, `bdrip`, `brrip`, `remux`, `web-dl`, `webdl`, `webrip`, `web`, `hdtv`, `pdtv`, `dsr`, `dvdrip`, `dvd`, `hdcam`, `cam`, `ts`, `tc`
- Codec tags: `x264`, `x265`, `h264`, `h265`, `hevc`, `avc`, `xvid`, `divx`, `aac`, `ac3`, `dts`, `flac`, `dd5.1`, `7.1`, `5.1`, `atmos`

**Confidence breakdown:**
| Signal                                  | Confidence |
| --------------------------------------- | ---------- |
| Year + resolution/source tags           | 0.88       |
| Year in parentheses alone               | 0.80       |
| Resolution or source tags alone         | 0.70       |
| No clear signals                        | 0.50 (LLM) |

#### Video — TV Shows

| Signal                        | Confidence |
| ----------------------------- | ---------- |
| `S##E##` pattern in filename  | 0.92       |
| "Season" folder in path       | 0.90       |

#### Subtitles (follow associated video)

| Extension              | Notes                    |
| ---------------------- | ------------------------ |
| srt, ass, ssa, sub, idx, vtt | Grouped with their video |

#### Music

| Extension                                              | Confidence | Notes                               |
| ------------------------------------------------------ | ---------- | ----------------------------------- |
| mp3, flac, ogg, opus, aac, wma, wav, m4a, alac, ape, wv | 0.50       | Deferred to audio heuristic + LLM   |

**Music path keywords** (boost confidence toward Media/Music): `music`, `album`, `discography`, `playlist`, `single`, `ep`, `soundtrack`, `ost`

### Documents (Paperless-ngx)

| Extension                                          | Confidence | Notes                     |
| -------------------------------------------------- | ---------- | ------------------------- |
| docx, doc, xlsx, xls, odt, ods, pptx, ppt         | 0.92       | Office documents          |
| txt, rtf, csv                                      | 0.92       | Plain text formats        |
| pdf                                                | **0.50**   | **Ambiguous — LLM decides** (could be Reading) |

**Document indicators for PDF disambiguation:**
- Invoice/receipt/statement naming patterns
- Scan-like naming (`Scan_001`, `IMG_20240315`)
- Business filenames (company names, dates)

### Audiobooks (Audiobookshelf)

| Extension    | Confidence | Notes                     |
| ------------ | ---------- | ------------------------- |
| m4b          | 0.98       | Dedicated audiobook format|
| mp3, m4a, flac, ogg, opus, aac, wma, wav | 0.50–0.92 | Requires audio heuristic  |

**Audio heuristic for audiobook detection:**

| Signal Combination                          | Confidence |
| ------------------------------------------- | ---------- |
| Audiobook keyword + bookish folder structure| 0.92       |
| Audiobook keyword alone                     | 0.88       |
| Chapter numbering + bookish folder          | 0.75       |
| No clear signals                            | 0.50 (LLM) |

**Audiobook filename keywords**: `chapter`, `chap`, `ch`, `part`, `section`, `narrated`, `unabridged`, `abridged`, `audiobook`

**Audiobook minimum duration**: 2700 seconds (45 minutes)

**Bookish folder structure**: 2+ path segments without music keywords (`music`, `album`, `discography`, `playlist`, `single`, `ep`, `soundtrack`, `ost`)

**Supported playback MIME types** (Audiobookshelf): `audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/flac`

### Reading (Kavita)

#### Ebooks

| Extension              | Confidence |
| ---------------------- | ---------- |
| epub, mobi, azw, azw3, fb2 | 0.95  |

#### Comics / Manga

| Extension              | Confidence |
| ---------------------- | ---------- |
| cbz, cbr, cb7, cbt, cba | 0.95     |

**Volume parsing prefixes**: `vol `, `vol. `, `volume `, `v`, `tome `, `tome. `, `issue `, `issue. `, `#`

**Special markers**: `sp`, `special`, `specials`, `oneshot`, `one-shot`

### Files (Steadfirm Local Storage)

Everything that doesn't match the above — or that the user explicitly routes here — is stored in Steadfirm's own file system and tracked in the `files` database table.

| Condition              | Confidence |
| ---------------------- | ---------- |
| No matching heuristic  | 1.0        |

---

## Heuristic Classification

The heuristic classifier runs synchronously and produces instant results. It is implemented in both Rust (server-side, full fidelity) and TypeScript (client-side, simplified preview).

### Decision Tree

```
Extension match?
├─ Image ext (jpg, jpeg, heic, png, webp, gif, raw, dng, cr2, arw, nef, orf)
│   → Photos (0.95)
│
├─ Office ext (docx, doc, xlsx, xls, odt, ods, pptx, ppt, txt, rtf, csv)
│   → Documents (0.92)
│
├─ Ebook ext (epub, mobi, azw, azw3, fb2)
│   → Reading (0.95)
│
├─ Comic ext (cbz, cbr, cb7, cbt, cba)
│   → Reading (0.95)
│
├─ pdf
│   → Documents (0.50) — LLM decides
│
├─ m4b
│   → Audiobooks (0.98)
│
├─ Video ext (mp4, mkv, avi, mov, wmv, webm, flv, m4v, ts)
│   → Video sub-heuristic (see below)
│
├─ Subtitle ext (srt, ass, ssa, sub, idx, vtt)
│   → Video sub-heuristic (see below)
│
├─ Audio ext (mp3, flac, ogg, aac, wma, opus, m4a, wav)
│   → Audio sub-heuristic (see below)
│
├─ MIME starts with image/
│   → Photos (0.90)
│
├─ MIME starts with video/ or audio/
│   → Media (0.50) — LLM decides
│
└─ Anything else
    → Files (1.0)
```

### Video Sub-Heuristic

```
S##E## pattern in filename?         → Media (0.92)
"Season" folder in path?            → Media (0.90)
Year in parens + resolution/source? → Media (0.88)
Year in parentheses?                → Media (0.80)
Resolution or source tags?          → Media (0.70)
None of the above?                  → Media (0.50) — LLM decides
```

### Audio Sub-Heuristic

```
Has audiobook keyword in filename/path?
├─ Yes + bookish folder structure?  → Audiobooks (0.92)
├─ Yes (no bookish folder)?         → Audiobooks (0.88)
└─ No
    Has sequential chapter numbering (leading digits ≥ 2)?
    ├─ Yes + bookish folder?        → Audiobooks (0.75)
    └─ No                           → Media (0.50) — LLM decides
```

### Confidence Threshold

Files with confidence **≥ 0.85** are returned immediately as heuristic results. Files **below 0.85** are batched and sent to the LLM for disambiguation.

---

## LLM Classification

### When It Triggers

The LLM is invoked for files where heuristic confidence falls below `AI_CONFIDENCE_THRESHOLD` (0.85). Common cases:

- **PDF files** (0.50) — could be documents or ebooks
- **Video files** without clear scene naming (0.50–0.80) — could be personal videos (Photos) or movies/shows (Media)
- **Audio files** without clear audiobook signals (0.50) — could be music or audiobook chapters
- **Unknown MIME audio/video** (0.50) — insufficient extension data

### Providers

| Provider       | API Endpoint                  | Auth               | Default Model       |
| -------------- | ----------------------------- | ------------------- | ------------------- |
| `anthropic`    | `https://api.anthropic.com/v1/messages` | `x-api-key` header | `claude-sonnet-4-6` |
| `openai`/`ollama`/`local` | Configurable base URL + `/v1/chat/completions` | Bearer token | `default` |
| `none`/`disabled` | — | — | LLM classification skipped |

### Batch Processing

- Files below the confidence threshold are grouped into batches of up to **50** (`CLASSIFY_BATCH_SIZE`).
- Each batch is sent as a single LLM request with max **16,384 tokens** (`CLASSIFY_MAX_TOKENS`).
- The LLM receives filename, MIME type, size, and relative path for each file in the batch.

### System Prompt Context

The LLM is instructed with these key distinctions:

| Ambiguity               | Key Signals for Resolution                                        |
| ----------------------- | ----------------------------------------------------------------- |
| Movie vs personal video | Scene naming + large size → movie; `IMG_*/VID_*/PXL_*` + DCIM → personal |
| Music vs audiobook      | 3–7 min + artist/album/genre folders → music; long duration + chapter numbering + author folders → audiobook |
| PDF: document vs ebook  | Invoice/receipt/scan naming → document; book title + author + ISBN → reading |
| Comic vs photo album    | CBZ/CBR archive → reading; image folder with DCIM/camera names → photos |

### Response Format

The LLM returns structured JSON per file:

```json
{
  "classifications": [
    {
      "index": 0,
      "service": "documents",
      "confidence": 0.92,
      "reasoning": "PDF with invoice-style naming pattern"
    }
  ]
}
```

For audiobooks, the LLM may also return metadata (title, author, series, narrator).

### JSON Extraction

The backend handles three response formats from the LLM:
1. Plain JSON
2. Markdown-fenced JSON (` ```json ... ``` `)
3. Prose-wrapped JSON (extracts JSON from surrounding text)

---

## Group Detection

After individual classification, the pipeline detects logical groups of related files. Groups inform the frontend UI and drive folder structure creation during routing.

### Audiobook Groups

Files classified as `audiobooks` in the same folder hierarchy are grouped by Author → Series → Title.

| Field            | Source                                             |
| ---------------- | -------------------------------------------------- |
| `title`          | Folder name or ffprobe metadata                    |
| `author`         | Parent folder or ID3 `artist`/`album_artist` tag   |
| `series`         | Grandparent folder or ID3 `series`/`mvnm` tag      |
| `series_sequence` | ID3 `series-part`/`mvin` tag                      |
| `narrator`       | ID3 `composer` tag (convention)                    |
| `year`           | ID3 `year`/`date` tag                              |
| `cover_index`    | Detected cover image in same folder                |
| `probe_data`     | ffprobe duration + tag data per file               |

**Cover image detection**: Files with extensions `jpg`, `jpeg`, `png`, `webp` whose stem contains `cover`, `folder`, or `front`.

### TV Show Groups

| Field            | Source                                             |
| ---------------- | -------------------------------------------------- |
| `series_name`    | Parsed from filename (text before S##E##)          |
| `year`           | Parenthesized year if present                      |
| `episodes`       | List of (season, episode, title) per file          |
| `subtitle_indices` | Subtitle files matching episode filenames        |

### Movie Groups

| Field            | Source                                             |
| ---------------- | -------------------------------------------------- |
| `title`          | Parsed from filename                               |
| `year`           | Parenthesized year                                 |
| `resolution`     | Resolution tag (1080p, 4k, etc.)                   |
| `source`         | Source tag (bluray, web-dl, etc.)                   |
| `subtitle_indices` | Associated subtitle files                        |
| `extra_indices`  | Behind-the-scenes, trailers, etc.                  |

### Music Album Groups

Files classified as `media` (music) in the same Artist/Album folder hierarchy.

| Field            | Source                                             |
| ---------------- | -------------------------------------------------- |
| `album`          | Folder name or ID3 `album` tag                     |
| `artist`         | Parent folder or ID3 `artist`/`album_artist` tag   |
| `year`           | ID3 `year`/`date` tag                              |
| `cover_index`    | Detected cover image                               |
| `probe_data`     | ffprobe track/duration data                        |

### Reading Groups

| Field            | Source                                             |
| ---------------- | -------------------------------------------------- |
| `series_name`    | Folder name or common prefix                       |
| `volumes`        | List of (number, title, format, is_special) per file |

**Volume number parsing** uses prefixes: `vol `, `vol. `, `volume `, `v`, `tome `, `tome. `, `issue `, `issue. `, `#`

**Special detection** uses markers: `sp`, `special`, `specials`, `oneshot`, `one-shot`

---

## Service Routing

After the user confirms classification, files are routed to the appropriate service API:

| Service      | Routing Method                                                        |
| ------------ | --------------------------------------------------------------------- |
| `photos`     | `POST /api/assets` to Immich (multipart with deviceAssetId, timestamps) |
| `documents`  | `POST /api/documents/post_document/` to Paperless-ngx (multipart with title) |
| `media`      | Write to Jellyfin library folder + trigger library refresh scan       |
| `audiobooks` | Write to Audiobookshelf library folder (preserving structure) + trigger library scan |
| `reading`    | Write to Kavita library folder (preserving structure) + trigger `POST /api/Library/scan-all` |
| `files`      | Write to local storage + insert record into `files` database table    |

### Jellyfin Folder Structures

```
/media/{user_id}/Movies/{Movie Name} ({Year})/{filename}.mkv
/media/{user_id}/Shows/{Show Name}/Season {XX}/{Show Name} S{XX}E{XX}.mkv
/media/{user_id}/Music/{Artist}/{Album}/{Track}.mp3
```

---

## Storage Layout

```
/data/steadfirm/
  files/                      Unclassified user uploads
    {user_id}/
  media/                      Jellyfin per-user media libraries
    {user_id}/
      Movies/
      Shows/
      Music/
  audiobooks/                 Audiobookshelf per-user libraries
    {user_id}/
  reading/                    Kavita per-user libraries
    {user_id}/
```

---

## Configuration

### Environment Variables

| Variable                | Default                        | Description                      |
| ----------------------- | ------------------------------ | -------------------------------- |
| `MAX_UPLOAD_BYTES`      | `2147483648` (2 GB)            | Server-side max upload size      |
| `FILES_STORAGE_PATH`    | `/data/steadfirm/files`        | Unclassified file storage root   |
| `MEDIA_STORAGE_PATH`    | `/data/steadfirm/media`        | Jellyfin library root            |
| `AUDIOBOOKS_STORAGE_PATH` | `/data/steadfirm/audiobooks` | Audiobookshelf library root      |
| `READING_STORAGE_PATH`  | `/data/steadfirm/reading`      | Kavita library root              |
| `LLM_PROVIDER`          | `anthropic`                    | `anthropic`, `openai`, `local`, `ollama`, `none`, `disabled` |
| `LLM_MODEL`             | *(provider default)*           | Override model name              |
| `ANTHROPIC_API_KEY`     | —                              | Required if provider = anthropic |
| `LOCAL_LLM_BASE_URL`    | `http://localhost:11434`       | Base URL for local/ollama provider |

### Constants (Backend)

| Constant                        | Value   | Purpose                                   |
| ------------------------------- | ------- | ----------------------------------------- |
| `AI_CONFIDENCE_THRESHOLD`       | 0.85    | Below this → send to LLM                  |
| `CLASSIFY_BATCH_SIZE`           | 50      | Max files per LLM batch                   |
| `CLASSIFY_MAX_TOKENS`           | 16,384  | Max LLM response tokens                   |
| `AUDIOBOOK_MIN_DURATION_SECS`   | 2,700   | 45 minutes — minimum for audiobook signal |

---

## Client-Side Validation

The TypeScript client (`packages/shared/src/validation.ts`) mirrors the heuristic classifier for instant preview before server round-trip. It uses simplified logic — all audio and video files get confidence 0.50 and defer to the server-side LLM.

### Allowed Upload MIME Prefixes

```
image/*
video/*
audio/*
application/pdf
application/vnd.*
application/msword
application/zip
application/x-*
text/*
```

Files not matching these prefixes are rejected client-side before upload.

---

## SSE Streaming Protocol

The `POST /api/v1/classify/stream` endpoint returns Server-Sent Events for real-time classification feedback:

| Event              | Payload                              | When                                |
| ------------------ | ------------------------------------ | ----------------------------------- |
| `log`              | Debug message string                 | Throughout (for browser console)    |
| `heuristic`        | Single file classification result    | Immediately for high-confidence files |
| `status`           | Phase name (e.g., `"classifying"`)   | On phase transitions                |
| `index_map`        | Batch index → global file index map  | Before each LLM batch              |
| `token`            | Individual LLM response token        | During LLM streaming                |
| `classification`   | Single file classification result    | As LLM results are parsed          |
| `done`             | All groups + debug info              | Final event                         |
| `error`            | Error message                        | If LLM call fails                   |

---

## Future Enhancements

Planned improvements (see TODO.md):

- **TMDb/TVDB lookup** for movies & TV shows (correct spelling, fill missing years)
- **Batch analysis heuristics** — 20+ numbered audio files in same folder = strong audiobook signal
- **Audio file size distribution** — audiobook chapters (10–80 MB) vs music tracks (3–10 MB)
- **Folder context keywords** — explicit `Audiobooks/`, `Movies/`, `Music/`, `DCIM/` folders
- **Music probing** — reuse ffprobe for ID3 tag extraction on music files
- **Immich enhancements** — EXIF date extraction, album creation from folders, deduplication
- **Paperless-ngx enhancements** — tag suggestion, correspondent inference from filenames
- **Reclassify endpoint** — move already-stored files between services
