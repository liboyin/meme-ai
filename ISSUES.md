# Issues

1. ~~High: the metadata endpoints eagerly load full image blobs even when they only return metadata. models.py (line 16), repository.py (line 74), repository.py (line 77), main.py (line 200), main.py (line 208) query(Meme) and db.get(Meme, ...) pull image_data with every list/detail fetch, even though the image already has its own endpoint. With the current 1.5 MB upload cap and 40-item page size, /api/memes can read roughly 60 MB of blob data just to return filenames and tags. Simplest fix: make metadata-specific selects that exclude image_data now; if the library grows, split binary content from metadata or mark the blob column deferred.~~

   **Fixed:** Added `_METADATA_COLUMNS` constant (all columns except `image_data`) in `repository.py`. `list_memes` now uses `SELECT {_METADATA_COLUMNS}` and operates on raw dicts, skipping the `_row_to_meme` roundtrip. A new `get_metadata(meme_id) -> dict | None` method handles single-meme metadata fetches. `update_search_fields` uses a cheap `SELECT id` existence check and returns `get_metadata()`. `get_for_llm` likewise uses the metadata select. Only `GET /api/memes/{id}/image` and `analyze_and_store` retain `SELECT *` since they genuinely need the blob.

2. High: AI search results are not stable; normal gallery refreshes can silently replace them with fuzzy results. App.jsx (line 18), App.jsx (line 26), App.jsx (line 46), App.jsx (line 121), useMemesCollection.js (line 44), useSearch.js (line 13), useSearch.js (line 35), useSearch.js (line 73)
useSearch reruns fuzzy search whenever refreshToken changes, and that token changes after uploads, deletes, and pending-status updates. So a user can click AI search, see reranked results, and then lose them as soon as background polling refreshes the gallery. Simplest fix: stop coupling search invalidation to gallery refresh, and make the active search mode/request authoritative with cancellation or request IDs.

3. Medium: /api/memes/pending is backed partly by in-memory process state instead of persisted state. main.py (line 32), main.py (line 43), main.py (line 47), main.py (line 109), main.py (line 194)
recent_statuses makes the endpoint return short-lived done/error items that are not coming from the DB query, which means behavior depends on the current worker and disappears on restart. That is fine for a toy single-process app, but it is a poor API contract because the endpoint is no longer authoritative. Simplest fix: keep the job/status truth in SQLite and return only DB-backed states.

4. Medium: startup rewrites the full FTS index every time the app boots. main.py (line 133), init_db.py (line 19), init_db.py (line 86)
init_db() drops and recreates triggers, deletes all FTS rows, and reinserts every analyzed meme on each startup. Since the triggers already maintain the index during normal operation, this turns app boot into a full-table write pass for no steady-state benefit. Simplest fix: separate one-time schema setup/migrations from runtime startup, and only rebuild FTS when schema/version changes require it.

5. Medium: the backend image bakes .env into the image even though Compose already injects runtime env. Dockerfile.backend (line 14), docker-compose.yml (line 6), .gitignore (line 10), .dockerignore (line 1)
That is both a secret-handling smell and a build-time coupling to an untracked local file. The runtime path is already there via env_file, so COPY .env is redundant and makes the image less portable. Simplest fix: remove the copy and add .env to .dockerignore.

6. Low: the response-schema layer exists, but it does not actually own the response contract. schemas.py (line 4), main.py (line 20), main.py (line 214), repository.py (line 34), repository.py (line 64), repository.py (line 160)
Most response models are dead code, route handlers return ad-hoc dicts, one route calls a repository private method, and get_for_llm() appears test-only. That is not breaking today, but it is an awkward halfway design. Simplest fix: either wire real response_models and expose a public serializer, or delete the unused schema/serializer layer and keep one clear dict-based path.

# Simplifications

1. App.jsx (line 10) is carrying collection, polling, search, upload, modal-detail, delete, and drag/drop coordination, which is why Sidebar.jsx (line 1) and MemeGrid.jsx (line 1) have such wide prop surfaces. A single page-level hook/view-model would simplify this without adding much abstraction.
2. The client stack is noisier than necessary: fetch for most requests, axios only for uploads in useUpload.js (line 2), unused httpx in pyproject.toml (line 8), and createElement inside .jsx files in App.jsx (line 146). Standardizing on one transport style and plain JSX would make the code easier to scan.