"""Tests for literature enrichment helpers."""

from __future__ import annotations

from backend.literature.enrichment import apply_papers_to_graph
from backend.literature.models import KnowledgeGraph, Paper


def test_apply_papers_to_graph_links_query() -> None:
    graph = KnowledgeGraph()
    papers = [
        Paper(
            paper_id="arxiv:1",
            title="T",
            authors=["A"],
            year=2024,
            source="arxiv",
            url="https://x",
            summary="s",
        )
    ]
    apply_papers_to_graph(graph, papers, query="rate limiting")
    assert graph.stats()["papers"] == 1
    assert graph.stats()["queries"] == 1
    assert "rate limiting" in graph.queries
