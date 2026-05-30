"""Runtime configuration for the autoresearch swarm."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class Settings:
    """Typed process settings loaded from environment variables."""

    app_name: str = os.getenv("AUTORESEARCH_APP_NAME", "autoresearch-swarm")
    model: str = os.getenv("AUTORESEARCH_MODEL", "openai:gpt-5.4")
    workspace_root: Path = Path(
        os.getenv("AUTORESEARCH_WORKSPACE", ".autoresearch_workspace")
    ).resolve()

    modal_app_name: str = os.getenv("MODAL_APP_NAME", "autoresearch-swarm-runtime")
    modal_timeout_seconds: int = int(os.getenv("MODAL_TIMEOUT_SECONDS", "300"))
    modal_python_version: str = os.getenv("MODAL_PYTHON_VERSION", "3.12")

    raindrop_api_key: str | None = os.getenv("RAINDROP_API_KEY")
    raindrop_base_url: str = os.getenv("RAINDROP_BASE_URL", "http://127.0.0.1:8080")
    raindrop_project: str = os.getenv("RAINDROP_PROJECT", "autoresearch-swarm")
    raindrop_enabled: bool = _env_bool("RAINDROP_ENABLED", True)

    max_generations: int = int(os.getenv("AUTORESEARCH_MAX_GENERATIONS", "3"))
    distilled_word_limit: int = int(os.getenv("DISTILLED_BRIEF_WORD_LIMIT", "500"))

    # Hierarchical swarm (Principal Investigator → Scientist+Developer workers → Reviewer)
    max_workers: int = int(os.getenv("AUTORESEARCH_MAX_WORKERS", "3"))
    worker_concurrency: int = int(os.getenv("AUTORESEARCH_WORKER_CONCURRENCY", "3"))
    reviewer_enabled: bool = _env_bool("AUTORESEARCH_REVIEWER_ENABLED", True)
    review_pass_score: float = float(os.getenv("AUTORESEARCH_REVIEW_PASS_SCORE", "0.7"))

    # Research ledger (long-term memory of attempts)
    ledger_enabled: bool = _env_bool("AUTORESEARCH_LEDGER_ENABLED", True)
    ledger_similarity_threshold: float = float(
        os.getenv("AUTORESEARCH_LEDGER_SIMILARITY", "0.8")
    )

    # Diagnostic sub-loop (environment self-repair before giving up a worker)
    diagnostic_enabled: bool = _env_bool("AUTORESEARCH_DIAGNOSTIC_ENABLED", True)
    diagnostic_max_attempts: int = int(os.getenv("AUTORESEARCH_DIAGNOSTIC_ATTEMPTS", "1"))

    # Experiment mode (program.md training-research loop, e.g. karpathy/autoresearch)
    experiment_timeout_seconds: int = int(os.getenv("AUTORESEARCH_EXPERIMENT_TIMEOUT", "600"))
    max_experiments: int = int(os.getenv("AUTORESEARCH_MAX_EXPERIMENTS", "100"))
    experiment_branch: str = os.getenv("AUTORESEARCH_EXPERIMENT_BRANCH", "")
    experiment_literature: bool = _env_bool("AUTORESEARCH_EXPERIMENT_LITERATURE", False)
    literature_arxiv_max_results: int = int(os.getenv("LITERATURE_ARXIV_MAX_RESULTS", "8"))
    literature_scholar_max_results: int = int(os.getenv("LITERATURE_SCHOLAR_MAX_RESULTS", "5"))
    literature_scholar_enabled: bool = _env_bool("LITERATURE_SCHOLAR_ENABLED", True)
    literature_enrich_citations: bool = _env_bool("LITERATURE_ENRICH_CITATIONS", True)
    literature_semantic_scholar_enabled: bool = _env_bool("LITERATURE_SEMANTIC_SCHOLAR_ENABLED", True)
    literature_crossref_enabled: bool = _env_bool("LITERATURE_CROSSREF_ENABLED", True)
    literature_crossref_mailto: str = os.getenv(
        "LITERATURE_CROSSREF_MAILTO", "autoresearch@example.com"
    )
    literature_s2_reference_limit: int = int(os.getenv("LITERATURE_S2_REFERENCE_LIMIT", "3"))
    parent_visible_files: tuple[str, ...] = (
        "distilled_brief.md",
        "literature_graph.md",
        "citations.md",
        "plan.md",
        "builder_result.md",
        "review.md",
        "ledger.md",
        "error_summary.md",
        "retrospective.md",
    )


settings = Settings()
