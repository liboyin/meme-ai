#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/update_dependencies.sh [--commit]

Refresh the Python lockfile, reinstall dev dependencies, and run the
project checks that should pass before promoting the update.

Options:
  --commit    Create a git commit for the updated uv.lock if checks pass
  -h, --help  Show this help message
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

commit_changes=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      commit_changes=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_cmd git
require_cmd uv
require_cmd npm

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before updating dependencies." >&2
  exit 1
fi

echo "Refreshing uv.lock..."
uv lock --upgrade

echo "Syncing backend development dependencies from uv.lock..."
uv sync --locked --group dev

echo "Installing frontend dependencies from package-lock.json..."
npm ci --prefix frontend

echo "Running backend lint..."
uv run --group dev ruff check backend

echo "Running backend tests..."
uv run --group dev pytest backend/tests

echo "Running frontend lint..."
npm --prefix frontend run lint

echo "Running frontend tests with coverage..."
npm --prefix frontend run test:coverage

echo "Running frontend build..."
npm --prefix frontend run build

if (( commit_changes )); then
  if [[ -z "$(git status --porcelain)" ]]; then
    echo "No dependency changes were produced."
    exit 0
  fi

  git add uv.lock
  git commit -m "chore: updated dependencies on ($(date -u +%Y-%m-%d))"
  echo "Created git commit for updated dependencies."
else
  echo "Checks completed with no changes."
fi
