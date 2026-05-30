"""Append experiment outcomes to a tab-separated results ledger (`results.tsv`).

Format matches the reference repo: commit, metric, memory_gb, status, description.
Tab-separated so descriptions may contain commas. Kept untracked by git.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_HEADER = "commit\tval_bpb\tmemory_gb\tstatus\tdescription"


@dataclass(slots=True)
class ResultRow:
    commit: str
    value: float | None
    memory_gb: float | None
    status: str  # keep | discard | crash
    description: str

    def render(self) -> str:
        value = f"{self.value:.6f}" if self.value is not None else "0.000000"
        memory = f"{self.memory_gb:.1f}" if self.memory_gb is not None else "0.0"
        description = self.description.replace("\t", " ").replace("\n", " ").strip()
        return f"{self.commit}\t{value}\t{memory}\t{self.status}\t{description}"


class ResultsTsv:
    """Append-only TSV at `results.tsv`; header written on first use."""

    def __init__(self, path: str | Path, *, header: str = _HEADER) -> None:
        self.path = Path(path)
        self.header = header

    def ensure_header(self) -> None:
        if not self.path.exists() or not self.path.read_text(encoding="utf-8").strip():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(self.header + "\n", encoding="utf-8")

    def append(self, row: ResultRow) -> None:
        self.ensure_header()
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(row.render() + "\n")

    def tail(self, rows: int = 10) -> str:
        if not self.path.exists():
            return ""
        lines = self.path.read_text(encoding="utf-8").splitlines()
        if len(lines) <= 1:
            return "\n".join(lines)
        head, body = lines[0], lines[1:]
        return "\n".join([head, *body[-rows:]])
