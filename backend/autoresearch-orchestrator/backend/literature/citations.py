"""Citation formatting helpers (APA-style + BibTeX)."""

from __future__ import annotations

import re

from backend.literature.models import Paper


def citation_key(paper: Paper) -> str:
    if paper.citation_key:
        return paper.citation_key
    author = _first_author_last(paper.authors)
    year = str(paper.year or "nd")
    suffix = _slug_fragment(paper.paper_id.split(":", maxsplit=1)[-1][:8])
    return f"{author}{year}{suffix}"


def format_apa(paper: Paper) -> str:
    authors = _format_authors_apa(paper.authors)
    year = paper.year or "n.d."
    title = paper.title.rstrip(".")
    tail = ""
    if paper.doi:
        tail = f" https://doi.org/{paper.doi}"
    elif paper.url:
        tail = f" {paper.url}"
    return f"{authors} ({year}). {title}.{tail}"


def format_bibtex(paper: Paper) -> str:
    key = citation_key(paper)
    entry_type = "article"
    lines = [f"@{entry_type}{{{key},"]
    lines.append(f"  title = {{{_bibtex_escape(paper.title)}}},")
    if paper.authors:
        joined = " and ".join(paper.authors)
        lines.append(f"  author = {{{_bibtex_escape(joined)}}},")
    if paper.year:
        lines.append(f"  year = {{{paper.year}}},")
    if paper.doi:
        lines.append(f"  doi = {{{paper.doi}}},")
    if paper.arxiv_id:
        lines.append(f"  eprint = {{{paper.arxiv_id}}},")
        lines.append("  archivePrefix = {arXiv},")
    if paper.url:
        lines.append(f"  url = {{{paper.url}}},")
    lines.append("}")
    return "\n".join(lines)


def format_inline(paper: Paper, *, number: int | None = None) -> str:
    authors = _format_authors_inline(paper.authors)
    year = paper.year or "n.d."
    prefix = f"[{number}] " if number is not None else ""
    return f"{prefix}{authors} ({year})"


def enrich_citation_fields(paper: Paper) -> Paper:
    paper.citation_key = citation_key(paper)
    paper.citation_apa = format_apa(paper)
    paper.bibtex = format_bibtex(paper)
    return paper


def _first_author_last(authors: list[str]) -> str:
    if not authors:
        return "anon"
    parts = authors[0].split()
    last = parts[-1] if parts else authors[0]
    return _slug_fragment(last)


def _format_authors_apa(authors: list[str]) -> str:
    if not authors:
        return "Unknown"
    if len(authors) == 1:
        return authors[0]
    if len(authors) <= 20:
        return ", ".join(authors[:-1]) + f", & {authors[-1]}"
    return ", ".join(authors[:19]) + ", ... " + authors[-1]


def _format_authors_inline(authors: list[str]) -> str:
    if not authors:
        return "Unknown"
    if len(authors) == 1:
        return authors[0]
    if len(authors) == 2:
        return f"{authors[0]} & {authors[1]}"
    return f"{authors[0]} et al."


def _slug_fragment(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]", "", text.lower())
    return cleaned[:12] or "ref"


def _bibtex_escape(text: str) -> str:
    return text.replace("{", "\\{").replace("}", "\\}")
