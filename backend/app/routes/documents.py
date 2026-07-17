"""Endpoints for the Library: browse, review, and delete stored documents.

Everything here reads the S3 artifacts the ingest pipeline wrote. Page and
figure images are served as redirects to presigned S3 URLs, so image bytes
never pass through this process. The artifact reads are synchronous boto3
calls, so every handler pushes them off the event loop.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app import bootstrap
from app.documents import registry
from app.documents.schemas import DocumentSummary, DocumentView
from app.pipeline.jobs import INGEST_JOBS

router = APIRouter(
    prefix="/api/documents", tags=["documents"],
    dependencies=[Depends(bootstrap.require_configured)],
)


@router.get("", response_model=list[DocumentSummary])
async def list_documents() -> list[DocumentSummary]:
    return await asyncio.to_thread(registry.list_summaries)


@router.get("/{doc_id}", response_model=DocumentView)
async def get_document(doc_id: str) -> DocumentView:
    try:
        view, _ = await asyncio.to_thread(registry.load_view, doc_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return view


@router.get("/{doc_id}/pages/{page_num}/image")
async def page_image(doc_id: str, page_num: int) -> RedirectResponse:
    url = await asyncio.to_thread(registry.page_image_url, doc_id, page_num)
    return RedirectResponse(url, status_code=307)


@router.get("/{doc_id}/pages/{page_num}/figures/{region_id}/image")
async def figure_image(doc_id: str, page_num: int, region_id: int) -> RedirectResponse:
    try:
        url = await asyncio.to_thread(registry.figure_image_url, doc_id, page_num, region_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if url is None:
        raise HTTPException(status_code=404, detail=f"no figure {region_id} on page {page_num}")
    return RedirectResponse(url, status_code=307)


@router.delete("/{doc_id}")
async def delete_document(doc_id: str) -> dict[str, int | bool]:
    result = await asyncio.to_thread(registry.delete, doc_id)
    if result["objects"] == 0:
        raise HTTPException(status_code=404, detail="no such document in the library")
    # Drop the finished ingest record for this content, so re-ingesting the
    # deleted document runs the pipeline again instead of joining stale state.
    INGEST_JOBS.delete(doc_id)
    return {"deleted": True, **result}
