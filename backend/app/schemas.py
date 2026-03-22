from pydantic import BaseModel, Field, field_validator


class ErrorBody(BaseModel):
    error: dict


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
    analysis_error: str | None


class MemeIndexFieldsIn(BaseModel):
    description: str | None = None
    why_funny: str | None = None
    references: str | None = None
    use_cases: str | None = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("description", "why_funny", "references", "use_cases", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value):
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


class LlmSearchRequest(BaseModel):
    query: str
    top_n: int = Field(default=20, ge=1, le=100)
