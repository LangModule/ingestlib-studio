"""Upload validation shared by the try and ingest routers."""
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.pipeline.jobs import SUPPORTED_SUFFIXES


async def read_document(file: UploadFile) -> tuple[str, bytes]:
    """Return (filename, content) for a supported, non-empty document upload."""
    filename = Path(file.filename or "upload").name
    if not filename.lower().endswith(SUPPORTED_SUFFIXES):
        raise HTTPException(
            status_code=422,
            detail=f"unsupported file type; expected one of {list(SUPPORTED_SUFFIXES)}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="the uploaded file is empty")
    return filename, content
