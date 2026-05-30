"""Tests for literature citations and knowledge graph."""

from __future__ import annotations

from backend.literature.citations import (
    citation_key,
    enrich_citation_fields,
    format_apa,
    format_bibtex,
    format_inline,
)
from backend.literature.models import KnowledgeGraph, Paper


def _sample_paper(**overrides) -> Paper:
    base = dict(
        paper_id="arxiv:2401.00001",
        title="Attention Is All You Need",
        authors=["Vaswani, A.", "Shazeer, N."],
        year=2017,
        source="arxiv",
        url="https://arxiv.org/abs/1706.03762",
        summary="Transformer architecture.",
        doi="10.48550/arXiv.1706.03762",
        arxiv_id="1706.03762",
    )
    base.update(overrides)
    return Paper(**base)


def test_citation_key_and_apa() -> None:
    paper = enrich_citation_fields(_sample_paper())
    assert paper.citation_key
    assert "2017" in paper.citation_apa
    assert "Attention Is All You Need" in paper.citation_apa
    assert format_inline(paper, number=1).startswith("[1]")


def test_bibtex_contains_doi() -> None:
    paper = enrich_citation_fields(_sample_paper())
    assert "@article" in paper.bibtex or "@" in paper.bibtex
    assert "1706.03762" in paper.bibtex or paper.doi in paper.bibtex


def test_citation_key_stable() -> None:
    p1 = _sample_paper()
    p2 = _sample_paper()
    assert citation_key(p1) == citation_key(p2)


def test_knowledge_graph_dedup_by_arxiv() -> None:
    graph = KnowledgeGraph()
    p1 = _sample_paper(paper_id="arxiv:1706.03762", summary="short")
    p2 = _sample_paper(paper_id="arxiv:1706.03762", summary="much longer abstract here")
    id1 = graph.add_paper(p1)
    id2 = graph.add_paper(p2)
    assert id1 == id2
    assert len(graph.papers) == 1
    assert "longer" in graph.papers[id1].summary


def test_knowledge_graph_cites_and_query_edges() -> None:
    graph = KnowledgeGraph()
    a = graph.add_paper(
        _sample_paper(
            paper_id="arxiv:1111.0001",
            title="Paper A",
            arxiv_id="1111.0001",
            doi=None,
        )
    )
    b = graph.add_paper(
        _sample_paper(
            paper_id="arxiv:2222.0002",
            title="Paper B",
            arxiv_id="2222.0002",
            doi=None,
        )
    )
    graph.link_cites(a, b)
    graph.link_query("transformers", a)
    stats = graph.stats()
    assert stats["papers"] == 2
    assert stats["citation_edges"] == 1
    assert stats["queries"] == 1


def test_knowledge_graph_numbered_and_markdown() -> None:
    graph = KnowledgeGraph()
    graph.add_paper(_sample_paper())
    numbered = graph.numbered_papers()
    assert numbered[0][0] == 1
    md = graph.to_markdown()
    assert "Literature Knowledge Graph" in md
    assert "mermaid" in md
    cites_md = graph.to_citations_markdown()
    assert "[1]" in cites_md


def test_knowledge_graph_json_roundtrip(tmp_path) -> None:
    graph = KnowledgeGraph()
    graph.add_paper(_sample_paper())
    graph.link_query("nlp", graph._order[0])
    path = tmp_path / "graph.json"
    graph.save_json(path)
    loaded = KnowledgeGraph.load_json(path)
    assert loaded.stats()["papers"] == 1
    assert loaded.queries == ["nlp"]
