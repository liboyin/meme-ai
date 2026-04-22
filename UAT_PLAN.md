# User Acceptance Test Plan — Meme Organiser

## 1. Scope & Philosophy

This plan targets an LLM agent driving a real browser against the running dev stack
(`http://localhost:5173`, backed by `http://localhost:8000/api`). It covers every
user-reachable feature surfaced through the SPA in `frontend/src/`, plus the
async and error behaviours called out in the README and in `backend/app/`.

Every scenario below is written as a *self-contained* script: preconditions,
steps, and explicit pass/fail assertions. The agent must not skip the assertions
— passing the steps without verifying outcomes does not constitute a pass.

### Tool Recommendation

**Use [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp)** (Playwright's
official MCP server for LLM agents), not raw Playwright scripting and not
pixel-based computer-use.

Rationale:

| Need | Why Playwright-MCP wins |
|------|------------------------|
| Deterministic selectors | The UI already uses stable class names (`dropzone`, `searchInput`, `statusBadge`, `dangerButton`) and button text. |
| Network assertion | We must verify `POST /api/memes/upload`, `GET /api/memes/pending` polling, `POST /api/search/llm`, and 503 handling. Playwright exposes request/response events directly. |
| File-upload primitives | `setInputFiles` is built in; drag-drop of real `File` objects is possible. Pixel-based tools cannot attach files reliably. |
| Accessibility-tree snapshots | The MCP server returns semantic DOM snapshots each step, which are ideal input for an LLM planner and far cheaper than screenshots. |
| Screenshots on demand | Available when visual verification is needed (progress bar, pulse animation, badge colours). |
| Retry/wait primitives | `waitFor` with selectors handles the 300 ms search debounce and 3 s pending-polling cadence without `sleep`. |

Fallback: if a scenario genuinely needs vision (e.g. asserting a CSS pulse
animation is running), capture a screenshot via the same MCP session.

---

## 2. Environment Preconditions

Verify before any scenario runs. If any fails, abort and report the setup gap.

1. **Backend reachable:** `GET http://localhost:8000/api/memes?page=1&page_size=1` returns `200`.
2. **Frontend reachable:** `GET http://localhost:5173` returns HTML containing the Vite entrypoint.
3. **Clean DB state for the run** — choose one:
   - *Preferred:* point the backend at a throwaway `DB_PATH` via env (e.g. `meme_uat.db`) and delete it before each full run.
   - *Acceptable:* at start of run, enumerate `GET /api/memes` and `DELETE /api/memes/{id}` for every existing meme.
4. **API-key awareness:** record whether `OPENAI_API_KEY` is set. Split the suite into two lanes:
   - **Lane A (key present):** run everything including AI-search and analysis-completion scenarios.
   - **Lane B (key absent):** run only the `llm_unavailable` scenarios (§6.2). Skip scenarios that require `analysis_status === "done"`.
5. **Fixtures available:** all 8 files listed in §3 exist under `assets/`.

---

## 3. Test Data

All fixtures live under `assets/` in the repository root. No generation step is needed.

| Fixture | Size | Purpose |
|---------|------|---------|
| `valid_small.jpeg` | 21 KB | Happy-path upload (primary) |
| `valid_medium.jpg` | 118 KB | Happy-path upload (secondary) |
| `valid_large.jpg` | 809 KB | Third distinct happy-path upload |
| `valid_webp.webp` | 143 KB | WEBP acceptance |
| `too_big.png` | 2.4 MB | 413 path (exceeds 1.5 MB limit) |
| `animated.gif` | 1.5 MB | 415 path (animated rejection) |
| `svg_disguised.png` | 114 B | MIME-vs-bytes mismatch rejection (SVG content, `.png` extension) |
| `duplicate.jpeg` | 21 KB | 409 duplicate-SHA path (byte-identical to `valid_small.jpeg`) |

---

## 4. Scenario Inventory

Scenarios are grouped by feature. Each has an ID (e.g. `UP-01`) so a report
can reference failures unambiguously. Numbering gaps are intentional.

### 4.1 Upload (UP)

#### UP-01 — Happy path, single valid JPEG (drag-drop)
**Pre:** Gallery empty.
**Steps:**
1. Open `/`.
2. Drop `assets/valid_small.jpeg` onto the `.dropzone` element.
3. Observe progress bar (`.progressMeter > div` width transitioning 0→100).
4. Wait for success message matching `/\d+ memes uploaded/i`.

**Assert:**
- `POST /api/memes/upload` request fired with `multipart/form-data`, status `200`.
- Response body contains `items[0].status === "created"` and numeric `id`.
- Sidebar "Library size" increments by 1.
- New card appears in grid with filename `valid_small.jpeg` and a `pending` badge.
- Subsequent `GET /api/memes/pending` polling fires at ≈3 s cadence.

#### UP-02 — Happy path, file-picker multi-upload
**Steps:** Click "Choose files", set `assets/valid_small.jpeg`, `assets/valid_medium.jpg`, and `assets/valid_large.jpg` at once via `setInputFiles`.
**Assert:** Single POST with 3 parts; 3 `created` items; 3 new cards.

#### UP-03 — Mixed valid + invalid batch
**Steps:** Upload `assets/valid_small.jpeg`, `assets/animated.gif`, `assets/valid_webp.webp` in one batch.
**Assert:** Response `200`; `items` contains two `created` and one `error` whose
`error` message matches `/Animated/i`. Two new cards appear; an error line with
the animated-file message is rendered in the upload error block
(`.errorText`). Library size increments by 2.

#### UP-04 — Oversized file rejected
**Steps:** Upload `assets/too_big.png` alone.
**Assert:** Error message in UI contains "too large" and the filename; no new
card appears; library size unchanged. (`POST` returns 413 for single-file path.)

#### UP-05 — Wrong MIME rejected
**Steps:** Upload `assets/svg_disguised.png` (SVG content with a `.png` extension).
**Assert:** UI shows "Unsupported file type" with filename; no new card.

#### UP-06 — Duplicate SHA256
**Steps:** Upload `assets/valid_small.jpeg`, then upload `assets/duplicate.jpeg` (byte-identical copy).
**Assert:** Second upload surfaces "A meme with the same sha256 already exists.";
library size increments by only 1.

#### UP-07 — Size-limit enforcement at batch boundary
**Steps:** Submit 51 tiny files in one request.
**Assert:** UI shows a server-side rejection; library size unchanged.
(Confirms the 50-file per-request cap.)

#### UP-08 — Progress feedback is live
**Steps:** Upload `assets/valid_large.jpg` and read progress-bar width at least three
distinct times before completion.
**Assert:** Width values strictly increase and terminate at 100%.

### 4.2 Gallery & Pagination (GA)

#### GA-01 — Empty state
**Pre:** DB cleaned.
**Assert:** Heading "Your meme vault is empty" visible; no grid cards rendered;
sort dropdown disabled or hidden with no items; sidebar stats read 0 total.

#### GA-02 — Default sort is newest-first
**Pre:** Upload three memes with staggered timestamps (use controlled sleeps
between upload requests or rely on monotonic upload order).
**Assert:** Grid order matches newest-uploaded first. Confirm via
`GET /api/memes?page=1&page_size=40&sort_by=uploaded_at&sort_order=desc`.

#### GA-03 — Sort switch resets to page 1
**Pre:** Upload 12 memes, then page to page 2 (if applicable) or verify the
request; change page size to reproduce if needed.
**Steps:** On a non-first page, change sort dropdown to "Filename (A–Z)".
**Assert:** Request fires with `sort_by=filename&sort_order=asc&page=1`.

#### GA-04 — Pagination controls
**Pre:** 45 memes present (batch-upload enough fixtures).
**Assert:** Page 1 shows 40 cards, "Previous" disabled, "Next" enabled. Click
"Next": page 2 shows 5 cards; "Next" disabled; header reads "Page 2 of 2".

#### GA-05 — Sort dropdown hides during search
**Steps:** Type into search input.
**Assert:** Sort dropdown disappears; grid re-renders as search results.

#### GA-06 — Lazy image loading
**Assert:** Each `<img>` inside a grid card carries `loading="lazy"`.

### 4.3 Detail Modal & Metadata Edit (DM)

#### DM-01 — Open and inspect
**Pre:** At least one meme with `analysis_status === "done"` (Lane A only).
**Steps:** Click a card.
**Assert:** Modal appears; `GET /api/memes/{id}` fires; filename, MIME,
description, why_funny, references, use_cases, and tag chips render.
`GET /api/memes/{id}/image` serves the image.

#### DM-02 — Close via backdrop click
**Steps:** Open modal; click outside the card.
**Assert:** Modal unmounts; URL unchanged; no stray network calls.

#### DM-03 — Close via "Close" button
**Assert:** Modal unmounts; focus returns to the originating card if a11y
support exists (nice-to-have).

#### DM-04 — Enter edit mode and cancel
**Steps:** Click "Edit fields"; mutate description textarea; click "Cancel changes".
**Assert:** Edit mode exits; description reverts to saved value; no
`PUT /api/memes/{id}` fires.

#### DM-05 — Save metadata updates
**Steps:** Edit all five fields (description, why_funny, references,
use_cases, tags = `"a, b, a, , c "`).
**Assert:**
- `PUT /api/memes/{id}` with normalised body: `tags === ["a","b","c"]`.
- Response 200; modal switches back to view mode with updated values.
- Grid card reflects new description preview and first four tags.

#### DM-06 — Save failure preserves draft
**Steps:** Interfere with the save — either pause the backend, or use Playwright
`page.route('**/api/memes/*', r => r.abort())` on the PUT — then click Save.
**Assert:** Error text appears in modal; form remains in edit mode with
user's unsaved values intact; removing the interference and re-clicking Save
succeeds.

#### DM-07 — Delete meme
**Steps:** Open modal; click "Delete meme".
**Assert:** `DELETE /api/memes/{id}` fires; returns `{deleted: true}`;
modal closes; card disappears from grid; library size decrements.

#### DM-08 — Detail of pending meme
**Steps:** Immediately after upload (before analysis completes), click the new card.
**Assert:** Modal shows `pending` badge, placeholder message for description,
no error line. Editing is still allowed (fields are empty strings).

#### DM-09 — Detail of errored analysis
**Pre:** Force an analysis error (Lane B: simply upload without a key; the meme
enters `error` status shortly after upload) or inject via repository in a test-only route.
**Assert:** Red error line visible; `analysis_error` from API rendered.

### 4.4 Fuzzy Search (FS)

#### FS-01 — Results after debounce
**Pre:** ≥5 analysed memes with distinctive descriptions.
**Steps:** Type a 2-word query (~10 characters). Observe network tab.
**Assert:** Number of `GET /api/search?mode=fuzzy` requests ≤ 2 over the typing
window (debounce of 300 ms is respected). Final response populates the grid.

#### FS-02 — Clearing input returns to gallery
**Steps:** Delete all search text.
**Assert:** Grid reverts to paginated gallery; view indicator reads "Gallery".

#### FS-03 — No-match state
**Steps:** Query a random 12-char string with no overlap.
**Assert:** Empty-state heading "No matches yet" shown; AI-search button still
visible.

#### FS-04 — Ranking approximates BM25
**Pre:** Two memes where one description contains the query verbatim, another
contains only a partial match.
**Assert:** Verbatim-match meme appears first in results.

#### FS-05 — Pending memes excluded from FTS
**Pre:** One pending meme whose filename would match the query, plus one done meme.
**Assert:** Only the done meme appears — FTS triggers only index done memes.

### 4.5 AI (LLM) Search (AI) — Lane A only

#### AI-01 — Happy path reranking
**Pre:** ≥5 analysed memes.
**Steps:** Run fuzzy search; click "Not finding it? Try AI search".
**Assert:**
- Button text switches to "AI search is scoring matches..." while the request
  is in flight; button is disabled.
- `POST /api/search/llm` fires with `{ query, top_n: 20 }`.
- Grid replaces with new ordering; view indicator reads "AI results".
- Response `items[*].score` ∈ [0, 10]; `items[*].reason` is a non-empty string.

#### AI-02 — Button not shown without a query
**Assert:** When the search input is empty, the AI-search button is absent.

#### AI-03 — Concurrent request safety
**Steps:** Click the AI-search button twice rapidly.
**Assert:** Only one request is in flight at a time (button disabled blocks
the second click) OR the second click is coalesced — either is acceptable, but
the UI must not enter an inconsistent state.

### 4.6 Async Analysis & Pending Polling (AN)

#### AN-01 — Pending count updates live (Lane A)
**Pre:** Upload 3 memes.
**Steps:** Observe sidebar "Pending analysis" value over the next minute.
**Assert:**
- `GET /api/memes/pending` fires every ≈3 s (tolerance ±1 s).
- Value monotonically decreases from 3 to 0.
- Polling stops firing after the count reaches 0.
- Each card's badge transitions `pending → done` without page reload.

#### AN-02 — Pulse banner visible while pending > 0
**Assert:** Banner reading "N meme(s) still being analysed" is visible during
polling; disappears when count hits 0. Screenshot recommended.

#### AN-03 — Resume on restart (Lane A, advanced)
**Pre:** Upload 5 memes, immediately stop backend while several are still pending.
**Steps:** Restart backend; reload frontend.
**Assert:** Pending polling resumes; remaining memes eventually reach `done`.
(If restarting the backend is out of scope for the agent, mark AN-03 as a
manual-only test and skip.)

### 4.7 LLM Unavailable (LU) — Lane B, or toggle key for the test

#### LU-01 — Upload still succeeds, analysis errors
**Pre:** Backend started with `OPENAI_API_KEY` unset.
**Steps:** Upload `valid_small.png`.
**Assert:** Meme is created; its `analysis_status` becomes `error` (not
`pending` indefinitely); `analysis_error` references unavailable LLM.

#### LU-02 — AI-search returns 503 with structured body
**Steps:** Enter a query; click AI-search.
**Assert:** Response status `503`; body matches
`{"error":{"code":"llm_unavailable", ... }}`; UI surfaces a human-readable
message (not a raw JSON blob).

### 4.8 Robustness & UI polish (RO)

#### RO-01 — Very long metadata strings render safely
**Steps:** Save a description of 10 000 characters.
**Assert:** PUT succeeds; modal wraps text without horizontal overflow; grid
card truncates to one-line preview.

#### RO-02 — Unicode in fields
**Steps:** Save tags `["🎭","反應","emoji tag"]`.
**Assert:** Round-trips intact; grid chips render.

#### RO-03 — Rapid upload while previous batch still analysing
**Steps:** Upload batch A (3 files); while still pending, upload batch B (3 files).
**Assert:** Both batches eventually complete; no requests are dropped; pending
count reflects sum correctly.

#### RO-04 — Keyboard access
**Steps:** Tab through sidebar controls; Enter opens a card; Esc — does it close the modal?
**Assert:** Record findings; file any gap under Issues rather than failing,
since this may not be a stated requirement.

---

## 5. Assertion Primitives

For each step that involves an API call, the agent should attach a Playwright
`page.on('response', ...)` listener so it can check:

- status code
- latency (soft-assert: warn if `>5s` for anything other than AI-search)
- response-body shape (minimal JSON-schema check)

For UI assertions prefer role/text selectors over brittle CSS, but fall back to
the class names listed in §4 when roles are unavailable.

All explicit waits must use `waitFor` with a condition — never bare `sleep`.
The only acceptable time-based wait is for the **3 s pending-polling cadence**,
and even there the right pattern is a `waitForRequest` bounded by a 5 s timeout.

---

## 6. Reporting Format

At the end of a run the agent produces a single `UAT_REPORT.md` with:

1. Run metadata: timestamp, commit SHA, lane (A/B), `OPENAI_API_KEY` present (y/n).
2. A table of scenario ID → PASS / FAIL / SKIPPED / ERROR (setup).
3. For each failure: expected vs. actual, relevant network-log excerpt, and a
   screenshot path.
4. Aggregate counts and any new issues that should be added to `ISSUES.md`.

Do **not** alter application code during a UAT run — findings go into the
report, not into fixes.

---

## 7. Out of Scope (explicit non-goals)

- Tag/reference/use-case faceted filtering — **not implemented**; do not write
  scenarios that assume clickable facets.
- Bulk delete — **not implemented**.
- Auth, settings, admin views — **not implemented**.
- Animated-image playback, HEIC/AVIF support — **not supported by design**.
- Mobile viewport layout — only desktop viewport (≥1200 px) is required.

If any of the above ship later, extend this plan rather than silently testing them.
