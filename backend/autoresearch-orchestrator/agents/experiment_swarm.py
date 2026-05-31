"""Experiment-mode orchestration: run a `program.md` training-research loop.

This is the autonomous loop from github.com/karpathy/autoresearch, driven by the
swarm's brain: an Experimenter deep agent proposes one change to the editable file
(grounded in the research ledger of past failures), the change is committed and run,
and the metric decides keep (advance the branch) vs discard/crash (git reset). Every
attempt is recorded to `results.tsv` and the ledger so near-duplicate dead ends are
not retried.

Unlike the general swarm, code runs on the LOCAL machine (the reference loop is meant
to run on the GPU box itself) via an `ExperimentRunner`, not a Modal sandbox.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable
from uuid import uuid4

from agents.subagent_loader import load_subagent_by_name
from agents.swarm import (
    RaindropTelemetry,
    _SUBAGENTS_DIR,
    _MEMORY_PATH,
    create_deep_agent_checked,
)
from backend.experiment import (
    ExperimentRunner,
    ExperimentSpec,
    ExperimentWorkspace,
    LocalSubprocessRunner,
    MetricReading,
    ResultRow,
    ResultsTsv,
    is_improvement,
    parse_log,
)
from backend.ledger import Attempt, ResearchLedger, create_ledger_tools
from backend.modal_runtime import blackboard_backend
from config import Settings, settings

# (description, full_new_file_content)
IdeaProposer = Callable[..., Awaitable[tuple[str, str]]]


@dataclass(slots=True)
class ExperimentRunResult:
    run_id: str
    best_value: float | None
    experiments_run: int
    kept: int
    results_path: Path
    head_commit: str


class ExperimentSwarm:
    """Runs the keep/discard experiment loop defined by a repo's `program.md`."""

    def __init__(
        self,
        cfg: Settings = settings,
        *,
        telemetry: RaindropTelemetry | None = None,
        runner: ExperimentRunner | None = None,
        idea_proposer: IdeaProposer | None = None,
    ) -> None:
        self.cfg = cfg
        self.telemetry = telemetry or RaindropTelemetry(cfg)
        self.runner = runner or LocalSubprocessRunner()
        self._idea_proposer = idea_proposer

    async def run(self, repo_path: str | Path, *, max_experiments: int | None = None) -> ExperimentRunResult:
        run_id = uuid4().hex
        spec = ExperimentSpec.from_repo(repo_path, timeout_seconds=self.cfg.experiment_timeout_seconds)
        workspace = ExperimentWorkspace(spec.repo_path)
        results = ResultsTsv(spec.results_path())
        ledger = self._load_ledger(run_id)
        budget = max_experiments or self.cfg.max_experiments
        print(f"[EXPERIMENT] start: {run_id} repo={spec.repo_path.name} metric={spec.metric_name}")

        if self.cfg.experiment_branch:
            workspace.checkout_branch(self.cfg.experiment_branch, create=True)

        # Baseline: run the editable file as-is; the current commit is the kept anchor.
        last_kept = workspace.head()
        baseline = await self._run_training(spec)
        best = baseline.value
        results.append(
            ResultRow(
                commit=last_kept,
                value=baseline.value,
                memory_gb=baseline.memory_gb,
                status="keep" if baseline.ok else "crash",
                description="baseline",
            )
        )
        await self._log(run_id, 0, "baseline", baseline)
        print(f"[EXPERIMENT] baseline {spec.metric_name}={best}")

        experiments_run = 0
        kept = 0
        for index in range(1, budget + 1):
            current_code = spec.read_edit_file()
            description, new_code = await self._propose_idea(
                run_id, spec, current_code, best, ledger, results.tail()
            )
            if not new_code.strip() or not description.strip():
                print("[EXPERIMENT] no further idea proposed; stopping.")
                break

            if self.cfg.ledger_enabled and ledger.is_blocked(description):
                print(f"[EXPERIMENT] skip near-duplicate of a failed idea: {description}")
                continue

            spec.edit_path().write_text(new_code, encoding="utf-8")
            commit = workspace.commit(description, paths=list(spec.edit_files))
            reading = await self._run_training(spec)
            experiments_run += 1

            if reading.crashed:
                status = "crash"
                workspace.revert_to(last_kept)
            elif is_improvement(reading.value, best, lower_is_better=spec.lower_is_better):
                status = "keep"
                best = reading.value
                last_kept = workspace.head()
                kept += 1
            else:
                status = "discard"
                workspace.revert_to(last_kept)

            results.append(
                ResultRow(
                    commit=commit.short_hash,
                    value=reading.value,
                    memory_gb=reading.memory_gb,
                    status=status,
                    description=description,
                )
            )
            self._record_ledger(run_id, index, description, status, reading, ledger)
            await self._log(run_id, index, f"{description} -> {status}", reading)
            print(f"[EXPERIMENT] {index}: {status} {reading.summary(spec.metric_name)} | {description}")

        print(f"[EXPERIMENT] finish: {experiments_run} runs, {kept} kept, best {spec.metric_name}={best}")
        return ExperimentRunResult(
            run_id=run_id,
            best_value=best,
            experiments_run=experiments_run,
            kept=kept,
            results_path=spec.results_path(),
            head_commit=workspace.head(),
        )

    # ----- training ---------------------------------------------------------
    async def _run_training(self, spec: ExperimentSpec) -> MetricReading:
        result = await self.runner.run(
            command=spec.run_command,
            cwd=spec.repo_path,
            log_path=spec.log_path(),
            timeout=spec.timeout_seconds,
        )
        reading = parse_log(result.log_text, spec)
        if result.timed_out:
            return MetricReading(value=None, memory_gb=reading.memory_gb, crashed=True, tail=reading.tail)
        return reading

    # ----- idea proposal ----------------------------------------------------
    async def _propose_idea(
        self,
        run_id: str,
        spec: ExperimentSpec,
        current_code: str,
        best: float | None,
        ledger: ResearchLedger,
        results_tail: str,
    ) -> tuple[str, str]:
        if self._idea_proposer is not None:
            return await self._idea_proposer(
                spec=spec,
                current_code=current_code,
                best=best,
                ledger=ledger,
                results_tail=results_tail,
            )
        return await self._agent_propose_idea(run_id, spec, current_code, best, ledger, results_tail)

    async def _agent_propose_idea(
        self,
        run_id: str,
        spec: ExperimentSpec,
        current_code: str,
        best: float | None,
        ledger: ResearchLedger,
        results_tail: str,
    ) -> tuple[str, str]:
        captured: dict[str, str] = {}

        async def submit_experiment(description: str, file_content: str) -> str:
            """Submit the next experiment: a one-line description and the FULL edited file."""
            captured["description"] = description.strip()
            captured["code"] = file_content
            return "Experiment recorded."

        agent_spec = load_subagent_by_name(_SUBAGENTS_DIR, "experimenter")
        tools = [submit_experiment, *create_ledger_tools(ledger=ledger)]
        agent = create_deep_agent_checked(
            model=agent_spec.get("model", self.cfg.model),
            system_prompt=agent_spec["system_prompt"],
            tools=tools,
            memory=[_MEMORY_PATH],
            backend=blackboard_backend(blackboard_root=str(self.cfg.workspace_root)),
        )
        best_text = f"{best:.6f}" if best is not None else "(no baseline metric yet)"
        message = (
            f"program.md contract:\n{spec.program_md}\n\n"
            f"Constraints: {spec.constraints_summary()}\n"
            f"Best {spec.metric_name} so far: {best_text}\n\n"
            f"{ledger.avoid_prompt_block()}\n\n"
            f"Recent results.tsv:\n{results_tail or '(none yet)'}\n\n"
            f"Current {spec.primary_edit_file}:\n```\n{current_code}\n```\n\n"
            "Propose ONE experiment and call submit_experiment with the full edited file."
        )
        await agent.ainvoke(
            {"messages": [{"role": "user", "content": message}]},
            config={"configurable": {"thread_id": f"{run_id}:experimenter:{uuid4().hex}"}},
        )
        return captured.get("description", ""), captured.get("code", "")

    # ----- ledger + telemetry ----------------------------------------------
    def _ledger_path(self, run_id: str) -> Path:
        return self.cfg.workspace_root / ".research" / run_id / "ledger.json"

    def _load_ledger(self, run_id: str) -> ResearchLedger:
        if not self.cfg.ledger_enabled:
            return ResearchLedger(similarity_threshold=self.cfg.ledger_similarity_threshold)
        return ResearchLedger.load_json(
            self._ledger_path(run_id),
            similarity_threshold=self.cfg.ledger_similarity_threshold,
        )

    def _record_ledger(
        self,
        run_id: str,
        index: int,
        description: str,
        status: str,
        reading: MetricReading,
        ledger: ResearchLedger,
    ) -> None:
        if not self.cfg.ledger_enabled:
            return
        error_class = {"crash": "crash", "discard": "no-improvement"}.get(status, "")
        ledger.record(
            Attempt.create(
                attempt_id=uuid4().hex,
                packet_id=f"exp{index}",
                generation=index,
                approach=description,
                outcome="success" if status == "keep" else "failure",
                error_class=error_class,
                detail=reading.summary("metric"),
            )
        )
        ledger.save_json(self._ledger_path(run_id))

    async def _log(self, run_id: str, index: int, label: str, reading: MetricReading) -> None:
        await self.telemetry.log_trace(
            run_id=run_id,
            span=f"experiment:{index}",
            level="info" if reading.ok else "error",
            detail=reading.tail or label,
            metadata={"label": label, "value": reading.value, "memory_gb": reading.memory_gb},
        )
