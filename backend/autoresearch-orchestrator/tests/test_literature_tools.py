"""Tests for literature tool factory (mocked search, no network)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from dataclasses import replace

import pytest

from backend.literature.arxiv_client import ArxivSearchResult
from backend.literature.models import KnowledgeGraph, Paper
from backend.literature.tools import create_literature_tools
from config import settings


def _paper(pid: str, title: str) -> Paper:
    return Paper(
        paper_id=pid,
        title=title,
        authors=["A. Author"],
        year=2024,
        source="arxiv",
        url=f"https://example/{pid}",
        summary="Abstract.",
    )


@pytest.mark.asyncio
async def test_search_arxiv_literature_tool(tmp_path) -> None:
    graph = KnowledgeGraph()
    cfg = replace(settings, literature_enrich_citations=False)

    mock_result = ArxivSearchResult(
        papers=[_paper("arxiv:1234.5678", "Test Paper")],
        query="transformers",
    )

    with patch(
        "backend.literature.tools.search_arxiv",
        new=AsyncMock(return_value=mock_result),
    ):
        tools = create_literature_tools(
            run_id="test-run",
            graph=graph,
            cfg=cfg,
            research_dir=tmp_path / "research",
        )
        search_fn = tools[0]
        summary = await search_fn("transformers")
        assert "arXiv" in summary
        assert "Test Paper" in summary
        assert graph.stats()["papers"] == 1


@pytest.mark.asyncio
async def test_render_literature_knowledge_graph_writes_blackboard() -> None:
    graph = KnowledgeGraph()
    graph.add_paper(_paper("arxiv:1", "Graph Paper"))
    written: dict[str, str] = {}

    async def writer(name: str, content: str) -> None:
        written[name] = content

    cfg = replace(settings, literature_enrich_citations=False)
    tools = create_literature_tools(
        run_id="r1",
        graph=graph,
        cfg=cfg,
        blackboard_writer=writer,
    )
    render_fn = tools[4]  # render_literature_knowledge_graph
    msg = await render_fn()
    assert "literature_graph.md" in written
    assert "citations.md" in written
    assert "Graph Paper" in written["literature_graph.md"]
    assert "updated" in msg.lower() or "Knowledge graph" in msg
