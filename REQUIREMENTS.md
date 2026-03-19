# Meme Organiser — Full-Stack Build Prompt

You are given an empty repo. You need to one-shot build a full stack web app using specs below. Do not ask questions because I will not attend the build. Make reasonable assumptions if you need. Only stop when the app is fully built and tested according to spec.

## Overview
Build a full-stack meme management web app from an empty repository. The target users are meme collectors with thousands of memes who need to quickly find the perfect meme for a specific situation using natural language search.

This is a single-user local-first app for personal use, but the architecture should leave room for a future migration to PostgreSQL. There is no authentication, no multi-user support, and no external file storage in v1. The app must work fully offline once dependencies are installed, except for LLM calls.

The implementation should favor simplicity, reliability, and maintainability over unnecessary abstraction.

---

## Tech Stack
- Backend: Python 3.13+ + FastAPI
- Frontend: React + Vite, single-page app
- Database + Storage: SQLite only — meme image files are stored as BLOBs directly in SQLite (no filesystem or S3).
  - *Architecture Note:* Use SQLAlchemy (or a lightweight query builder) and a Repository pattern to isolate database operations. This ensures a future migration to PostgreSQL is feasible.
- LLM: Any OpenAI-compatible multimodal API. Must support switching between providers (e.g., GPT-5.4-mini, Kimi k2.5) by changing the base URL and model name via `.env`.
- Backend HTTP client: `openai` Python SDK (preferred for standardizing payloads) or `httpx`.
- Image processing: `Pillow`
- Frontend data fetching: native `fetch` for standard API calls, but use `XMLHttpRequest` or `Axios` for the upload endpoint to support real upload progress events.
- Frontend state: React hooks only; do not introduce Redux, MobX, etc., unless absolutely necessary.
- Styling: simple CSS modules or plain CSS; keep dependencies minimal.

---

## Environment Variables
Create a `.env` file at the repo root. The backend reads these at startup:

```env
OPENAI_API_KEY=...
OPENAI_BASE_URL=[https://api.openai.com/v1](https://api.openai.com/v1)  # Can be swapped for Kimi, DeepSeek, etc.
OPENAI_MODEL=gpt-4o

```

Also include a `.env.example` with the same keys and placeholder values.

If `OPENAI_API_KEY` is missing, the backend should still start successfully, but any LLM-dependent endpoint must return:

* HTTP `503`
* JSON error body:

```json
{
  "error": {
    "code": "llm_unavailable",
    "message": "LLM features are unavailable because OPENAI_API_KEY is not configured."
  }
}

```

LLM-dependent behavior includes background meme analysis and `POST /api/search/llm`. If the API key is missing, uploads should still succeed, but uploaded memes should transition to `analysis_status = error`.

---

## Core Product Assumptions

Assume for v1:

* uploaded memes are typically under 1 MB.
* uploaded memes are static images only (PNG, JPEG, WEBP).
* GIF, animated WEBP, HEIC, AVIF, SVG, and video must be rejected with a `415` error.
* duplicate uploads are allowed in v1.
* store a `sha256` hash for each image to support future deduplication.

---

## Database Schema

Use a single SQLite file named `memes.db`. Enable WAL mode and a sensible busy timeout.

### `memes`

| column | type | notes |
| --- | --- | --- |
| id | INTEGER PK | autoincrement |
| filename | TEXT | original upload filename |
| mime_type | TEXT | e.g. `image/png` |
| sha256 | TEXT | lowercase hex digest of original bytes |
| image_data | BLOB | raw file bytes |
| uploaded_at | DATETIME | UTC ISO 8601 timestamp |
| description | TEXT | LLM free-text description |
| why_funny | TEXT | LLM explanation of humour |
| references | TEXT | LLM cultural/pop-culture references |
| use_cases | TEXT | LLM suggested use cases |
| tags | TEXT | JSON array of strings |
| analysis_status | TEXT | one of `pending`, `done`, `error` |
| analysis_error | TEXT | nullable short error message for debugging/logging |

### `memes_fts`

A SQLite FTS5 virtual table covering: `filename`, `description`, `why_funny`, `references`, `use_cases`, and flattened `tags`.
Keep it in sync with `memes` using triggers on insert, update, and delete. Only index memes with `analysis_status = done`.

---

## API Design

All backend routes must be mounted under `/api`. All responses must be JSON unless explicitly returning image bytes.

### `POST /api/memes/upload`

Accept `multipart/form-data` with one or more image files.

* Validate MIME type and verify that each file is a decodable static image using Pillow synchronously (blocking is OK here).
* Reject files larger than 1.5 MB each with `413`.
* Allow up to 50 files per request. Partial success is allowed for multi-file upload.
* Store each valid file in SQLite with `analysis_status = pending`.
* Return created meme IDs immediately.
* Kick off analysis asynchronously using FastAPI `BackgroundTasks`.

### `GET /api/memes`

Return a paginated list of memes (excluding BLOB data). Support `?page=` and `?page_size=` (default 40, max 100). Sort newest first.

### `GET /api/memes/pending`

Return a lightweight array of meme IDs and their current status for all memes where `analysis_status` is `pending` or was recently updated to `done`/`error`.

```json
{
  "items": [
    { "id": 123, "analysis_status": "pending" },
    { "id": 124, "analysis_status": "done" }
  ]
}

```

### `GET /api/memes/{id}/image`

Return the raw image BLOB with the correct `Content-Type`. Do not base64-wrap.

### `GET /api/memes/{id}`

Return the full meme record excluding image bytes.

### `DELETE /api/memes/{id}`

Delete a meme. FTS triggers must handle cleanup.

### `GET /api/search?q=<query>&mode=fuzzy`

Run FTS5 search against `memes_fts`, rank by BM25, and return top 20 results.

### `POST /api/search/llm`

Body: `{ "query": "...", "top_n": 20 }`

Use a two-stage search strategy to save tokens and ensure reliability:

1. Run FTS to shortlist up to 200 candidate memes.
2. Batch them into chunks of **15** (to prevent LLM JSON array truncation).
3. Ask the configured LLM to score each meme from `0` to `10`.
4. The prompt MUST require OpenAI Structured Outputs (or explicit JSON array formatting) yielding: `[{ "id": 123, "score": 8.5, "reason": "..." }]`.
5. Aggregate valid batch results, sort by `score DESC`, and return the top `top_n`. Skip and log any failed batches without failing the whole request.

---

## LLM Analysis (Background Task)

When a meme is uploaded, analyze it asynchronously by sending the image inline as base64 to the multimodal endpoint.

**Concurrency & Safety:** Use an `asyncio.Semaphore(3)` (or similar mechanism) to limit concurrent LLM API calls. This prevents `429 Too Many Requests` when a user uploads 50 images at once.

**Required output schema:**

```json
{
  "description": "string",
  "why_funny": "string",
  "references": "string",
  "use_cases": "string",
  "tags": ["string", "..."]
}

```

**Recovery behavior:**
On startup, the backend must scan for rows with `analysis_status = pending` and enqueue them for analysis to handle interrupted jobs.

---

## Frontend — React + Vite

Single-page app with a two-column desktop layout (Left sidebar: controls; Main panel: grid).
Use a Vite development proxy so frontend code calls `/api/...` directly.

### 1. Gallery view (default)

Responsive grid of meme thumbnails. Show tags and `analysis_status` badges. Use standard pagination.

### 2. Upload (with Progress)

* Drag-and-drop zone and file picker.
* Use `XMLHttpRequest` or `Axios` to track and display a real **upload progress bar**.
* After upload success, poll `GET /api/memes/pending` every 3 seconds to update the UI globally until all pending items resolve to `done` or `error`.

### 3. Detail modal

Show full-size image, all LLM fields, and a delete button. Show errors clearly if `analysis_status = error`.

### 4. Search

* Search bar with 300ms debounce. Triggers fuzzy search by default.
* Show a "Not finding it? Try AI search" button below fuzzy results.
* Clicking it calls `POST /api/search/llm`, shows a loading state, and replaces results with LLM-ranked data.

### Security and Rendering

Render all LLM output as plain text only. No `dangerouslySetInnerHTML`. Do not log secrets or base64 payloads.

---

## Testing

Use `pytest` for backend and `Vitest` for frontend.
All tests must run without real network access and without a real API key (mock the LLM client). Include a full backend integration flow test.

---

## Project Structure

Standard split (`/backend` and `/frontend`). Include `.env.example`, `requirements.txt`, and `package.json`.

## Developer Experience

Include `pytest`, `ruff`, `vitest`, and `eslint`.
The `README.md` must include setup instructions, how to run dev servers, how to run tests/linting, and a short explanation of fuzzy vs. AI search.

## Implementation Constraints

* No external file storage, cloud infra, Redis, or Docker in v1.
* No social sharing, auth, or folders.
* Prefer clear code and predictable behavior over cleverness.

## Assumptions:

- Single-file invalid uploads return HTTP 413/415, while multi-file uploads keep partial success in a 200 response body.
- GET /api/memes/pending keeps recently completed or failed statuses in an in-memory 3 minute window so the frontend poller can observe state transitions.
- LLM calls try OpenAI JSON schema response_format first and fall back to prompt-only JSON if an OpenAI-compatible provider rejects structured outputs.
- The "fuzzy" search mode is implemented as SQLite FTS5 prefix matching across tokenized query terms instead of edit-distance matching.
