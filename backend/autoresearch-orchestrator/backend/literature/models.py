"""Data models for literature review and knowledge graphs."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import re
from typing import Any

from typing import Any


def _slug(text: str, *, limit: int = 48) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", text.strip().lower()).strip("_")
    return cleaned[:limit] or "node"


@dataclass(slots=True)
class Paper:
    """Normalized paper record from arXiv, Scholar, or Semantic Scholar."""

    paper_id: str
    title: str
    authors: list[str]
    year: int | None
    source: str
    url: str
    summary: str
    categories: list[str] = field(default_factory=list)
    doi: str | None = None
    arxiv_id: str | None = None
    semantic_scholar_id: str | None = None
    cited_by_count: int | None = None
    citation_key: str = ""
    citation_apa: str = ""
    bibtex: str = ""
    references: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "paper_id": self.paper_id,
            "title": self.title,
            "authors": self.authors,
            "year": self.year,
            "source": self.source,
            "url": self.url,
            "summary": self.summary,
            "categories": self.categories,
            "doi": self.doi,
            "arxiv_id": self.arxiv_id,
            "semantic_scholar_id": self.semantic_scholar_id,
            "cited_by_count": self.cited_by_count,
            "citation_key": self.citation_key,
            "citation_apa": self.citation_apa,
            "bibtex": self.bibtex,
            "references": self.references,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Paper:
        return cls(
            paper_id=str(data["paper_id"]),
            title=str(data["title"]),
            authors=list(data.get("authors") or []),
            year=data.get("year"),
            source=str(data.get("source") or "unknown"),
            url=str(data.get("url") or ""),
            summary=str(data.get("summary") or ""),
            categories=list(data.get("categories") or []),
            doi=data.get("doi"),
            arxiv_id=data.get("arxiv_id"),
            semantic_scholar_id=data.get("semantic_scholar_id"),
            cited_by_count=data.get("cited_by_count"),
            citation_key=str(data.get("citation_key") or ""),
            citation_apa=str(data.get("citation_apa") or ""),
            bibtex=str(data.get("bibtex") or ""),
            references=list(data.get("references") or []),
        )


@dataclass
class KnowledgeGraph:
    """In-memory citation/topic graph exported as markdown + JSON."""

    papers: dict[str, Paper] = field(default_factory=dict)
    edges: list[tuple[str, str, str]] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    _order: list[str] = field(default_factory=list)

    def add_paper(self, paper: Paper, *, merge: bool = True) -> str:
        """Insert or merge a paper; returns canonical paper_id in the graph."""
        _enrich_citation_fields(paper)
        canonical_id = self._canonical_id(paper) if merge else paper.paper_id
        if canonical_id != paper.paper_id and canonical_id in self.papers:
            self._merge_into(self.papers[canonical_id], paper)
            paper_id = canonical_id
        elif paper.paper_id in self.papers:
            self._merge_into(self.papers[paper.paper_id], paper)
            paper_id = paper.paper_id
        else:
            self.papers[paper.paper_id] = paper
            self._order.append(paper.paper_id)
            paper_id = paper.paper_id

        stored = self.papers[paper_id]
        for author in stored.authors[:6]:
            author_id = f"author:{_slug(author)}"
            self._add_edge(paper_id, author_id, "authored_by")
        for category in stored.categories[:4]:
            topic_id = f"topic:{_slug(category)}"
            self._add_edge(paper_id, topic_id, "in_topic")
        return paper_id

    def link_related(self, left_id: str, right_id: str) -> None:
        if left_id in self.papers and right_id in self.papers and left_id != right_id:
            self._add_edge(left_id, right_id, "related_to")

    def link_cites(self, citing_id: str, cited_id: str) -> None:
        if citing_id in self.papers and cited_id in self.papers and citing_id != cited_id:
            self._add_edge(citing_id, cited_id, "cites")

    def link_query(self, query: str, paper_id: str) -> None:
        if query not in self.queries:
            self.queries.append(query)
        query_id = f"query:{_slug(query)}"
        self._add_edge(query_id, paper_id, "retrieved_by")

    def numbered_papers(self) -> list[tuple[int, Paper]]:
        ordered = [self.papers[paper_id] for paper_id in self._order if paper_id in self.papers]
        return list(enumerate(ordered, start=1))

    def to_citations_markdown(self) -> str:
        lines = ["# References", ""]
        for number, paper in self.numbered_papers():
            apa = paper.citation_apa or _format_apa(paper)
            doi_note = f" DOI: {paper.doi}" if paper.doi else ""
            cites_note = (
                f" (cited by {paper.cited_by_count})" if paper.cited_by_count is not None else ""
            )
            lines.append(f"[{number}] {apa}{cites_note}{doi_note}")
        lines.append("")
        return "\n".join(lines)

    def to_bibtex(self) -> str:
        blocks = []
        for _, paper in self.numbered_papers():
            blocks.append(paper.bibtex or _format_bibtex(paper))
        return "\n\n".join(blocks) + ("\n" if blocks else "")

    def _canonical_id(self, paper: Paper) -> str:
        if paper.arxiv_id:
            arxiv_id = f"arxiv:{paper.arxiv_id}"
            if arxiv_id in self.papers:
                return arxiv_id
        if paper.doi:
            doi_id = f"doi:{paper.doi.replace('/', '_')}"
            if doi_id in self.papers:
                return doi_id
        for existing in self.papers.values():
            if paper.doi and existing.doi and paper.doi.lower() == existing.doi.lower():
                return existing.paper_id
            if paper.arxiv_id and existing.arxiv_id and paper.arxiv_id == existing.arxiv_id:
                return existing.paper_id
        return paper.paper_id

    def _merge_into(self, target: Paper, incoming: Paper) -> None:
        if not target.doi and incoming.doi:
            target.doi = incoming.doi
        if not target.arxiv_id and incoming.arxiv_id:
            target.arxiv_id = incoming.arxiv_id
        if not target.semantic_scholar_id and incoming.semantic_scholar_id:
            target.semantic_scholar_id = incoming.semantic_scholar_id
        if target.cited_by_count is None and incoming.cited_by_count is not None:
            target.cited_by_count = incoming.cited_by_count
        if len(incoming.summary) > len(target.summary):
            target.summary = incoming.summary
        for author in incoming.authors:
            if author not in target.authors:
                target.authors.append(author)
        for category in incoming.categories:
            if category not in target.categories:
                target.categories.append(category)
        for ref in incoming.references:
            if ref not in target.references:
                target.references.append(ref)
        if incoming.url and not target.url:
            target.url = incoming.url
        _enrich_citation_fields(target)

    def _add_edge(self, source: str, target: str, relation: str) -> None:
        edge = (source, target, relation)
        if edge not in self.edges:
            self.edges.append(edge)

    def stats(self) -> dict[str, int]:
        paper_nodes = len(self.papers)
        author_nodes = len({edge[1] for edge in self.edges if edge[2] == "authored_by"})
        topic_nodes = len({edge[1] for edge in self.edges if edge[2] == "in_topic"})
        cite_edges = len([edge for edge in self.edges if edge[2] == "cites"])
        with_doi = len([paper for paper in self.papers.values() if paper.doi])
        return {
            "papers": paper_nodes,
            "authors": author_nodes,
            "topics": topic_nodes,
            "edges": len(self.edges),
            "citation_edges": cite_edges,
            "papers_with_doi": with_doi,
            "queries": len(self.queries),
        }

    def to_markdown(self) -> str:
        stats = self.stats()
        lines = [
            "# Literature Knowledge Graph",
            "",
            "## Stats",
            f"- Papers: {stats['papers']}",
            f"- Papers with DOI: {stats['papers_with_doi']}",
            f"- Citation edges: {stats['citation_edges']}",
            f"- Authors (linked): {stats['authors']}",
            f"- Topics: {stats['topics']}",
            f"- Total edges: {stats['edges']}",
            f"- Search queries: {stats['queries']}",
            "",
            "## Graph",
            "```mermaid",
            "graph LR",
        ]

        seen_nodes: set[str] = set()
        for _, paper in self.numbered_papers()[:12]:
            node = _mermaid_id(paper.paper_id)
            label = _mermaid_label(paper.title[:60])
            if node not in seen_nodes:
                lines.append(f'  {node}["{label}"]')
                seen_nodes.add(node)

        for source, target, relation in self.edges[:50]:
            if relation not in {"cites", "related_to", "retrieved_by"}:
                continue
            src = _mermaid_id(source)
            dst = _mermaid_id(target)
            if src not in seen_nodes and source in self.papers:
                title = self.papers[source].title[:60]
                lines.append(f'  {src}["{_mermaid_label(title)}"]')
                seen_nodes.add(src)
            if dst not in seen_nodes and target in self.papers:
                title = self.papers[target].title[:60]
                lines.append(f'  {dst}["{_mermaid_label(title)}"]')
                seen_nodes.add(dst)
            if source in self.papers and target in self.papers:
                lines.append(f"  {src} -->|{relation}| {dst}")

        lines.extend(["```", "", "## Papers", ""])
        for number, paper in self.numbered_papers():
            authors = ", ".join(paper.authors[:3]) or "unknown"
            year = paper.year or "n.d."
            lines.append(
                f"- **[{number}] {paper.paper_id}** ({paper.source}, {year}): {paper.title} — {authors}"
            )
            if paper.doi:
                lines.append(f"  - DOI: https://doi.org/{paper.doi}")
            elif paper.url:
                lines.append(f"  - {paper.url}")
            if paper.cited_by_count is not None:
                lines.append(f"  - Cited by: {paper.cited_by_count}")

        lines.extend(["", "## Bibliography", ""])
        for number, paper in self.numbered_papers():
            apa = paper.citation_apa or _format_apa(paper)
            lines.append(f"{number}. {apa}")
        lines.append("")
        return "\n".join(lines)

    def save_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "papers": {key: paper.to_dict() for key, paper in self.papers.items()},
            "edges": [{"source": s, "target": t, "relation": r} for s, t, r in self.edges],
            "queries": self.queries,
            "order": self._order,
        }
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    @classmethod
    def load_json(cls, path: Path) -> KnowledgeGraph:
        if not path.exists():
            return cls()
        payload = json.loads(path.read_text(encoding="utf-8"))
        graph = cls(
            papers={
                key: Paper.from_dict(value)
                for key, value in (payload.get("papers") or {}).items()
            },
            edges=[
                (edge["source"], edge["target"], edge["relation"])
                for edge in (payload.get("edges") or [])
            ],
            queries=list(payload.get("queries") or []),
            _order=list(payload.get("order") or []),
        )
        if not graph._order:
            graph._order = list(graph.papers.keys())
        return graph


def _mermaid_id(node_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", node_id)


def _mermaid_label(text: str) -> str:
    return text.replace('"', "'").replace("\n", " ")


def _enrich_citation_fields(paper: Paper) -> Paper:
    from backend.literature.citations import enrich_citation_fields

    return enrich_citation_fields(paper)


def _format_apa(paper: Paper) -> str:
    from backend.literature.citations import format_apa

    return format_apa(paper)


def _format_bibtex(paper: Paper) -> str:
    from backend.literature.citations import format_bibtex

    return format_bibtex(paper)
