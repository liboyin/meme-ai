import sqlite3

from .config import settings


def _configure_connection(connection: sqlite3.Connection) -> sqlite3.Connection:
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA busy_timeout=5000;")
    connection.execute("PRAGMA foreign_keys=ON;")
    return connection


def SessionLocal() -> sqlite3.Connection:
    connection = sqlite3.connect(settings.db_path, check_same_thread=False)
    return _configure_connection(connection)
