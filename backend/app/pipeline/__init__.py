"""The in-memory pipeline job engine.

Try runs are rehearsals: they hold their results in memory, serve page images
from memory, and never write to S3 or the vector store. A restart clears the
registry, which is acceptable by design. The Ingest page later reuses the
event-streaming machinery here for its committed runs.
"""
