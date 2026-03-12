#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# Seed Steadfirm dev environment with public-domain content.
#
# Creates a demo user, waits for provisioning, then uploads sample files
# across every service category — giving you a full showcase from a
# fresh git clone + reset-dev.sh.
#
# Prerequisites:
#   - infra/reset-dev.sh has been run (or containers are up)
#   - BetterAuth is running  (cd services/betterauth && bun run dev)
#   - Backend is running     (cargo run -p steadfirm-backend)
#
# Usage: ./infra/seed-dev.sh
# ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_DIR="/tmp/steadfirm-seed"

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

# ── Create seed directory ─────────────────────────────────────────────
mkdir -p "$SEED_DIR"
info "Seed content directory: $SEED_DIR"

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
    STATUS=$(curl -sf "${BACKEND_URL}/api/v1/me" \
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

# ── Helper: download if not cached ────────────────────────────────────

download() {
    local url="$1" dest="$2"
    if [ -f "$dest" ]; then
        return 0
    fi
    info "  Downloading $(basename "$dest")..."
    curl -sfL --max-time 60 -o "$dest" "$url" || {
        warn "  Failed to download: $url"
        return 1
    }
}

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

upload_audiobook() {
    local title="$1" author="$2"
    shift 2
    local files=("$@")

    local args=(
        -sf -X POST "${BACKEND_URL}/api/v1/upload/audiobook"
        -H "Cookie: ${SESSION_COOKIE}"
        -F "title=${title}"
        -F "author=${author}"
    )

    local i=0
    for f in "${files[@]}"; do
        args+=(-F "${i}=@${f}")
        i=$((i + 1))
    done

    local response
    response=$(curl "${args[@]}" 2>/dev/null || echo '{"error": "upload failed"}')

    if echo "$response" | jq -e '.status == "uploaded"' >/dev/null 2>&1; then
        ok "  [audiobooks] ${author} — ${title} (${#files[@]} files)"
    else
        warn "  [audiobooks] ${author} — ${title} — FAILED"
    fi
}

# ======================================================================
#  DOWNLOAD PUBLIC DOMAIN CONTENT
# ======================================================================
# All content below is public domain or CC0-licensed.
# Files are cached in /tmp/steadfirm-seed so repeated runs are fast.
# ======================================================================

header "Downloading seed content"

# ── PHOTOS ────────────────────────────────────────────────────────────
# Unsplash provides CC0/Unsplash-licensed photos. Using their source API
# for deterministic, high-quality sample images.
mkdir -p "$SEED_DIR/photos"

download "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1920" \
    "$SEED_DIR/photos/mountain-landscape.jpg"
download "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1920" \
    "$SEED_DIR/photos/lake-sunset.jpg"
download "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1920" \
    "$SEED_DIR/photos/valley-sunrise.jpg"
download "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=1920" \
    "$SEED_DIR/photos/cat-portrait.jpg"
download "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=1920" \
    "$SEED_DIR/photos/golden-retriever.jpg"
download "https://images.unsplash.com/photo-1504198453319-5ce911bafcde?w=1920" \
    "$SEED_DIR/photos/northern-lights.jpg"

# A PNG screenshot-style image
download "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/560px-PNG_transparency_demonstration_1.png" \
    "$SEED_DIR/photos/transparency-test.png"

# ── DOCUMENTS ─────────────────────────────────────────────────────────
# Real public-domain documents for Paperless to OCR and index.
mkdir -p "$SEED_DIR/documents"

# US Constitution (PDF) — US Government, public domain
download "https://www.archives.gov/files/founding-docs/constitution-page1-high-res.jpg" \
    "$SEED_DIR/documents/us-constitution-page1.jpg"

# A simple text file (we create it inline)
cat > "$SEED_DIR/documents/meeting-notes.txt" << 'DOCEOF'
Meeting Notes — Steadfirm Dev Sync
Date: 2026-03-01
Attendees: Caleb, Demo User

Agenda:
1. Review drop zone classification accuracy
2. Discuss audiobook detection heuristics
3. Plan mobile app offline sync

Action Items:
- [ ] Improve PDF classification confidence
- [ ] Add TMDb lookup for media folder naming
- [ ] Test Kavita library scanning with large collections

Next meeting: 2026-03-08
DOCEOF

# A CSV spreadsheet
cat > "$SEED_DIR/documents/inventory.csv" << 'CSVEOF'
Item,Category,Quantity,Price
Laptop,Electronics,5,1299.99
Monitor,Electronics,10,449.99
Keyboard,Peripherals,25,89.99
Mouse,Peripherals,25,49.99
Headset,Audio,15,129.99
Webcam,Video,10,79.99
USB Hub,Accessories,20,34.99
CSVEOF

# Plain RTF document
cat > "$SEED_DIR/documents/project-charter.rtf" << 'RTFEOF'
{\rtf1\ansi
{\b Project Charter: Steadfirm}\par
\par
{\b Objective:} Build a unified personal cloud platform that replaces 5+ separate services with one login.\par
\par
{\b Scope:}\par
- Photos (Immich)\par
- Media (Jellyfin)\par
- Documents (Paperless-ngx)\par
- Audiobooks (Audiobookshelf)\par
- Reading (Kavita)\par
- Files (Steadfirm storage)\par
\par
{\b Success Criteria:} Users never see infrastructure. One drag-and-drop upload handles everything.\par
}
RTFEOF

# ── READING (ebooks + comics) ─────────────────────────────────────────
# Public domain books from Project Gutenberg and Standard Ebooks.
mkdir -p "$SEED_DIR/reading"

# Alice's Adventures in Wonderland — Lewis Carroll (public domain)
download "https://www.gutenberg.org/ebooks/11.epub3.images" \
    "$SEED_DIR/reading/alice-in-wonderland.epub"

# The Art of War — Sun Tzu (public domain)
download "https://www.gutenberg.org/ebooks/132.epub3.images" \
    "$SEED_DIR/reading/the-art-of-war.epub"

# Frankenstein — Mary Shelley (public domain)
download "https://www.gutenberg.org/ebooks/84.epub3.images" \
    "$SEED_DIR/reading/frankenstein.epub"

# ── MEDIA (video) ─────────────────────────────────────────────────────
# Public-domain / CC0 video clips.
mkdir -p "$SEED_DIR/media"

# Big Buck Bunny trailer — Blender Foundation, CC BY 3.0
download "https://download.blender.org/peach/trailer/trailer_480p.mov" \
    "$SEED_DIR/media/Big Buck Bunny (2008).mov"

# Sintel trailer — Blender Foundation, CC BY 3.0
download "https://download.blender.org/demo/sintel/Sintel_Trailer1.480p.DivX_Plus_HD.mkv" \
    "$SEED_DIR/media/Sintel (2010).mkv"

# ── AUDIOBOOKS ────────────────────────────────────────────────────────
# LibriVox recordings — public domain readings of public domain books.
mkdir -p "$SEED_DIR/audiobooks/Edgar Allan Poe/The Tell-Tale Heart"
mkdir -p "$SEED_DIR/audiobooks/H.G. Wells/The Time Machine"

# The Tell-Tale Heart — Edgar Allan Poe, read by LibriVox (public domain)
download "https://www.archive.org/download/tell_tale_heart_1002_librivox/tell_tale_heart_poe_rk_128kb.mp3" \
    "$SEED_DIR/audiobooks/Edgar Allan Poe/The Tell-Tale Heart/01 - The Tell-Tale Heart.mp3"

# The Time Machine chapters — H.G. Wells, read by LibriVox (public domain)
download "https://www.archive.org/download/time_machine_0809_librivox/timemachine_01_wells_128kb.mp3" \
    "$SEED_DIR/audiobooks/H.G. Wells/The Time Machine/01 - Chapter 1.mp3"
download "https://www.archive.org/download/time_machine_0809_librivox/timemachine_02_wells_128kb.mp3" \
    "$SEED_DIR/audiobooks/H.G. Wells/The Time Machine/02 - Chapter 2.mp3"
download "https://www.archive.org/download/time_machine_0809_librivox/timemachine_03_wells_128kb.mp3" \
    "$SEED_DIR/audiobooks/H.G. Wells/The Time Machine/03 - Chapter 3.mp3"

# ── MUSIC (media — music subfolder) ──────────────────────────────────
# Short public domain music clips for Jellyfin music library.
mkdir -p "$SEED_DIR/music"

# Chopin — Nocturne Op. 9 No. 2 (Musopen, public domain)
download "https://files.musopen.org/recordings/55d0bda0-4e30-485e-b437-8a5df4153a03.mp3" \
    "$SEED_DIR/music/Chopin - Nocturne Op 9 No 2.mp3"

# ── PDFs (ambiguous — tests classifier) ──────────────────────────────
# PDFs are low-confidence in heuristics (0.5) — these test the LLM path.
mkdir -p "$SEED_DIR/pdfs"

# A real receipt/invoice-style PDF — should go to Documents
download "https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table-word.pdf" \
    "$SEED_DIR/pdfs/accessibility-table-example.pdf"

# ── FILES (catchall — exotic/unknown formats) ─────────────────────────
# These are intentionally formats we don't classify yet.
# They should land in the "files" catchall category.
mkdir -p "$SEED_DIR/files"

# A YAML config file
cat > "$SEED_DIR/files/docker-compose.yml" << 'YAMLEOF'
version: "3.8"
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html
YAMLEOF

# A JSON data file
cat > "$SEED_DIR/files/sample-data.json" << 'JSONEOF'
{
  "users": [
    {"id": 1, "name": "Alice", "role": "admin"},
    {"id": 2, "name": "Bob", "role": "user"},
    {"id": 3, "name": "Charlie", "role": "user"}
  ],
  "metadata": {
    "version": "1.0.0",
    "generated": "2026-03-01T00:00:00Z"
  }
}
JSONEOF

# A shell script
cat > "$SEED_DIR/files/backup.sh" << 'SHEOF'
#!/bin/bash
# Automated backup script
DATE=$(date +%Y-%m-%d)
tar -czf "/backups/backup-${DATE}.tar.gz" /data
echo "Backup complete: backup-${DATE}.tar.gz"
SHEOF

# A Markdown file
cat > "$SEED_DIR/files/README.md" << 'MDEOF'
# Sample Project

This is a sample README file that would typically live in a code repository.

## Features
- Feature one
- Feature two
- Feature three

## License
MIT
MDEOF

# An SVG image (not a raster photo — should be files, not photos)
cat > "$SEED_DIR/files/logo.svg" << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="45" fill="#3b82f6" />
  <text x="50" y="58" text-anchor="middle" fill="white" font-size="24" font-family="sans-serif">SF</text>
</svg>
SVGEOF

# A .zip archive
(cd "$SEED_DIR/files" && echo "archive contents" > archive-test.txt && \
    zip -qj test-archive.zip archive-test.txt && rm archive-test.txt) 2>/dev/null || \
    warn "zip not available — skipping archive"

# ======================================================================
#  UPLOAD SEED CONTENT
# ======================================================================

header "Uploading photos"
for f in "$SEED_DIR/photos"/*; do
    [ -f "$f" ] && upload "$f" "photos"
done

header "Uploading documents"
for f in "$SEED_DIR/documents"/*; do
    [ -f "$f" ] && upload "$f" "documents"
done

header "Uploading reading material"
for f in "$SEED_DIR/reading"/*; do
    [ -f "$f" ] && upload "$f" "reading"
done

header "Uploading media"
for f in "$SEED_DIR/media"/*; do
    [ -f "$f" ] && upload "$f" "media"
done

header "Uploading audiobooks"
# Upload via the directory-structure path (relative_path preserves Author/Title)
find "$SEED_DIR/audiobooks" -type f -name "*.mp3" | sort | while read -r f; do
    rel="${f#"$SEED_DIR/audiobooks/"}"
    upload "$f" "audiobooks" "$(basename "$f")" "$rel"
done

header "Uploading music"
for f in "$SEED_DIR/music"/*; do
    [ -f "$f" ] && upload "$f" "media"
done

header "Uploading PDFs (classifier test)"
for f in "$SEED_DIR/pdfs"/*; do
    [ -f "$f" ] && upload "$f" "documents"
done

header "Uploading misc files (catchall)"
for f in "$SEED_DIR/files"/*; do
    [ -f "$f" ] && upload "$f" "files"
done

# ======================================================================
#  SUMMARY
# ======================================================================

header "Seed complete"
echo ""
echo -e "  ${BOLD}Demo account${NC}"
echo -e "  Email:    ${CYAN}${DEMO_EMAIL}${NC}"
echo -e "  Password: ${CYAN}${DEMO_PASSWORD}${NC}"
echo ""
echo -e "  ${BOLD}What was seeded${NC}"
echo "  Photos:     Landscape & animal photos (JPG, PNG)"
echo "  Documents:  Meeting notes, spreadsheet, charter (TXT, CSV, RTF)"
echo "  Reading:    Alice in Wonderland, Art of War, Frankenstein (EPUB)"
echo "  Media:      Big Buck Bunny, Sintel trailers (MOV, MKV)"
echo "  Audiobooks: The Tell-Tale Heart, The Time Machine (MP3)"
echo "  Music:      Chopin Nocturne (MP3 — routed to media)"
echo "  PDFs:       Accessibility table example (classifier test)"
echo "  Files:      YAML, JSON, shell script, markdown, SVG, ZIP"
echo ""
echo -e "  ${BOLD}Open the app${NC}"
echo "  http://localhost:5173"
echo ""
