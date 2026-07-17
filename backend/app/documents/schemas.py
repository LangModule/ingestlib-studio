"""UI-shaped view models for a processed document.

Bounding boxes are fractions of the page (0 to 1, x1/y1/x2/y2), so the
frontend positions highlights with percentages at any zoom level. Markdown
figure references are rewritten to studio image URLs before they get here.
"""
from pydantic import BaseModel, Field


class RegionView(BaseModel):
    region_id: int
    region_type: str
    text: str
    content: str
    bbox: tuple[float, float, float, float]


class PageView(BaseModel):
    page_num: int
    width: int
    height: int
    image_url: str
    markdown: str
    text: str
    regions: list[RegionView] = Field(default_factory=list)


class AlternativeView(BaseModel):
    label: str
    score: float


class ClassifyView(BaseModel):
    category: str
    confidence: float
    reasoning: str
    alternatives: list[AlternativeView] = Field(default_factory=list)
    pages_used: int


class SectionView(BaseModel):
    """Split's own output: pages grouped by role. Chunks are listed separately."""

    name: str
    description: str
    pages: list[int]
    chunk_ids: list[int] = Field(default_factory=list)


class ChunkView(BaseModel):
    """One vector-store unit, exactly as it would be embedded."""

    chunk_id: int
    section: str
    heading: str
    kind: str
    token_estimate: int
    pages: list[int]
    region_ids: dict[int, list[int]] = Field(default_factory=dict)
    markdown: str
    text: str


class DocumentView(BaseModel):
    filename: str
    page_count: int
    pages: list[PageView]
    classify: ClassifyView
    sections: list[SectionView]
    chunks: list[ChunkView]
