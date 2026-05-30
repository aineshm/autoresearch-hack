"""arXiv search via the public Atom API."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from html import unescape
import re
from typing import Any
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from backend.literature.models import Paper

_ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


@dataclass(frozen=True, slots=True)
class ArxivSearchResult:
    papers: list[Paper]
    query: str


def search_arxiv_sync(query: str, *, max_results: int = 8) -> ArxivSearchResult:
    """Query export.arxiv.org and return normalized paper records."""
    safe_query = quote_plus(query.strip())
    url = (
        "https://export.arxiv.org/api/query?"
        f"search_query=all:{safe_query}&start=0&max_results={max(1, min(max_results, 25))}"
    )
    request = Request(url, headers={"User-Agent": "autoresearch-orchestrator/1.0"})
    with urlopen(request, timeout=30) as response:
        payload = response.read().decode("utf-8")

    root = ET.fromstring(payload)
    papers: list[Paper] = []
    for entry in root.findall("atom:entry", _ATOM_NS):
        raw_id = _text(entry.find("atom:id", _ATOM_NS))
        arxiv_id = raw_id.rsplit("/", maxsplit=1)[-1] if raw_id else ""
        arxiv_base = re.sub(r"v\d+$", "", arxiv_id, flags=re.IGNORECASE)
        doi_node = entry.find("arxiv:doi", _ATOM_NS)
        doi = _text(doi_node) or None
        title = _clean_text(_text(entry.find("atom:title", _ATOM_NS)))
        summary = _clean_text(_text(entry.find("atom:summary", _ATOM_NS)))
        published = _text(entry.find("atom:published", _ATOM_NS))
        year = int(published[:4]) if published and len(published) >= 4 else None
        authors = [
            _clean_text(_text(author.find("atom:name", _ATOM_NS)))
            for author in entry.findall("atom:author", _ATOM_NS)
        ]
        categories = [
            category.attrib.get("term", "")
            for category in entry.findall("atom:category", _ATOM_NS)
            if category.attrib.get("term")
        ]
        link = next(
            (
                link.attrib.get("href", "")
                for link in entry.findall("atom:link", _ATOM_NS)
                if link.attrib.get("rel") == "alternate"
            ),
            f"https://arxiv.org/abs/{arxiv_id}",
        )
        if not arxiv_id or not title:
            continue
        papers.append(
            Paper(
                paper_id=f"arxiv:{arxiv_id}",
                title=title,
                authors=[author for author in authors if author],
                year=year,
                source="arxiv",
                url=link,
                summary=summary[:1200],
                categories=categories,
                doi=doi,
                arxiv_id=arxiv_base or arxiv_id,
            )
        )
    return ArxivSearchResult(papers=papers, query=query)


async def search_arxiv(query: str, *, max_results: int = 8) -> ArxivSearchResult:
    return await asyncio.to_thread(search_arxiv_sync, query, max_results=max_results)


def _text(node: Any) -> str:
    return node.text.strip() if node is not None and node.text else ""


def _clean_text(text: str) -> str:
    collapsed = re.sub(r"\s+", " ", unescape(text)).strip()
    return collapsed
