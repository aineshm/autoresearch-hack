"""Parse a karpathy-style `program.md` experiment contract into a typed spec.

`program.md` is freeform instructions for an autonomous training-research loop. We
read it verbatim into agent context, but we also extract a few machine-actionable
fields (metric, run command, editable/readonly files) so the deterministic control
loop can run, score, and keep/discard experiments. Sensible defaults match the
reference repo (github.com/karpathy/autoresearch).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import re


@dataclass(slots=True)
class ExperimentSpec:
    """Machine-actionable view of an experiment defined by `program.md`."""

    repo_path: Path
    program_md: str
    edit_files: tuple[str, ...] = ("train.py",)
    readonly_files: tuple[str, ...] = ("prepare.py",)
    run_command: str = "uv run train.py"
    log_file: str = "run.log"
    metric_name: str = "val_bpb"
    metric_pattern: str = r"^val_bpb:\s*([0-9]*\.?[0-9]+)"
    memory_pattern: str = r"^peak_vram_mb:\s*([0-9]*\.?[0-9]+)"
    lower_is_better: bool = True
    results_tsv: str = "results.tsv"
    allow_install: bool = False
    timeout_seconds: int = 600
    program_file: str = "program.md"

    @classmethod
    def from_repo(cls, repo_path: str | Path, *, timeout_seconds: int = 600) -> "ExperimentSpec":
        repo = Path(repo_path).resolve()
        program_path = repo / "program.md"
        if not program_path.is_file():
            raise FileNotFoundError(f"No program.md found at {program_path}")
        program_md = program_path.read_text(encoding="utf-8")
        spec = cls(repo_path=repo, program_md=program_md, timeout_seconds=timeout_seconds)
        return spec.with_program_hints()

    def with_program_hints(self) -> "ExperimentSpec":
        """Override defaults with anything we can confidently detect in program.md."""
        text = self.program_md
        updates: dict[str, object] = {}

        run_match = re.search(r"`(uv run [^`]+|python[0-9]? [^`]+)`", text)
        if run_match:
            command = run_match.group(1).strip()
            # strip any inline redirection; the runner captures output itself
            command = re.split(r"\s*[>|]\s*", command)[0].strip()
            updates["run_command"] = command

        metric_match = re.search(r"\b(val_bpb|val_loss|accuracy|score|reward)\b", text)
        if metric_match:
            metric = metric_match.group(1)
            updates["metric_name"] = metric
            updates["metric_pattern"] = rf"^{re.escape(metric)}:\s*([0-9]*\.?[0-9]+)"
            updates["lower_is_better"] = metric not in {"accuracy", "score", "reward"}

        log_match = re.search(r"([A-Za-z0-9_./-]+\.log)\b", text)
        if log_match:
            updates["log_file"] = Path(log_match.group(1)).name

        if re.search(r"results\.tsv", text):
            updates["results_tsv"] = "results.tsv"

        # "cannot install new packages" style constraint
        updates["allow_install"] = not bool(
            re.search(r"(cannot|can't|do not|don't|never).{0,40}(install|add).{0,20}(package|dependenc)", text, re.IGNORECASE)
        )

        for key, value in updates.items():
            setattr(self, key, value)
        return self

    # ----- convenience ------------------------------------------------------
    @property
    def primary_edit_file(self) -> str:
        return self.edit_files[0]

    def edit_path(self, name: str | None = None) -> Path:
        return self.repo_path / (name or self.primary_edit_file)

    def log_path(self) -> Path:
        return self.repo_path / self.log_file

    def results_path(self) -> Path:
        return self.repo_path / self.results_tsv

    def read_edit_file(self, name: str | None = None) -> str:
        path = self.edit_path(name)
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def constraints_summary(self) -> str:
        installs = "may install packages" if self.allow_install else "MUST NOT install packages"
        readonly = ", ".join(self.readonly_files) or "(none)"
        editable = ", ".join(self.edit_files)
        direction = "lower is better" if self.lower_is_better else "higher is better"
        return (
            f"Editable files: {editable}. Read-only files: {readonly}. {installs}. "
            f"Metric: {self.metric_name} ({direction}). Run: `{self.run_command}`."
        )
