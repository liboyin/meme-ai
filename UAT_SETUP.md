# UAT Environment Setup — Meme Organiser

Steps required the **first time** UAT is run inside the devcontainer (before executing any scenario in `UAT_PLAN.md`).

---

## 1. Verify services are running

```bash
# Backend
curl -s "http://localhost:8000/api/memes?page=1&page_size=1"
# Expected: {"items":[],"total":0,"page":1,"page_size":1}

# Frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
# Expected: 200
```

If either is down, start them per the project README before continuing.

---

## 2. Activate the Python virtual environment

Backend scripts (e.g. the DB-clean helper in step 5) must run inside the venv:

```bash
source /workspaces/meme-ai/.venv/bin/activate
```

---

## 3. Install the Playwright Chromium browser

The `@playwright/mcp` server is pre-installed but ships without a browser binary.
Run once to download Chromium (~107 MB):

```bash
npx playwright install chromium --with-deps
```

---

## 4. Symlink Chromium as "chrome"

The MCP server defaults to the `chrome` distribution and looks for it at
`/opt/google/chrome/chrome`. Only Chromium is available in the container, so
create a symlink:

```bash
sudo mkdir -p /opt/google/chrome
sudo ln -sf \
  ~/.cache/ms-playwright/chromium-1217/chrome-linux/chrome \
  /opt/google/chrome/chrome
```

> **Note:** The Chromium version number (`chromium-1217`) may change when
> `npx playwright install chromium` downloads a newer release. Adjust the path
> if the symlink breaks after a Playwright upgrade.

---

## 5. Clean database state

Before the first scenario, ensure the DB is empty:

```bash
# Count existing memes
curl -s "http://localhost:8000/api/memes?page=1&page_size=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('total:', d['total'])"

# If total > 0, delete all existing memes:
python3 - <<'EOF'
import urllib.request, json

base = "http://localhost:8000/api"
while True:
    with urllib.request.urlopen(f"{base}/memes?page=1&page_size=40") as r:
        d = json.load(r)
    if not d["items"]:
        break
    for item in d["items"]:
        req = urllib.request.Request(f"{base}/memes/{item['id']}", method="DELETE")
        urllib.request.urlopen(req)
        print(f"Deleted meme {item['id']}")
print("DB cleared.")
EOF
```

---

## 6. Determine the test lane

```bash
env | grep OPENAI_API_KEY && echo "Lane A — full suite" || echo "Lane B — LU scenarios only, skip AI/analysis-done"
```

| Lane | Scenarios skipped |
|------|------------------|
| A (key present) | none |
| B (key absent) | AI-01…AI-03, AN-01, AN-03, DM-01, FS-01, FS-04, FS-05 |

---

## 7. Quick smoke test

With everything above done, confirm the browser works:

```
# In a Claude Code session with Playwright MCP configured:
# Navigate to http://localhost:5173 and take a snapshot.
# Expected: heading "Your meme vault is empty" is visible.
```

---

## Checklist summary

- [ ] Backend returns 200 on `/api/memes`
- [ ] Frontend returns 200 on port 5173
- [ ] Python venv activated
- [ ] `npx playwright install chromium --with-deps` completed
- [ ] `/opt/google/chrome/chrome` symlink created
- [ ] `assets/` fixtures verified (8 files — see §3 of `UAT_PLAN.md`)
- [ ] Lane determined (A or B)
- [ ] DB empty (or cleaned)
