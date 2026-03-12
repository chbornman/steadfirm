#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# Seed Steadfirm dev environment with local content.
#
# Uploads sample files from infra/seed-media/ across every service
# category — giving you a full showcase from a fresh git clone +
# reset-dev.sh.
#
# The seed-media/ directory is gitignored and must be populated
# separately (see infra/seed-media/README.md or copy files from NAS).
#
# Prerequisites:
#   - infra/seed-media/ is populated with sample content
#   - infra/reset-dev.sh has been run (or containers are up)
#   - BetterAuth is running  (cd services/betterauth && bun run dev)
#   - Backend is running     (cargo run -p steadfirm-backend)
#
# Usage: ./infra/seed-dev.sh
# ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_DIR="${SCRIPT_DIR}/seed-media"

# ── Service URLs (match .env defaults) ────────────────────────────────
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
BETTERAUTH_URL="${BETTERAUTH_URL:-http://localhost:3002}"

# ── Demo user ─────────────────────────────────────────────────────────
DEMO_EMAIL="demo@steadfirm.local"
DEMO_PASSWORD="demo-password-2026"
DEMO_NAME="Demo User"

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}[seed]${NC} $*"; }
ok()    { echo -e "${GREEN}[seed]${NC} $*"; }
warn()  { echo -e "${YELLOW}[seed]${NC} $*"; }
err()   { echo -e "${RED}[seed]${NC} $*"; }
header(){ echo -e "\n${BOLD}${CYAN}=== $* ===${NC}"; }

# ── Check seed-media directory ────────────────────────────────────────

if [ ! -d "$SEED_DIR" ]; then
    err "Seed media directory not found: $SEED_DIR"
    err ""
    err "The seed-media/ directory is gitignored and must be populated manually."
    err "Copy sample files from the NAS or other sources into:"
    err "  infra/seed-media/"
    err ""
    err "Expected structure:"
    err "  seed-media/"
    err "    photos/       — JPG, PNG images"
    err "    documents/    — PDF, TXT, CSV files"
    err "    reading/      — EPUB, CBZ, CBR files"
    err "    movies/       — Movie files (MP4, MKV)"
    err "    shows/        — TV show episodes"
    err "    audiobooks/   — Author/Title/chapter.mp3"
    err "    music/        — MP3, FLAC files"
    err "    files/        — Misc catchall (YAML, JSON, etc.)"
    exit 1
fi

# ── Preflight checks ─────────────────────────────────────────────────

check_service() {
    local name="$1" url="$2" path="${3:-/}"
    if ! curl -sf --max-time 3 "${url}${path}" >/dev/null 2>&1; then
        err "$name is not reachable at $url"
        return 1
    fi
}

header "Preflight"
MISSING=0
check_service "Backend"    "$BACKEND_URL" "/health"    || MISSING=1
check_service "BetterAuth" "$BETTERAUTH_URL" "/health" || MISSING=1
if [ "$MISSING" -eq 1 ]; then
    err "Some services are not running. Start them first:"
    err "  1. cd services/betterauth && bun run dev"
    err "  2. cargo run -p steadfirm-backend"
    exit 1
fi
ok "Backend and BetterAuth are reachable"

# Check for required tools
for cmd in curl jq; do
    if ! command -v "$cmd" &>/dev/null; then
        err "Required tool '$cmd' is not installed"
        exit 1
    fi
done

# ── Step 1: Create demo user via BetterAuth ───────────────────────────

header "Creating demo user"

SIGNUP_RESPONSE=$(curl -sf -X POST "${BETTERAUTH_URL}/api/auth/sign-up/email" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${DEMO_NAME}\", \"email\": \"${DEMO_EMAIL}\", \"password\": \"${DEMO_PASSWORD}\"}" \
    -D - 2>/dev/null || true)

if echo "$SIGNUP_RESPONSE" | grep -q '"user"'; then
    ok "Created user: $DEMO_EMAIL"
elif echo "$SIGNUP_RESPONSE" | grep -qi 'already\|exists\|duplicate'; then
    warn "User already exists, signing in instead"
else
    # Might already exist — try signing in
    warn "Signup returned unexpected response, trying sign-in"
fi

# Sign in and capture session cookie
SIGNIN_HEADERS=$(mktemp)
SIGNIN_BODY=$(curl -sf -X POST "${BETTERAUTH_URL}/api/auth/sign-in/email" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"${DEMO_EMAIL}\", \"password\": \"${DEMO_PASSWORD}\"}" \
    -D "$SIGNIN_HEADERS" 2>/dev/null || true)

# Extract set-cookie header for the session
SESSION_COOKIE=$(grep -i 'set-cookie' "$SIGNIN_HEADERS" | grep -oP 'better-auth\.session_token=[^;]+' | head -1 || true)
rm -f "$SIGNIN_HEADERS"

if [ -z "$SESSION_COOKIE" ]; then
    err "Failed to get session cookie. Sign-in response:"
    echo "$SIGNIN_BODY"
    exit 1
fi
ok "Signed in as $DEMO_EMAIL"

# ── Step 2: Wait for provisioning ─────────────────────────────────────

header "Waiting for service provisioning"

PROVISION_TIMEOUT=60
PROVISION_ELAPSED=0

while [ $PROVISION_ELAPSED -lt $PROVISION_TIMEOUT ]; do
    # Hit an authenticated endpoint — if provisioning is done, we get credentials
    STATUS=$(curl -sf "${BACKEND_URL}/api/v1/users/me" \
        -H "Cookie: ${SESSION_COOKIE}" 2>/dev/null || echo "{}")

    # Check if all services are provisioned
    if echo "$STATUS" | jq -e '.services.photos and .services.media and .services.documents and .services.audiobooks' >/dev/null 2>&1; then
        ok "All services provisioned"
        break
    fi

    sleep 2
    PROVISION_ELAPSED=$((PROVISION_ELAPSED + 2))
    info "Waiting for provisioning... (${PROVISION_ELAPSED}s)"
done

if [ $PROVISION_ELAPSED -ge $PROVISION_TIMEOUT ]; then
    warn "Provisioning timed out after ${PROVISION_TIMEOUT}s — some uploads may fail"
fi

# ── Helper: upload to backend ─────────────────────────────────────────

upload() {
    local file="$1" service="$2" filename="${3:-$(basename "$1")}" relative_path="${4:-}"

    local args=(
        -sf -X POST "${BACKEND_URL}/api/v1/upload"
        -H "Cookie: ${SESSION_COOKIE}"
        -F "file=@${file};filename=${filename}"
        -F "service=${service}"
    )

    if [ -n "$relative_path" ]; then
        args+=(-F "relative_path=${relative_path}")
    fi

    local response
    response=$(curl "${args[@]}" 2>/dev/null || echo '{"error": "upload failed"}')

    if echo "$response" | jq -e '.status == "routed"' >/dev/null 2>&1; then
        ok "  [$service] $filename"
    else
        warn "  [$service] $filename — FAILED: $(echo "$response" | jq -r '.error // .message // "unknown"' 2>/dev/null)"
    fi
}

# ── Helper: count files in a directory ────────────────────────────────

count_files() {
    local dir="$1"
    if [ -d "$dir" ]; then
        find "$dir" -maxdepth 1 -type f | wc -l
    else
        echo 0
    fi
}

# ======================================================================
#  UPLOAD SEED CONTENT FROM LOCAL seed-media/ DIRECTORY
# ======================================================================

# ── PHOTOS ────────────────────────────────────────────────────────────
PHOTO_COUNT=$(find "$SEED_DIR/photos" -type f \( -name "*.jpg" -o -name "*.JPG" -o -name "*.jpeg" -o -name "*.png" -o -name "*.HEIC" -o -name "*.heic" -o -name "*.gif" -o -name "*.webp" \) 2>/dev/null | wc -l)
if [ "$PHOTO_COUNT" -gt 0 ]; then
    header "Uploading photos ($PHOTO_COUNT files)"
    find "$SEED_DIR/photos" -type f \( -name "*.jpg" -o -name "*.JPG" -o -name "*.jpeg" -o -name "*.png" -o -name "*.HEIC" -o -name "*.heic" -o -name "*.gif" -o -name "*.webp" \) | sort | while read -r f; do
        upload "$f" "photos"
    done
else
    warn "No photos found in $SEED_DIR/photos/"
fi

# ── DOCUMENTS ─────────────────────────────────────────────────────────
DOC_COUNT=$(find "$SEED_DIR/documents" -type f \( -name "*.pdf" -o -name "*.txt" -o -name "*.csv" -o -name "*.doc" -o -name "*.docx" \) 2>/dev/null | wc -l)
if [ "$DOC_COUNT" -gt 0 ]; then
    header "Uploading documents ($DOC_COUNT files)"
    find "$SEED_DIR/documents" -type f \( -name "*.pdf" -o -name "*.txt" -o -name "*.csv" -o -name "*.doc" -o -name "*.docx" \) | sort | while read -r f; do
        upload "$f" "documents"
    done
else
    warn "No documents found in $SEED_DIR/documents/"
fi

# ── READING (ebooks + comics + manga) ─────────────────────────────────
READING_COUNT=$(find "$SEED_DIR/reading" -type f \( -name "*.epub" -o -name "*.cbz" -o -name "*.cbr" -o -name "*.pdf" \) 2>/dev/null | wc -l)
if [ "$READING_COUNT" -gt 0 ]; then
    header "Uploading reading material ($READING_COUNT files)"
    find "$SEED_DIR/reading" -type f \( -name "*.epub" -o -name "*.cbz" -o -name "*.cbr" -o -name "*.pdf" \) | sort | while read -r f; do
        upload "$f" "reading"
    done
else
    warn "No reading material found in $SEED_DIR/reading/"
fi

# ── MEDIA: Movies ─────────────────────────────────────────────────────
if [ -d "$SEED_DIR/movies" ] && [ "$(count_files "$SEED_DIR/movies")" -gt 0 ]; then
    header "Uploading movies ($(count_files "$SEED_DIR/movies") files)"
    for f in "$SEED_DIR/movies"/*; do
        [ -f "$f" ] && upload "$f" "media"
    done
else
    warn "No movies found in $SEED_DIR/movies/"
fi

# ── MEDIA: TV Shows ──────────────────────────────────────────────────
if [ -d "$SEED_DIR/shows" ] && [ "$(count_files "$SEED_DIR/shows")" -gt 0 ]; then
    header "Uploading TV shows ($(count_files "$SEED_DIR/shows") files)"
    for f in "$SEED_DIR/shows"/*; do
        [ -f "$f" ] && upload "$f" "media"
    done
else
    warn "No TV shows found in $SEED_DIR/shows/"
fi

# ── AUDIOBOOKS ────────────────────────────────────────────────────────
if [ -d "$SEED_DIR/audiobooks" ]; then
    AUDIOBOOK_COUNT=$(find "$SEED_DIR/audiobooks" -type f -name "*.mp3" -o -name "*.m4a" -o -name "*.m4b" | wc -l)
    if [ "$AUDIOBOOK_COUNT" -gt 0 ]; then
        header "Uploading audiobooks ($AUDIOBOOK_COUNT files)"
        # Upload preserving Author/Title directory structure via relative_path
        find "$SEED_DIR/audiobooks" -type f \( -name "*.mp3" -o -name "*.m4a" -o -name "*.m4b" \) | sort | while read -r f; do
            rel="${f#"$SEED_DIR/audiobooks/"}"
            upload "$f" "audiobooks" "$(basename "$f")" "$rel"
        done
    else
        warn "No audiobook files found in $SEED_DIR/audiobooks/"
    fi
else
    warn "No audiobooks directory found"
fi

# ── MUSIC ─────────────────────────────────────────────────────────────
if [ -d "$SEED_DIR/music" ] && [ "$(count_files "$SEED_DIR/music")" -gt 0 ]; then
    header "Uploading music ($(count_files "$SEED_DIR/music") files)"
    for f in "$SEED_DIR/music"/*; do
        [ -f "$f" ] && upload "$f" "media"
    done
else
    warn "No music found in $SEED_DIR/music/"
fi

# ── FILES (catchall) ──────────────────────────────────────────────────
if [ -d "$SEED_DIR/files" ] && [ "$(count_files "$SEED_DIR/files")" -gt 0 ]; then
    header "Uploading misc files ($(count_files "$SEED_DIR/files") files)"
    for f in "$SEED_DIR/files"/*; do
        [ -f "$f" ] && upload "$f" "files"
    done
else
    warn "No misc files found in $SEED_DIR/files/"
fi

# ======================================================================
#  SUMMARY
# ======================================================================

header "Seed complete"
echo ""
echo -e "  ${BOLD}Demo account${NC}"
echo -e "  Email:    ${CYAN}${DEMO_EMAIL}${NC}"
echo -e "  Password: ${CYAN}${DEMO_PASSWORD}${NC}"
echo ""
echo -e "  ${BOLD}What was seeded (from ${SEED_DIR})${NC}"

# Print counts per category
for category in photos documents reading movies shows music files; do
    dir="$SEED_DIR/$category"
    if [ -d "$dir" ]; then
        count=$(find "$dir" -type f | wc -l)
        printf "  %-14s %d file(s)\n" "$category:" "$count"
    fi
done
# Audiobooks count separately (nested dirs)
if [ -d "$SEED_DIR/audiobooks" ]; then
    count=$(find "$SEED_DIR/audiobooks" -type f | wc -l)
    printf "  %-14s %d file(s)\n" "audiobooks:" "$count"
fi

echo ""
echo -e "  ${BOLD}Open the app${NC}"
echo "  http://localhost:5173"
echo ""
