"""Endpoints for the Playground: ask a question, get cited hits.

Retrieval is the library's job: embed the question, query the configured
vector store, rerank. The studio shapes each hit for the UI and resolves
its document filename, so a hit card can point at its source and the
click-through can land on the exact page with its regions pinned.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import bootstrap
from app.documents import registry
from app.documents.shaping import rewrite_figure_refs

router = APIRouter(
    prefix="/api/retrieve", tags=["playground"],
    dependencies=[Depends(bootstrap.require_configured)],
)


class RetrieveRequest(BaseModel):
    question: str
    top_k: int = Field(default=5, ge=1, le=20)


class HitView(BaseModel):
    """One retrieved chunk, shaped for a hit card.

    region_ids maps page number to the source regions on that page; the
    click-through pins them on the light table."""

    doc_id: str
    chunk_id: int
    filename: str
    category: str
    section: str
    heading: str
    kind: str
    pages: list[int]
    region_ids: dict[int, list[int]]
    markdown: str
    vector_score: float
    rerank_score: float | None


class RetrieveResponse(BaseModel):
    question: str
    hits: list[HitView]


async def _aretrieve(question: str, top_k: int):
    """Indirection point for tests; imports the library only when a query runs."""
    from ingestlib.services.retrieve import aretrieve

    return await aretrieve(question, top_k=top_k)


@router.post("", response_model=RetrieveResponse)
async def retrieve(body: RetrieveRequest) -> RetrieveResponse:
    if not body.question.strip():
        raise HTTPException(status_code=422, detail="the question is empty")
    result = await _aretrieve(body.question, body.top_k)

    hits = []
    for hit in result.hits:
        chunk = hit.chunk
        hits.append(HitView(
            doc_id=chunk.document_id,
            chunk_id=chunk.chunk_id,
            filename=await asyncio.to_thread(registry.document_filename, chunk.document_id),
            category=chunk.category,
            section=chunk.section,
            heading=chunk.heading,
            kind=chunk.kind,
            pages=chunk.pages,
            region_ids=chunk.region_ids,
            markdown=rewrite_figure_refs(
                chunk.markdown, f"/api/documents/{chunk.document_id}"
            ),
            vector_score=hit.vector_score,
            rerank_score=hit.rerank_score,
        ))
    return RetrieveResponse(question=result.question, hits=hits)
