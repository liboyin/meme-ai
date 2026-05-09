import asyncio
import json
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError


def image_bytes_with_phash(modules, format_name="PNG", color=(255, 0, 0)):
    """Return raw image bytes and their perceptual hash for use in repository tests."""
    image = Image.new("RGB", (32, 24), color)
    buffer = BytesIO()
    image.save(buffer, format=format_name)
    raw = buffer.getvalue()
    return raw, modules.main.compute_image_phash(raw)


def fake_response(content):
    """Wrap *content* in a minimal OpenAI ChatCompletion-shaped object."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
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


def test_validate_image_bytes_and_recent_status_snapshot(monkeypatch, load_test_modules, image_bytes):
    """Covers size, format, animation, and MIME-mismatch rejection paths in validate_image_bytes."""
    modules = load_test_modules()
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

    # MIME type reported by the client is ignored — Pillow's detection is the ground truth.
    # A WEBP file sent with application/octet-stream must be accepted (regression guard for
    # the UP-03 UAT finding where curl didn't send image/webp).
    install_image_open(
        monkeypatch,
        main,
        FakeImageContext(format_name="WEBP"),
        FakeImageContext(format_name="WEBP"),
    )
    result = main.validate_image_bytes(
        filename="valid.webp",
        mime_type="application/octet-stream",
        data=b"data",
    )
    assert result == "image/webp"


def test_repository_edge_cases(load_test_modules, image_bytes):
    """Covers no-op operations, FTS search, tag parsing, and API payload structure."""
    modules = load_test_modules()
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    created_bytes, created_phash = image_bytes_with_phash(modules)
    pending_bytes, pending_phash = image_bytes_with_phash(modules, color=(0, 255, 0))

    created = repo.create_meme(
        filename="done.png",
        mime_type="image/png",
        sha256="abc123",
        phash=created_phash,
        image_data=created_bytes,
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
        phash=pending_phash,
        image_data=pending_bytes,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="pending",
    )

    assert repo._build_fts_query("wow wow test") == "wow* OR test*"
    assert repo.search_fts("!!!") == []
    assert repo.search_fts("done")[0]["id"] == created.id
    assert repo.delete(99999) is False

    repo.update_analysis(99999, {"description": "ignored"}, "done")
    repo.set_error(99999, "ignored")

    meta_item = repo.get_metadata(created.id)
    assert meta_item["filename"] == "done.png"
    assert meta_item["references"] == "internet culture"

    pending_items = repo.pending_statuses()
    assert pending_items == [{"id": created.id + 1, "analysis_status": "pending"}]

    listed_items, total = repo.list_memes(page=1, page_size=10)
    assert total == 2
    assert listed_items[0]["id"] == created.id + 1
    assert listed_items[1].keys() == meta_item.keys()
    assert listed_items[1]["references"] == "internet culture"

    fts_item = repo.search_fts("wow", limit=1)[0]
    assert set(fts_item.keys()) == set(meta_item.keys()) | {"rank"}
    assert fts_item["references"] == "internet culture"
    assert isinstance(fts_item["tags"], list)

    assert repo._safe_parse_tags("not-json") == []
    assert repo._safe_parse_tags('{"oops": true}') == []
    assert repo._safe_parse_tags(["x"]) == ["x"]
    db.close()


def test_repository_rejects_duplicate_sha256(load_test_modules):
    """DuplicateMemeError is raised and the original row is unchanged on sha256 collision."""
    modules = load_test_modules()
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    first_bytes, first_phash = image_bytes_with_phash(modules)
    second_bytes, second_phash = image_bytes_with_phash(modules, color=(0, 255, 0))

    repo.create_meme(
        filename="first.png",
        mime_type="image/png",
        sha256="same-hash",
        phash=first_phash,
        image_data=first_bytes,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="pending",
    )

    with pytest.raises(modules.repository.DuplicateMemeError) as duplicate:
        repo.create_meme(
            filename="second.png",
            mime_type="image/png",
            sha256="same-hash",
            phash=second_phash,
            image_data=second_bytes,
            uploaded_at=datetime.now(timezone.utc).isoformat(),
            analysis_status="pending",
        )

    assert str(duplicate.value) == "A meme with the same sha256 already exists."
    existing = repo.get_by_sha256("same-hash")
    assert existing is not None
    assert existing.filename == "first.png"
    db.close()


def test_repository_list_memes_supports_requested_sort(load_test_modules, image_bytes):
    """list_memes returns rows in the correct order for all supported sort fields and directions."""
    modules = load_test_modules()
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    for index, (filename, phash, uploaded_at, color) in enumerate(
        [
            ("z-last.png", "ccc333", "2026-01-03T00:00:00+00:00", (255, 0, 0)),
            ("a-first.png", "aaa111", "2026-01-01T00:00:00+00:00", (0, 255, 0)),
            ("m-middle.png", "bbb222", "2026-01-02T00:00:00+00:00", (0, 0, 255)),
        ],
        start=1,
    ):
        repo.create_meme(
            filename=filename,
            mime_type="image/png",
            sha256=f"seed-{index}",
            phash=phash,
            image_data=image_bytes(color=color),
            uploaded_at=uploaded_at,
            analysis_status="done",
        )

    newest_first, total = repo.list_memes(page=1, page_size=10)
    assert total == 3
    assert [item["filename"] for item in newest_first] == [
        "z-last.png",
        "m-middle.png",
        "a-first.png",
    ]

    oldest_first, _ = repo.list_memes(page=1, page_size=10, sort_by="uploaded_at", sort_order="asc")
    assert [item["filename"] for item in oldest_first] == [
        "a-first.png",
        "m-middle.png",
        "z-last.png",
    ]

    filename_sorted, _ = repo.list_memes(page=1, page_size=10, sort_by="filename", sort_order="asc")
    assert [item["filename"] for item in filename_sorted] == [
        "a-first.png",
        "m-middle.png",
        "z-last.png",
    ]

    phash_sorted, _ = repo.list_memes(page=1, page_size=10, sort_by="phash", sort_order="asc")
    assert [item["filename"] for item in phash_sorted] == [
        "a-first.png",
        "m-middle.png",
        "z-last.png",
    ]

    with pytest.raises(ValueError):
        repo.list_memes(page=1, page_size=10, sort_by="nope")
    db.close()


def test_init_db_adds_phash_column_and_indexes(load_test_modules):
    """init_db creates the phash column and all expected indexes."""
    modules = load_test_modules()
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    columns = {row["name"]: row for row in db.execute("PRAGMA table_info(memes)").fetchall()}
    indexes = {row["name"] for row in db.execute("PRAGMA index_list(memes)").fetchall()}

    assert "phash" in columns
    assert columns["phash"]["notnull"] == 1
    assert "idx_memes_sha256_unique" in indexes
    assert "idx_memes_uploaded_at_sort" in indexes
    assert "idx_memes_filename_sort" in indexes
    assert "idx_memes_phash_sort" in indexes
    db.close()


def test_init_db_rejects_legacy_duplicate_sha256_rows(load_test_modules):
    """init_db reports duplicate sha256 rows before enforcing the unique index."""
    modules = load_test_modules()

    db = modules.database.SessionLocal()
    db.execute(
        """
        CREATE TABLE memes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            phash TEXT NOT NULL,
            image_data BLOB NOT NULL,
            uploaded_at TEXT NOT NULL,
            description TEXT,
            why_funny TEXT,
            "references" TEXT,
            use_cases TEXT,
            tags TEXT,
            analysis_status TEXT NOT NULL DEFAULT 'pending',
            analysis_error TEXT
        )
        """
    )
    db.execute(
        """
        INSERT INTO memes (
            filename, mime_type, sha256, phash, image_data, uploaded_at, analysis_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "one.png",
            "image/png",
            "same-hash",
            "abc",
            b"one",
            "2026-01-01T00:00:00+00:00",
            "pending",
            "two.png",
            "image/png",
            "same-hash",
            "def",
            b"two",
            "2026-01-02T00:00:00+00:00",
            "pending",
        ),
    )
    db.commit()
    db.close()

    with pytest.raises(RuntimeError, match=r"same-hash \(2\)"):
        modules.init_db.init_db()


@pytest.mark.anyio
async def test_analyze_and_store_handles_missing_and_failed_analysis(monkeypatch, load_test_modules):
    """analyze_and_store is a no-op for unknown IDs and sets error status on analysis failure."""
    modules = load_test_modules()
    modules.init_db.init_db()

    await modules.main.analyze_and_store(99999)

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    raw, phash = image_bytes_with_phash(modules)
    meme = repo.create_meme(
        filename="broken.png",
        mime_type="image/png",
        sha256="oops",
        phash=phash,
        image_data=raw,
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
    stored = repo.get_full(meme.id)
    assert stored.analysis_status == "error"
    assert stored.analysis_error == "analysis crashed"
    db.close()


@pytest.mark.anyio
async def test_manual_metadata_update_is_not_overwritten_by_late_analysis(monkeypatch, load_test_modules):
    """A manual update that completes before slow LLM analysis finishes takes precedence."""
    modules = load_test_modules()
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    raw, phash = image_bytes_with_phash(modules)
    meme = repo.create_meme(
        filename="manual-wins.png",
        mime_type="image/png",
        sha256="manual-wins",
        phash=phash,
        image_data=raw,
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
    stored = repo.get_full(meme.id)
    assert updated is not None
    assert stored.description == "User supplied description"
    assert stored.why_funny == "User supplied joke"
    assert stored.references == "User reference"
    assert stored.use_cases == "User use case"
    assert json.loads(stored.tags) == ["manual", "edited"]
    assert stored.analysis_status == "done"
    db.close()


@pytest.mark.anyio
async def test_resume_pending_analysis_logs_task_failures(monkeypatch, load_test_modules, image_bytes, caplog):
    """resume_pending_analysis logs errors from failed startup tasks without raising."""
    import logging

    modules = load_test_modules()
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    raw = image_bytes()
    phash = modules.main.compute_image_phash(raw)
    meme = repo.create_meme(
        filename="startup-fail.png",
        mime_type="image/png",
        sha256="startup-fail-hash",
        phash=phash,
        image_data=raw,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="pending",
    )
    db.close()

    async def always_raise(meme_id: int) -> None:
        raise RuntimeError("startup crash")

    monkeypatch.setattr(modules.main, "analyze_and_store", always_raise)

    with caplog.at_level(logging.ERROR):
        await modules.main.resume_pending_analysis()

    assert any(str(meme.id) in r.message for r in caplog.records)


def test_update_search_fields_marks_errored_meme_as_done(load_test_modules):
    """Editing metadata on an errored meme sets analysis_status to done and clears the error.

    This is intentional: a manual metadata edit means the user is taking ownership of the
    content, so the meme is treated as fully indexed regardless of its previous LLM state.
    The done status also prevents analyze_and_store from overwriting the user's data if a
    background task is still in flight.
    """
    modules = load_test_modules()
    modules.init_db.init_db()

    db = modules.database.SessionLocal()
    repo = modules.repository.MemeRepository(db)
    raw, phash = image_bytes_with_phash(modules)
    meme = repo.create_meme(
        filename="errored.png",
        mime_type="image/png",
        sha256="errored-hash",
        phash=phash,
        image_data=raw,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        analysis_status="error",
        analysis_error="LLM features are unavailable because OPENAI_API_KEY is not configured.",
    )
    assert meme.analysis_status == "error"
    assert meme.analysis_error is not None

    updated = repo.update_search_fields(
        meme.id,
        {
            "description": "User-provided description",
            "why_funny": "User explanation",
            "references": "User refs",
            "use_cases": "User use cases",
            "tags": ["manual"],
        },
    )
    assert updated is not None
    assert updated["analysis_status"] == "done"
    assert updated["analysis_error"] is None
    assert updated["description"] == "User-provided description"
    db.close()


def test_llm_helpers_cover_validation_and_json_extraction(load_test_modules):
    """_normalise_analysis_payload and _extract_json handle valid, partial, and invalid inputs."""
    modules = load_test_modules(api_key="")
    llm = modules.llm

    with pytest.raises(llm.LLMUnavailableError):
        llm._get_client()

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
async def test_get_client_caches_singleton_and_close_client_resets_it(monkeypatch, load_test_modules):
    """_get_client returns the same instance on repeated calls; close_client closes and resets it."""
    from importlib import reload as importlib_reload

    modules = load_test_modules()
    llm = modules.llm

    # load_test_modules patches _get_client to a lambda so tests don't hit the network.
    # Re-reload llm to restore the real implementation and reset _openai_client to None,
    # while keeping the env vars (already set by monkeypatch) in place.
    importlib_reload(llm)

    constructor_calls: list[object] = []

    class FakeClient:
        async def close(self) -> None:
            pass

    def fake_constructor(**_kwargs: object) -> FakeClient:
        instance = FakeClient()
        constructor_calls.append(instance)
        return instance

    monkeypatch.setattr(llm, "DefaultAsyncHttpxClient", lambda: None)
    monkeypatch.setattr(llm, "AsyncOpenAI", fake_constructor)

    c1 = llm._get_client()
    c2 = llm._get_client()
    assert len(constructor_calls) == 1, "AsyncOpenAI should be instantiated only once"
    assert c1 is c2, "_get_client should return the cached instance on the second call"

    await llm.close_client()
    assert llm._openai_client is None, "close_client should reset the singleton to None"

    await llm.close_client()
    assert len(constructor_calls) == 1, "close_client on a None singleton should be a no-op"


@pytest.mark.anyio
async def test_llm_completion_fallback_and_ranking_edge_cases(monkeypatch, load_test_modules):
    """_create_json_completion falls back to prompt-only JSON, and llm_rank skips malformed items."""
    modules = load_test_modules()
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
    monkeypatch.setattr(llm, "_get_client", lambda: fake_client)

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
