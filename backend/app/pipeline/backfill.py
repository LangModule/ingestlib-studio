"""Rebuilds the configured vector store from the S3 split artifacts.

S3 is the source of truth; the vector store is a derived, rebuildable
index. Backfill re-embeds each stored chunk's embedding text and upserts
it into the currently configured store: no re-parse and no OCR server.
Stores that already hold a document are left alone, and the previous
store is never touched, so two stores can stay populated side by side.

ingestlib is imported inside each function, not at module level, so
importing the studio's routes keeps the process free of the library until
a configured user actually starts a run.
"""
import asyncio
import time
from datetime import datetime, timezone

from botocore.exceptions import ClientError

from app.pipeline.jobs import IngestJob

_EMBED_CONCURRENCY = 8


def pending() -> tuple[dict[str, int | str], list[tuple[str, str]]]:
    """The backfill picture for the current store.

    Returns (status, missing): status holds the store name and document
    counts, missing lists (doc_id, filename) for every fully ingested
    document whose manifest names a different store."""
    from ingestlib.storage import artifacts, default_store

    store_name = type(default_store()).__name__
    documents = 0
    in_store = 0
    missing: list[tuple[str, str]] = []
    for meta in artifacts.list_documents():
        if not meta.filename:
            continue
        try:
            manifest = artifacts.load_ingest_manifest(meta.doc_id)
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                continue  # never fully ingested; nothing to backfill from
            raise
        documents += 1
        if manifest.get("store") == store_name:
            in_store += 1
        else:
            missing.append((meta.doc_id, meta.filename))
    status = {
        "store": store_name,
        "documents": documents,
        "in_store": in_store,
        "missing": documents - in_store,
    }
    return status, missing


async def _embed_all(texts: list[str]) -> list[list[float]]:
    """Embed every chunk text, bounded-parallel, cancelling siblings on failure."""
    from ingestlib.foundations.llm import aembed_text

    semaphore = asyncio.Semaphore(_EMBED_CONCURRENCY)

    async def one(text: str) -> list[float]:
        async with semaphore:
            return await aembed_text(text)

    tasks = [asyncio.ensure_future(one(text)) for text in texts]
    try:
        return list(await asyncio.gather(*tasks))
    except BaseException:
        for task in tasks:
            task.cancel()
        raise


async def run(job: IngestJob, documents: list[tuple[str, str]]) -> None:
    """Backfill each (doc_id, filename) into the configured store.

    Every document is one event stage named by its filename, so the UI
    can show the same stepper Ingest uses."""
    from ingestlib.storage import artifacts, default_store

    store = default_store()
    total_vectors = 0
    current = documents[0][1] if documents else "backfill"
    try:
        for doc_id, filename in documents:
            current = filename
            job.emit(filename, "start")
            started = time.perf_counter()

            split = await asyncio.to_thread(artifacts.load_split, doc_id)
            meta = await asyncio.to_thread(artifacts.get_document_meta, doc_id)
            chunks = split.chunks
            embeddings = await _embed_all([c.embedding_text for c in chunks])
            vectors = 0
            if chunks:
                vectors = await asyncio.to_thread(
                    store.upsert_chunks, doc_id, chunks, embeddings,
                    category=meta.category, namespace="",
                )
            await asyncio.to_thread(artifacts.save_ingest_manifest, doc_id, {
                "store": type(store).__name__,
                "namespace": "",
                "dimension": len(embeddings[0]) if embeddings else 0,
                "vector_ids": [f"{doc_id}:{c.chunk_id}" for c in chunks],
                "category": meta.category,
                "embedded_at": datetime.now(timezone.utc).isoformat(),
            })

            total_vectors += vectors
            seconds = round(time.perf_counter() - started, 2)
            job.durations[filename] = seconds
            job.emit(filename, "done", seconds=seconds)

        job.summary = {
            "documents": len(job.durations),
            "vectors": total_vectors,
            "store": type(store).__name__,
        }
        job.finish("done")
    except Exception as exc:  # noqa: BLE001
        detail = f"{type(exc).__name__}: {exc}"
        job.emit(current, "failed", detail=detail)
        job.finish("failed", error=detail)
