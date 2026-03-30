from pydantic import BaseModel, Field, field_validator


class ErrorBody(BaseModel):
    """Envelope for error responses."""

    error: dict


class MemeOut(BaseModel):
    """Response model for a single meme's metadata."""

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
    analysis_error: str | None


class MemeIndexFieldsIn(BaseModel):
    """Request body for updating a meme's searchable fields."""

    description: str | None = None
    why_funny: str | None = None
    references: str | None = None
    use_cases: str | None = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("description", "why_funny", "references", "use_cases", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        """Strip whitespace from text fields and convert empty strings to None."""
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value):
        """Deduplicate and strip whitespace from tags, removing empty entries."""
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("tags must be a list of strings")

        normalized: list[str] = []
        seen: set[str] = set()
        for tag in value:
            text = str(tag).strip()
            if text and text not in seen:
                seen.add(text)
                normalized.append(text)
        return normalized


class MemeListOut(BaseModel):
    """Paginated response for the meme listing endpoint."""

    items: list[MemeOut]
    total: int
    page: int
    page_size: int


class PendingItem(BaseModel):
    """A meme whose analysis is pending or errored."""

    id: int
    analysis_status: str


class PendingOut(BaseModel):
    """Response model for the pending-analysis endpoint."""

    items: list[PendingItem]


class UploadItemResult(BaseModel):
    """Result for a single file in a batch upload."""

    filename: str
    status: str
    id: int | None = None
    error: str | None = None


class UploadOut(BaseModel):
    """Response model for the batch upload endpoint."""

    items: list[UploadItemResult]


class MemeSearchOut(MemeOut):
    """Meme metadata extended with search ranking fields."""

    rank: float | None = None
    score: float | None = None
    reason: str | None = None


class SearchOut(BaseModel):
    """Response model for search endpoints."""

    items: list[MemeSearchOut]


class DeleteOut(BaseModel):
    """Response model for the delete endpoint."""

    deleted: bool


class LlmSearchRequest(BaseModel):
    """Request body for the LLM-powered semantic search endpoint."""

    query: str
    top_n: int = Field(default=20, ge=1, le=100)
