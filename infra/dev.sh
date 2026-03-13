#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# Dev environment: start services → keep running.
#
# By default, starts everything without touching existing data.
# Use --reset and/or --seed to wipe and repopulate.
#
# Usage: ./infra/dev.sh [--reset] [--seed] [--fresh]
#
#   --reset   Wipe volumes and recreate containers before starting
#   --seed    Run the seed script after services are ready
#   --fresh   Shorthand for --reset --seed (full clean start)
# ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Parse flags ───────────────────────────────────────────────────────
DO_RESET=0
DO_SEED=0
for arg in "$@"; do
    case "$arg" in
        --reset) DO_RESET=1 ;;
        --seed)  DO_SEED=1 ;;
        --fresh) DO_RESET=1; DO_SEED=1 ;;
        *)       echo "Unknown flag: $arg"; exit 1 ;;
    esac
done

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()   { echo -e "${CYAN}[dev]${NC} $*"; }
ok()     { echo -e "${GREEN}[dev]${NC} $*"; }
warn()   { echo -e "${YELLOW}[dev]${NC} $*"; }
header() { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}"; }

# ── Cleanup on exit ──────────────────────────────────────────────────
PIDS=()
CLEANING_UP=0

cleanup() {
    # Guard against re-entrancy from repeated Ctrl+C
    if [ "$CLEANING_UP" -eq 1 ]; then
        return
    fi
    CLEANING_UP=1

    echo ""
    info "Shutting down..."

    # Kill entire process groups so child processes (bun, cargo, etc.)
    # inside the subshell pipelines are also terminated.
    for pid in "${PIDS[@]}"; do
        kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    done

    # Brief grace period, then force-kill stragglers
    sleep 0.5
    for pid in "${PIDS[@]}"; do
        kill -9 -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    done

    wait 2>/dev/null || true
    ok "All processes stopped"
}
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

# ── Step 1: Reset (opt-in) ────────────────────────────────────────────

if [ "$DO_RESET" -eq 1 ]; then
    header "Resetting dev environment"
    "$SCRIPT_DIR/reset-dev.sh"
else
    header "Starting containers"
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" -f "$SCRIPT_DIR/docker-compose.dev.yml" up -d
fi

# ── Step 2: Wait for Docker services ──────────────────────────────────

header "Waiting for Docker services"

dc() {
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" -f "$SCRIPT_DIR/docker-compose.dev.yml" "$@"
}

wait_for_container() {
    local name="$1" timeout="${2:-120}" elapsed=0
    while [ $elapsed -lt $timeout ]; do
        local health
        health=$(dc ps --format "{{.Health}}" "$name" 2>/dev/null | head -1)
        # Containers without healthchecks report empty — treat as ready
        if [ -z "$health" ] || [ "$health" = "healthy" ]; then
            ok "$name is ready"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        info "Waiting for $name... (${elapsed}s)"
    done
    warn "$name did not become healthy within ${timeout}s"
    return 1
}

# Postgres and Valkey first (other services depend on them)
wait_for_container postgres 30
wait_for_container valkey 30

# Then the application services (can take longer, especially Immich ML)
for svc in immich-server jellyfin paperless audiobookshelf kavita; do
    wait_for_container "$svc" 120
done

# ── Step 3: Start local services ──────────────────────────────────────

# Kill any stale processes from previous runs
kill_port() {
    local port="$1"
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        warn "Killing stale process(es) on port $port (PIDs: $pids)"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        # Wait until the port is actually free
        local attempts=0
        while lsof -ti :"$port" >/dev/null 2>&1 && [ $attempts -lt 20 ]; do
            sleep 0.25
            attempts=$((attempts + 1))
        done
    fi
}

kill_port 3001
kill_port 3002
kill_port 5173

header "Starting BetterAuth"
setsid bash -c "cd '$REPO_ROOT/services/betterauth' && bun run dev" 2>&1 | sed 's/^/  [betterauth] /' &
PIDS+=($!)

header "Starting Backend"
setsid bash -c "cd '$REPO_ROOT' && cargo run -p steadfirm-backend" 2>&1 | sed 's/^/  [backend]    /' &
PIDS+=($!)

header "Starting Web frontend"
setsid bash -c "cd '$REPO_ROOT/web' && bun run dev" 2>&1 | sed 's/^/  [web]        /' &
PIDS+=($!)

# ── Step 4: Wait for services to be ready ─────────────────────────────

header "Waiting for services"

wait_for() {
    local name="$1" url="$2" timeout="${3:-60}" elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if curl -sf --max-time 2 "$url" >/dev/null 2>&1; then
            ok "$name is ready"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    warn "$name did not become ready within ${timeout}s"
    return 1
}

wait_for "BetterAuth" "http://localhost:3002/health" 30
wait_for "Backend"    "http://localhost:3001/health"  120

# ── Step 5: Seed (opt-in) ─────────────────────────────────────────────

if [ "$DO_SEED" -eq 1 ]; then
    header "Seeding demo content"
    "$SCRIPT_DIR/seed-dev.sh"
else
    info "Skipping seed (use --seed or --fresh to seed)"
fi

# ── Step 6: Keep running ──────────────────────────────────────────────

header "Ready"
echo ""
echo -e "  ${BOLD}App${NC}:      ${CYAN}http://localhost:5173${NC}"
echo -e "  ${BOLD}Backend${NC}:  ${CYAN}http://localhost:3001${NC}"
echo -e "  ${BOLD}Auth${NC}:     ${CYAN}http://localhost:3002${NC}"
echo ""
echo -e "  ${BOLD}Demo login${NC}"
echo -e "  Email:    ${CYAN}demo@steadfirm.local${NC}"
echo -e "  Password: ${CYAN}demo-password-2026${NC}"
echo ""
echo -e "  Press ${BOLD}Ctrl+C${NC} to stop everything"
echo ""

# Wait forever — Ctrl+C triggers the INT trap which calls cleanup + exit.
# `wait` is interrupted by signals, so loop to keep alive.
while true; do
    wait 2>/dev/null || true
done
