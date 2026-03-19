# Meme Organiser

Full-stack local-first meme manager built with FastAPI + React (Vite) + SQLite.

## Setup (without Docker)

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

## Docker

Run the full stack with Docker Compose:

```bash
cp .env.example .env
docker compose up --build
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173`
- SQLite DB persists in Docker volume `meme_data` at `/data/memes.db` inside backend container.

## VS Code Dev Container

This repo includes a dev container config in `.devcontainer/`.

1. Install the **Dev Containers** extension in VS Code.
2. Open this repo.
3. Run **Dev Containers: Reopen in Container**.

The container installs Python 3.13 + Node.js 24, forwards ports `8000` and `5173`, and runs dependency installation after create.

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
