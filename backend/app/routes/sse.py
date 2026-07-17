"""Server-sent events plumbing shared by the try and ingest routers."""
import json

from fastapi.responses import StreamingResponse

from app.pipeline.jobs import Job


def stage_events(job: Job) -> StreamingResponse:
    """Stream the job's stage events: full history first, then live until
    the terminal "job" event."""

    async def stream():
        async for event in job.stream():
            yield f"data: {json.dumps(event.model_dump())}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
