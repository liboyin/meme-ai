from dataclasses import dataclass


@dataclass(slots=True)
class Meme:
    id: int
    filename: str
    mime_type: str
    sha256: str
    phash: str
    image_data: bytes
    uploaded_at: str
    description: str | None = None
    why_funny: str | None = None
    references: str | None = None
    use_cases: str | None = None
    tags: str | None = None
    analysis_status: str = "pending"
    analysis_error: str | None = None
