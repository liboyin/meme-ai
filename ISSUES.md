# Issues

1. App.jsx (line 10) is carrying collection, polling, search, upload, modal-detail, delete, and drag/drop coordination, which is why Sidebar.jsx (line 1) and MemeGrid.jsx (line 1) have such wide prop surfaces. Sidebar receives ~19 props, MemeGrid ~13, MemeDetailModal ~6. A single page-level hook/view-model would consolidate this coordination without adding much abstraction.

2. The client stack is noisier than necessary: fetch for most requests, axios only for uploads in useUpload.js (line 2), unused httpx in pyproject.toml (line 8), and createElement inside .jsx files in App.jsx (line 146). Standardizing on fetch everywhere and plain JSX would make the code easier to scan. The httpx removal is a one-liner; replacing axios with fetch in useUpload.js removes the dependency entirely.

3. _api_payload in repository.py (lines 78–115) has a dual-dispatch inner helper get() that handles both Meme instances and Mapping inputs. Since get_for_llm was deleted, every call site now passes a plain dict(row). The Meme branch and the get() abstraction are dead code; the method can become a straightforward dict transform.

4. _safe_parse_tags in repository.py (lines 51–70) defensively handles list, None, non-string, invalid JSON, and non-array JSON inputs. Tags are always written by the application itself via json.dumps(list), so most of these branches are unreachable. The whole function can be reduced to: return json.loads(tags) if isinstance(tags, str) else (tags or []).

5. analyze_and_store in main.py calls still_pending() three times (lines 147, 152, 156), each round-tripping to the database. The scenario it guards against — a meme being deleted between steps — doesn't justify three separate checks. One check at the start of the async operation followed by unconditional updates is simpler and no less correct.

6. refreshToken is in the dependency array of the detail-panel loading effect in App.jsx (line 112). Every upload, delete, or pending-status poll increments refreshToken, forcing a detail reload even when the open meme hasn't changed. The detail only needs to reload when detailId changes or when the user explicitly saves; refreshToken should be removed from that effect's dependencies.
