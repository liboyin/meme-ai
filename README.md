# Meme Organiser

Full-stack local-first meme manager built with FastAPI + React (Vite) + SQLite.

## Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Backend install/run:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

3. Frontend install/run:

```bash
cd frontend
npm install
npm run dev
```

Frontend calls `/api/...` and Vite proxies to backend.

## Tests and linting

```bash
pytest backend/tests
ruff check backend
cd frontend && npm run test
cd frontend && npm run lint
```

## Search modes

- **Fuzzy search** (`GET /api/search`): SQLite FTS5 BM25 ranking over filename + LLM fields.
- **AI search** (`POST /api/search/llm`): runs fuzzy shortlist then LLM reranking in batches of 15.

## Notes

- Uploaded images are stored as SQLite BLOBs.
- If `OPENAI_API_KEY` is missing, app still runs, uploads succeed, and LLM-dependent endpoints return 503.
