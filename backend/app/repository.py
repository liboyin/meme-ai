import json
import re
import sqlite3
from collections.abc import Mapping
from typing import Any, Iterable, Literal

from .models import Meme

FTS_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)
SortBy = Literal["uploaded_at", "filename", "phash"]
SortOrder = Literal["asc", "desc"]

LIST_MEME_ORDER_BY: dict[tuple[SortBy, SortOrder], str] = {
    ("uploaded_at", "desc"): "uploaded_at DESC, id DESC",
    ("uploaded_at", "asc"): "uploaded_at ASC, id ASC",
    ("filename", "asc"): "filename COLLATE NOCASE ASC, id ASC",
    ("filename", "desc"): "filename COLLATE NOCASE DESC, id DESC",
    ("phash", "asc"): "phash ASC, id ASC",
    ("phash", "desc"): "phash DESC, id DESC",
}

# All columns except image_data, used by metadata-only queries.
_METADATA_COLUMNS = (
    'id, filename, mime_type, sha256, phash, uploaded_at,'
    ' description, why_funny, "references", use_cases, tags,'
    ' analysis_status, analysis_error'
)


class DuplicateMemeError(ValueError):
    def __init__(self, sha256: str, *, existing_id: int | None = None):
        self.sha256 = sha256
        self.existing_id = existing_id
        super().__init__("A meme with the same sha256 already exists.")


class MemeRepository:
    def __init__(self, db: sqlite3.Connection):
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

    @staticmethod
    def _row_to_meme(row: sqlite3.Row) -> Meme:
        return Meme(**dict(row))

    @classmethod
    def _api_payload(
        cls,
        meme: Meme | Mapping[str, Any],
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

    def get_by_sha256(self, sha256: str) -> Meme | None:
        row = self.db.execute("SELECT * FROM memes WHERE sha256 = ?", (sha256,)).fetchone()
        if row is None:
            return None
        return self._row_to_meme(row)

    def create_meme(self, **kwargs) -> Meme:
        payload = {
            "filename": kwargs["filename"],
            "mime_type": kwargs["mime_type"],
            "sha256": kwargs["sha256"],
            "phash": kwargs["phash"],
            "image_data": kwargs["image_data"],
            "uploaded_at": kwargs["uploaded_at"],
            "description": kwargs.get("description"),
            "why_funny": kwargs.get("why_funny"),
            "references": kwargs.get("references"),
            "use_cases": kwargs.get("use_cases"),
            "tags": kwargs.get("tags"),
            "analysis_status": kwargs.get("analysis_status", "pending"),
            "analysis_error": kwargs.get("analysis_error"),
        }
        try:
            cursor = self.db.execute(
                """
                INSERT INTO memes (
                    filename,
                    mime_type,
                    sha256,
                    phash,
                    image_data,
                    uploaded_at,
                    description,
                    why_funny,
                    "references",
                    use_cases,
                    tags,
                    analysis_status,
                    analysis_error
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["filename"],
                    payload["mime_type"],
                    payload["sha256"],
                    payload["phash"],
                    payload["image_data"],
                    payload["uploaded_at"],
                    payload["description"],
                    payload["why_funny"],
                    payload["references"],
                    payload["use_cases"],
                    payload["tags"],
                    payload["analysis_status"],
                    payload["analysis_error"],
                ),
            )
        except sqlite3.IntegrityError as exc:
            if "sha256" in str(exc).lower():
                existing = self.get_by_sha256(payload["sha256"])
                raise DuplicateMemeError(
                    payload["sha256"],
                    existing_id=existing.id if existing is not None else None,
                ) from exc
            raise
        self.db.commit()
        row_id = cursor.lastrowid
        if row_id is None:
            raise RuntimeError("SQLite did not return a row id for the new meme.")
        meme = self.get(row_id)
        if meme is None:
            raise RuntimeError("Failed to load newly created meme.")
        return meme

    def get(self, meme_id: int) -> Meme | None:
        row = self.db.execute("SELECT * FROM memes WHERE id = ?", (meme_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_meme(row)

    @staticmethod
    def _list_order_by(sort_by: SortBy, sort_order: SortOrder) -> str:
        try:
            return LIST_MEME_ORDER_BY[(sort_by, sort_order)]
        except KeyError as exc:
            raise ValueError(f"Unsupported meme sort: {sort_by} {sort_order}") from exc

    def get_metadata(self, meme_id: int) -> dict | None:
        """Fetch a single meme's metadata without loading image_data."""
        row = self.db.execute(
            f"SELECT {_METADATA_COLUMNS} FROM memes WHERE id = ?", (meme_id,)
        ).fetchone()
        if row is None:
            return None
        return self._api_payload(dict(row))

    def list_memes(
        self,
        page: int,
        page_size: int,
        *,
        sort_by: SortBy = "uploaded_at",
        sort_order: SortOrder = "desc",
    ) -> tuple[list[dict], int]:
        order_by = self._list_order_by(sort_by, sort_order)
        total_row = self.db.execute("SELECT COUNT(*) AS total FROM memes").fetchone()
        total = int(total_row["total"]) if total_row is not None else 0
        rows = self.db.execute(
            f"""
            SELECT {_METADATA_COLUMNS} FROM memes
            ORDER BY {order_by}
            LIMIT ? OFFSET ?
            """,
            (page_size, (page - 1) * page_size),
        ).fetchall()
        return [self._api_payload(dict(row)) for row in rows], total

    def pending_statuses(self) -> list[dict]:
        rows = self.db.execute(
            """
            SELECT id, analysis_status
            FROM memes
            WHERE analysis_status = ?
            ORDER BY id DESC
            """,
            ("pending",),
        ).fetchall()
        return [{"id": row["id"], "analysis_status": row["analysis_status"]} for row in rows]

    def update_analysis(self, meme_id: int, payload: dict, status: str, error: str | None = None) -> None:
        cursor = self.db.execute(
            """
            UPDATE memes
            SET description = ?,
                why_funny = ?,
                "references" = ?,
                use_cases = ?,
                tags = ?,
                analysis_status = ?,
                analysis_error = ?
            WHERE id = ?
            """,
            (
                payload.get("description"),
                payload.get("why_funny"),
                payload.get("references"),
                payload.get("use_cases"),
                json.dumps(payload.get("tags", [])),
                status,
                error,
                meme_id,
            ),
        )
        if cursor.rowcount:
            self.db.commit()

    def update_search_fields(self, meme_id: int, payload: Mapping[str, Any]) -> dict | None:
        exists = self.db.execute("SELECT id FROM memes WHERE id = ?", (meme_id,)).fetchone()
        if exists is None:
            return None

        self.db.execute(
            """
            UPDATE memes
            SET description = ?,
                why_funny = ?,
                "references" = ?,
                use_cases = ?,
                tags = ?,
                analysis_status = ?,
                analysis_error = NULL
            WHERE id = ?
            """,
            (
                payload.get("description"),
                payload.get("why_funny"),
                payload.get("references"),
                payload.get("use_cases"),
                json.dumps(payload.get("tags", [])),
                "done",
                meme_id,
            ),
        )
        self.db.commit()
        return self.get_metadata(meme_id)

    def set_error(self, meme_id: int, message: str) -> None:
        cursor = self.db.execute(
            """
            UPDATE memes
            SET analysis_status = ?, analysis_error = ?
            WHERE id = ?
            """,
            ("error", message[:200], meme_id),
        )
        if cursor.rowcount:
            self.db.commit()

    def delete(self, meme_id: int) -> bool:
        cursor = self.db.execute("DELETE FROM memes WHERE id = ?", (meme_id,))
        deleted = cursor.rowcount > 0
        if deleted:
            self.db.commit()
        return deleted

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

        rows = self.db.execute(
            """
            SELECT
                   m.id,
                   m.filename,
                   m.mime_type,
                   m.sha256,
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
            WHERE memes_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
            (fts_query, limit),
        ).fetchall()
        return [self._api_payload(dict(row), include_rank=True) for row in rows]

    def get_for_llm(self, ids: Iterable[int]) -> list[dict]:
        id_list = list(ids)
        if not id_list:
            return []
        placeholders = ", ".join("?" for _ in id_list)
        rows = self.db.execute(
            f"SELECT {_METADATA_COLUMNS} FROM memes WHERE id IN ({placeholders})",
            id_list,
        ).fetchall()
        return [self._api_payload(dict(row)) for row in rows]

    def pending_ids(self) -> list[int]:
        rows = self.db.execute(
            """
            SELECT id
            FROM memes
            WHERE analysis_status = ?
            ORDER BY id DESC
            """,
            ("pending",),
        ).fetchall()
        return [int(row["id"]) for row in rows]
