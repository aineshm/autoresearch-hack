"""Literature review integrations (arXiv, Google Scholar, knowledge graphs)."""

from backend.literature.models import KnowledgeGraph, Paper
from backend.literature.tools import create_literature_tools

__all__ = [
    "KnowledgeGraph",
    "Paper",
    "create_literature_tools",
]
