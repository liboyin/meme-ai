import asyncio
import json
from datetime import datetime, timezone
from importlib import reload
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError


def image_bytes(format_name="PNG", color=(255, 0, 0)):
    image = Image.new("RGB", (24, 24), color)
    buffer = BytesIO()
    image.save(buffer, format=format_name)
    return buffer.getvalue()


def fake_response(content):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


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
    return SimpleNamespace(
        config=config,
        database=database,
        init_db=init_db,
        llm=llm,
        main=main,
        repository=repository,
    )


class FakeImageContext:
    def __init__(self, *, format_name="PNG", is_animated=False, frame_count=1):
        self.format = format_name
        self.is_animated = is_animated
        self.n_frames = frame_count

    def verify(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def install_image_open(monkeypatch, main_module, *entries):
    queue = list(entries)

    def fake_open(_stream):
        item = queue.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    monkeypatch.setattr(main_module.Image, "open", fake_open)


def test_validate_image_bytes_and_recent_status_snapshot(monkeypatch, tmp_path):
    modules = load_test_modules(monkeypatch, tmp_path)
    main = modules.main

    assert (
        main.validate_image_bytes(
            filename="ok.png",
            mime_type="image/png",
            data=image_bytes(),
        )
        == "image/png"
    )

    with pytest.raises(HTTPException) as too_large:
        main.validate_image_bytes(
            filename="huge.png",
            mime_type="image/png",
            data=b"x" * (main.MAX_FILE_BYTES + 1),
        )
    assert too_large.value.status_code == 413

    install_image_open(
        monkeypatch,
        main,
        UnidentifiedImageError("bad first open"),
    )
    with pytest.raises(HTTPException) as invalid_first_pass:
        main.validate_image_bytes(filename="bad.bin", mime_type="image/png", data=b"data")
    assert invalid_first_pass.value.status_code == 415

    install_image_open(
        monkeypatch,
        main,
        FakeImageContext(format_name="PNG"),
        UnidentifiedImageError("bad second open"),
    )
    with pytest.raises(HTTPException) as invalid_second_pass:
        main.validate_image_bytes(filename="bad.png", mime_type="image/png", data=b"data")
    assert invalid_second_pass.value.status_code == 415

    install_image_open(
        monkeypatch,
        main,
        FakeImageContext(format_name="GIF"),
        FakeImageContext(format_name="GIF"),
    )
    with pytest.raises(HTTPException) as unsupported_type:
        main.validate_image_bytes(filename="bad.gif", mime_type="image/gif", data=b"data")
    assert unsupported_type.value.status_code == 415

    install_image_open(
        monkeypatch,
        main,
        FakeImageContext(format_name="WEBP"),
        FakeImageContext(format_name="WEBP", is_animated=True, frame_count=2),
    )
    with pytest.raises(HTTPException) as animated:
        main.validate_image_bytes(filename="anim.webp", mime_type="image/webp", data=b"data")
    assert animated.value.status_code == 415

    install_image_open(
        monkeypatch,
        main,
        FakeImageContext(format_name="PNG"),
        FakeImageContext(format_name="PNG"),
    )
    with pytest.raises(HTTPException) as mismatched_mime:
        main.validate_image_bytes(
            filename="wrong-type.png",
            mime_type="image/jpeg",
            data=b"data",
        )
    assert mismatched_mime.value.status_code == 415

    main.recent_statuses.update(
        {
            2: ("done", 970),
            3: ("error", 700),
        }
    )
    monkeypatch.setattr(main.time, "time", lambda: 1000)

    snapshot = main.recent_status_snapshot([{"id": 1, "analysis_status": "pending"}])
    assert snapshot == [
        {"id": 2, "analysis_status": "done"},
        {"id": 1, "analysis_status": "pending"},
    ]
    assert 3 not in main.recent_statuses


def test_repository_edge_cases(monkeypatch, tmp_path):
    modules = load_test_modules(monkeypatch, tmp_path)
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)

    created = repo.create_meme(
        filename="done.png",
        mime_type="image/png",
        sha256="abc123",
        image_data=image_bytes(),
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        description="already indexed",
        why_funny="because timing",
        references="internet culture",
        use_cases="reaction",
        tags=json.dumps(["wow", "test"]),
        analysis_status="done",
    )
    repo.create_meme(
        filename="pending.png",
        mime_type="image/png",
        sha256="def456",
        image_data=image_bytes(color=(0, 255, 0)),
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="pending",
    )

    assert repo._build_fts_query("wow wow test") == "wow* OR test*"
    assert repo.search_fts("!!!") == []
    assert repo.search_fts("done") == []
    assert repo.delete(99999) is False

    repo.update_analysis(99999, {"description": "ignored"}, "done")
    repo.set_error(99999, "ignored")

    llm_items = repo.get_for_llm([created.id])
    assert llm_items[0]["filename"] == "done.png"
    assert llm_items[0]["references"] == "internet culture"

    pending_items = repo.pending_statuses()
    assert pending_items == [{"id": created.id + 1, "analysis_status": "pending"}]

    listed_items, total = repo.list_memes(page=1, page_size=10)
    assert total == 2
    assert listed_items[0]["id"] == created.id + 1
    assert listed_items[1].keys() == llm_items[0].keys()
    assert listed_items[1]["references"] == "internet culture"

    fts_item = repo.search_fts("wow", limit=1)[0]
    assert set(fts_item.keys()) == set(llm_items[0].keys()) | {"rank"}
    assert fts_item["references"] == "internet culture"
    assert isinstance(fts_item["tags"], list)

    assert repo._safe_parse_tags("not-json") == []
    assert repo._safe_parse_tags('{"oops": true}') == []
    assert repo._safe_parse_tags(["x"]) == ["x"]
    db.close()


@pytest.mark.anyio
async def test_analyze_and_store_handles_missing_and_failed_analysis(monkeypatch, tmp_path):
    modules = load_test_modules(monkeypatch, tmp_path)
    modules.init_db.init_db()

    await modules.main.analyze_and_store(99999)

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    meme = repo.create_meme(
        filename="broken.png",
        mime_type="image/png",
        sha256="oops",
        image_data=image_bytes(),
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="pending",
    )
    db.close()

    async def boom(*_args, **_kwargs):
        raise RuntimeError("analysis crashed")

    monkeypatch.setattr(modules.main, "analyze_image", boom)
    await modules.main.analyze_and_store(meme.id)

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    stored = repo.get(meme.id)
    assert stored.analysis_status == "error"
    assert stored.analysis_error == "analysis crashed"
    assert modules.main.recent_statuses[meme.id][0] == "error"
    db.close()


@pytest.mark.anyio
async def test_manual_metadata_update_is_not_overwritten_by_late_analysis(monkeypatch, tmp_path):
    modules = load_test_modules(monkeypatch, tmp_path)
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    meme = repo.create_meme(
        filename="manual-wins.png",
        mime_type="image/png",
        sha256="manual-wins",
        image_data=image_bytes(),
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="pending",
    )
    db.close()

    analysis_started = asyncio.Event()
    allow_analysis_to_finish = asyncio.Event()

    async def slow_analysis(*_args, **_kwargs):
        analysis_started.set()
        await allow_analysis_to_finish.wait()
        return {
            "description": "AI generated description",
            "why_funny": "AI explanation",
            "references": "AI references",
            "use_cases": "AI use cases",
            "tags": ["ai", "generated"],
        }

    monkeypatch.setattr(modules.main, "analyze_image", slow_analysis)

    task = asyncio.create_task(modules.main.analyze_and_store(meme.id))
    await analysis_started.wait()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    updated = repo.update_search_fields(
        meme.id,
        {
            "description": "User supplied description",
            "why_funny": "User supplied joke",
            "references": "User reference",
            "use_cases": "User use case",
            "tags": ["manual", "edited"],
        },
    )
    db.close()

    allow_analysis_to_finish.set()
    await task

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    stored = repo.get(meme.id)
    assert updated is not None
    assert stored.description == "User supplied description"
    assert stored.why_funny == "User supplied joke"
    assert stored.references == "User reference"
    assert stored.use_cases == "User use case"
    assert json.loads(stored.tags) == ["manual", "edited"]
    assert stored.analysis_status == "done"
    db.close()


def test_llm_helpers_cover_validation_and_json_extraction(monkeypatch, tmp_path):
    modules = load_test_modules(monkeypatch, tmp_path, api_key="")
    llm = modules.llm

    with pytest.raises(llm.LLMUnavailableError):
        llm._client()

    assert llm._normalise_analysis_payload(
        {
            "description": "  dramatic stare  ",
            "why_funny": " relatable ",
            "references": " meme canon ",
            "use_cases": " reply ",
            "tags": [" wow ", "", 123],
        }
    ) == {
        "description": "dramatic stare",
        "why_funny": "relatable",
        "references": "meme canon",
        "use_cases": "reply",
        "tags": ["wow", "123"],
    }

    assert llm._normalise_analysis_payload({"tags": "not-a-list"})["tags"] == []

    with pytest.raises(ValueError):
        llm._normalise_analysis_payload("bad payload")

    assert llm._extract_json('prefix {"ok": true} suffix') == {"ok": True}
    assert llm._extract_json('noise [1, 2, 3] noise') == [1, 2, 3]

    with pytest.raises(ValueError):
        llm._extract_json("no structured output here")


@pytest.mark.anyio
async def test_llm_completion_fallback_and_ranking_edge_cases(monkeypatch, tmp_path):
    modules = load_test_modules(monkeypatch, tmp_path)
    llm = modules.llm

    class FakeBadRequestError(Exception):
        pass

    class FakeCompletions:
        def __init__(self):
            self.calls = []

        async def create(self, **kwargs):
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                raise FakeBadRequestError("json_schema rejected")
            return fake_response('{"value": 42}')

    fake_completions = FakeCompletions()
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=fake_completions))

    monkeypatch.setattr(llm, "BadRequestError", FakeBadRequestError)
    monkeypatch.setattr(llm, "_client", lambda: fake_client)

    parsed = await llm._create_json_completion(
        messages=[{"role": "user", "content": "hello"}],
        schema_name="demo",
        schema={"type": "object"},
        fallback_instructions="Return only JSON.",
    )
    assert parsed == {"value": 42}
    assert fake_completions.calls[1]["messages"][-1]["content"] == "Return only JSON."

    call_count = {"value": 0}

    async def fake_completion(*, messages, **_kwargs):
        call_count["value"] += 1
        if call_count["value"] == 1:
            return [
                {"id": 1, "score": "9.5", "reason": "great match"},
                {"score": 5, "reason": "missing id"},
                {"id": 2, "score": "oops", "reason": "bad score"},
            ]
        raise RuntimeError("provider timeout")

    monkeypatch.setattr(llm, "_create_json_completion", fake_completion)

    results = await llm.llm_rank(
        "dramatic",
        [
            {"id": idx, "filename": f"meme-{idx}.png", "tags": ["tag"]}
            for idx in range(1, 17)
        ],
    )
    assert results == [{"id": 1, "score": 9.5, "reason": "great match"}]
