import json
from typing import Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

from .models import Meme


class MemeRepository:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _to_dict(meme: Meme) -> dict:
        return {
            "id": meme.id,
            "filename": meme.filename,
            "mime_type": meme.mime_type,
            "sha256": meme.sha256,
            "uploaded_at": meme.uploaded_at,
            "description": meme.description,
            "why_funny": meme.why_funny,
            "references": meme.references,
            "use_cases": meme.use_cases,
            "tags": json.loads(meme.tags or "[]"),
            "analysis_status": meme.analysis_status,
            "analysis_error": meme.analysis_error,
        }

    def create_meme(self, **kwargs) -> Meme:
        meme = Meme(**kwargs)
        self.db.add(meme)
        self.db.commit()
        self.db.refresh(meme)
        return meme

    def get(self, meme_id: int) -> Meme | None:
        return self.db.get(Meme, meme_id)

    def list_memes(self, page: int, page_size: int) -> tuple[list[dict], int]:
        q = self.db.query(Meme).order_by(Meme.id.desc())
        total = q.count()
        items = q.offset((page - 1) * page_size).limit(page_size).all()
        return [self._to_dict(x) for x in items], total

    def pending_statuses(self) -> list[dict]:
        rows = (
            self.db.query(Meme.id, Meme.analysis_status)
            .filter(Meme.analysis_status.in_(["pending", "done", "error"]))
            .order_by(Meme.id.desc())
            .limit(500)
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

    def search_fts(self, query: str, limit: int = 20) -> list[dict]:
        sql = text(
            """
            SELECT m.id, m.filename, m.description, m.why_funny, m.references, m.use_cases, m.tags,
                   bm25(memes_fts) AS score
            FROM memes_fts
            JOIN memes m ON m.id = memes_fts.rowid
            WHERE memes_fts MATCH :q
            ORDER BY score
            LIMIT :limit
            """
        )
        rows = self.db.execute(sql, {"q": query, "limit": limit}).mappings().all()
        out = []
        for r in rows:
            out.append({
                "id": r["id"],
                "filename": r["filename"],
                "description": r["description"],
                "why_funny": r["why_funny"],
                "references": r["references"],
                "use_cases": r["use_cases"],
                "tags": json.loads(r["tags"] or "[]"),
                "rank": r["score"],
            })
        return out

    def get_for_llm(self, ids: Iterable[int]) -> list[dict]:
        rows = self.db.query(Meme).filter(Meme.id.in_(list(ids))).all()
        return [self._to_dict(x) for x in rows]

    def pending_ids(self) -> list[int]:
        rows = self.db.query(Meme.id).filter(Meme.analysis_status == "pending").all()
        return [r.id for r in rows]
