import logging

from .config import settings
from .database import SessionLocal
from .llm import LLM_UNAVAILABLE_MESSAGE, analyze_image
from .repository import MemeRepository


logger = logging.getLogger(__name__)


async def analyze_and_store(meme_id: int, *, worker_id: str | None = None) -> None:
    """Run LLM analysis on a pending meme and persist the results.

    Skips analysis if the meme no longer exists, is no longer pending, or is
    currently owned by a different worker. Repository updates are conditional
    so a manual metadata edit that completes during analysis still wins.

    Args:
        meme_id: ID of the meme to analyse.
        worker_id: Optional worker owner that must still match the row lock.
    """
    db = SessionLocal()
    repo = MemeRepository(db)
    try:
        meme = repo.get_full(meme_id)
        if not meme or meme.analysis_status != "pending":
            return
        if worker_id is not None and meme.analysis_worker_id != worker_id:
            return
        if not settings.openai_api_key:
            repo.set_error(meme_id, LLM_UNAVAILABLE_MESSAGE, worker_id=worker_id)
            return
        try:
            payload = await analyze_image(meme.image_data, meme.mime_type)
            repo.update_analysis(meme_id, payload, "done", worker_id=worker_id)
        except Exception as exc:
            logger.exception("Meme analysis failed for meme_id=%s", meme_id)
            repo.set_error(meme_id, str(exc), worker_id=worker_id)
    finally:
        db.close()
