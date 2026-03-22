from .database import SessionLocal


def init_db() -> None:
    db = SessionLocal()
    try:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS memes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                sha256 TEXT NOT NULL,
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
        # Recreate the derived FTS table so schema changes are applied to existing DBs.
        db.execute("DROP TABLE IF EXISTS memes_fts")
        db.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS memes_fts USING fts5(
                description, why_funny, "references", use_cases, tags
            )
            """
        )
        db.execute("DROP TRIGGER IF EXISTS memes_ai")
        db.execute("DROP TRIGGER IF EXISTS memes_au")
        db.execute("DROP TRIGGER IF EXISTS memes_ad")
        db.execute(
            """
            CREATE TRIGGER memes_ai AFTER INSERT ON memes BEGIN
                INSERT INTO memes_fts(rowid, description, why_funny, "references", use_cases, tags)
                SELECT
                    NEW.id,
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
            CREATE TRIGGER memes_au AFTER UPDATE ON memes BEGIN
                DELETE FROM memes_fts WHERE rowid = NEW.id;
                INSERT INTO memes_fts(rowid, description, why_funny, "references", use_cases, tags)
                SELECT
                    NEW.id,
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
            CREATE TRIGGER memes_ad AFTER DELETE ON memes BEGIN
                DELETE FROM memes_fts WHERE rowid = OLD.id;
            END
            """
        )
        db.execute("DELETE FROM memes_fts")
        db.execute(
            """
            INSERT INTO memes_fts(rowid, description, why_funny, "references", use_cases, tags)
            SELECT
                m.id,
                m.description,
                m.why_funny,
                m."references",
                m.use_cases,
                COALESCE((SELECT group_concat(value, ' ') FROM json_each(m.tags)), '')
            FROM memes AS m
            WHERE m.analysis_status = 'done'
            """
        )
        db.commit()
    finally:
        db.close()
