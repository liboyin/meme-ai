import argparse
import asyncio
import logging
import socket
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone

from .analysis import analyze_and_store
from .database import SessionLocal
from .init_db import init_db
from .llm import close_client
from .repository import MemeRepository


logger = logging.getLogger(__name__)
DEFAULT_POLL_INTERVAL_SECONDS = 2.0
DEFAULT_STALE_LOCK_SECONDS = 15 * 60


def build_worker_id() -> str:
    """Return a readable unique identifier for this worker process."""
    return f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"


async def process_next_pending(*, worker_id: str, stale_lock_seconds: int) -> bool:
    """Claim and analyse one pending meme if work is available.

    Args:
        worker_id: Identifier recorded on the claimed row.
        stale_lock_seconds: Age after which another worker may reclaim a lock.

    Returns:
        True when a meme was claimed, otherwise False.
    """
    now = datetime.now(timezone.utc)
    stale_before = (now - timedelta(seconds=stale_lock_seconds)).isoformat()
    db = SessionLocal()
    try:
        repo = MemeRepository(db)
        meme = repo.claim_pending_analysis(
            worker_id=worker_id,
            now=now.isoformat(),
            stale_before=stale_before,
        )
    finally:
        db.close()

    if meme is None:
        return False

    logger.info("Analysing meme_id=%s with worker_id=%s", meme.id, worker_id)
    await analyze_and_store(meme.id, worker_id=worker_id)
    return True


async def run_worker(
    *,
    worker_id: str | None = None,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    stale_lock_seconds: int = DEFAULT_STALE_LOCK_SECONDS,
    once: bool = False,
) -> None:
    """Run the meme analysis worker loop.

    Args:
        worker_id: Optional stable worker identifier. A unique one is generated when omitted.
        poll_interval_seconds: Seconds to wait between empty queue polls.
        stale_lock_seconds: Age after which locked pending work can be reclaimed.
        once: If True, process at most one pending meme and exit.
    """
    init_db()
    active_worker_id = worker_id or build_worker_id()
    try:
        while True:
            processed = await process_next_pending(
                worker_id=active_worker_id,
                stale_lock_seconds=stale_lock_seconds,
            )
            if once:
                return
            if not processed:
                await asyncio.sleep(poll_interval_seconds)
    finally:
        await close_client()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments for the worker process.

    Args:
        argv: Optional argument sequence. Defaults to ``sys.argv`` when omitted.

    Returns:
        Parsed command-line namespace.
    """
    parser = argparse.ArgumentParser(description="Run the meme analysis worker.")
    parser.add_argument("--once", action="store_true", help="Process at most one pending meme and exit.")
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=DEFAULT_POLL_INTERVAL_SECONDS,
        help="Seconds to wait between empty queue polls.",
    )
    parser.add_argument(
        "--stale-lock-seconds",
        type=int,
        default=DEFAULT_STALE_LOCK_SECONDS,
        help="Seconds before an abandoned lock may be reclaimed.",
    )
    parser.add_argument("--worker-id", help="Optional stable worker identifier.")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    """Run the worker CLI entrypoint.

    Args:
        argv: Optional argument sequence. Defaults to ``sys.argv`` when omitted.
    """
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(
            run_worker(
                worker_id=args.worker_id,
                poll_interval_seconds=args.poll_interval,
                stale_lock_seconds=args.stale_lock_seconds,
                once=args.once,
            )
        )
    except KeyboardInterrupt:
        logger.info("Meme analysis worker stopped.")


if __name__ == "__main__":
    main()
