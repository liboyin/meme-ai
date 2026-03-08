from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


def png_bytes(color=(255, 0, 0)):
    img = Image.new("RGB", (20, 20), color)
    bio = BytesIO()
    img.save(bio, format="PNG")
    return bio.getvalue()


def test_full_flow_without_api_key(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    from app import config

    config.settings.openai_api_key = None
    config.settings.db_path = str(tmp_path / "test.db")

    from importlib import reload
    from app import database, init_db, main

    reload(database)
    reload(init_db)
    reload(main)

    client = TestClient(main.app)
    file_data = png_bytes()
    r = client.post("/api/memes/upload", files=[("files", ("a.png", file_data, "image/png"))])
    assert r.status_code == 200
    meme_id = r.json()["items"][0]["id"]

    r = client.get("/api/memes")
    assert r.status_code == 200
    assert r.json()["total"] == 1

    r = client.get(f"/api/memes/{meme_id}/image")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"

    r = client.post("/api/search/llm", json={"query": "happy", "top_n": 5})
    assert r.status_code == 503

    r = client.get("/api/memes/pending")
    assert r.status_code == 200
    assert r.json()["items"][0]["analysis_status"] in {"pending", "error"}


def test_upload_rejects_invalid_type():
    client = TestClient(app)
    r = client.post("/api/memes/upload", files=[("files", ("bad.gif", b"GIF89a", "image/gif"))])
    assert r.status_code == 200
    assert r.json()["items"][0]["status"] == "error"
