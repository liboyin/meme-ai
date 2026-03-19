import asyncio
import base64
import json
import logging
from typing import Any

from openai import AsyncOpenAI, BadRequestError

from .config import settings

logger = logging.getLogger(__name__)
semaphore = asyncio.Semaphore(3)

ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "description": {"type": "string"},
        "why_funny": {"type": "string"},
        "references": {"type": "string"},
        "use_cases": {"type": "string"},
        "tags": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["description", "why_funny", "references", "use_cases", "tags"],
}

RANKING_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "integer"},
            "score": {"type": "number"},
            "reason": {"type": "string"},
        },
        "required": ["id", "score", "reason"],
    },
}


class LLMUnavailableError(RuntimeError):
    pass


def _client() -> AsyncOpenAI:
    if not settings.openai_api_key:
        raise LLMUnavailableError
    return AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)


def _normalise_analysis_payload(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("LLM analysis response was not a JSON object.")

    tags = data.get("tags", [])
    if not isinstance(tags, list):
        tags = []

    return {
        "description": str(data.get("description", "")).strip(),
        "why_funny": str(data.get("why_funny", "")).strip(),
        "references": str(data.get("references", "")).strip(),
        "use_cases": str(data.get("use_cases", "")).strip(),
        "tags": [str(tag).strip() for tag in tags if str(tag).strip()],
    }


def _extract_json(content: str) -> Any:
    stripped = content.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    for opener, closer in (("[", "]"), ("{", "}")):
        start = stripped.find(opener)
        end = stripped.rfind(closer)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(stripped[start : end + 1])
            except json.JSONDecodeError:
                continue

    raise ValueError("LLM response did not contain valid JSON.")


async def _create_json_completion(
    *,
    messages: list[dict[str, Any]],
    schema_name: str,
    schema: dict[str, Any],
    fallback_instructions: str,
) -> Any:
    client = _client()

    try:
        response = await client.chat.completions.create(
            model=settings.openai_model,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": schema,
                },
            },
            messages=messages,
        )
        content = response.choices[0].message.content or ""
        return _extract_json(content)
    except BadRequestError as exc:
        logger.info("Provider rejected json_schema response_format, retrying with prompt-only JSON: %s", exc)

    fallback_messages = [
        *messages,
        {
            "role": "system",
            "content": fallback_instructions,
        },
    ]
    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=fallback_messages,
    )
    content = response.choices[0].message.content or ""
    return _extract_json(content)


async def analyze_image(image_bytes: bytes, mime_type: str) -> dict:
    async with semaphore:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        prompt = (
            "Analyze this static meme image for a personal meme library. "
            "Describe what is visible, explain why it is funny, note any references, "
            "suggest likely use cases, and provide concise searchable tags."
        )
        data = await _create_json_completion(
            schema_name="meme_analysis",
            schema=ANALYSIS_SCHEMA,
            fallback_instructions=(
                "Return only a JSON object with keys description, why_funny, references, "
                "use_cases, and tags. tags must be an array of strings."
            ),
            messages=[
                {
                    "role": "system",
                    "content": "You analyze memes for offline search and organization.",
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{b64}"},
                        },
                    ],
                },
            ],
        )
        return _normalise_analysis_payload(data)


async def llm_rank(query: str, candidates: list[dict]) -> list[dict]:
    results: list[dict] = []
    for idx in range(0, len(candidates), 15):
        chunk = candidates[idx : idx + 15]
        try:
            payload = [
                {
                    "id": c["id"],
                    "filename": c["filename"],
                    "description": c.get("description"),
                    "why_funny": c.get("why_funny"),
                    "references": c.get("references"),
                    "use_cases": c.get("use_cases"),
                    "tags": c.get("tags", []),
                }
                for c in chunk
            ]
            prompt = (
                "Score how relevant each meme candidate is to the user's search query on a 0 to 10 scale. "
                "Use higher scores for strong semantic matches, even if wording differs. "
                "Every candidate must appear exactly once in the response.\n"
                f"Query: {query}\n"
                f"Candidates: {json.dumps(payload, ensure_ascii=True)}"
            )
            parsed = await _create_json_completion(
                schema_name="meme_rankings",
                schema=RANKING_SCHEMA,
                fallback_instructions=(
                    "Return only a JSON array of objects in the form "
                    '[{"id":123,"score":8.5,"reason":"..."}].'
                ),
                messages=[
                    {
                        "role": "system",
                        "content": "You rerank meme search candidates for a local archive.",
                    },
                    {"role": "user", "content": prompt},
                ],
            )
            arr = parsed if isinstance(parsed, list) else parsed.get("results", [])
            for item in arr:
                if "id" not in item or "score" not in item:
                    continue
                try:
                    results.append(
                        {
                            "id": int(item["id"]),
                            "score": float(item["score"]),
                            "reason": str(item.get("reason", "")).strip(),
                        }
                    )
                except (TypeError, ValueError):
                    logger.warning("Skipping malformed LLM ranking item: %r", item)
        except Exception as exc:
            logger.warning("LLM rank batch failed: %s", exc)
    return sorted(results, key=lambda x: x["score"], reverse=True)
