"""Hierarchical, context-isolated Deep Agents swarm using a markdown blackboard.

Layers (all built from deepagents primitives):

    Filter                literature review -> distilled_brief.md
    Principal Investigator strategy + work-packet decomposition (write_todos, submit_work_packets)
    Scientist + Developer  middle "swarm": N worker pairs run in parallel, each in its own Modal
                           sandbox. Scientist writes code, Developer runs it; a Diagnostic agent
                           repairs the sandbox on environment errors.
    Reviewer               independent rubric score -> review.md (VERDICT: accept|revise)
    Research Ledger        long-term memory; failed approach signatures block near-duplicate retries
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any, Iterable, Mapping, Protocol
from uuid import uuid4

from agents.subagent_loader import load_subagent_by_name, load_subagents_dir
from backend.literature import KnowledgeGraph, create_literature_tools
from backend.ledger import Attempt, ResearchLedger, create_ledger_tools
from backend.execute_telemetry import ExecuteTelemetryMiddleware
from backend.modal_runtime import BLACKBOARD_ROUTE, ModalSandboxSession, blackboard_backend
from config import Settings, settings

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_SUBAGENTS_DIR = _PACKAGE_ROOT / ".deepagents" / "agents"
_PI_PROMPT_PATH = _PACKAGE_ROOT / "agents" / "personas" / "principal_investigator.md"
_MEMORY_PATH = "./AGENTS.md"

_ENV_ERROR_TOKENS = (
    "modulenotfound",
    "importerror",
    "no module",
    "command not found",
    "cuda",
    "filenotfound",
    "oserror",
    "libcudart",
    "not installed",
    "no such file",
)


class AgentGraph(Protocol):
    async def ainvoke(self, input: Mapping[str, Any], config: Mapping[str, Any]) -> Any:
        ...


def _utcstamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class MarkdownBlackboard:
    """Shared virtual filesystem facade with markdown-only agent exchange."""

    def __init__(self, root: Path, visible_files: Iterable[str]) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.visible_files = set(visible_files)

    def path(self, name: str) -> Path:
        posix = PurePosixPath(name)
        if posix.is_absolute() or ".." in posix.parts:
            raise ValueError(f"Unsafe blackboard path: {name}")
        path = (self.root / posix.as_posix()).resolve()
        if self.root not in path.parents and path != self.root:
            raise ValueError(f"Path escapes blackboard root: {name}")
        return path

    async def write(self, name: str, content: str) -> None:
        if not name.endswith(".md"):
            raise ValueError("Agents may only exchange markdown files.")
        path = self.path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_text, content, "utf-8")
        print(f"[BLACKBOARD] write: {name}")

    async def read(self, name: str) -> str:
        path = self.path(name)
        if not path.exists():
            return ""
        return await asyncio.to_thread(path.read_text, "utf-8")

    async def append(self, name: str, content: str) -> None:
        current = await self.read(name)
        await self.write(name, f"{current.rstrip()}\n\n{content.strip()}\n" if current else content)

    async def parent_context(self) -> str:
        sections: list[str] = []
        for name in sorted(self.visible_files):
            text = await self.read(name)
            if text:
                sections.append(f"## {name}\n{text.strip()}")
        return "\n\n".join(sections)


class RaindropTelemetry:
    """Small Raindrop client that keeps raw traces out of model context."""

    def __init__(self, cfg: Settings = settings) -> None:
        self.cfg = cfg

    async def log_trace(
        self,
        *,
        run_id: str,
        span: str,
        level: str,
        detail: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        if not self.cfg.raindrop_enabled:
            return
        payload = {
            "project": self.cfg.raindrop_project,
            "run_id": run_id,
            "span": span,
            "level": level,
            "detail": detail,
            "metadata": dict(metadata or {}),
            "timestamp": _utcstamp(),
        }
        await asyncio.to_thread(self._spool_jsonl, run_id, payload)
        await asyncio.to_thread(self._post_json, "/api/traces", payload)

    async def summarize_run(self, run_id: str) -> str:
        if not self.cfg.raindrop_enabled:
            return "Telemetry disabled; no Raindrop post-mortem available."
        trace = await asyncio.to_thread(self._get_json, f"/api/traces/{run_id}")
        if not trace:
            trace = await asyncio.to_thread(self._read_spool, run_id)
        return self._semantic_root_cause(trace)

    def _spool_jsonl(self, run_id: str, payload: Mapping[str, Any]) -> None:
        path = self.cfg.workspace_root / ".telemetry" / f"{run_id}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, sort_keys=True) + "\n")

    def _read_spool(self, run_id: str) -> list[dict[str, Any]]:
        path = self.cfg.workspace_root / ".telemetry" / f"{run_id}.jsonl"
        if not path.exists():
            return []
        events: list[dict[str, Any]] = []
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return events

    def _post_json(self, path: str, payload: Mapping[str, Any]) -> None:
        from urllib import request

        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            self.cfg.raindrop_base_url.rstrip("/") + path,
            data=body,
            headers=self._headers(),
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=10):
                return
        except OSError:
            return

    def _get_json(self, path: str) -> Any:
        from urllib import request

        req = request.Request(
            self.cfg.raindrop_base_url.rstrip("/") + path,
            headers=self._headers(),
            method="GET",
        )
        try:
            with request.urlopen(req, timeout=10) as response:
                return json.loads(response.read().decode("utf-8"))
        except OSError:
            return {}

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.cfg.raindrop_api_key:
            headers["Authorization"] = f"Bearer {self.cfg.raindrop_api_key}"
        return headers

    @staticmethod
    def _semantic_root_cause(trace: Any) -> str:
        text = str(trace)
        if not text or text == "{}":
            return "No Raindrop trace was available for this run."
        patterns = [
            r"(ModuleNotFoundError:[^\\n']+)",
            r"(ImportError:[^\\n']+)",
            r"(AssertionError:[^\\n']*)",
            r"(TimeoutError:[^\\n']*)",
            r"(PermissionError:[^\\n']*)",
            r"([A-Za-z]+Error:[^\\n']+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(1)[:240]
        return "Trace captured, but no specific exception signature was detected."


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


@dataclass(slots=True)
class WorkerOutcome:
    """Result of one Scientist+Developer worker for a single work packet."""

    packet_id: str
    packet: str
    success: bool
    approach: str = ""
    error_class: str = ""
    result_md: str = ""
    error_md: str = ""
    diagnostic_ran: bool = False


@dataclass(slots=True)
class ReviewVerdict:
    score: float | None
    accepted: bool
    raw: str = ""


@dataclass(slots=True)
class SwarmRunResult:
    run_id: str
    final_summary: str
    blackboard_root: Path


class AutoresearchSwarm:
    """Coordinates a hierarchy of short-lived, context-isolated Deep Agents."""

    def __init__(
        self,
        cfg: Settings = settings,
        *,
        telemetry: RaindropTelemetry | None = None,
    ) -> None:
        self.cfg = cfg
        self.blackboard = MarkdownBlackboard(cfg.workspace_root, cfg.parent_visible_files)
        self.telemetry = telemetry or RaindropTelemetry(cfg)

    async def run(self, user_goal: str, raw_materials: str = "") -> SwarmRunResult:
        run_id = uuid4().hex
        print(f"[PI] start: {run_id}")
        await self.blackboard.write(
            "retrospective.md", f"# Retrospective\n\n- {_utcstamp()}: run started."
        )
        ledger = self._load_ledger(run_id)
        await self._publish_ledger(ledger)

        for generation in range(1, self.cfg.max_generations + 1):
            print(f"[PI] generation: {generation}")
            await self._run_filter(run_id, user_goal, raw_materials)
            packets = await self._plan_work_packets(run_id, user_goal, ledger)
            outcomes = await self._run_workers(run_id, generation, packets, ledger)
            await self._merge_worker_results(generation, outcomes)
            await self._record_ledger(run_id, generation, outcomes, ledger)
            review = await self._run_reviewer(run_id, generation)
            await self._run_post_mortem(run_id, generation)

            error = await self.blackboard.read("error_summary.md")
            accepted = review.accepted if self.cfg.reviewer_enabled else True
            if not error.strip() and accepted:
                break

        parent_context = await self.blackboard.parent_context()
        parent = self._create_parent_agent()
        response = await parent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Produce the final compact outcome for the user from only "
                            "the following blackboard files.\n\n"
                            f"{parent_context}"
                        ),
                    }
                ]
            },
            config={"configurable": {"thread_id": f"{run_id}:pi:{uuid4().hex}"}},
        )
        final = _extract_text(response)
        print(f"[PI] finish: {run_id}")
        return SwarmRunResult(run_id=run_id, final_summary=final, blackboard_root=self.blackboard.root)

    # ----- Filter -----------------------------------------------------------
    async def _run_filter(self, run_id: str, user_goal: str, raw_materials: str) -> None:
        print("[FILTER] spawn: digest raw materials")
        graph = self._load_literature_graph(run_id)
        agent = self._create_filter_agent(run_id, graph)
        await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Goal:\n{user_goal}\n\nRaw materials for this isolated run:\n"
                            f"{raw_materials or '(none)'}\n\n"
                            "Run a literature review before distilling:\n"
                            "1. search_arxiv_literature with focused queries derived from the goal\n"
                            "2. search_google_scholar_literature for complementary coverage\n"
                            "3. enrich_literature_citations if DOI/citation edges look sparse\n"
                            "4. get_citation_bibliography then render_literature_knowledge_graph\n"
                            f"5. Write {BLACKBOARD_ROUTE}distilled_brief.md (<=500 words) using [1], [2] citation keys\n"
                            "Prioritize arXiv for preprints; use Scholar for citations and adjacent work."
                        ),
                    }
                ]
            },
            config={"configurable": {"thread_id": f"{run_id}:filter:{uuid4().hex}"}},
        )
        await self._finalize_literature_graph(run_id, graph)
        await self._enforce_brief_limit()
        print("[FILTER] terminate: raw context flushed")

    # ----- Principal Investigator: planning ---------------------------------
    async def _plan_work_packets(
        self, run_id: str, user_goal: str, ledger: ResearchLedger
    ) -> list[str]:
        print("[PI] plan: decompose goal into work packets")
        captured: list[str] = []

        async def submit_work_packets(packets: list[str]) -> str:
            """Submit the final list of independent work packets for parallel execution.

            Each packet should be one focused, independently implementable deliverable.
            """
            cleaned = [p.strip() for p in packets if p and p.strip()]
            captured.clear()
            captured.extend(cleaned[: self.cfg.max_workers])
            return f"Recorded {len(captured)} work packets."

        brief = await self.blackboard.read("distilled_brief.md")
        prior_review = await self.blackboard.read("review.md")
        prior_result = await self.blackboard.read("builder_result.md")
        agent = self._create_planner_agent(submit_work_packets)
        message = (
            f"Goal:\n{user_goal}\n\n"
            f"distilled_brief.md:\n{brief or '(empty)'}\n\n"
            f"{ledger.avoid_prompt_block()}\n\n"
        )
        if prior_review.strip():
            message += f"Previous review (address required revisions):\n{prior_review}\n\n"
        if prior_result.strip():
            message += f"Previous builder_result.md:\n{prior_result}\n\n"
        message += (
            f"Decompose this into at most {self.cfg.max_workers} independent work packets. "
            "Use write_todos to plan, then call submit_work_packets exactly once with the list."
        )
        await agent.ainvoke(
            {"messages": [{"role": "user", "content": message}]},
            config={"configurable": {"thread_id": f"{run_id}:pi-plan:{uuid4().hex}"}},
        )

        packets = captured or [user_goal]
        await self.blackboard.write("plan.md", self._render_plan(user_goal, packets))
        print(f"[PI] packets: {len(packets)}")
        return packets

    @staticmethod
    def _render_plan(user_goal: str, packets: list[str]) -> str:
        lines = ["# Work Plan", "", f"_Goal: {user_goal}_", "", "## Packets"]
        for index, packet in enumerate(packets, start=1):
            lines.append(f"- **p{index}** — {packet}")
        return "\n".join(lines) + "\n"

    # ----- Middle swarm: parallel Scientist + Developer workers -------------
    async def _run_workers(
        self,
        run_id: str,
        generation: int,
        packets: list[str],
        ledger: ResearchLedger,
    ) -> list[WorkerOutcome]:
        await self.blackboard.write("error_summary.md", "")
        await self.blackboard.write("builder_result.md", "")
        brief = await self.blackboard.read("distilled_brief.md")
        files = await self._target_file_state()
        semaphore = asyncio.Semaphore(max(1, self.cfg.worker_concurrency))

        async def run_one(index: int, packet: str) -> WorkerOutcome:
            async with semaphore:
                return await self._run_worker(
                    run_id, generation, f"p{index}", packet, brief, files, ledger
                )

        return await asyncio.gather(
            *(run_one(i, packet) for i, packet in enumerate(packets, start=1))
        )

    async def _run_worker(
        self,
        run_id: str,
        generation: int,
        packet_id: str,
        packet: str,
        brief: str,
        files: str,
        ledger: ResearchLedger,
    ) -> WorkerOutcome:
        print(f"[WORKER {packet_id}] spawn")
        plan_path = f"workers/{packet_id}/plan.md"
        result_path = f"workers/{packet_id}/result.md"
        error_path = f"workers/{packet_id}/error.md"
        await self.blackboard.write(result_path, "")
        await self.blackboard.write(error_path, "")

        modal_session = ModalSandboxSession(self.cfg)
        try:
            await asyncio.to_thread(modal_session.create)
            await self._invoke_scientist(
                run_id, generation, modal_session, packet_id, packet, brief, ledger,
                plan_path=plan_path,
            )
            approach = _extract_approach(await self.blackboard.read(plan_path), fallback=packet)

            await self._invoke_developer(
                run_id, modal_session, packet_id, files,
                plan_path=plan_path, result_path=result_path, error_path=error_path,
            )

            error_md = await self.blackboard.read(error_path)
            diagnostic_ran = False
            if error_md.strip() and self.cfg.diagnostic_enabled:
                error_class = _extract_error_class(error_md)
                if _is_environment_error(error_class, error_md):
                    diagnostic_ran = True
                    await self._run_diagnostic(
                        run_id, modal_session, packet_id, error_class,
                        plan_path=plan_path,
                    )
                    await self.blackboard.write(error_path, "")
                    await self._invoke_developer(
                        run_id, modal_session, packet_id, files,
                        plan_path=plan_path, result_path=result_path, error_path=error_path,
                    )
                    error_md = await self.blackboard.read(error_path)

            result_md = await self.blackboard.read(result_path)
            success = bool(result_md.strip()) and not error_md.strip()
            outcome = WorkerOutcome(
                packet_id=packet_id,
                packet=packet,
                success=success,
                approach=approach,
                error_class="" if success else _extract_error_class(error_md),
                result_md=result_md.strip(),
                error_md=error_md.strip(),
                diagnostic_ran=diagnostic_ran,
            )
        except BaseException as exc:  # noqa: BLE001 - swarm must never crash on a worker
            await self.telemetry.log_trace(
                run_id=run_id,
                span=f"worker:{packet_id}",
                level="error",
                detail=repr(exc),
                metadata={"generation": generation, "packet_id": packet_id},
            )
            outcome = WorkerOutcome(
                packet_id=packet_id,
                packet=packet,
                success=False,
                approach=packet,
                error_class=type(exc).__name__,
                error_md=f"{packet_id}\n{type(exc).__name__}\nFull trace logged to Raindrop.",
            )
        finally:
            await asyncio.to_thread(modal_session.terminate)
        print(f"[WORKER {packet_id}] terminate: success={outcome.success}")
        return outcome

    async def _invoke_scientist(
        self,
        run_id: str,
        generation: int,
        modal_session: ModalSandboxSession,
        packet_id: str,
        packet: str,
        brief: str,
        ledger: ResearchLedger,
        *,
        plan_path: str,
    ) -> None:
        agent = self._create_scientist_agent(run_id, modal_session, ledger)
        await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Generation {generation} · work packet {packet_id}:\n{packet}\n\n"
                            f"{BLACKBOARD_ROUTE}distilled_brief.md:\n{brief or '(empty)'}\n\n"
                            f"{ledger.avoid_prompt_block()}\n\n"
                            "Write code FILES into the sandbox, then write your approach summary to "
                            f"{BLACKBOARD_ROUTE}{plan_path}. Call check_prior_attempts before "
                            "committing to an approach."
                        ),
                    }
                ]
            },
            config={"configurable": {"thread_id": f"{run_id}:scientist:{packet_id}:{uuid4().hex}"}},
        )

    async def _invoke_developer(
        self,
        run_id: str,
        modal_session: ModalSandboxSession,
        packet_id: str,
        files: str,
        *,
        plan_path: str,
        result_path: str,
        error_path: str,
    ) -> None:
        agent = self._create_developer_agent(run_id, modal_session)
        await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Work packet {packet_id}. The Scientist wrote code into this sandbox.\n\n"
                            f"{BLACKBOARD_ROUTE}{plan_path} describes the files and run command.\n\n"
                            f"Target file state:\n{files}\n\n"
                            "Run the verification command via the execute tool. On success write "
                            f"{BLACKBOARD_ROUTE}{result_path}; on failure write the 3-line "
                            f"{BLACKBOARD_ROUTE}{error_path} and call log_raindrop_error."
                        ),
                    }
                ]
            },
            config={"configurable": {"thread_id": f"{run_id}:developer:{packet_id}:{uuid4().hex}"}},
        )

    async def _run_diagnostic(
        self,
        run_id: str,
        modal_session: ModalSandboxSession,
        packet_id: str,
        error_class: str,
        *,
        plan_path: str,
    ) -> None:
        print(f"[DIAGNOSTIC {packet_id}] spawn: repair env ({error_class})")
        diag_path = f"workers/{packet_id}/diagnostic.md"
        agent = self._create_diagnostic_agent(run_id, modal_session)
        await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Work packet {packet_id} hit an environment error: {error_class}.\n"
                            f"{BLACKBOARD_ROUTE}{plan_path} has the intended run command.\n"
                            "Repair the sandbox environment (install missing deps/tooling) via the "
                            f"execute tool, then write {BLACKBOARD_ROUTE}{diag_path} with the fix."
                        ),
                    }
                ]
            },
            config={"configurable": {"thread_id": f"{run_id}:diagnostic:{packet_id}:{uuid4().hex}"}},
        )

    # ----- Merge + Reviewer -------------------------------------------------
    async def _merge_worker_results(
        self, generation: int, outcomes: list[WorkerOutcome]
    ) -> None:
        successes = [o for o in outcomes if o.success]
        failures = [o for o in outcomes if not o.success]

        lines = [f"# Builder Result (generation {generation})", ""]
        lines.append(f"_{len(successes)}/{len(outcomes)} packets completed._")
        if successes:
            lines.append("\n## Completed packets")
            for outcome in successes:
                lines.append(f"\n### {outcome.packet_id} — {outcome.packet}")
                lines.append(outcome.result_md or "(no detail)")
        if failures:
            lines.append("\n## Failed packets")
            for outcome in failures:
                reason = outcome.error_class or "failure"
                note = " (after diagnostic)" if outcome.diagnostic_ran else ""
                lines.append(f"- {outcome.packet_id} — **{reason}**{note}: {outcome.packet}")
        await self.blackboard.write("builder_result.md", "\n".join(lines) + "\n")

        if failures:
            err_lines = ["# Error Summary", f"- Generation {generation}: {len(failures)} packet(s) failed."]
            for outcome in failures:
                err_lines.append(
                    f"- {outcome.packet_id}: {outcome.error_class or 'failure'} "
                    "(full trace in Raindrop)."
                )
            await self.blackboard.write("error_summary.md", "\n".join(err_lines))
        else:
            await self.blackboard.write("error_summary.md", "")

    async def _run_reviewer(self, run_id: str, generation: int) -> ReviewVerdict:
        if not self.cfg.reviewer_enabled:
            return ReviewVerdict(score=None, accepted=True, raw="")
        print("[REVIEWER] spawn: score against rubric")
        builder_result = await self.blackboard.read("builder_result.md")
        brief = await self.blackboard.read("distilled_brief.md")
        agent = self._create_reviewer_agent()
        await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Generation {generation}. Evaluate the implementation against the rubric "
                            "in your instructions and the user goal.\n\n"
                            f"{BLACKBOARD_ROUTE}distilled_brief.md:\n{brief or '(empty)'}\n\n"
                            f"{BLACKBOARD_ROUTE}builder_result.md:\n{builder_result or '(empty)'}\n\n"
                            f"Write {BLACKBOARD_ROUTE}review.md with SCORE and VERDICT lines."
                        ),
                    }
                ]
            },
            config={"configurable": {"thread_id": f"{run_id}:reviewer:{uuid4().hex}"}},
        )
        review_md = await self.blackboard.read("review.md")
        verdict = _parse_review(review_md, self.cfg.review_pass_score)
        print(f"[REVIEWER] verdict: accepted={verdict.accepted} score={verdict.score}")
        return verdict

    # ----- Research ledger --------------------------------------------------
    def _ledger_path(self, run_id: str) -> Path:
        return self.cfg.workspace_root / ".research" / run_id / "ledger.json"

    def _load_ledger(self, run_id: str) -> ResearchLedger:
        if not self.cfg.ledger_enabled:
            return ResearchLedger(similarity_threshold=self.cfg.ledger_similarity_threshold)
        return ResearchLedger.load_json(
            self._ledger_path(run_id),
            similarity_threshold=self.cfg.ledger_similarity_threshold,
        )

    async def _publish_ledger(self, ledger: ResearchLedger) -> None:
        await self.blackboard.write("ledger.md", ledger.to_markdown())

    async def _record_ledger(
        self,
        run_id: str,
        generation: int,
        outcomes: list[WorkerOutcome],
        ledger: ResearchLedger,
    ) -> None:
        if not self.cfg.ledger_enabled:
            return
        for outcome in outcomes:
            ledger.record(
                Attempt.create(
                    attempt_id=uuid4().hex,
                    packet_id=outcome.packet_id,
                    generation=generation,
                    approach=outcome.approach or outcome.packet,
                    outcome="success" if outcome.success else "failure",
                    error_class=outcome.error_class,
                    detail=outcome.error_md,
                )
            )
        await asyncio.to_thread(ledger.save_json, self._ledger_path(run_id))
        await self._publish_ledger(ledger)

    async def _run_post_mortem(self, run_id: str, generation: int) -> None:
        print("[POST-MORTEM] summarize: Raindrop telemetry")
        root_cause = await self.telemetry.summarize_run(run_id)
        await self.blackboard.append(
            "retrospective.md",
            f"- {_utcstamp()} generation {generation}: {root_cause}",
        )

    # ----- Agent factories --------------------------------------------------
    def _create_parent_agent(self) -> AgentGraph:
        return create_deep_agent_checked(
            model=self.cfg.model,
            system_prompt=_read_text(_PI_PROMPT_PATH),
            tools=[],
            subagents=self._subagent_specs(),
            memory=[_MEMORY_PATH],
            backend=self._deepagents_backend(),
        )

    def _create_planner_agent(self, submit_work_packets: Any) -> AgentGraph:
        return create_deep_agent_checked(
            model=self.cfg.model,
            system_prompt=_read_text(_PI_PROMPT_PATH),
            tools=[submit_work_packets],
            memory=[_MEMORY_PATH],
            backend=self._deepagents_backend(),
        )

    def _create_filter_agent(self, run_id: str, graph: KnowledgeGraph) -> AgentGraph:
        spec = load_subagent_by_name(_SUBAGENTS_DIR, "filter")

        async def write_blackboard(name: str, content: str) -> None:
            await self.blackboard.write(name, content)

        literature_tools = create_literature_tools(
            run_id=run_id,
            graph=graph,
            cfg=self.cfg,
            telemetry=self.telemetry,
            blackboard_writer=write_blackboard,
        )
        return create_deep_agent_checked(
            model=spec.get("model", self.cfg.model),
            system_prompt=spec["system_prompt"],
            tools=literature_tools,
            memory=[_MEMORY_PATH],
            backend=self._deepagents_backend(),
        )

    def _create_scientist_agent(
        self, run_id: str, modal_session: ModalSandboxSession, ledger: ResearchLedger
    ) -> AgentGraph:
        spec = load_subagent_by_name(_SUBAGENTS_DIR, "scientist")
        tools = [self._log_raindrop_error_tool(run_id, "scientist")]
        tools.extend(create_ledger_tools(ledger=ledger))
        return create_deep_agent_checked(
            model=spec.get("model", self.cfg.model),
            system_prompt=spec["system_prompt"],
            tools=tools,
            middleware=[ExecuteTelemetryMiddleware(run_id=run_id, telemetry=self.telemetry)],
            memory=[_MEMORY_PATH],
            backend=modal_session.builder_backend(blackboard_root=str(self.blackboard.root)),
        )

    def _create_developer_agent(
        self, run_id: str, modal_session: ModalSandboxSession
    ) -> AgentGraph:
        spec = load_subagent_by_name(_SUBAGENTS_DIR, "developer")
        return create_deep_agent_checked(
            model=spec.get("model", self.cfg.model),
            system_prompt=spec["system_prompt"],
            tools=[self._log_raindrop_error_tool(run_id, "developer")],
            middleware=[ExecuteTelemetryMiddleware(run_id=run_id, telemetry=self.telemetry)],
            memory=[_MEMORY_PATH],
            backend=modal_session.builder_backend(blackboard_root=str(self.blackboard.root)),
        )

    def _create_diagnostic_agent(
        self, run_id: str, modal_session: ModalSandboxSession
    ) -> AgentGraph:
        spec = load_subagent_by_name(_SUBAGENTS_DIR, "diagnostic")
        return create_deep_agent_checked(
            model=spec.get("model", self.cfg.model),
            system_prompt=spec["system_prompt"],
            tools=[self._log_raindrop_error_tool(run_id, "diagnostic")],
            middleware=[ExecuteTelemetryMiddleware(run_id=run_id, telemetry=self.telemetry)],
            memory=[_MEMORY_PATH],
            backend=modal_session.builder_backend(blackboard_root=str(self.blackboard.root)),
        )

    def _create_reviewer_agent(self) -> AgentGraph:
        spec = load_subagent_by_name(_SUBAGENTS_DIR, "reviewer")
        return create_deep_agent_checked(
            model=spec.get("model", self.cfg.model),
            system_prompt=spec["system_prompt"],
            tools=[],
            memory=[_MEMORY_PATH],
            backend=self._deepagents_backend(),
        )

    def _log_raindrop_error_tool(self, run_id: str, span: str) -> Any:
        async def log_raindrop_error(detail: str) -> str:
            """Log full error detail to Raindrop without returning that detail to the agent."""
            await self.telemetry.log_trace(
                run_id=run_id, span=span, level="error", detail=detail
            )
            return "Full error detail logged to Raindrop."

        return log_raindrop_error

    # ----- Literature graph persistence -------------------------------------
    def _literature_graph_path(self, run_id: str) -> Path:
        return self.cfg.workspace_root / ".research" / run_id / "literature_graph.json"

    def _load_literature_graph(self, run_id: str) -> KnowledgeGraph:
        return KnowledgeGraph.load_json(self._literature_graph_path(run_id))

    async def _finalize_literature_graph(self, run_id: str, graph: KnowledgeGraph) -> None:
        if not graph.papers:
            return
        graph.save_json(self._literature_graph_path(run_id))
        bib_path = self.cfg.workspace_root / ".research" / run_id / "references.bib"
        bib_path.parent.mkdir(parents=True, exist_ok=True)
        bib_path.write_text(graph.to_bibtex(), encoding="utf-8")
        await self.blackboard.write("literature_graph.md", graph.to_markdown())
        await self.blackboard.write("citations.md", graph.to_citations_markdown())

    def _subagent_specs(self) -> list[dict[str, Any]]:
        return load_subagents_dir(_SUBAGENTS_DIR)

    def _deepagents_backend(self) -> Any:
        return blackboard_backend(blackboard_root=str(self.blackboard.root))

    async def _enforce_brief_limit(self) -> None:
        text = await self.blackboard.read("distilled_brief.md")
        words = text.split()
        if len(words) <= self.cfg.distilled_word_limit:
            return
        clipped = " ".join(words[: self.cfg.distilled_word_limit])
        await self.blackboard.write(
            "distilled_brief.md",
            clipped + "\n\n<!-- clipped to configured word limit -->\n",
        )

    async def _target_file_state(self) -> str:
        files = sorted(
            path for path in self.blackboard.root.glob("*.md") if path.name in self.blackboard.visible_files
        )
        parts = []
        for path in files:
            parts.append(
                f"## {BLACKBOARD_ROUTE}{path.name}\n{await self.blackboard.read(path.name)}"
            )
        return "\n\n".join(parts) or "No target files exist yet."


def create_deep_agent_checked(**kwargs: Any) -> AgentGraph:
    try:
        from deepagents import create_deep_agent
    except ImportError as exc:
        raise RuntimeError("Install `deepagents` before constructing the swarm.") from exc
    return create_deep_agent(**kwargs)


# ----- parsing helpers ------------------------------------------------------
def _extract_text(response: Any) -> str:
    messages = response.get("messages", []) if isinstance(response, Mapping) else []
    if not messages:
        return str(response)
    last = messages[-1]
    content = getattr(last, "content", None)
    if content is None and isinstance(last, Mapping):
        content = last.get("content")
    return str(content)


def _extract_approach(plan_md: str, *, fallback: str) -> str:
    for line in plan_md.splitlines():
        if "approach" in line.lower():
            text = re.sub(r"^[\s\d.*#>\-]*", "", line)
            text = re.sub(r"(?i)approach\**\s*[—:\-]*\s*", "", text, count=1).strip()
            if text:
                return text[:300]
    stripped = plan_md.strip()
    return stripped[:300] if stripped else fallback


def _extract_error_class(error_md: str) -> str:
    if not error_md.strip():
        return ""
    lines = [line.strip() for line in error_md.splitlines() if line.strip()]
    for line in lines:
        match = re.search(r"([A-Za-z_]*Error|CUDA[^\n]*|TimeoutError|command not found)", line)
        if match:
            return match.group(1)[:60]
    return lines[1][:60] if len(lines) >= 2 else lines[0][:60]


def _is_environment_error(error_class: str, error_md: str) -> bool:
    blob = f"{error_class}\n{error_md}".lower()
    return any(token in blob for token in _ENV_ERROR_TOKENS)


def _parse_review(review_md: str, pass_score: float) -> ReviewVerdict:
    score: float | None = None
    verdict_accept: bool | None = None
    for line in review_md.splitlines():
        stripped = line.strip()
        lowered = stripped.lower()
        if lowered.startswith("score:"):
            match = re.search(r"([0-9]*\.?[0-9]+)", stripped)
            if match:
                try:
                    score = float(match.group(1))
                except ValueError:
                    score = None
        elif lowered.startswith("verdict:"):
            verdict_accept = "accept" in lowered
    if verdict_accept is None:
        accepted = score is not None and score >= pass_score
    else:
        accepted = verdict_accept
    return ReviewVerdict(score=score, accepted=accepted, raw=review_md.strip())
