# Meme Organiser

Meme Organiser is a local-first meme library built with FastAPI, React, Vite, and SQLite. Images are stored directly in SQLite as BLOBs, fuzzy search runs fully offline, and AI search only needs network access for the configured OpenAI-compatible multimodal provider.

## Architecture

- `backend/` contains the FastAPI app, SQLite repository, database initialisation, image validation, perceptual hashing, the OpenAI-compatible LLM client, and a standalone analysis worker.
- `frontend/` contains the React/Vite app for upload, browsing, sorting, metadata editing, fuzzy search, and AI-assisted search.
- Runtime configuration comes from environment variables or `.env`; `DB_PATH` selects the SQLite database path and the `OPENAI_*` variables configure the multimodal provider.
- The Vite dev server proxies `/api/...` to FastAPI, so the frontend can use the same API paths in development that it expects in production-style routing.

## Dataflow

1. The user uploads up to 50 PNG, JPEG, or WEBP files through the frontend.
2. FastAPI validates file size, detected image type, and animation status, then stores accepted image bytes in SQLite with `sha256`, perceptual hash, upload time, and pending analysis status.
3. A separate worker process claims pending rows from SQLite, asks the configured multimodal LLM for searchable metadata, then stores the description, references, use cases, and tags. If the LLM is unavailable or fails, the meme remains usable with an error status.
4. SQLite FTS5 indexes completed searchable fields. Fuzzy search queries FTS5 directly; AI search first gathers a fuzzy shortlist and then asks the LLM to re-rank candidates.
5. The frontend polls pending analysis state so newly uploaded or recovered memes appear as their metadata becomes available.

## Design Decisions

- Images live in SQLite BLOBs to keep the app local-first and avoid coordinating a separate object store.
- Exact duplicate uploads are rejected by `sha256`; perceptual hashes are stored for comparison and sorting, but visually similar memes are allowed.
- Pending rows in SQLite are the durable analysis queue. The API process stays responsive while a separate worker handles LLM calls, and abandoned worker locks can be reclaimed.
- Manual metadata edits mark a meme as analysed and take precedence over late worker analysis results.
- `uv` intentionally has no default dependency groups, keeping production installs minimal unless `--group dev` is requested.

## Prerequisites

- Python 3.13+
- Node.js 18+
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)

## Setup

1. Copy the env template:

```bash
cp .env.example .env
```

2. Install backend dependencies with `uv`:

```bash
# Development (includes pytest, mypy, ruff, ipython):
uv sync --group dev

# Production (runtime dependencies only):
uv sync
```

`default-groups = []` is set intentionally so a bare `uv sync` produces a minimal production install. The `--group dev` flag is always required to run tests or linting.

3. Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

## Run The App

Start the FastAPI server from the repo root:

```bash
uv run uvicorn backend.main:app --reload
```

In a second terminal, start the analysis worker:

```bash
uv run python -m backend.app.worker
```

In a third terminal, start the Vite frontend:

```bash
cd frontend
npm run dev
```

Then open `http://localhost:5173` in your browser.

The frontend uses the Vite proxy, so the browser talks to `/api/...` directly during development.

The devcontainer starts with `.env` loaded through Docker's `--env-file` option. Rebuild or reopen the container after changing `.env` so the container receives the updated environment variables.

## Tests And Linting

Backend:

```bash
uv run --group dev pytest backend
uv run --group dev mypy
uv run --group dev ruff check backend
```

Backend coverage is enforced by `pytest` and fails below 85%.

Frontend:

```bash
cd frontend
npm run test
npm run test:coverage
npm run lint
```

Frontend coverage is enforced by `npm run test:coverage` and fails below the configured thresholds.

## Search Modes

Fuzzy search uses SQLite FTS5 with BM25 ranking. It is fast, local, and great when the text you type overlaps with filenames, descriptions, references, use cases, or tags.

AI search first gathers a fuzzy shortlist, then asks the configured multimodal LLM to score those candidates in chunks of 15. It is slower, but it helps when the best meme is semantically related even if the wording does not match.

## Notes

- If `OPENAI_API_KEY` is missing, the backend still starts, uploads still work, and LLM-dependent features return a `503` response with the required `llm_unavailable` body.
- Image fixtures under `assets/` cover valid uploads and validation failures for quick manual testing.
