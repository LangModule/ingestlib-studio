"""The in-memory pipeline job engine.

Try runs are rehearsals: they hold their results in memory, serve page images
from memory, and never write to S3 or the vector store. Ingest runs are the
committed counterpart: the library persists every stage to S3 and upserts the
chunks into the vector store, and the job records only progress and outcome.
Backfill runs rebuild the configured vector store from those S3 artifacts.
A restart clears every registry, which is acceptable by design; a run that
was interrupted partway is simply retried, because the library treats an
incomplete run as not ingested.
"""
