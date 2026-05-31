"""CrossRef DOI lookup for papers missing stable identifiers."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

from config import Settings, settings


def lookup_doi_sync(title: str, *, cfg: Settings = settings) -> str | None:
    """Best-effort DOI lookup by title via CrossRef."""
    if not title.strip():
        return None
    query = quote(title[:200])
    url = f"https://api.crossref.org/works?query.title={query}&rows=1"
    headers = {"User-Agent": _crossref_mailto(cfg)}
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except OSError:
        return None

    items = ((payload.get("message") or {}).get("items") or [])
    if not items:
        return None
    item = items[0]
    if not isinstance(item, dict):
        return None
    doi = str(item.get("DOI") or "").strip()
    return doi or None


async def lookup_doi(title: str, *, cfg: Settings = settings) -> str | None:
    return await asyncio.to_thread(lookup_doi_sync, title, cfg=cfg)


def _crossref_mailto(cfg: Settings) -> str:
    contact = cfg.literature_crossref_mailto or "autoresearch@example.com"
    return f"autoresearch-orchestrator/1.0 (mailto:{contact})"
