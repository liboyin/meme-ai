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

All Python commands (fixture generation, backend scripts) must run inside the venv:

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

## 5. Generate test fixtures

Playwright MCP only allows file access inside the workspace root, so fixtures
must live under `/workspaces/meme-ai/`. With the venv active:

```bash
source /workspaces/meme-ai/.venv/bin/activate

python3 - <<'EOF'
from PIL import Image, ImageDraw
import io, os, shutil, random

FIXTURES = "/workspaces/meme-ai/uat_fixtures"
os.makedirs(FIXTURES, exist_ok=True)

# valid_small.png — 512×512 PNG
img = Image.new("RGB", (512, 512), color=(255, 100, 50))
draw = ImageDraw.Draw(img)
draw.rectangle([100, 100, 400, 400], fill=(0, 200, 100))
draw.ellipse([200, 200, 300, 300], fill=(255, 255, 0))
img.save(f"{FIXTURES}/valid_small.png", "PNG")

# valid_medium.jpg — large JPEG
img2 = Image.new("RGB", (1200, 900), color=(50, 150, 200))
draw2 = ImageDraw.Draw(img2)
for i in range(0, 1200, 60):
    draw2.line([(i, 0), (i, 900)], fill=(255, 0, i % 255), width=3)
img2.save(f"{FIXTURES}/valid_medium.jpg", "JPEG", quality=95)

# valid_webp.webp
img3 = Image.new("RGB", (800, 600), color=(200, 50, 200))
ImageDraw.Draw(img3).rectangle([50, 50, 750, 550], outline=(255, 255, 255), width=10)
img3.save(f"{FIXTURES}/valid_webp.webp", "WEBP", quality=80)

# too_big.jpg — must exceed 1.5 MB (random noise prevents JPEG compression)
random.seed(42)
img4 = Image.new("RGB", (2500, 2500))
img4.putdata([(random.randint(0,255), random.randint(0,255), random.randint(0,255))
              for _ in range(2500*2500)])
img4.save(f"{FIXTURES}/too_big.jpg", "JPEG", quality=95)
assert os.path.getsize(f"{FIXTURES}/too_big.jpg") > 1.5 * 1024 * 1024

# animated.gif — 2-frame animation
f1, f2 = Image.new("RGB", (100, 100), (255, 0, 0)), Image.new("RGB", (100, 100), (0, 255, 0))
f1.save(f"{FIXTURES}/animated.gif", save_all=True, append_images=[f2], loop=0, duration=100)

# svg_disguised.png — SVG content with .png extension (MIME mismatch)
with open(f"{FIXTURES}/svg_disguised.png", "w") as f:
    f.write('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
            '<circle cx="50" cy="50" r="40" fill="red"/></svg>')

# duplicate.png — byte-identical copy of valid_small.png
shutil.copy(f"{FIXTURES}/valid_small.png", f"{FIXTURES}/duplicate.png")

print("Fixtures written to", FIXTURES)
for name in sorted(os.listdir(FIXTURES)):
    print(f"  {name}: {os.path.getsize(f'{FIXTURES}/{name}')} bytes")
EOF
```

Expected output (sizes may vary slightly):

```
Fixtures written to /workspaces/meme-ai/uat_fixtures
  animated.gif: 421 bytes
  duplicate.png: 2340 bytes
  svg_disguised.png: 114 bytes
  too_big.jpg: 7361731 bytes
  valid_medium.jpg: 102731 bytes
  valid_small.png: 2340 bytes
  valid_webp.webp: 1740 bytes
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

## 7. Clean database state

Before the first scenario, ensure the DB is empty:

```bash
# Count existing memes
curl -s "http://localhost:8000/api/memes?page=1&page_size=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('total:', d['total'])"

# If total > 0, delete all existing memes:
python3 - <<'EOF'
import urllib.request, json, urllib.parse

base = "http://localhost:8000/api"
page = 1
while True:
    with urllib.request.urlopen(f"{base}/memes?page={page}&page_size=40") as r:
        d = json.load(r)
    if not d["items"]:
        break
    for item in d["items"]:
        req = urllib.request.Request(f"{base}/memes/{item['id']}", method="DELETE")
        urllib.request.urlopen(req)
        print(f"Deleted meme {item['id']}")
    if len(d["items"]) < 40:
        break
print("DB cleared.")
EOF
```

---

## 8. Quick smoke test

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
- [ ] `uat_fixtures/` populated (7 files)
- [ ] Lane determined (A or B)
- [ ] DB empty (or cleaned)
