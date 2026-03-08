import asyncio
import base64
import json
import logging

from openai import OpenAI

from .config import settings

logger = logging.getLogger(__name__)
semaphore = asyncio.Semaphore(3)


class LLMUnavailableError(RuntimeError):
    pass


def _client() -> OpenAI:
    if not settings.openai_api_key:
        raise LLMUnavailableError
    return OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)


async def analyze_image(image_bytes: bytes, mime_type: str) -> dict:
    async with semaphore:
        client = _client()
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        prompt = "Analyze this meme. Return JSON with keys description, why_funny, references, use_cases, tags (string array)."
        resp = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}}]},
            ],
        )
        data = json.loads(resp.choices[0].message.content)
        return {
            "description": data.get("description", ""),
            "why_funny": data.get("why_funny", ""),
            "references": data.get("references", ""),
            "use_cases": data.get("use_cases", ""),
            "tags": data.get("tags", []),
        }


async def llm_rank(query: str, candidates: list[dict]) -> list[dict]:
    client = _client()
    results: list[dict] = []
    for idx in range(0, len(candidates), 15):
        chunk = candidates[idx : idx + 15]
        try:
            payload = [{"id": c["id"], "filename": c["filename"], "description": c.get("description"), "tags": c.get("tags", [])} for c in chunk]
            prompt = (
                "Score relevance of each meme to query from 0-10. Return JSON array exactly: "
                '[{"id":123,"score":8.5,"reason":"..."}]. Query: '
                + query
                + " Candidates: "
                + json.dumps(payload)
            )
            resp = await asyncio.to_thread(
                client.chat.completions.create,
                model=settings.openai_model,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}],
            )
            txt = resp.choices[0].message.content
            parsed = json.loads(txt)
            arr = parsed if isinstance(parsed, list) else parsed.get("results", [])
            for item in arr:
                if "id" in item and "score" in item:
                    results.append({"id": item["id"], "score": float(item["score"]), "reason": item.get("reason", "")})
        except Exception as exc:
            logger.warning("LLM rank batch failed: %s", exc)
    return sorted(results, key=lambda x: x["score"], reverse=True)
