import sqlite3

from .config import settings


def _configure_connection(connection: sqlite3.Connection) -> sqlite3.Connection:
    """Configure a SQLite connection with WAL mode, busy timeout, and foreign keys.

    Args:
        connection: A raw SQLite connection to configure.

    Returns:
        The same connection with row_factory and pragmas applied.
    """
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA busy_timeout=5000;")
    connection.execute("PRAGMA foreign_keys=ON;")
    return connection


def SessionLocal() -> sqlite3.Connection:
    """Create and return a configured SQLite connection to the application database.

    Returns:
        A configured SQLite connection.
    """
    connection = sqlite3.connect(settings.db_path, check_same_thread=False)
    return _configure_connection(connection)
