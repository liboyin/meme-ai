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
                    filename, description, why_funny, references, use_cases, tags
                );
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TRIGGER IF NOT EXISTS memes_ai AFTER INSERT ON memes BEGIN
                    INSERT INTO memes_fts(rowid, filename, description, why_funny, references, use_cases, tags)
                    SELECT NEW.id, NEW.filename, NEW.description, NEW.why_funny, NEW.references, NEW.use_cases, COALESCE(NEW.tags, '[]')
                    WHERE NEW.analysis_status = 'done';
                END;
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TRIGGER IF NOT EXISTS memes_au AFTER UPDATE ON memes BEGIN
                    DELETE FROM memes_fts WHERE rowid = NEW.id;
                    INSERT INTO memes_fts(rowid, filename, description, why_funny, references, use_cases, tags)
                    SELECT NEW.id, NEW.filename, NEW.description, NEW.why_funny, NEW.references, NEW.use_cases, COALESCE(NEW.tags, '[]')
                    WHERE NEW.analysis_status = 'done';
                END;
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TRIGGER IF NOT EXISTS memes_ad AFTER DELETE ON memes BEGIN
                    DELETE FROM memes_fts WHERE rowid = OLD.id;
                END;
                """
            )
        )
