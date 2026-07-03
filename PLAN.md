# Comprehensive Review & Improvement Plan — Meme Organiser

Reviewed: 2026-07-03. Scope: every source file, tests, docs, and infra (~6.5k lines), assessed against the app's designed purpose — a single-user, local-first meme library for collectors with **thousands of memes**, searchable via FTS5 and LLM re-ranking.

**Overall verdict:** the codebase is in good shape — clean layering (API → repository → SQLite), a well-designed durable worker queue (stale-lock reclaim, conditional updates so manual edits beat late analysis), broad test suites on both stacks, CI, multi-stage non-root Docker images with a comprehensive `.dockerignore` already in place, and unusually disciplined docs. The findings below are mostly drift, latent bugs, and scalability gaps — not structural problems.

---

## Findings

### A. Correctness bugs / latent failures

1. **Production uploads break at nginx (highest-impact bug).** `nginx.conf` has no `client_max_body_size`; nginx's default is **1 MB**, but the backend accepts 2 MB/file × 100 files (`backend/app/main.py:35,136`). Any upload > 1 MB through the docker-compose frontend gets a raw nginx 413 the app never sees. The Vite dev proxy hides this, so UAT wouldn't catch it.
2. **Upload endpoint blocks the event loop.** `upload_memes` (`backend/app/main.py:133`) is `async def` but runs Pillow decode ×2, `imagehash.phash` (DCT), and sha256 inline for up to 100×2 MB files — freezing *all* requests (including the 3 s pending-poll the UI depends on) for the duration.
3. **LLM ranking never actually uses structured outputs on OpenAI.** `RANKING_SCHEMA` (`backend/app/llm.py:40`) has a top-level `array`, which OpenAI's `json_schema` mode rejects (root must be an object) → every ranking call 400s and silently falls back to prompt-only JSON. The parsing code already handles `{"results": [...]}` (`llm.py:307`), so wrapping the schema in an object is a near one-line fix. REQUIREMENTS.md explicitly mandates structured outputs here.
4. **Decompression-bomb PNG → 500 + CPU burn.** `validate_image_bytes` only catches `UnidentifiedImageError`; a 2 MB gigapixel PNG raises Pillow's `DecompressionBombError` (uncaught → 500), and `phash` on a near-limit image burns CPU on the event loop (compounds #2). Also: the size check runs *after* `await file.read()` loads the whole file into RAM — a 10 GB upload is fully buffered before the 413.
5. **AI search can return duplicate memes.** `llm_rank` doesn't dedupe ids (the prompt merely asks nicely); `ai_search` (`backend/app/main.py:247-251`) appends once per ranked item and also mutates the shortlist dicts in place. A model returning an id twice yields duplicate cards (duplicate React keys downstream).
6. **LLM-produced tags aren't deduped** (`_normalise_analysis_payload`, `backend/app/llm.py:119`) — manual edits dedupe via `MemeIndexFieldsIn`, analysis results don't. Duplicate tags → React `key={tag}` collisions in `frontend/src/components/MemeGrid.jsx:102`.
7. **Misleading docstring on an intentional behavior.** `validate_image_bytes`'s docstring says the declared MIME is "cross-check[ed] against detected format" (`backend/app/main.py:70`) — it's intentionally *ignored* (a unit test documents this as a UAT regression guard). The docstring contradicts a deliberate design choice.

### B. Infra & security

8. **Backend port needlessly published + wildcard CORS + no auth.** Compose publishes `8000:8000` even though nginx proxies `/api`; `allow_origins=["*"]` (`backend/app/main.py:129`). On a LAN deployment anyone can hit DELETE endpoints directly, and any website in the user's browser can script against `localhost:8000`. Single-user local-first is the stated scope, but the defaults widen it silently.
9. **No `restart:` policies or healthchecks in docker-compose** — a crashed worker stays dead; `depends_on` is start-order only.
10. **Runtime dependencies are frozen in 2024.** `fastapi==0.115.0`, `openai==1.52.2`, `pillow==10.4.0`, `pydantic==2.9.2` — while dev deps are current (ruff 0.15, pytest 9). Pillow is the untrusted-input parser here, so lagging it has real CVE exposure. The `openai` pin even required a workaround comment (`llm.py:73-74`) for an httpx incompatibility that upgrading would erase.
11. **`update_dependencies.sh` structurally can't update anything.** All pins are `==`, so `uv lock --upgrade` can only move transitive deps; the frontend just runs `npm ci` (installs, never upgrades). Also: its usage text says `scripts/update_dependencies.sh` (wrong path), and it skips `mypy`, which AGENTS.md requires after any change. This explains finding #10.
12. **Node version matrix inconsistent:** README "Node 18+", CI 22, devcontainer & Dockerfile.frontend 24.
13. **`.claude/settings.json` denies `Read(./.env)` but allows all `Bash` with `dontAsk`** — the deny is decorative (any shell command can read it). Worth knowing, since `.env` holds the API key.
14. **No caching for images.** `/api/memes/{id}/image` sends no `Cache-Control`/`ETag`; every gallery refresh (which pending-polling triggers) can re-fetch full-size BLOBs.

### C. Architecture & code smells

15. **Repository returns API-shaped payloads.** `MemeRepository._api_payload` builds JSON-response dicts inside the data layer, and methods inconsistently return `Meme` dataclasses vs dicts. Presentation shaping belongs to the Pydantic schemas; the repo should return one row type.
16. **`create_meme(**kwargs: Any)`** (`backend/app/repository.py:116`) — a typed method with 13 real parameters hidden behind kwargs; typos become runtime KeyErrors and mypy can't help.
17. **Module-level `settings = Settings()` singleton** (`backend/app/config.py:15`) forces the test suite to `reload()` eight modules per fixture call (`backend/tests/conftest.py:103-112`) — the clearest "design choice that makes testing unnecessarily difficult" by AGENTS.md's own criterion.
18. **Throughput is serial everywhere despite concurrency scaffolding.** The worker processes one meme at a time, so `Semaphore(3)` (`llm.py:21`) is vestigial; 100 uploads drain in ~15–30 min. `llm_rank` runs up to 14 chunk calls *sequentially* — AI search over a 200-item shortlist can take minutes with no frontend timeout.
19. **`analysis_attempts` is incremented but never read** — no retry cap/backoff; a meme that crashes the worker mid-analysis is reclaimed and retried forever every 15 min.
20. **Dead/fragile bits:** `ErrorBody` schema unused; duplicate detection parses the IntegrityError message string (`"sha256" in exc.args[0]`, `repository.py:181`); analysis prompt string concatenation is missing spaces ("…references.suggest likely cases…", `llm.py:224-227`); `claim_pending_analysis` returns the BLOB, then `analyze_and_store` re-fetches the same BLOB on a new connection.
21. **Undocumented deviation from REQUIREMENTS: the PostgreSQL escape hatch is gone.** REQUIREMENTS.md mandated SQLAlchemy/query-builder + Repository "so a future migration to PostgreSQL is feasible." The implementation is raw `sqlite3` with FTS5 virtual tables, triggers, `json_each`, `BEGIN IMMEDIATE` — deeply SQLite-coupled. Probably the right call for v1 simplicity, but README's Design Decisions never records that this goal was dropped.
22. **pHash sort is a lexicographic string sort** offered in the UI as a similarity-ish ordering; hex-prefix order only weakly correlates with visual similarity. Undocumented as a limitation.
23. **Ruff runs at default settings** (only pycodestyle-errors + pyflakes) — no isort, bugbear, pyupgrade, etc. The lint gate is much weaker than the toolchain implies; mypy also excludes `backend/tests`.

### D. Documentation drift (violates the project's own "single source of truth" rule)

24. Commit 8fae766 raised limits to **100 files / 2 MB**, but: README dataflow still says "up to 50"; `Sidebar.jsx:71` says "pick up to 50 at once"; UAT_PLAN §3/§4 still says "1.5 MB limit" and UP-07 "confirms the 50-file cap" (now wrong — 51 files would succeed).
25. REQUIREMENTS.md "Assumptions" describe a 3-minute in-memory recently-done window for `/api/memes/pending` that was never implemented (the endpoint returns pending+error rows; the frontend infers "done" by disappearance). A stale test name (`test_validate_image_bytes_and_recent_status_snapshot`) still references it.
26. README documents only the three-terminal dev workflow — the entire docker-compose/nginx production deployment (5 commits of work) is undocumented anywhere.
27. UAT_PLAN §6 tells the agent to file issues in `ISSUES.md`, which doesn't exist. UAT_PLAN AN-02 asserts banner text "being analysed, including startup recovery"; actual text is "queued for worker analysis" (`MemeGrid.jsx:58`).

### E. Product-scope & UX gaps

28. **No thumbnails — the biggest scalability gap vs the stated purpose.** The grid loads *full-size originals* (≤2 MB each, 40/page ⇒ up to ~80 MB per page) for a product aimed at "thousands of memes". Combined with #14 (no caching), browsing a large library will be painful.
29. **Delete has no confirmation** (`MemeDetailModal.jsx:217`) — one mis-click permanently destroys a meme (the only copy, since images live only in SQLite). No export/backup path exists either.
30. **Modal a11y:** no Escape-to-close, no focus trap, no `aria-modal`; `frontend/index.html` lacks a `lang` attribute. (UAT RO-04 already flags this area as "record findings".)
31. **AI search inherits FTS recall.** If the fuzzy shortlist is empty, AI search returns nothing — a purely semantic query with zero token overlap can't be found. This is the spec's two-stage design, but it's the main functional ceiling of "natural language search" and deserves a documented note (or a future embeddings index).
32. **Test-quality drift vs own guideline** ("tests MUST encode WHY, not just WHAT"): several backend tests are kitchen-sink coverage sweeps (`test_repository_edge_cases`, `test_llm_helpers_cover_validation_and_json_extraction`), and the frontend suite has ~6 near-identical "falls back to default error message" permutations — coverage-chasing rather than behavior-encoding.

---

## Improvement Plan (prioritized, within designed purpose)

### Phase 1 — Correctness & deployment fixes (small diffs, high value)
- `nginx.conf`: add `client_max_body_size 250m;` (100×2 MB + multipart overhead) for the `/api/` path. *(#1)*
- `backend/app/main.py`: check `file.size` before reading; run the validate+phash+sha256 pipeline in a thread (`anyio.to_thread.run_sync`) so the event loop stays free; catch `Image.DecompressionBombError` → 415 and set an explicit `Image.MAX_IMAGE_PIXELS`. *(#2, #4)*
- `backend/app/llm.py`: wrap `RANKING_SCHEMA` in `{"type":"object","properties":{"results":{…array…}},"required":["results"]}` (parser already accepts it); dedupe ranked ids (keep best score); dedupe tags in `_normalise_analysis_payload`; fix prompt spacing. *(#3, #5, #6)*
- `docker-compose.yml`: add `restart: unless-stopped` to all services; drop the `8000:8000` publish (or bind `127.0.0.1:8000:8000` for debugging). Replace CORS `*` with explicit dev origins (`http://localhost:5173`). *(#8, #9)*
- `MemeDetailModal.jsx`: confirm before delete; add Escape-to-close. `index.html`: `<html lang="en">`. *(#29, #30)*

### Phase 2 — Scalability for "thousands of memes"
- **Thumbnails:** generate a ~320 px WEBP at upload time (inside the Phase-1 threadpool pipeline), store in a `thumbnail_data BLOB` column (added via the existing `_ensure_column` migration helper in `init_db.py`), serve at `GET /api/memes/{id}/thumbnail`, use it in `MemeGrid`; keep the original in the detail modal. *(#28)*
- **HTTP caching:** `Cache-Control: private, max-age=31536000, immutable` + `ETag: sha256` on image/thumbnail responses (bytes for a given id never change). *(#14)*
- **Concurrency:** worker claims up to N memes and runs `analyze_and_store` under the existing semaphore via `asyncio.gather`; `llm_rank` fires chunk requests concurrently (bounded by the same semaphore). Use `analysis_attempts` to cap reclaims (e.g. ≥3 → `error`). *(#18, #19)*

### Phase 3 — Code hygiene & testability
- `repository.py`: give `create_meme` explicit typed parameters; return `Meme` (or a slim metadata dataclass) everywhere and move API shaping into the Pydantic schemas; detect duplicates via `sqlite3.IntegrityError.sqlite_errorcode` / index name rather than message substring; have `analyze_and_store` accept the already-fetched `Meme` from the claim. *(#15, #16, #20)*
- `config.py`: expose a cached `get_settings()` factory so tests override one function instead of reloading eight modules; simplify `conftest.load_test_modules` accordingly. *(#17)*
- Delete `ErrorBody`; fix the `validate_image_bytes` docstring to state that declared MIME is deliberately ignored. *(#20, #7)*
- `pyproject.toml`: enable a real ruff ruleset (`I`, `B`, `UP`, `SIM`, `C4`); add `backend/tests` to mypy files. *(#23)*
- Dependencies: switch runtime pins to compatible ranges (`>=X,<Y` — `uv.lock` still guarantees reproducibility), upgrade openai (delete the httpx workaround), Pillow, FastAPI, pydantic; extend `update_dependencies.sh` with npm upgrades (e.g. `npm-check-updates`), a mypy step, and the correct usage path. Align Node versions (pick 24; update README + CI). *(#10, #11, #12)*

### Phase 4 — Documentation sync (cheap, mandated by AGENTS.md)
- README: fix "50" → 100 files / 2 MB; add a "Run with Docker Compose" section (nginx, volumes, ports); record the design decision that PostgreSQL portability was dropped in favor of SQLite-native FTS5/triggers; note the pHash-sort limitation and the AI-search-needs-FTS-overlap ceiling. *(#21, #22, #24, #26, #31)*
- `Sidebar.jsx` copy: "up to 100 at once". *(#24)*
- UAT_PLAN: update limits (2 MB / 100 files, UP-07 → 101 files), AN-02 banner text, drop or create `ISSUES.md`. Mark REQUIREMENTS.md as a historical build prompt (or excise the unimplemented 3-minute-window assumption). *(#25, #27)*
- `.claude/settings.json`: accept (or document) that the `.env` read-deny is advisory only given the blanket Bash allow. *(#13)*

### Phase 5 — Optional / future (flagged, not scheduled)
- Local embeddings index (e.g. sqlite-vec + a small local model) to lift the FTS-shortlist ceiling on semantic search. *(#31)*
- Export/backup command (dump images + metadata to a folder) — mitigates "SQLite is the only copy". *(#29)*
- Consolidate redundant test permutations into behavior-named tests when those files are next touched. *(#32)*

## Verification
- `uv run --group dev pytest` + `uv run --group dev mypy` + `uv run --group dev ruff check backend`; `cd frontend && npm run test:coverage && npm run lint` (per-file ≥80% gates must stay green).
- New unit tests: threadpooled upload validation (incl. bomb → 415), ranking-schema object wrapper + id dedupe, tag dedupe, thumbnail endpoint, attempts cap.
- End-to-end: `docker compose up --build`, then upload a >1 MB fixture (`assets/valid_large.jpg`) **through nginx on port 80** — the regression that motivates Phase 1. Confirm the gallery uses `/thumbnail`, images return 304/cache hits on refresh, and the worker restarts after `docker kill`.
- Re-run relevant UAT scenarios (UP-01…UP-08, AI-01, AN-01) per the updated UAT_PLAN.
