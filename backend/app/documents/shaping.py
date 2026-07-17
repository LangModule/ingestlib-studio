"""Pure converters from library models to the UI views in schemas.py.

The library is referenced only through duck typing and TYPE_CHECKING imports:
importing its model modules would pull in the OCR stack, and this module must
stay cheap to import.
"""
import re
from typing import TYPE_CHECKING

from app.documents.schemas import (
    AlternativeView,
    ChunkView,
    ClassifyView,
    DocumentView,
    PageView,
    RegionView,
    SectionView,
)

if TYPE_CHECKING:
    from ingestlib.operations.classify.models import ClassifyResult
    from ingestlib.operations.parse.models import PageResult, ParseResult
    from ingestlib.operations.split.models import SplitResult

# The library's canonical figure filename, e.g. page2_region5_chart.png,
# as it appears inside markdown image references.
_FIGURE_REF = re.compile(r"\]\(page(\d+)_region(\d+)_[a-z_]+\.png\)")


def rewrite_figure_refs(markdown: str, base_url: str) -> str:
    """Point markdown image references at the studio's figure route."""
    return _FIGURE_REF.sub(rf"]({base_url}/pages/\1/figures/\2/image)", markdown)


def shape_page(page: "PageResult", base_url: str) -> PageView:
    width = page.page_width or 1
    height = page.page_height or 1
    figure_ids = {figure.region_id for figure in page.figures}
    return PageView(
        page_num=page.page_num,
        width=width,
        height=height,
        image_url=f"{base_url}/pages/{page.page_num}/image",
        markdown=rewrite_figure_refs(page.markdown, base_url),
        text=page.text,
        regions=[
            RegionView(
                region_id=region.region_id,
                region_type=region.region_type,
                text=region.text,
                content=region.content,
                bbox=region.bbox.normalized(width, height),
                image_url=(
                    f"{base_url}/pages/{page.page_num}/figures/{region.region_id}/image"
                    if region.region_id in figure_ids
                    else None
                ),
            )
            for region in page.regions
        ],
    )


def shape_classify(result: "ClassifyResult") -> ClassifyView:
    return ClassifyView(
        category=result.category,
        confidence=result.confidence,
        reasoning=result.reasoning,
        alternatives=[
            AlternativeView(label=a.label, score=a.score) for a in result.alternatives
        ],
        pages_used=result.pages_used,
    )


def shape_document(
    filename: str,
    parse: "ParseResult",
    classify: "ClassifyResult",
    split: "SplitResult",
    base_url: str,
) -> DocumentView:
    """Assemble the full view. base_url is the document's route prefix, for
    example /api/try/{job_id}; every image URL hangs off it."""
    return DocumentView(
        filename=filename,
        page_count=parse.page_count,
        pages=[shape_page(page, base_url) for page in parse.pages],
        classify=shape_classify(classify),
        sections=[
            SectionView(
                name=section.name,
                description=section.description,
                pages=section.pages,
                chunk_ids=[chunk.chunk_id for chunk in section.chunks],
            )
            for section in split.sections
        ],
        chunks=[
            ChunkView(
                chunk_id=chunk.chunk_id,
                section=chunk.section,
                heading=chunk.heading,
                kind=chunk.kind,
                token_estimate=chunk.token_estimate,
                pages=chunk.pages,
                region_ids=chunk.region_ids,
                markdown=rewrite_figure_refs(chunk.markdown, base_url),
                text=chunk.text,
            )
            for chunk in split.chunks
        ],
    )
