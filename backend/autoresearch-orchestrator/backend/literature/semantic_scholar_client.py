"""Semantic Scholar enrichment for DOI, citations, and reference edges."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import json
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from backend.literature.citations import enrich_citation_fields
from backend.literature.models import Paper

_S2_BASE = "https://api.semanticscholar.org/graph/v1"
_FIELDS = (
    "paperId,title,authors,year,externalIds,citationCount,referenceCount,"
    "references.paperId,references.title,references.authors,references.year,references.externalIds"
)


@dataclass(frozen=True, slots=True)
class EnrichmentResult:
    paper: Paper
    reference_papers: list[Paper] = field(default_factory=list)
    warning: str | None = None


def enrich_paper_sync(paper: Paper, *, reference_limit: int = 3) -> EnrichmentResult:
    """Match a paper in Semantic Scholar and enrich metadata plus reference stubs."""
    payload = _fetch_paper_payload(paper)
    if payload is None:
        enrich_citation_fields(paper)
        return EnrichmentResult(paper=paper, warning="Semantic Scholar match not found.")

    paper.semantic_scholar_id = str(payload.get("paperId") or "") or None
    external = payload.get("externalIds") or {}
    if not paper.doi and external.get("DOI"):
        paper.doi = str(external["DOI"])
    if not paper.arxiv_id and external.get("ArXiv"):
        paper.arxiv_id = str(external["ArXiv"])
    if paper.cited_by_count is None and payload.get("citationCount") is not None:
        paper.cited_by_count = int(payload["citationCount"])

    references = payload.get("references") or []
    reference_papers: list[Paper] = []
    for ref in references[: max(0, reference_limit)]:
        if not isinstance(ref, dict):
            continue
        ref_paper = _paper_from_s2_reference(ref)
        if ref_paper is None:
            continue
        enrich_citation_fields(ref_paper)
        reference_papers.append(ref_paper)
        paper.references.append(ref_paper.paper_id)

    enrich_citation_fields(paper)
    return EnrichmentResult(paper=paper, reference_papers=reference_papers)


async def enrich_paper(paper: Paper, *, reference_limit: int = 3) -> EnrichmentResult:
    return await asyncio.to_thread(enrich_paper_sync, paper, reference_limit=reference_limit)


def _fetch_paper_payload(paper: Paper) -> dict[str, Any] | None:
    if paper.arxiv_id:
        payload = _get_json(f"/paper/ARXIV:{quote(paper.arxiv_id, safe='')}", {"fields": _FIELDS})
        if payload:
            return payload
    if paper.doi:
        payload = _get_json(f"/paper/DOI:{quote(paper.doi, safe='')}", {"fields": _FIELDS})
        if payload:
            return payload
    if paper.semantic_scholar_id:
        payload = _get_json(f"/paper/{quote(paper.semantic_scholar_id, safe='')}", {"fields": _FIELDS})
        if payload:
            return payload
    search = _get_json(
        "/paper/search",
        {"query": paper.title[:200], "limit": "1", "fields": _FIELDS},
    )
    if not search:
        return None
    data = search.get("data") or []
    if not data:
        return None
    return data[0] if isinstance(data[0], dict) else None


def _paper_from_s2_reference(ref: dict[str, Any]) -> Paper | None:
    title = str(ref.get("title") or "").strip()
    paper_id = str(ref.get("paperId") or "").strip()
    if not title or not paper_id:
        return None
    authors = [
        str(author.get("name") or "").strip()
        for author in (ref.get("authors") or [])
        if isinstance(author, dict) and author.get("name")
    ]
    external = ref.get("externalIds") or {}
    arxiv_id = str(external.get("ArXiv") or "") or None
    doi = str(external.get("DOI") or "") or None
    local_id = f"s2:{paper_id}"
    if arxiv_id:
        local_id = f"arxiv:{arxiv_id}"
    elif doi:
        local_id = f"doi:{doi.replace('/', '_')}"

    return Paper(
        paper_id=local_id,
        title=title,
        authors=authors,
        year=ref.get("year"),
        source="semantic_scholar",
        url=_best_url(doi=doi, arxiv_id=arxiv_id, s2_id=paper_id),
        summary="",
        categories=["reference"],
        doi=doi,
        arxiv_id=arxiv_id,
        semantic_scholar_id=paper_id,
    )


def _best_url(*, doi: str | None, arxiv_id: str | None, s2_id: str) -> str:
    if doi:
        return f"https://doi.org/{doi}"
    if arxiv_id:
        return f"https://arxiv.org/abs/{arxiv_id}"
    return f"https://www.semanticscholar.org/paper/{s2_id}"


def _get_json(path: str, params: dict[str, str]) -> dict[str, Any] | None:
    query = "&".join(f"{key}={quote(value, safe='')}" for key, value in params.items())
    url = f"{_S2_BASE}{path}?{query}"
    request = Request(url, headers={"User-Agent": "autoresearch-orchestrator/1.0"})
    try:
        with urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError:
        return None
    except OSError:
        return None
