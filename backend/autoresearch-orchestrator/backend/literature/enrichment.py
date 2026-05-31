"""Batch citation enrichment for the literature knowledge graph."""

from __future__ import annotations

from dataclasses import dataclass

from backend.literature.crossref_client import lookup_doi
from backend.literature.models import KnowledgeGraph, Paper
from backend.literature.semantic_scholar_client import enrich_paper
from config import Settings, settings


@dataclass(frozen=True, slots=True)
class GraphEnrichmentSummary:
    papers_enriched: int
    references_added: int
    citation_edges: int
    dois_resolved: int
    warnings: list[str]


async def enrich_graph_citations(
    graph: KnowledgeGraph,
    *,
    cfg: Settings = settings,
    paper_ids: list[str] | None = None,
) -> GraphEnrichmentSummary:
    """Resolve DOIs and citation edges via CrossRef + Semantic Scholar."""
    targets = paper_ids or list(graph.papers.keys())
    papers_enriched = 0
    references_added = 0
    citation_edges = 0
    dois_resolved = 0
    warnings: list[str] = []

    for paper_id in targets:
        paper = graph.papers.get(paper_id)
        if paper is None:
            continue

        if cfg.literature_crossref_enabled and not paper.doi:
            doi = await lookup_doi(paper.title, cfg=cfg)
            if doi:
                paper.doi = doi
                dois_resolved += 1
                graph.add_paper(paper)

        if not cfg.literature_semantic_scholar_enabled:
            continue

        result = await enrich_paper(paper, reference_limit=cfg.literature_s2_reference_limit)
        if result.warning:
            warnings.append(f"{paper_id}: {result.warning}")
        graph.add_paper(result.paper)
        papers_enriched += 1

        citing_id = result.paper.paper_id
        for ref_paper in result.reference_papers:
            cited_id = graph.add_paper(ref_paper)
            graph.link_cites(citing_id, cited_id)
            references_added += 1
            citation_edges += 1

    return GraphEnrichmentSummary(
        papers_enriched=papers_enriched,
        references_added=references_added,
        citation_edges=citation_edges,
        dois_resolved=dois_resolved,
        warnings=warnings[:5],
    )


def apply_papers_to_graph(graph: KnowledgeGraph, papers: list[Paper], *, query: str) -> None:
    for paper in papers:
        paper_id = graph.add_paper(paper)
        graph.link_query(query, paper_id)
