# Meme Organiser

Meme Organiser is a local-first meme library built with FastAPI, React, Vite, and SQLite. Images are stored directly in SQLite as BLOBs, fuzzy search runs fully offline, and AI search only needs network access for the configured OpenAI-compatible multimodal provider.

## Setup

1. Copy the env template:

```bash
cp .env.example .env
```

2. Install backend dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

## Run The App

Start the FastAPI server from the repo root:

```bash
source .venv/bin/activate
uvicorn backend.main:app --reload
```

In a second terminal, start the Vite frontend:

```bash
cd frontend
npm run dev
```

The frontend uses the Vite proxy, so the browser talks to `/api/...` directly during development.

## Tests And Linting

Backend:

```bash
source .venv/bin/activate
cd backend
pytest
cd ..
.venv/bin/ruff check backend
```

Frontend:

```bash
cd frontend
npm run test
npm run lint
```

## Search Modes

Fuzzy search uses SQLite FTS5 with BM25 ranking. It is fast, local, and great when the text you type overlaps with filenames, descriptions, references, use cases, or tags.

AI search first gathers a fuzzy shortlist, then asks the configured multimodal LLM to score those candidates in chunks of 15. It is slower, but it helps when the best meme is semantically related even if the wording does not match.

## Notes

- If `OPENAI_API_KEY` is missing, the backend still starts, uploads still work, and LLM-dependent features return a `503` response with the required `llm_unavailable` body.
- Pending meme analysis is resumed on backend startup.
- Two sample memes are included under `assets/` for quick manual testing.
