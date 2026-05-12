"""Shared pytest fixtures for backend tests."""

import json
from importlib import reload
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image


def _make_image_bytes(format_name="PNG", color=(255, 0, 0)):
    """Return raw image bytes for a small solid-colour image.

    Args:
        format_name: Pillow format string, e.g. ``"PNG"`` or ``"JPEG"``.
        color: RGB tuple for the solid fill colour.

    Returns:
        Raw bytes of the encoded image.
    """
    image = Image.new("RGB", (32, 24), color)
    buffer = BytesIO()
    image.save(buffer, format=format_name)
    return buffer.getvalue()


class FakeChatCompletions:
    """Fake OpenAI chat completions that returns canned analysis and ranking JSON."""

    async def create(self, *, messages, **_kwargs):
        """Return a canned analysis or ranking response based on the message payload."""
        payload = messages[-1]["content"]

        if isinstance(payload, list):
            return _fake_response(
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
        return _fake_response(json.dumps(rankings))


class FakeClient:
    """Fake OpenAI client wired to FakeChatCompletions."""

    def __init__(self):
        """Initialise with a fake chat completions endpoint."""
        self.chat = SimpleNamespace(completions=FakeChatCompletions())


def _fake_response(content):
    """Wrap *content* in an object that mimics the OpenAI ChatCompletion shape."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


@pytest.fixture
def image_bytes():
    """Return a factory that produces raw bytes for a small solid-colour image."""
    return _make_image_bytes


@pytest.fixture
def load_test_modules(monkeypatch, tmp_path):
    """Return a factory that reloads backend modules under isolated env vars.

    The returned callable accepts an optional *api_key* keyword argument.  When
    *api_key* is a non-empty string the OpenAI client is replaced with
    :class:`FakeClient` so tests do not hit the network.

    Returns:
        A callable ``(*, api_key="test-key") -> SimpleNamespace`` with attributes
        ``analysis``, ``config``, ``database``, ``init_db``, ``llm``, ``main``,
        ``repository``, ``worker``.
    """

    def _load(*, api_key="test-key"):
        monkeypatch.setenv("DB_PATH", str(tmp_path / "memes.db"))
        monkeypatch.setenv("OPENAI_BASE_URL", "https://example.invalid/v1")
        monkeypatch.setenv("OPENAI_MODEL", "fake-model")
        monkeypatch.setenv("OPENAI_API_KEY", api_key)

        from backend.app import analysis, config, database, init_db, llm, main, repository, worker

        reload(config)
        reload(database)
        reload(init_db)
        reload(repository)
        reload(llm)
        reload(analysis)
        reload(worker)
        reload(main)

        if api_key:
            monkeypatch.setattr(llm, "_get_client", lambda: FakeClient())

        return SimpleNamespace(
            config=config,
            database=database,
            init_db=init_db,
            llm=llm,
            main=main,
            repository=repository,
            analysis=analysis,
            worker=worker,
        )

    return _load
