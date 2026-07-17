"""Presentation shaping and the library registry.

Library models become UI-shaped views: pure transformation plus S3 reads,
with no model calls and no ingestlib imports at module level. Try it shapes
in-memory results through this package; the Library shapes the same views
from the S3 artifacts through registry.py.
"""
