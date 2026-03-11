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
