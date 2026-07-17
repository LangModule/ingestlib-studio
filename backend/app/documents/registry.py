"""Adapter over the library's S3 artifact registry, with a small cache.

Loading a document costs three S3 reads plus shaping, so shaped views are
kept in a bounded LRU keyed by doc_id; artifacts are immutable for a given
doc_id, which is what makes the cache safe. Page and figure images never
pass through this process: the routes redirect to presigned S3 URLs.

ingestlib is imported inside each function, not at module level, so
importing the studio's routes keeps the process free of the library until
a configured user actually opens the library.
"""
import threading
from collections import OrderedDict

from botocore.exceptions import ClientError

from app.documents.schemas import DocumentSummary, DocumentView
from app.documents.shaping import shape_document

CACHE_SIZE = 8
PRESIGN_SECONDS = 15 * 60

# doc_id -> (shaped view, {(page_num, region_id): figure filename})
_cache: OrderedDict[str, tuple[DocumentView, dict[tuple[int, int], str]]] = OrderedDict()
# doc_id -> filename, for hit cards; one meta read per document, evicted on delete.
_filenames: dict[str, str] = {}
# Routes call this module through asyncio.to_thread, so cache access is locked.
_lock = threading.Lock()


def _is_missing(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code") in ("NoSuchKey", "404")


def list_summaries() -> list[DocumentSummary]:
    """Every stored document, newest first. Bare prefixes without a parse
    artifact are foreign objects, not documents, and are left out."""
    from ingestlib.storage import artifacts

    entries = [meta for meta in artifacts.list_documents() if meta.filename]
    entries.sort(key=lambda meta: meta.created_at, reverse=True)
    return [
        DocumentSummary(
            doc_id=meta.doc_id,
            filename=meta.filename,
            page_count=meta.page_count,
            category=meta.category,
            sections=meta.sections,
            chunks=meta.chunks,
            created_at=meta.created_at,
            thumbnail_url=f"/api/documents/{meta.doc_id}/pages/1/image",
        )
        for meta in entries
    ]


def load_view(doc_id: str) -> tuple[DocumentView, dict[tuple[int, int], str]]:
    """The shaped view plus the figure-filename map the image route needs.

    Raises LookupError when the document does not exist."""
    with _lock:
        cached = _cache.get(doc_id)
        if cached is not None:
            _cache.move_to_end(doc_id)
            return cached

    from ingestlib.storage import artifacts

    try:
        parse = artifacts.load_parse(doc_id)
        classify = artifacts.load_classify(doc_id)
        split = artifacts.load_split(doc_id)
    except ClientError as err:
        if _is_missing(err):
            raise LookupError(f"no document {doc_id[:12]} in the library") from err
        raise

    view = shape_document(
        parse.source_path.name, parse, classify, split,
        base_url=f"/api/documents/{doc_id}",
    )
    figure_files = {
        (page.page_num, figure.region_id): figure.filename(page.page_num)
        for page in parse.pages
        for figure in page.figures
    }
    with _lock:
        _cache[doc_id] = (view, figure_files)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return view, figure_files


def _presign(key: str) -> str:
    from ingestlib.storage.s3.client import ensure_bucket, get_s3_client

    return get_s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": ensure_bucket(), "Key": key},
        ExpiresIn=PRESIGN_SECONDS,
    )


def page_image_url(doc_id: str, page_num: int) -> str:
    from ingestlib.storage import artifacts

    return _presign(artifacts.page_image_key(doc_id, page_num))


def document_filename(doc_id: str) -> str:
    """Cached filename lookup for retrieval hit cards."""
    with _lock:
        cached = _filenames.get(doc_id)
    if cached is not None:
        return cached

    from ingestlib.storage import artifacts

    filename = artifacts.get_document_meta(doc_id).filename
    with _lock:
        _filenames[doc_id] = filename
    return filename


def figure_image_url(doc_id: str, page_num: int, region_id: int) -> str | None:
    """Presigned URL for one figure crop, or None when no such figure exists.

    The figures prefix mirrors the layout documented in
    ingestlib.storage.artifacts; the filename itself comes from the model's
    canonical FigureImage.filename()."""
    _, figure_files = load_view(doc_id)
    filename = figure_files.get((page_num, region_id))
    if filename is None:
        return None
    return _presign(f"documents/{doc_id}/parse/figures/{filename}")


def clear_caches() -> None:
    """Forget every cached view and filename.

    Settings calls this after a configuration change: a new bucket means
    the cached documents may no longer be the ones the registry would
    serve."""
    with _lock:
        _cache.clear()
        _filenames.clear()


def delete(doc_id: str) -> dict[str, int]:
    """Remove the document everywhere: vector store first, then S3.

    Vectors go first because the ingest manifest is the only record of
    them; deleting the artifacts first could orphan vectors forever. A
    document that never finished ingesting has no manifest and no vectors.
    """
    from ingestlib.storage import artifacts, default_store

    vectors = 0
    try:
        manifest = artifacts.load_ingest_manifest(doc_id)
        vectors = default_store().delete_document(
            doc_id, namespace=manifest.get("namespace", "")
        )
    except ClientError as err:
        if not _is_missing(err):
            raise

    objects = artifacts.delete_document(doc_id)
    with _lock:
        _cache.pop(doc_id, None)
        _filenames.pop(doc_id, None)
    return {"vectors": vectors, "objects": objects}
