#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Check for .env file
if [ ! -f .env ]; then
  echo "Error: .env file not found. Copy .env.example to .env and fill in your values:"
  echo "  cp .env.example .env"
  exit 1
fi

echo "Starting PostgreSQL..."
docker compose up -d postgres

echo "Waiting for PostgreSQL to be healthy..."
until docker compose exec postgres pg_isready -U "${POSTGRES_USER:-claude}" -d "${POSTGRES_DB:-claude_workflow}" > /dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready."

echo "Starting all services..."
docker compose up -d

echo "Services started. Web server available at http://localhost:3000"
