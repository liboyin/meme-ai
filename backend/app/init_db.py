import sqlite3

from .database import SessionLocal


def _duplicate_sha256_preview(db: sqlite3.Connection) -> str:
    """Return a short human-readable preview of duplicate sha256 rows.

    Args:
        db: Open SQLite connection.

    Returns:
        Comma-separated duplicate sha256 values with duplicate counts, or a
        fallback string if the duplicate rows cannot be identified.
    """
    duplicate_rows = db.execute(
        """
        SELECT sha256, COUNT(*) AS duplicate_count
        FROM memes
        GROUP BY sha256
        HAVING COUNT(*) > 1
        ORDER BY duplicate_count DESC, sha256
        LIMIT 3
        """
    ).fetchall()
    return ", ".join(
        f"{row['sha256']} ({row['duplicate_count']})"
        for row in duplicate_rows
    ) or "unknown duplicates"


def _ensure_unique_sha256_index(db: sqlite3.Connection) -> None:
    """Ensure existing databases reject duplicate sha256 values.

    Args:
        db: Open SQLite connection.

    Raises:
        RuntimeError: If duplicate sha256 rows prevent unique index creation.
    """
    try:
        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_memes_sha256_unique
            ON memes (sha256)
            """
        )
    except sqlite3.IntegrityError as exc:
        duplicate_preview = _duplicate_sha256_preview(db)
        raise RuntimeError(
            "Cannot enforce unique meme sha256 values until duplicate rows are removed: "
            f"{duplicate_preview}"
        ) from exc


def init_db() -> None:
    """Create the memes table, indexes, FTS virtual table, and triggers if they don't exist.

    Raises:
        RuntimeError: If duplicate sha256 rows prevent unique index creation.
    """
    db = SessionLocal()
    try:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS memes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                sha256 TEXT NOT NULL UNIQUE,
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
        _ensure_unique_sha256_index(db)
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_memes_uploaded_at_sort
            ON memes (uploaded_at DESC, id DESC)
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_memes_filename_sort
            ON memes (filename COLLATE NOCASE ASC, id ASC)
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_memes_phash_sort
            ON memes (phash ASC, id ASC)
            """
        )
        db.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS memes_fts USING fts5(
                filename, description, why_funny, "references", use_cases, tags
            )
            """
        )
        db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memes_ai AFTER INSERT ON memes BEGIN
                INSERT INTO memes_fts(rowid, filename, description, why_funny, "references", use_cases, tags)
                SELECT
                    NEW.id,
                    NEW.filename,
                    NEW.description,
                    NEW.why_funny,
                    NEW."references",
                    NEW.use_cases,
                    COALESCE((SELECT group_concat(value, ' ') FROM json_each(NEW.tags)), '')
                WHERE NEW.analysis_status = 'done';
            END
            """
        )
        db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memes_au AFTER UPDATE ON memes BEGIN
                DELETE FROM memes_fts WHERE rowid = NEW.id;
                INSERT INTO memes_fts(rowid, filename, description, why_funny, "references", use_cases, tags)
                SELECT
                    NEW.id,
                    NEW.filename,
                    NEW.description,
                    NEW.why_funny,
                    NEW."references",
                    NEW.use_cases,
                    COALESCE((SELECT group_concat(value, ' ') FROM json_each(NEW.tags)), '')
                WHERE NEW.analysis_status = 'done';
            END
            """
        )
        db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memes_ad AFTER DELETE ON memes BEGIN
                DELETE FROM memes_fts WHERE rowid = OLD.id;
            END
            """
        )
        db.commit()
    finally:
        db.close()
