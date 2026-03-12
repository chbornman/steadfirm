#!/usr/bin/env bash
set -euo pipefail

# Reset all Steadfirm dev data: databases, service configs, uploads, caches.
# This gives you a completely fresh state as if you just cloned the repo.
#
# Usage: ./infra/reset-dev.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR"

echo "=== Stopping all containers ==="
docker compose -f "$COMPOSE_DIR/docker-compose.yml" -f "$COMPOSE_DIR/docker-compose.dev.yml" down --timeout 10 2>/dev/null || true

echo "=== Removing all volumes ==="
docker compose -f "$COMPOSE_DIR/docker-compose.yml" -f "$COMPOSE_DIR/docker-compose.dev.yml" down -v --timeout 10 2>/dev/null || true

echo "=== Cleaning local file storage ==="
rm -rf /tmp/steadfirm-files 2>/dev/null || true

echo "=== Starting fresh ==="
docker compose -f "$COMPOSE_DIR/docker-compose.yml" -f "$COMPOSE_DIR/docker-compose.dev.yml" up -d

echo ""
echo "Waiting for postgres to be healthy..."
until docker compose -f "$COMPOSE_DIR/docker-compose.yml" -f "$COMPOSE_DIR/docker-compose.dev.yml" exec -T postgres pg_isready -U "${DB_USER:-steadfirm}" >/dev/null 2>&1; do
  sleep 1
done

echo ""
echo "=== Done ==="
echo "All data wiped. Services are starting fresh."
echo ""
echo "Next steps:"
echo "  1. cd services/betterauth && bun run dev"
echo "  2. cargo watch -c -w crates/backend -w crates/shared -x 'run -p steadfirm-backend'"
echo "  3. cd web && bun run dev"
echo ""
echo "To seed with demo content (after services are running):"
echo "  4. ./infra/seed-dev.sh"
