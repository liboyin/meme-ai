#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

cd "${repo_root}"
uv sync --locked --group dev
npm ci --prefix frontend

# devcontainer-features/claude-code installs as root, so ~/.claude and ~/.claude/plugins are owned by root
sudo chown vscode:vscode ~/.claude ~/.claude/plugins
