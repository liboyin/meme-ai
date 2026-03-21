#!/usr/bin/env bash
set -euo pipefail

uv sync --group dev
npm install -g npm@11.12.0
cd frontend
npm install
