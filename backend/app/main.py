import asyncio
import hashlib
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
from sqlite3 import Connection
from typing import Annotated

import imagehash
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, UnidentifiedImageError

from .config import settings
from .database import SessionLocal
from .init_db import init_db
from .llm import LLMUnavailableError, analyze_image, llm_rank
from .repository import DuplicateMemeError, MemeRepository, SortBy, SortOrder
from .schemas import (
    DeleteOut,
    LlmSearchRequest,
    MemeIndexFieldsIn,
    MemeListOut,
    MemeOut,
    PendingOut,
    SearchOut,
    UploadOut,
)


logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 1_500_000
ALLOWED_MIME = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def llm_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "error": {
                "code": "llm_unavailable",
                "message": "LLM features are unavailable because OPENAI_API_KEY is not configured.",
            }
        },
    )


def validate_image_bytes(*, filename: str | None, mime_type: str | None, data: bytes) -> str:
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large: {filename or 'upload'}")

    try:
        with Image.open(BytesIO(data)) as image:
            detected_format = image.format
            image.verify()
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {filename or 'upload'}") from exc

    try:
        with Image.open(BytesIO(data)) as image:
            frame_count = getattr(image, "n_frames", 1)
            is_animated = bool(getattr(image, "is_animated", False) or frame_count > 1)
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {filename or 'upload'}") from exc

    if detected_format not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {filename or 'upload'}")
    if is_animated:
        raise HTTPException(
            status_code=415,
            detail=f"Animated images are not supported: {filename or 'upload'}",
        )

    expected_mime_type = ALLOWED_MIME[detected_format]
    if mime_type and mime_type != expected_mime_type:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {filename or 'upload'}")
    return expected_mime_type


def compute_image_phash(data: bytes) -> str:
    with Image.open(BytesIO(data)) as image:
        return str(imagehash.phash(image))


async def analyze_and_store(meme_id: int):
    db = SessionLocal()
    repo = MemeRepository(db)
    meme = repo.get_full(meme_id)
    if not meme:
        db.close()
        return
    if meme.analysis_status != "pending":
        db.close()
        return

    def still_pending() -> bool:
        current = repo.get_full(meme_id)
        return current is not None and current.analysis_status == "pending"

    if not settings.openai_api_key:
        if still_pending():
            repo.set_error(meme_id, "LLM features are unavailable because OPENAI_API_KEY is not configured.")
        db.close()
        return
    try:
        payload = await analyze_image(meme.image_data, meme.mime_type)
        if still_pending():
            repo.update_analysis(meme_id, payload, "done")
    except Exception as exc:
        logger.exception("Meme analysis failed for meme_id=%s", meme_id)
        if still_pending():
            repo.set_error(meme_id, str(exc))
    finally:
        db.close()


async def resume_pending_analysis() -> None:
    init_db()
    db = SessionLocal()
    repo = MemeRepository(db)
    for meme_id in repo.pending_ids():
        asyncio.create_task(analyze_and_store(meme_id))
    db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await resume_pending_analysis()
    yield


app = FastAPI(title="Meme Organiser", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.post("/api/memes/upload", response_model=UploadOut)
async def upload_memes(background_tasks: BackgroundTasks, files: list[UploadFile] = File(...), db: Connection = Depends(get_db)) -> UploadOut:
    if len(files) > 50:
        raise HTTPException(status_code=413, detail="Maximum 50 files per request")

    repo = MemeRepository(db)
    items = []
    single_file_request = len(files) == 1
    for file in files:
        try:
            data = await file.read()
            detected_mime_type = validate_image_bytes(
                filename=file.filename,
                mime_type=file.content_type,
                data=data,
            )
            meme = repo.create_meme(
                filename=file.filename,
                mime_type=detected_mime_type,
                sha256=hashlib.sha256(data).hexdigest(),
                phash=compute_image_phash(data),
                image_data=data,
                uploaded_at=datetime.now(timezone.utc).isoformat(),
                analysis_status="pending",
            )
            background_tasks.add_task(analyze_and_store, meme.id)
            items.append({"filename": file.filename, "status": "created", "id": meme.id})
        except DuplicateMemeError as exc:
            if single_file_request:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            items.append({"filename": file.filename, "status": "error", "error": str(exc)})
        except HTTPException as exc:
            if single_file_request:
                raise exc
            items.append({"filename": file.filename, "status": "error", "error": exc.detail})
    return {"items": items}


@app.get("/api/memes", response_model=MemeListOut)
def list_memes(
    page: int = 1,
    page_size: int = 40,
    sort_by: Annotated[SortBy, Query()] = "uploaded_at",
    sort_order: Annotated[SortOrder, Query()] = "desc",
    db: Connection = Depends(get_db),
) -> MemeListOut:
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    repo = MemeRepository(db)
    items, total = repo.list_memes(page, page_size, sort_by=sort_by, sort_order=sort_order)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@app.get("/api/memes/pending", response_model=PendingOut)
def pending(db: Connection = Depends(get_db)) -> PendingOut:
    return {"items": MemeRepository(db).pending_statuses()}


@app.get("/api/memes/{meme_id}/image", response_class=Response)
def image(meme_id: int, db: Connection = Depends(get_db)) -> Response:
    meme = MemeRepository(db).get_full(meme_id)
    if not meme:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=meme.image_data, media_type=meme.mime_type)


@app.get("/api/memes/{meme_id}", response_model=MemeOut)
def get_meme(meme_id: int, db: Connection = Depends(get_db)) -> MemeOut:
    repo = MemeRepository(db)
    meme = repo.get_metadata(meme_id)
    if not meme:
        raise HTTPException(status_code=404, detail="Not found")
    return meme


@app.put("/api/memes/{meme_id}", response_model=MemeOut)
def update_meme(meme_id: int, body: MemeIndexFieldsIn, db: Connection = Depends(get_db)) -> MemeOut:
    repo = MemeRepository(db)
    meme = repo.update_search_fields(meme_id, body.model_dump())
    if not meme:
        raise HTTPException(status_code=404, detail="Not found")
    return meme


@app.delete("/api/memes/{meme_id}", response_model=DeleteOut)
def delete_meme(meme_id: int, db: Connection = Depends(get_db)) -> DeleteOut:
    if not MemeRepository(db).delete(meme_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


@app.get("/api/search", response_model=SearchOut)
def fuzzy_search(q: str, mode: str = "fuzzy", db: Connection = Depends(get_db)) -> SearchOut:
    if mode != "fuzzy":
        raise HTTPException(status_code=400, detail="Unsupported mode")
    return {"items": MemeRepository(db).search_fts(q, limit=20)}


@app.post("/api/search/llm", response_model=SearchOut)
async def ai_search(body: LlmSearchRequest, db: Connection = Depends(get_db)) -> SearchOut | JSONResponse:
    if not settings.openai_api_key:
        return llm_unavailable_response()
    repo = MemeRepository(db)
    short = repo.search_fts(body.query, limit=200)
    if not short:
        return {"items": []}
    ranked = await llm_rank(body.query, short)
    by_id = {m["id"]: m for m in short}
    out = []
    for item in ranked:
        if item["id"] in by_id:
            m = by_id[item["id"]]
            m.update(item)
            out.append(m)
    return {"items": out[: body.top_n]}


@app.exception_handler(LLMUnavailableError)
async def llm_unavailable_handler(_request: object, _exc: LLMUnavailableError) -> JSONResponse:
    return llm_unavailable_response()
