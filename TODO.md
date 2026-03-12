# Steadfirm — Technical Debt & Future Work

Items that are acceptable for POC but must be addressed before scaling beyond a handful of users.

---

## Streaming Proxy Bottleneck

**Problem:** Every media request flows Client → Caddy → Axum → Service → back out. The Axum backend buffers or stream-proxies every byte. This works at low concurrency but becomes a CPU/memory bottleneck with concurrent video streams, large photo libraries, and audio playback across many users.

**Affected services:** Immich (photo originals, video), Jellyfin (video/audio streaming), Audiobookshelf (audiobook streaming), Paperless (PDF downloads).

**Solution: Signed URLs with direct service access**

Instead of proxying the binary payload through Axum, the backend generates a short-lived signed URL that the client uses to fetch media directly from the underlying service. The backend stays in the loop for auth and metadata but gets out of the data path.

### How it works

1. Client requests a resource: `GET /api/v1/photos/:id/original`
2. Axum validates the session, looks up the user's Immich API key
3. Instead of proxying the response, Axum returns a signed redirect:
   ```json
   {
     "url": "http://caddy:18080/internal/immich/assets/:id/original?token=<signed>&expires=<timestamp>",
     "expires_in": 300
   }
   ```
4. Client fetches the signed URL directly
5. Caddy validates the signature (via a lightweight auth middleware or a validation subrequest to the backend) and proxies to the internal service with the correct service credentials injected
6. Binary data flows Client → Caddy → Service — Axum is not in the path

### Signing scheme

- HMAC-SHA256 with a server-side secret
- Token includes: `user_id`, `service`, `resource_id`, `expires_at`
- Signature = `HMAC(secret, "{user_id}:{service}:{resource_id}:{expires_at}")`
- Short TTL (5 minutes) — tokens are cheap to generate, clients request new ones as needed
- Caddy validates via `forward_auth` directive → lightweight endpoint on Axum that only checks the signature (no DB hit)

### Implementation plan

1. Add a `/internal/validate-token` endpoint to Axum that verifies HMAC signatures (stateless, fast)
2. Add Caddy `forward_auth` routes for `/internal/immich/*`, `/internal/jellyfin/*`, etc.
3. Caddy injects the service-specific auth header (`x-api-key`, `Authorization`, etc.) after validation
4. Update the existing proxy endpoints to return signed URL responses instead of streaming
5. Client SDK/hooks handle the two-step fetch transparently

### When to implement

After M2 (Backend API Proxy) is working end-to-end with the naive proxy approach. The naive approach is correct for development and testing — switch to signed URLs before opening to real users at scale.

---

## Missing Health Checks on Custom Containers

**Problem:** `betterauth` and `steadfirm-backend` have no health checks. Caddy's `depends_on: service_started` only waits for the process to launch, not for it to accept connections. This can cause startup race conditions where Caddy tries to proxy to a backend that isn't ready yet.

**Solution:** Add HTTP health check endpoints and `healthcheck` directives in the compose file.

- `steadfirm-backend`: already has `GET /health`
- `betterauth`: add a `GET /api/auth/health` or `GET /health` endpoint

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
  interval: 10s
  timeout: 5s
  retries: 5
```

---

## Single Postgres Instance

**Problem:** Immich, Paperless, BetterAuth, and Steadfirm all share one Postgres. A crash or corruption affects everything simultaneously.

**Solution (phased):**
1. **Immediate:** Automated daily backups (pg_dump) to local disk + offsite (Backblaze B2)
2. **Phase 2:** WAL archiving for point-in-time recovery
3. **Phase 3 (if needed):** Separate Postgres instances per service, or read replicas

The shared instance is architecturally fine — these services have low write volumes and non-overlapping databases. The risk is operational (single point of failure), not architectural.

---

## Container Image Pinning

**Rule: Never use `latest` or other floating tags (e.g. `2-alpine`) for production deployments.** Every image must be pinned to a specific version tag (e.g. `v2.5.6`, `10.11.6`). Rolling tags like `latest` can silently introduce breaking changes on any `docker compose pull`.

**Current status:** All images are now pinned to specific versions in `docker-compose.yml`. When upgrading, bump versions intentionally with testing — never rely on floating tags to pick up updates.

---

## Secrets Management

**Problem:** Database passwords, BetterAuth secret, and service API keys are in `.env` files as plaintext.

**Solution (phased):**
1. **Immediate:** `.env` is gitignored, generated per-environment — acceptable for POC
2. **Phase 2:** Docker secrets (`docker secret create`) or SOPS-encrypted env files
3. **Phase 3:** HashiCorp Vault or similar if multi-server

---

## Backup Strategy

**Problem:** No backups exist. Losing the Postgres volume or media volumes means total data loss.

**Solution:**
1. Postgres: automated pg_dump daily, WAL archiving for PITR
2. Media volumes (Immich uploads, Jellyfin media, Audiobookshelf libraries): rsync to secondary disk + offsite sync to Backblaze B2
3. Config volumes: export and version-control service configs
4. Test restores regularly

Priority: **Must be in place before accepting real user data.**

---

## Jellyfin Startup Wizard Automation

**Problem:** Jellyfin requires completing a startup wizard (set server name, create admin user, finalize config) before any admin API calls work. Currently done manually via API calls during dev setup.

**Solution:** Create an idempotent init script (`infra/scripts/init-jellyfin.sh` or similar) that:
1. Polls `GET /System/Info/Public` until Jellyfin is healthy
2. Checks `StartupWizardCompleted` — exits early if already done
3. Sets server config via `POST /Startup/Configuration`
4. Creates admin user via `POST /Startup/User` (credentials from env vars)
5. Completes wizard via `POST /Startup/Complete`
6. Authenticates as admin via `POST /Users/AuthenticateByName` to obtain the API token
7. Writes `JELLYFIN_ADMIN_TOKEN` back to the environment (or prints it for manual `.env` update)

Run as part of the deploy pipeline or as a Docker Compose `init` container. Must be idempotent — safe to run repeatedly.

**Current dev credentials (stored in `.env`):**
- Admin username: `admin`
- Admin password: `zGDpLxYOdpR5nkIV1h3clGs8H6nMWUHR`
- Admin token: `33d586b4c7834b4d87a7032e6b93f7ad`
- Admin user ID: `bab8098494364f96a8d194ebe74ab085`

---

## BetterAuth Email (Resend)

**Problem:** BetterAuth has no email provider configured. Password reset, email verification, and magic link flows don't work.

**Solution:** Add Resend integration to the BetterAuth sidecar:
1. Create a Resend API key at resend.com
2. Add `RESEND_API_KEY` to `.env`
3. Install `resend` package in `services/betterauth/`
4. Configure `sendResetPassword` and optionally `sendVerificationEmail` in `auth.ts`
5. Use `no-reply@steadfirm.io` as the from address (requires domain verification in Resend)

**Priority:** Low for POC (5-10 known users, can reset passwords manually). Required before opening to wider audience.

---

## Connection Pooling

**Problem:** Each Axum request that hits Postgres uses a connection from SQLx's pool, but there's no tuning or strategy around pool sizing, and no connection pooler (like PgBouncer) in front of Postgres. With multiple services (Immich, Paperless, BetterAuth, Steadfirm) all connecting independently, the combined connection count can exceed Postgres's `max_connections` under load — especially since Immich and Paperless each maintain their own pools.

**Solution (phased):**
1. **Immediate:** Tune SQLx pool settings (`max_connections`, `min_connections`, `acquire_timeout`) in the backend config. Set conservative limits that leave headroom for other services.
2. **Phase 2:** Add PgBouncer as a connection pooler in front of Postgres. All services connect through PgBouncer instead of directly. This multiplexes many application connections onto fewer Postgres connections.
3. **Phase 3:** Monitor connection usage per service and set per-service pool limits in PgBouncer to prevent any single service from starving others.

**Priority:** Low for POC with a handful of users. Becomes important before scaling to many concurrent users or adding more services.

---

## File Classification Heuristics

**Problem:** The drop zone classification currently uses only MIME type / file extension as a first pass, assigning low confidence (0.5) to all audio and video files so the LLM handles disambiguation. This works but means every audio/video upload requires an LLM call, adding latency and cost.

**Goal:** Develop thoughtful heuristics that handle the common cases with high confidence, reserving LLM calls for genuinely ambiguous files. The heuristics should be developed incrementally based on real-world upload patterns rather than guessing upfront.

**Heuristic candidates to evaluate:**

1. **Batch analysis** — Many numbered audio files in the same folder (e.g. `01 Title.mp3` through `45 Title.mp3`) is a near-certain audiobook signal. Music albums rarely have 20+ tracks.
2. **Folder name patterns** — Series numbering in folder names (`Book 01`, `Vol. 3`), known author names, book-title-like structures.
3. **Video source detection** — Camera-generated filenames (`IMG_`, `VID_`, `PXL_`, `DSC_`, timestamp patterns) for personal videos vs scene release naming (`1080p`, `BluRay`, `x264`, `S01E02`) for movies/TV.
4. **Audio file size distribution** — Audiobook chapters are typically 10-80MB per file; individual music tracks are typically 3-10MB.
5. **Folder context keywords** — Explicit folder names like `Audiobooks/`, `Movies/`, `Music/`, `DCIM/`.
6. **File count per folder** — A folder with 3-5 audio files is likely a music album; 15+ is likely an audiobook.

**Approach:** Add heuristics one at a time, test against real uploads, measure how many files still fall through to the LLM. Each heuristic should have clear confidence scoring and be easy to disable if it causes misclassification.

---

## Silent Failure Audit

**Problem:** Multiple places in the codebase swallow errors silently — no user feedback, no console errors, no debug panel entries. When something breaks (e.g. an SSE stream fails to parse, a module fails to load, an API call silently returns unexpected data), the user sees nothing and has no way to diagnose the issue.

**Areas to audit:**

1. **SSE streaming hook** — `useStreamingClassify` catches errors but only sets phase to `'error'`. If the hook itself fails to initialize (e.g. import error), the UI shows nothing. Need visible error states in the DropZone UI.
2. **Classification fallback** — When the LLM call fails, the backend sends heuristic results silently. The user has no indication that AI classification was unavailable. Should show a warning banner.
3. **Heuristic-only mode** — When `ai.is_enabled()` is false, low-confidence files get heuristic results with no indication. Users should see that AI is disabled.
4. **API error handling** — The `ky` client in `api/client.ts` logs errors but some callers (especially fire-and-forget patterns like `void doSomething()`) never surface the error to the user.
5. **Debug panel clipboard** — `navigator.clipboard` is undefined on non-HTTPS contexts (LAN IP access). Was silently throwing. Fixed with optional chaining but should show a toast fallback.
6. **Module loading** — Vite module loading failures (stale cache, broken imports) produce console errors but no user-visible indication. Consider an error boundary that catches and displays import failures.
7. **Upload progress** — Upload failures set status to `'error'` but don't show what the error was. Should capture and display the error message.
8. **Proxy buffering** — SSE streams through the Vite dev proxy can be silently buffered, making the streaming feel broken even though data is flowing. Need explicit `X-Accel-Buffering: no` and validation.

**Principle:** Every error should be visible to at least one audience:
- **Users:** Toast notification, inline error message, or error state in the UI
- **Developers:** Console error, debug panel entry, or tracing log
- **Both** for critical failures

**Priority:** High — silent failures waste debugging time and erode trust in the system.

---

## Background Tasks Audit

**Problem:** Everything in the backend currently runs request-scoped — work starts when a request arrives and ends when the response completes. This is correct for most flows, but several current and planned features may benefit from durable background processing (tasks that survive request cancellation, run on a schedule, or need retries).

**Candidates to evaluate:**

1. **Bulk upload + classification** — User drops 500 files. Currently the SSE stream must stay open for the entire classification + upload pipeline. If the browser tab closes, the work is lost. A background job queue would let the backend accept the batch, return immediately, and process uploads asynchronously with progress queryable via polling or SSE reconnect.
2. **Service provisioning** — Creating a user currently provisions across 5 services synchronously in the signup flow. If Kavita is slow or temporarily down, signup fails entirely. Background provisioning with retries would be more resilient.
3. **Periodic metadata sync** — If global search is built as a federation layer (fan out to 5 services per query), it's fast but adds load. An alternative is periodic background sync that pulls metadata from each service into a local search index (Postgres full-text or Meilisearch). This moves latency from query-time to sync-time.
4. **Thumbnail/preview caching** — Pre-generating and caching thumbnails server-side rather than proxying on every request. Low priority given the signed URL plan above.
5. **Stale session cleanup** — Periodic cleanup of expired BetterAuth sessions, orphaned files in the drop zone staging area, etc.
6. **Re-classification** — User requests re-classification of files already stored. Potentially long-running if it involves moving files between services.

**Rust options:**

- `tokio::spawn` — Already used. Fine for fire-and-forget work within a request lifecycle. Not durable (lost on restart, no retries).
- `tokio-cron-scheduler` — Lightweight cron-like scheduling within the Axum process. Good for periodic sync/cleanup.
- `apalis` — Rust job queue library with Postgres or Redis backend. Typed jobs, retries, persistence, dead-letter queue. Closest equivalent to Python's Celery or Ruby's Sidekiq. Uses the existing Postgres instance.
- Redis streams + custom worker — DIY approach using the existing Redis. More control, more code.

**Recommendation:** No action needed for POC. Revisit when implementing global search (metadata sync) or when bulk uploads become a real workflow. `apalis` with Postgres is the natural first choice given the existing stack.

---

## Smart Upload Enhancements

The core smart upload pipelines (Audiobookshelf, Jellyfin TV/Movies/Music, Kavita Reading) are complete. These enhancements would improve accuracy and user experience.

### TMDb / TVDB Lookup for Movies & TV Shows

**Problem:** Movie and TV show naming relies entirely on filename parsing. Misspelled titles, missing years, or non-standard naming produce incorrect folder structures that Jellyfin can't match.

**Solution:** After heuristic detection, query TMDb (movies) or TVDB (TV shows) to validate and enrich metadata — correct title spelling, fill in missing years, fetch episode titles, and confirm season/episode numbering. Show matched results in the review panel so users can confirm or pick an alternative match.

### Music Probing via ffprobe

**Problem:** Music track metadata (artist, album, track number, year) is inferred from folder structure and filenames. Files with proper ID3/Vorbis tags have richer metadata that goes unused.

**Solution:** Reuse the existing ffprobe service (already used for audiobook ID3 extraction) to probe music files. Extract artist, album, track number, title, year, and genre from tags. Prefer tag metadata over filename-inferred metadata in the review panel, with fallback to folder heuristics when tags are missing.

### Immich Photo Enhancements (EXIF & Albums)

**Problem:** Photos uploaded via the drop zone are sent to Immich as-is. No EXIF date extraction for organizing by date, no album creation from folder structure, and no deduplication check.

**Solution:**
1. Extract EXIF date-taken from images to display in the review panel and potentially group by date
2. Infer album names from folder structure (e.g. `Vacation 2024/` → create Immich album)
3. Check for duplicate photos before uploading (perceptual hash or EXIF fingerprint)

### Paperless-ngx Enhancements (Tags & Correspondents)

**Problem:** Documents uploaded to Paperless are sent without any pre-filled metadata. Users must manually tag and assign correspondents after upload.

**Solution:**
1. Suggest tags based on filename keywords, folder names, or document content (if OCR is available client-side)
2. Infer correspondent from filename patterns (e.g. `Invoice - Acme Corp.pdf` → correspondent "Acme Corp")
3. Show suggested tags and correspondent in the review panel for user confirmation before upload
