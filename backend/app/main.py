import asyncio
import hashlib
import imghdr
from datetime import datetime, timezone
from io import BytesIO

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal
from .init_db import init_db
from .llm import LLMUnavailableError, analyze_image, llm_rank
from .repository import MemeRepository
from .schemas import LlmSearchRequest

MAX_FILE_BYTES = 1_500_000
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_IMGHDR = {"png", "jpeg", "webp"}

app = FastAPI(title="Meme Organiser")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def analyze_and_store(meme_id: int):
    db = SessionLocal()
    repo = MemeRepository(db)
    meme = repo.get(meme_id)
    if not meme:
        db.close()
        return
    if not settings.openai_api_key:
        repo.set_error(meme_id, "LLM features are unavailable because OPENAI_API_KEY is not configured.")
        db.close()
        return
    try:
        payload = await analyze_image(meme.image_data, meme.mime_type)
        repo.update_analysis(meme_id, payload, "done")
    except Exception as exc:
        repo.set_error(meme_id, str(exc))
    finally:
        db.close()


@app.on_event("startup")
async def startup_event():
    init_db()
    db = SessionLocal()
    repo = MemeRepository(db)
    for meme_id in repo.pending_ids():
        asyncio.create_task(analyze_and_store(meme_id))
    db.close()


@app.post("/api/memes/upload")
async def upload_memes(background_tasks: BackgroundTasks, files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    if len(files) > 50:
        raise HTTPException(status_code=413, detail="Maximum 50 files per request")
    repo = MemeRepository(db)
    items = []
    for file in files:
        try:
            if file.content_type not in ALLOWED_MIME:
                raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.content_type}")
            data = await file.read()
            if len(data) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail=f"File too large: {file.filename}")
            kind = imghdr.what(None, data)
            if kind not in ALLOWED_IMGHDR:
                raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.filename}")
            with Image.open(BytesIO(data)) as img:
                img.verify()
                if getattr(img, "is_animated", False):
                    raise HTTPException(status_code=415, detail=f"Animated images are not supported: {file.filename}")
            meme = repo.create_meme(
                filename=file.filename,
                mime_type=file.content_type,
                sha256=hashlib.sha256(data).hexdigest(),
                image_data=data,
                uploaded_at=datetime.now(timezone.utc).isoformat(),
                analysis_status="pending",
            )
            background_tasks.add_task(analyze_and_store, meme.id)
            items.append({"filename": file.filename, "status": "created", "id": meme.id})
        except HTTPException as exc:
            items.append({"filename": file.filename, "status": "error", "error": exc.detail})
        except UnidentifiedImageError:
            items.append({"filename": file.filename, "status": "error", "error": "Invalid image"})
    return {"items": items}


@app.get("/api/memes")
def list_memes(page: int = 1, page_size: int = 40, db: Session = Depends(get_db)):
    page_size = max(1, min(page_size, 100))
    repo = MemeRepository(db)
    items, total = repo.list_memes(page, page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@app.get("/api/memes/pending")
def pending(db: Session = Depends(get_db)):
    return {"items": MemeRepository(db).pending_statuses()}


@app.get("/api/memes/{meme_id}/image")
def image(meme_id: int, db: Session = Depends(get_db)):
    meme = MemeRepository(db).get(meme_id)
    if not meme:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=meme.image_data, media_type=meme.mime_type)


@app.get("/api/memes/{meme_id}")
def get_meme(meme_id: int, db: Session = Depends(get_db)):
    repo = MemeRepository(db)
    meme = repo.get(meme_id)
    if not meme:
        raise HTTPException(status_code=404, detail="Not found")
    return repo._to_dict(meme)


@app.delete("/api/memes/{meme_id}")
def delete_meme(meme_id: int, db: Session = Depends(get_db)):
    if not MemeRepository(db).delete(meme_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


@app.get("/api/search")
def fuzzy_search(q: str, mode: str = "fuzzy", db: Session = Depends(get_db)):
    if mode != "fuzzy":
        raise HTTPException(status_code=400, detail="Unsupported mode")
    return {"items": MemeRepository(db).search_fts(q, limit=20)}


@app.post("/api/search/llm")
async def ai_search(body: LlmSearchRequest, db: Session = Depends(get_db)):
    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "llm_unavailable",
                    "message": "LLM features are unavailable because OPENAI_API_KEY is not configured.",
                }
            },
        )
    repo = MemeRepository(db)
    short = repo.search_fts(body.query, limit=200)
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
async def llm_unavailable_handler(_request, _exc):
    return Response(
        status_code=503,
        media_type="application/json",
        content='{"error":{"code":"llm_unavailable","message":"LLM features are unavailable because OPENAI_API_KEY is not configured."}}',
    )
