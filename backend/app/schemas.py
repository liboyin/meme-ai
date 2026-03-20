from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorBody(BaseModel):
    error: ErrorDetail


class MemeOut(BaseModel):
    id: int
    filename: str
    mime_type: str
    sha256: str
    uploaded_at: str
    description: str | None
    why_funny: str | None
    references: str | None
    use_cases: str | None
    tags: list[str] = Field(default_factory=list)
    analysis_status: str
    analysis_error: str | None = None


class MemeListOut(BaseModel):
    items: list[MemeOut]
    total: int
    page: int
    page_size: int


class PendingItem(BaseModel):
    id: int
    analysis_status: str


class PendingOut(BaseModel):
    items: list[PendingItem]


class UploadItemResult(BaseModel):
    filename: str
    status: str
    id: int | None = None
    error: str | None = None


class UploadOut(BaseModel):
    items: list[UploadItemResult]


class DeleteOut(BaseModel):
    deleted: bool


class MemeSearchItemOut(BaseModel):
    id: int
    filename: str
    mime_type: str
    uploaded_at: str
    description: str | None = None
    why_funny: str | None = None
    references: str | None = None
    use_cases: str | None = None
    tags: list[str] = Field(default_factory=list)
    analysis_status: str
    analysis_error: str | None = None
    rank: float


class MemeSearchOut(BaseModel):
    items: list[MemeSearchItemOut]


class LlmSearchItemOut(MemeSearchItemOut):
    score: float
    reason: str


class LlmSearchOut(BaseModel):
    items: list[LlmSearchItemOut]


class LlmSearchRequest(BaseModel):
    query: str
    top_n: int = Field(default=20, ge=1, le=100)
