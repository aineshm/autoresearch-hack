"""Deep Agents tool factories for literature review."""

from __future__ import annotations

from pathlib import Path
import textwrap
from typing import Any, Callable

from backend.literature.arxiv_client import search_arxiv
from backend.literature.citations import format_inline
from backend.literature.enrichment import GraphEnrichmentSummary, apply_papers_to_graph, enrich_graph_citations
from backend.literature.models import KnowledgeGraph, Paper
from backend.literature.scholar_client import search_google_scholar
from config import Settings, settings


def create_literature_tools(
    *,
    run_id: str,
    graph: KnowledgeGraph,
    cfg: Settings = settings,
    telemetry: Any | None = None,
    research_dir: Path | None = None,
    blackboard_writer: Callable[[str, str], Any] | None = None,
) -> list[Callable[..., Any]]:
    """Build async literature tools bound to a run-scoped knowledge graph."""
    store_dir = research_dir or (cfg.workspace_root / ".research" / run_id)
    store_dir.mkdir(parents=True, exist_ok=True)
    graph_path = store_dir / "literature_graph.json"
    bib_path = store_dir / "references.bib"

    async def _persist() -> None:
        graph.save_json(graph_path)
        bib_path.write_text(graph.to_bibtex(), encoding="utf-8")

    async def _maybe_enrich(paper_ids: list[str] | None = None) -> GraphEnrichmentSummary | None:
        if not cfg.literature_enrich_citations:
            return None
        summary = await enrich_graph_citations(graph, cfg=cfg, paper_ids=paper_ids)
        await _persist()
        return summary

    async def search_arxiv_literature(query: str, max_results: int | None = None) -> str:
        """Search arXiv for papers matching a query and add them to the knowledge graph.

        Returns a compact summary only; full abstracts are stored under the workspace
        research directory, not in the agent context.
        """
        limit = max_results or cfg.literature_arxiv_max_results
        result = await search_arxiv(query, max_results=limit)
        apply_papers_to_graph(graph, result.papers, query=query)
        _link_related_within_query(graph, result.papers)
        enrich = await _maybe_enrich([paper.paper_id for paper in result.papers])
        if telemetry is not None:
            await telemetry.log_trace(
                run_id=run_id,
                span="search_arxiv",
                level="info",
                detail=_papers_detail(result.papers),
                metadata={"query": query, "count": len(result.papers)},
            )
        return _format_search_summary(
            source="arXiv",
            query=query,
            papers=result.papers,
            graph=graph,
            enrichment=enrich,
        )

    async def search_google_scholar_literature(query: str, max_results: int | None = None) -> str:
        """Search Google Scholar for papers matching a query and add them to the knowledge graph.

        Scholar access is best-effort and may rate-limit; prefer arXiv when both are viable.
        Returns a compact summary only.
        """
        if not cfg.literature_scholar_enabled:
            return "Google Scholar search is disabled (LITERATURE_SCHOLAR_ENABLED=false)."

        limit = max_results or cfg.literature_scholar_max_results
        result = await search_google_scholar(query, max_results=limit)
        apply_papers_to_graph(graph, result.papers, query=query)
        _link_related_within_query(graph, result.papers)
        enrich = await _maybe_enrich([paper.paper_id for paper in result.papers])
        if telemetry is not None:
            await telemetry.log_trace(
                run_id=run_id,
                span="search_google_scholar",
                level="info",
                detail=_papers_detail(result.papers),
                metadata={"query": query, "count": len(result.papers), "warning": result.warning},
            )
        summary = _format_search_summary(
            source="Google Scholar",
            query=query,
            papers=result.papers,
            graph=graph,
            enrichment=enrich,
        )
        if result.warning:
            summary = f"{summary}\nNote: {result.warning}"
        return summary

    async def enrich_literature_citations(paper_id: str = "") -> str:
        """Resolve DOIs and citation edges via CrossRef and Semantic Scholar.

        Pass a specific `paper_id` or leave empty to enrich all papers in the graph.
        """
        targets = [paper_id] if paper_id.strip() else None
        if targets and targets[0] not in graph.papers:
            return f"Unknown paper_id: {paper_id!r}."
        summary = await enrich_graph_citations(graph, cfg=cfg, paper_ids=targets)
        await _persist()
        base = (
            f"Enriched {summary.papers_enriched} papers; added {summary.references_added} references; "
            f"{summary.citation_edges} cites edges; {summary.dois_resolved} DOIs resolved."
        )
        if summary.warnings:
            base = f"{base}\nWarnings: {'; '.join(summary.warnings)}"
        return base

    async def get_citation_bibliography() -> str:
        """Return numbered APA citations for use in distilled_brief.md (e.g. [1], [2])."""
        if not graph.papers:
            return "No citations yet. Search literature first."
        lines = ["Use these numbered keys in distilled_brief.md:"]
        for number, paper in graph.numbered_papers()[:20]:
            inline = format_inline(paper, number=number)
            doi = f" DOI:{paper.doi}" if paper.doi else ""
            lines.append(f"{inline}{doi}")
        return "\n".join(lines)

    async def render_literature_knowledge_graph() -> str:
        """Write `/blackboard/literature_graph.md` and `/blackboard/citations.md`."""
        await _persist()
        markdown = graph.to_markdown()
        citations_md = graph.to_citations_markdown()
        if blackboard_writer is not None:
            await blackboard_writer("literature_graph.md", markdown)
            await blackboard_writer("citations.md", citations_md)
        stats = graph.stats()
        preview = textwrap.shorten(
            citations_md.split("\n", maxsplit=2)[-1] if citations_md else markdown,
            width=500,
            placeholder="...",
        )
        return (
            f"Knowledge graph updated: {stats['papers']} papers, "
            f"{stats['citation_edges']} citation edges, {stats['papers_with_doi']} with DOI. "
            f"Wrote literature_graph.md and citations.md. Preview:\n{preview}"
        )

    async def get_literature_graph_summary() -> str:
        """Return compact stats and top paper titles from the knowledge graph."""
        stats = graph.stats()
        if not graph.papers:
            return "Knowledge graph is empty. Run search_arxiv_literature or search_google_scholar_literature first."
        titles = [
            f"- [{num}] {paper.paper_id}: {paper.title}"
            for num, paper in graph.numbered_papers()[:8]
        ]
        return (
            f"Graph stats: {stats['papers']} papers, {stats['papers_with_doi']} with DOI, "
            f"{stats['citation_edges']} citation edges, {stats['edges']} total edges.\n"
            + "\n".join(titles)
        )

    return [
        search_arxiv_literature,
        search_google_scholar_literature,
        enrich_literature_citations,
        get_citation_bibliography,
        render_literature_knowledge_graph,
        get_literature_graph_summary,
    ]


def _link_related_within_query(graph: KnowledgeGraph, papers: list[Paper]) -> None:
    ids = [graph.add_paper(paper) for paper in papers]
    for index, left_id in enumerate(ids):
        for right_id in ids[index + 1 : index + 4]:
            graph.link_related(left_id, right_id)


def _format_search_summary(
    *,
    source: str,
    query: str,
    papers: list[Paper],
    graph: KnowledgeGraph,
    enrichment: Any | None = None,
) -> str:
    if not papers:
        return f"{source}: no papers found for query {query!r}."
    lines = [f"{source}: {len(papers)} papers for {query!r}."]
    for index, paper in enumerate(papers[:8], start=1):
        authors = ", ".join(paper.authors[:2]) or "unknown authors"
        snippet = textwrap.shorten(paper.summary or paper.title, width=120, placeholder="...")
        doi = f" doi:{paper.doi}" if paper.doi else ""
        lines.append(f"{index}. [{paper.paper_id}] {paper.title} ({authors}){doi} — {snippet}")
    stats = graph.stats()
    lines.append(
        f"Graph: {stats['papers']} papers, {stats['papers_with_doi']} with DOI, "
        f"{stats['citation_edges']} citation edges."
    )
    if enrichment is not None:
        lines.append(
            f"Enrichment: {enrichment.references_added} references linked, "
            f"{enrichment.dois_resolved} DOIs resolved."
        )
    return "\n".join(lines)


def _papers_detail(papers: list[Paper]) -> str:
    return "\n\n".join(
        f"{paper.paper_id}\n{paper.title}\nDOI:{paper.doi or '-'}\n{paper.url}\n{paper.summary[:2000]}"
        for paper in papers
    )
