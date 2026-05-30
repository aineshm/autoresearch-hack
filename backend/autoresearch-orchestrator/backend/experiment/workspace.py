"""Git-backed persistent code state for the experiment loop.

Mirrors the reference loop: edit the editable file, commit, run; if the metric
improves keep the commit (advance), otherwise hard-reset back to the prior commit
(discard). `results.tsv` stays untracked.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess


class GitError(RuntimeError):
    pass


@dataclass(slots=True)
class CommitInfo:
    short_hash: str
    subject: str


class ExperimentWorkspace:
    """Thin git wrapper scoped to one repository working tree."""

    def __init__(self, repo_path: str | Path) -> None:
        self.repo_path = Path(repo_path).resolve()
        if not (self.repo_path / ".git").exists():
            raise GitError(f"{self.repo_path} is not a git repository.")

    def _git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise GitError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
        return result.stdout.strip()

    # ----- inspection -------------------------------------------------------
    def head(self) -> str:
        return self._git("rev-parse", "--short", "HEAD")

    def current_branch(self) -> str:
        return self._git("rev-parse", "--abbrev-ref", "HEAD")

    def is_clean(self) -> bool:
        return self._git("status", "--porcelain") == ""

    def read(self, rel_path: str) -> str:
        path = self.repo_path / rel_path
        return path.read_text(encoding="utf-8") if path.exists() else ""

    # ----- mutation ---------------------------------------------------------
    def write(self, rel_path: str, content: str) -> None:
        path = self.repo_path / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def checkout_branch(self, name: str, *, create: bool = True) -> None:
        if create:
            self._git("checkout", "-B", name)
        else:
            self._git("checkout", name)

    def commit(self, message: str, *, paths: list[str] | None = None) -> CommitInfo:
        if paths:
            self._git("add", *paths)
        else:
            self._git("add", "-A")
        # Nothing staged -> create an explicit empty commit so the loop still advances.
        status = self._git("status", "--porcelain")
        if status:
            self._git("commit", "-m", message)
        else:
            self._git("commit", "--allow-empty", "-m", message)
        return CommitInfo(short_hash=self.head(), subject=message.splitlines()[0][:72])

    def reset_hard(self, ref: str) -> None:
        self._git("reset", "--hard", ref)

    def revert_to(self, ref: str) -> None:
        """Discard the working tree and HEAD back to `ref` (used on discard/crash)."""
        self.reset_hard(ref)
