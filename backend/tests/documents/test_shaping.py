"""Tests for the shaping layer, using synthetic library models.

Importing the library's model modules pulls in its full import chain, which
is why this file is the slowest to collect; the shaping itself is pure."""
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def views():
    from ingestlib.foundations.ocr.models import BoundingBox, Region
    from ingestlib.operations.classify.models import CategoryScore, ClassifyResult
    from ingestlib.operations.parse.models import FigureImage, PageResult, ParseResult
    from ingestlib.operations.split.models import Chunk, Section, SplitResult

    from app.documents.shaping import shape_document

    region = Region(
        region_type="chart",
        bbox=BoundingBox(x=100, y=200, width=300, height=400),
        region_id=5,
        text="chart data",
        content="| a | b |",
    )
    page = PageResult(
        page_num=1,
        text="hello",
        markdown="![Growth](page1_region5_chart.png)\n\n| a | b |",
        regions=[region],
        figures=[FigureImage(region_id=5, region_type="chart", image_bytes=b"\x89PNG")],
        image_bytes=b"\x89PNG-page",
        page_width=1000,
        page_height=2000,
    )
    parse = ParseResult(pages=[page], source_path=Path("doc.pdf"), source_format="pdf")
    classify = ClassifyResult(
        category="earnings_report", confidence=0.9, reasoning="numbers everywhere",
        alternatives=[CategoryScore(label="invoice", score=0.2)], pages_used=1,
    )
    chunk = Chunk(
        chunk_id=0, section="results", heading="Growth", kind="figure",
        text="chart data", markdown="![Growth](page1_region5_chart.png)",
        embedding_text="[earnings_report › results › Growth]\n\nchart",
        pages=[1], region_ids={1: [5]}, token_estimate=12,
    )
    split = SplitResult(
        sections=[Section(name="results", description="the numbers",
                          pages=[1], chunks=[chunk])],
        pages_used=1,
    )
    return shape_document("doc.pdf", parse, classify, split, base_url="/api/try/j1")


def test_bboxes_become_page_fractions(views):
    region = views.pages[0].regions[0]
    assert region.bbox == (0.1, 0.1, 0.4, 0.3)
    assert all(0.0 <= value <= 1.0 for value in region.bbox)


def test_image_urls_hang_off_the_base_url(views):
    assert views.pages[0].image_url == "/api/try/j1/pages/1/image"


def test_markdown_figure_refs_point_at_the_figure_route(views):
    assert "](/api/try/j1/pages/1/figures/5/image)" in views.pages[0].markdown
    assert "page1_region5_chart.png" not in views.pages[0].markdown
    assert "](/api/try/j1/pages/1/figures/5/image)" in views.chunks[0].markdown


def test_sections_carry_pages_and_chunk_ids(views):
    section = views.sections[0]
    assert section.name == "results" and section.pages == [1]
    assert section.chunk_ids == [0]


def test_chunks_keep_provenance_and_breadcrumb_fields(views):
    chunk = views.chunks[0]
    assert chunk.section == "results" and chunk.region_ids == {1: [5]}
    assert chunk.token_estimate == 12


def test_classification_is_fully_shaped(views):
    assert views.classify.category == "earnings_report"
    assert views.classify.alternatives[0].label == "invoice"
