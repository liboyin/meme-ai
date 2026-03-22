import hashlib
import json
import time
from datetime import datetime, timezone
from importlib import reload
from io import BytesIO
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image


def image_bytes(format_name="PNG", color=(255, 0, 0)):
    image = Image.new("RGB", (32, 24), color)
    buffer = BytesIO()
    image.save(buffer, format=format_name)
    return buffer.getvalue()


def fake_response(content):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


class FakeChatCompletions:
    async def create(self, *, messages, **_kwargs):
        payload = messages[-1]["content"]

        if isinstance(payload, list):
            return fake_response(
                json.dumps(
                    {
                        "description": "Distracted partner eye-roll meme.",
                        "why_funny": "The expression mismatch makes the overreaction relatable.",
                        "references": "Classic reaction image energy.",
                        "use_cases": "When something mildly annoying feels catastrophic.",
                        "tags": ["dramatic", "reaction", "annoyed"],
                    }
                )
            )

        prompt = payload if isinstance(payload, str) else ""
        candidates_raw = prompt.split("Candidates: ", maxsplit=1)[1]
        candidates = json.loads(candidates_raw)
        rankings = [
            {
                "id": candidate["id"],
                "score": float(10 - index),
                "reason": f"Candidate {candidate['id']} matches the dramatic reaction tone.",
            }
            for index, candidate in enumerate(candidates)
        ]
        return fake_response(json.dumps(rankings))


class FakeClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=FakeChatCompletions())


def load_test_modules(monkeypatch, tmp_path, *, api_key="test-key"):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "memes.db"))
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.invalid/v1")
    monkeypatch.setenv("OPENAI_MODEL", "fake-model")
    monkeypatch.setenv("OPENAI_API_KEY", api_key)

    from backend.app import config, database, init_db, llm, main, repository

    reload(config)
    reload(database)
    reload(init_db)
    reload(repository)
    reload(llm)
    reload(main)

    main.recent_statuses.clear()
    if api_key:
        monkeypatch.setattr(llm, "_client", lambda: FakeClient())

    return config, database, init_db, llm, main, repository


def wait_for_status(client, meme_id, expected_status, timeout=1.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = client.get(f"/api/memes/{meme_id}")
        if response.status_code == 200:
            data = response.json()
            if data["analysis_status"] == expected_status:
                return data
        time.sleep(0.05)
    raise AssertionError(f"Meme {meme_id} never reached status {expected_status!r}")


def test_full_backend_flow_with_mocked_llm(monkeypatch, tmp_path):
    _config, _database, _init_db, _llm, main, _repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="test-key",
    )

    with TestClient(main.app) as client:
        upload = client.post(
            "/api/memes/upload",
            files=[("files", ("dramatic.png", image_bytes(), "image/png"))],
        )
        assert upload.status_code == 200
        created_item = upload.json()["items"][0]
        meme_id = created_item["id"]

        detail = wait_for_status(client, meme_id, "done")
        assert detail["description"] == "Distracted partner eye-roll meme."
        assert detail["tags"] == ["dramatic", "reaction", "annoyed"]

        listing = client.get("/api/memes")
        assert listing.status_code == 200
        assert listing.json()["total"] == 1
        assert listing.json()["items"][0]["analysis_status"] == "done"

        image_response = client.get(f"/api/memes/{meme_id}/image")
        assert image_response.status_code == 200
        assert image_response.headers["content-type"] == "image/png"

        fuzzy = client.get("/api/search", params={"q": "dramatic reaction", "mode": "fuzzy"})
        assert fuzzy.status_code == 200
        assert fuzzy.json()["items"][0]["id"] == meme_id

        llm_search = client.post("/api/search/llm", json={"query": "dramatic reaction", "top_n": 5})
        assert llm_search.status_code == 200
        assert llm_search.json()["items"][0]["id"] == meme_id
        assert llm_search.json()["items"][0]["score"] == 10.0

        delete_response = client.delete(f"/api/memes/{meme_id}")
        assert delete_response.status_code == 200
        assert delete_response.json() == {"deleted": True}

        listing_after_delete = client.get("/api/memes")
        assert listing_after_delete.json()["total"] == 0


def test_upload_rejects_single_invalid_file_with_415(monkeypatch, tmp_path):
    _config, _database, _init_db, _llm, main, _repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="test-key",
    )

    with TestClient(main.app) as client:
        response = client.post(
            "/api/memes/upload",
            files=[("files", ("bad.gif", b"GIF89a", "image/gif"))],
        )

    assert response.status_code == 415
    assert "Unsupported file type" in response.json()["detail"]


def test_multi_upload_allows_partial_success(monkeypatch, tmp_path):
    _config, _database, _init_db, _llm, main, _repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="test-key",
    )

    with TestClient(main.app) as client:
        response = client.post(
            "/api/memes/upload",
            files=[
                ("files", ("ok.png", image_bytes(), "image/png")),
                ("files", ("bad.gif", b"GIF89a", "image/gif")),
            ],
        )

    assert response.status_code == 200
    items = response.json()["items"]
    assert items[0]["status"] == "created"
    assert items[1]["status"] == "error"
    assert "Unsupported file type" in items[1]["error"]


def test_upload_rejects_duplicate_sha256_with_409(monkeypatch, tmp_path):
    _config, _database, _init_db, _llm, main, _repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="",
    )

    raw = image_bytes()

    with TestClient(main.app) as client:
        first = client.post(
            "/api/memes/upload",
            files=[("files", ("first.png", raw, "image/png"))],
        )
        assert first.status_code == 200

        duplicate = client.post(
            "/api/memes/upload",
            files=[("files", ("duplicate-name.png", raw, "image/png"))],
        )

        assert duplicate.status_code == 409
        assert duplicate.json()["detail"] == "A meme with the same sha256 already exists."

        listing = client.get("/api/memes")
        assert listing.status_code == 200
        assert listing.json()["total"] == 1


def test_multi_upload_reports_duplicate_sha256_as_item_error(monkeypatch, tmp_path):
    _config, _database, _init_db, _llm, main, _repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="",
    )

    duplicate_bytes = image_bytes()
    fresh_bytes = image_bytes(color=(0, 255, 0))

    with TestClient(main.app) as client:
        first = client.post(
            "/api/memes/upload",
            files=[("files", ("seed.png", duplicate_bytes, "image/png"))],
        )
        assert first.status_code == 200

        response = client.post(
            "/api/memes/upload",
            files=[
                ("files", ("dupe.png", duplicate_bytes, "image/png")),
                ("files", ("fresh.png", fresh_bytes, "image/png")),
            ],
        )

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "filename": "dupe.png",
            "status": "error",
            "error": "A meme with the same sha256 already exists.",
        },
        {
            "filename": "fresh.png",
            "status": "created",
            "id": 2,
        },
    ]


def test_upload_persists_phash(monkeypatch, tmp_path):
    _config, database, _init_db, _llm, main, repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="",
    )

    raw = image_bytes(color=(12, 34, 56))

    with TestClient(main.app) as client:
        upload = client.post(
            "/api/memes/upload",
            files=[("files", ("phash.png", raw, "image/png"))],
        )

    assert upload.status_code == 200
    meme_id = upload.json()["items"][0]["id"]

    db = database.SessionLocal()
    stored = repository.MemeRepository(db).get(meme_id)
    assert stored is not None
    assert stored.phash == main.compute_image_phash(raw)
    db.close()


def test_list_memes_supports_sorting(monkeypatch, tmp_path):
    _config, database, init_db, _llm, main, repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="",
    )
    init_db.init_db()

    db = database.SessionLocal()
    repo = repository.MemeRepository(db)
    seeded_memes = [
        ("z-last.png", "ccc333", "2026-01-03T00:00:00+00:00", (255, 0, 0)),
        ("a-first.png", "aaa111", "2026-01-01T00:00:00+00:00", (0, 255, 0)),
        ("m-middle.png", "bbb222", "2026-01-02T00:00:00+00:00", (0, 0, 255)),
    ]
    for index, (filename, phash, uploaded_at, color) in enumerate(seeded_memes, start=1):
        repo.create_meme(
            filename=filename,
            mime_type="image/png",
            sha256=f"seed-{index}",
            phash=phash,
            image_data=image_bytes(color=color),
            uploaded_at=uploaded_at,
            analysis_status="done",
        )
    db.close()

    with TestClient(main.app) as client:
        newest_first = client.get("/api/memes")
        assert newest_first.status_code == 200
        assert [item["filename"] for item in newest_first.json()["items"]] == [
            "z-last.png",
            "m-middle.png",
            "a-first.png",
        ]

        oldest_first = client.get(
            "/api/memes",
            params={"sort_by": "uploaded_at", "sort_order": "asc"},
        )
        assert oldest_first.status_code == 200
        assert [item["filename"] for item in oldest_first.json()["items"]] == [
            "a-first.png",
            "m-middle.png",
            "z-last.png",
        ]

        filename_sorted = client.get(
            "/api/memes",
            params={"sort_by": "filename", "sort_order": "asc"},
        )
        assert filename_sorted.status_code == 200
        assert [item["filename"] for item in filename_sorted.json()["items"]] == [
            "a-first.png",
            "m-middle.png",
            "z-last.png",
        ]

        phash_sorted = client.get(
            "/api/memes",
            params={"sort_by": "phash", "sort_order": "asc"},
        )
        assert phash_sorted.status_code == 200
        assert [item["filename"] for item in phash_sorted.json()["items"]] == [
            "a-first.png",
            "m-middle.png",
            "z-last.png",
        ]

        invalid_sort = client.get("/api/memes", params={"sort_by": "nope"})
        assert invalid_sort.status_code == 422


def test_missing_api_key_marks_uploads_error_and_blocks_llm_search(monkeypatch, tmp_path):
    _config, _database, _init_db, _llm, main, _repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="",
    )

    with TestClient(main.app) as client:
        upload = client.post(
            "/api/memes/upload",
            files=[("files", ("offline.png", image_bytes(), "image/png"))],
        )
        assert upload.status_code == 200
        meme_id = upload.json()["items"][0]["id"]

        detail = wait_for_status(client, meme_id, "error")
        assert detail["analysis_error"] == (
            "LLM features are unavailable because OPENAI_API_KEY is not configured."
        )

        llm_search = client.post("/api/search/llm", json={"query": "anything", "top_n": 5})
        assert llm_search.status_code == 503
        assert llm_search.json() == {
            "error": {
                "code": "llm_unavailable",
                "message": "LLM features are unavailable because OPENAI_API_KEY is not configured.",
            }
        }

        pending = client.get("/api/memes/pending")
        assert pending.status_code == 200
        assert pending.json()["items"][0] == {"id": meme_id, "analysis_status": "error"}


def test_manual_metadata_update_reindexes_fts(monkeypatch, tmp_path):
    _config, _database, _init_db, _llm, main, _repository = load_test_modules(
        monkeypatch,
        tmp_path,
        api_key="",
    )

    with TestClient(main.app) as client:
        upload = client.post(
            "/api/memes/upload",
            files=[("files", ("manual.png", image_bytes(), "image/png"))],
        )
        assert upload.status_code == 200
        meme_id = upload.json()["items"][0]["id"]

        detail = wait_for_status(client, meme_id, "error")
        assert detail["analysis_status"] == "error"

        update = client.put(
            f"/api/memes/{meme_id}",
            json={
                "description": "Cat staring with deeply unimpressed energy.",
                "why_funny": "The deadpan face makes tiny annoyances feel cinematic.",
                "references": "Classic reaction meme format.",
                "use_cases": "When a coworker schedules one more meeting.",
                "tags": ["cat", "deadpan", "meeting"],
            },
        )
        assert update.status_code == 200
        updated = update.json()
        assert updated["analysis_status"] == "done"
        assert updated["analysis_error"] is None
        assert updated["tags"] == ["cat", "deadpan", "meeting"]

        fuzzy = client.get("/api/search", params={"q": "deadpan meeting", "mode": "fuzzy"})
        assert fuzzy.status_code == 200
        assert fuzzy.json()["items"][0]["id"] == meme_id


def test_startup_requeues_pending_memes(monkeypatch, tmp_path):
    (
        _config,
        database,
        init_db,
        _llm,
        main,
        repository,
    ) = load_test_modules(monkeypatch, tmp_path, api_key="test-key")

    init_db.init_db()
    db = database.SessionLocal()
    repo = repository.MemeRepository(db)
    raw_bytes = image_bytes(format_name="JPEG", color=(0, 200, 140))
    meme = repo.create_meme(
        filename="recovered.jpg",
        mime_type="image/jpeg",
        sha256=hashlib.sha256(raw_bytes).hexdigest(),
        phash=main.compute_image_phash(raw_bytes),
        image_data=raw_bytes,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="pending",
    )
    db.close()

    with TestClient(main.app) as client:
        detail = wait_for_status(client, meme.id, "done")

    assert detail["filename"] == "recovered.jpg"
    assert detail["analysis_status"] == "done"
