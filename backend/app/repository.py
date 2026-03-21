import json
import re
from collections.abc import Mapping
from typing import Any, Iterable

from sqlalchemy import text
from sqlalchemy.engine import RowMapping
from sqlalchemy.orm import Session

from .models import Meme

FTS_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)


class MemeRepository:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _safe_parse_tags(tags: Any) -> list[Any]:
        if isinstance(tags, list):
            return tags
        if not tags:
            return []
        if not isinstance(tags, str):
            return []
        try:
            parsed = json.loads(tags)
        except (json.JSONDecodeError, TypeError):
            return []
        return parsed if isinstance(parsed, list) else []

    @classmethod
    def _api_payload(
        cls,
        meme: Meme | Mapping[str, Any] | RowMapping,
        *,
        include_rank: bool = False,
    ) -> dict[str, Any]:
        def get(field: str) -> Any:
            if isinstance(meme, Mapping):
                return meme.get(field)
            return getattr(meme, field, None)

        payload = {
            "id": get("id"),
            "filename": get("filename"),
            "mime_type": get("mime_type"),
            "sha256": get("sha256"),
            "uploaded_at": get("uploaded_at"),
            "description": get("description"),
            "why_funny": get("why_funny"),
            "references": get("references"),
            "use_cases": get("use_cases"),
            "tags": cls._safe_parse_tags(get("tags")),
            "analysis_status": get("analysis_status"),
            "analysis_error": get("analysis_error"),
        }
        if include_rank:
            payload["rank"] = get("score")
        return payload

    @staticmethod
    def _to_dict(meme: Meme) -> dict[str, Any]:
        return MemeRepository._api_payload(meme)

    def create_meme(self, **kwargs) -> Meme:
        meme = Meme(**kwargs)
        self.db.add(meme)
        self.db.commit()
        self.db.refresh(meme)
        return meme

    def get(self, meme_id: int) -> Meme | None:
        return self.db.get(Meme, meme_id)

    def list_memes(self, page: int, page_size: int) -> tuple[list[dict], int]:
        q = self.db.query(Meme).order_by(Meme.uploaded_at.desc(), Meme.id.desc())
        total = q.count()
        items = q.offset((page - 1) * page_size).limit(page_size).all()
        return [self._api_payload(x) for x in items], total

    def pending_statuses(self) -> list[dict]:
        rows = (
            self.db.query(Meme.id, Meme.analysis_status)
            .filter(Meme.analysis_status == "pending")
            .order_by(Meme.id.desc())
            .all()
        )
        return [{"id": r.id, "analysis_status": r.analysis_status} for r in rows]

    def update_analysis(self, meme_id: int, payload: dict, status: str, error: str | None = None) -> None:
        meme = self.get(meme_id)
        if not meme:
            return
        meme.description = payload.get("description")
        meme.why_funny = payload.get("why_funny")
        meme.references = payload.get("references")
        meme.use_cases = payload.get("use_cases")
        meme.tags = json.dumps(payload.get("tags", []))
        meme.analysis_status = status
        meme.analysis_error = error
        self.db.commit()

    def set_error(self, meme_id: int, message: str) -> None:
        meme = self.get(meme_id)
        if meme:
            meme.analysis_status = "error"
            meme.analysis_error = message[:200]
            self.db.commit()

    def delete(self, meme_id: int) -> bool:
        meme = self.get(meme_id)
        if not meme:
            return False
        self.db.delete(meme)
        self.db.commit()
        return True

    @staticmethod
    def _build_fts_query(query: str) -> str:
        tokens: list[str] = []
        seen: set[str] = set()
        for token in FTS_TOKEN_PATTERN.findall(query.lower()):
            if token not in seen:
                seen.add(token)
                tokens.append(f"{token}*")
        return " OR ".join(tokens)

    def search_fts(self, query: str, limit: int = 20) -> list[dict]:
        fts_query = self._build_fts_query(query)
        if not fts_query:
            return []

        sql = text(
            """
            SELECT
                   m.id,
                   m.filename,
                   m.mime_type,
                   m.uploaded_at,
                   m.description,
                   m.why_funny,
                   m."references" AS "references",
                   m.use_cases,
                   m.tags,
                   m.analysis_status,
                   m.analysis_error,
                   bm25(memes_fts) AS score
            FROM memes_fts
            JOIN memes m ON m.id = memes_fts.rowid
            WHERE memes_fts MATCH :q
            ORDER BY score
            LIMIT :limit
            """
        )
        rows = self.db.execute(sql, {"q": fts_query, "limit": limit}).mappings().all()
        return [self._api_payload(r, include_rank=True) for r in rows]

    def get_for_llm(self, ids: Iterable[int]) -> list[dict]:
        rows = self.db.query(Meme).filter(Meme.id.in_(list(ids))).all()
        return [self._api_payload(x) for x in rows]

    def pending_ids(self) -> list[int]:
        rows = self.db.query(Meme.id).filter(Meme.analysis_status == "pending").all()
        return [r.id for r in rows]
