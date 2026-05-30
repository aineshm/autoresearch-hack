"""Google Scholar search via scholarly (best-effort; may rate-limit)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib

from backend.literature.models import Paper


@dataclass(frozen=True, slots=True)
class ScholarSearchResult:
    papers: list[Paper]
    query: str
    warning: str | None = None


def search_google_scholar_sync(query: str, *, max_results: int = 5) -> ScholarSearchResult:
    """Search Google Scholar and normalize results."""
    try:
        from scholarly import scholarly
    except ImportError as exc:
        raise RuntimeError(
            "Install the `scholarly` package to enable Google Scholar search."
        ) from exc

    papers: list[Paper] = []
    warning: str | None = None
    try:
        iterator = scholarly.search_pubs(query)
        for index, pub in enumerate(iterator):
            if index >= max(1, min(max_results, 10)):
                break
            paper = _normalize_pub(pub)
            if paper is not None:
                papers.append(paper)
    except Exception as exc:  # noqa: BLE001 - scholar scraping is brittle
        warning = f"Google Scholar search failed: {type(exc).__name__}: {exc}"

    if not papers and warning is None:
        warning = "Google Scholar returned no results for this query."

    return ScholarSearchResult(papers=papers, query=query, warning=warning)


async def search_google_scholar(query: str, *, max_results: int = 5) -> ScholarSearchResult:
    return await asyncio.to_thread(search_google_scholar_sync, query, max_results=max_results)


def _normalize_pub(pub: dict) -> Paper | None:
    bib = pub.get("bib") or {}
    title = str(bib.get("title") or "").strip()
    if not title:
        return None

    authors_raw = bib.get("author")
    if isinstance(authors_raw, str):
        authors = [part.strip() for part in authors_raw.split(" and ") if part.strip()]
    elif isinstance(authors_raw, list):
        authors = [str(author).strip() for author in authors_raw if str(author).strip()]
    else:
        authors = []

    year_raw = bib.get("pub_year") or bib.get("year")
    year = int(year_raw) if year_raw is not None and str(year_raw).isdigit() else None
    abstract = str(bib.get("abstract") or pub.get("snippet") or "").strip()
    url = str(pub.get("pub_url") or pub.get("eprint_url") or "").strip()
    doi_raw = bib.get("doi") or pub.get("doi")
    doi = str(doi_raw).strip() if doi_raw else None
    scholar_id = str(pub.get("author_pub_id") or pub.get("pub_url") or title)
    digest = hashlib.sha1(scholar_id.encode("utf-8")).hexdigest()[:12]

    return Paper(
        paper_id=f"scholar:{digest}",
        title=title,
        authors=authors,
        year=year,
        source="google_scholar",
        url=url,
        summary=abstract[:1200],
        categories=["google_scholar"],
        doi=doi,
    )
