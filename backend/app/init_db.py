from sqlalchemy import text

from .database import engine
from .models import Base


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS memes_fts USING fts5(
                    filename, description, why_funny, "references", use_cases, tags
                );
                """
            )
        )
        conn.execute(
            text(
                """
                DROP TRIGGER IF EXISTS memes_ai;
                """
            )
        )
        conn.execute(
            text(
                """
                DROP TRIGGER IF EXISTS memes_au;
                """
            )
        )
        conn.execute(
            text(
                """
                DROP TRIGGER IF EXISTS memes_ad;
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TRIGGER memes_ai AFTER INSERT ON memes BEGIN
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
                END;
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TRIGGER memes_au AFTER UPDATE ON memes BEGIN
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
                END;
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TRIGGER memes_ad AFTER DELETE ON memes BEGIN
                    DELETE FROM memes_fts WHERE rowid = OLD.id;
                END;
                """
            )
        )
        conn.execute(text("DELETE FROM memes_fts;"))
        conn.execute(
            text(
                """
                INSERT INTO memes_fts(rowid, filename, description, why_funny, "references", use_cases, tags)
                SELECT
                    m.id,
                    m.filename,
                    m.description,
                    m.why_funny,
                    m."references",
                    m.use_cases,
                    COALESCE((SELECT group_concat(value, ' ') FROM json_each(m.tags)), '')
                FROM memes AS m
                WHERE m.analysis_status = 'done';
                """
            )
        )
