#!/usr/bin/env bash
set -euo pipefail

python -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
npm install -g npm@11.12.0
cd frontend
npm install
