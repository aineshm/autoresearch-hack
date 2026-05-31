# Autoresearch Orchestrator — Agent Personas

This directory implements a **hierarchical, token-efficient Deep Agents swarm** using the
[`deepagents`](https://docs.langchain.com/oss/python/deepagents/) library. A **Principal
Investigator** sets strategy and decomposes the goal into work packets; a middle **swarm of
parallel Scientist+Developer worker pairs** implements them; an independent **Reviewer** scores
the result; and a **Research Ledger** provides long-term memory so the swarm never retries a
near-duplicate of a known-failed approach.

Context isolation is enforced: agents communicate only through markdown files on a shared
`MarkdownBlackboard`. Code lives in Modal sandboxes; raw detail lives in Raindrop and JSON stores.

---

## Architecture Overview

```
user goal + raw materials
        │
        ▼
   [Filter]  ── literature review → distilled_brief.md / literature_graph.md / citations.md
        │
        ▼
[Principal Investigator]  ── write_todos + submit_work_packets → N independent work packets
        │  fan-out (asyncio.gather, bounded by worker_concurrency)
        ├─► Worker p1: [Scientist writes code → Developer runs it]   ← own Modal sandbox
        ├─► Worker p2: [Scientist → Developer]                        ← own Modal sandbox
        └─► Worker pN: ...   │ environment error? → [Diagnostic] repairs sandbox → retry once
        │  merge worker results
        ▼
   [Reviewer]  ── scores builder_result.md vs rubric → review.md (SCORE + VERDICT: accept|revise)
        │
        ▼
   [Research Ledger]  ── records every attempt; failed approach signatures block near-dup retries
        │  loop until VERDICT accept AND no errors, or max_generations
        ▼
[Principal Investigator]  ── final compact user-facing summary
```

Three pillars of "moving beyond simple iteration", all on deepagents primitives:

- **Hierarchical multi-agent system** — PI (strategy) → Scientist (writes code) + Developer
  (runs it) → Reviewer (independent rubric).
- **Advanced memory** — ephemeral per-agent context (flushed every invocation) vs. the durable
  **Research Ledger** (`.research/<run_id>/ledger.json`) of attempted approaches.
- **Dynamic planning** — the Developer can pause into a **Diagnostic sub-loop** to repair the
  sandbox environment, then resume; the Reviewer's verdict and the ledger steer the next generation.

---

## Shared Conventions

- **Markdown-only exchange.** `MarkdownBlackboard` only allows `.md` files. Code is never written
  to the blackboard — it lives in the Modal sandbox. Workers use `workers/<packet>/*.md` namespaces.
- **Context budget is the highest priority.** Never pass raw logs, raw papers, raw traces, or full
  stdout/stderr to any agent context.
- **Raindrop absorbs raw detail.** Full error text → `RaindropTelemetry`; agents receive only
  short, compressed summaries.
- **Ledger raw vs. distilled.** Full attempt records live in `ledger.json`; only the compact
  `ledger.md` (an "avoid list") is published to the blackboard.
- **Modal executes all code.** Scientist + Developer share one `langchain_modal.ModalSandbox` per
  worker. Full command output goes to Raindrop via `ExecuteTelemetryMiddleware`.
- Each agent is spawned with a **unique `thread_id`** (`{run_id}:{role}:{uuid}`, workers include
  the packet id) so LangGraph checkpointing never bleeds context between invocations.

---

## deepagents API Quick Reference

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    model="openai:gpt-5.4",                     # model string (per-subagent override via frontmatter)
    system_prompt="...",                         # persona seed (PI: agents/personas/principal_investigator.md)
    tools=[my_async_fn],                         # plain async callables
    subagents=[                                  # loaded from .deepagents/agents/*/AGENTS.md
        {"name": "filter", "description": "...", "system_prompt": "...", "tools": []},
    ],
    middleware=[ExecuteTelemetryMiddleware(...)],# compresses execute output, logs failures
    backend=FilesystemBackend(root_dir=str(blackboard.root), virtual_mode=True),
    memory=["./AGENTS.md"],                      # project memory injected at startup
)

await agent.ainvoke(
    {"messages": [{"role": "user", "content": "..."}]},
    config={"configurable": {"thread_id": f"{run_id}:{role}:{uuid}"}},
)
```

`create_deep_agent` is wrapped by `create_deep_agent_checked` in `agents/swarm.py` which raises a
clear `RuntimeError` if `deepagents` is not installed. Primitives used across the swarm:
`write_todos`, `task` (parent delegation), filesystem tools, `execute` (Modal), custom tools,
`middleware`, and `memory`.

---

## Persona: Principal Investigator (PI)

**Files:** `agents/personas/principal_investigator.md` (system prompt) +
`AutoresearchSwarm._create_parent_agent()` (final synthesis) and `._create_planner_agent()` (planning).

The PI is the only long-lived control persona. It never reads raw material — only distilled
blackboard files. Two modes:

- **Planning** — given `distilled_brief.md` + `ledger.md` (+ any prior `review.md` /
  `builder_result.md`), it calls `write_todos` then `submit_work_packets([...])` to emit up to
  `max_workers` independent work packets. The swarm captures the list deterministically and writes
  `plan.md`.
- **Synthesis** — at the end of all generations, it reads only the parent-visible files and returns
  the final compact, user-facing summary.

**Readable blackboard files** (`parent_visible_files` in `config.py`): `distilled_brief.md`,
`literature_graph.md`, `citations.md`, `plan.md`, `builder_result.md`, `review.md`, `ledger.md`,
`error_summary.md`, `retrospective.md`.

**Tools:** `submit_work_packets` (planning mode only) + built-in `task`/`write_todos`.

---

## Persona: Filter

**File:** `.deepagents/agents/filter/AGENTS.md`

Short-lived literature-review + raw-token sink. Searches arXiv (primary) then Google Scholar,
enriches DOIs/citation edges (CrossRef + Semantic Scholar), builds a `KnowledgeGraph`, and writes:

- `citations.md` — numbered APA bibliography (source of truth for `[n]` keys)
- `literature_graph.md` — Mermaid graph with `cites` edges
- `distilled_brief.md` — synthesis (≤500 words) with inline `[n]` citation keys

Full BibTeX/JSON live under `.research/<run_id>/`. Invoked directly each generation (not via PI
`task`) for strict context isolation.

**Literature tools (async):** `search_arxiv_literature`, `search_google_scholar_literature`,
`enrich_literature_citations`, `get_citation_bibliography`, `render_literature_knowledge_graph`,
`get_literature_graph_summary`.

---

## Middle swarm: Scientist + Developer worker pairs

The PI's packets are executed by **parallel worker pairs** (`asyncio.gather`, bounded by
`worker_concurrency`). Each worker owns one Modal sandbox shared by its Scientist and Developer.

### Persona: Scientist

**File:** `.deepagents/agents/scientist/AGENTS.md` · **Factory:**
`_create_scientist_agent(run_id, modal_session, ledger)`

Receives one work packet + `distilled_brief.md` + the ledger avoid-list. **Writes code files into
the sandbox** (built-in filesystem tools + `execute`). Before committing to an approach it calls
`check_prior_attempts` to avoid known dead ends. Writes `workers/<packet>/plan.md` (Approach, Files
written, How to run, Risks). The **Approach line is recorded in the ledger.**

**Tools:** `check_prior_attempts`, `list_failed_approaches` (read-only ledger), `log_raindrop_error`.
**Middleware:** `ExecuteTelemetryMiddleware`. **Backend:** Modal composite (`/blackboard/` → files).

### Persona: Developer

**File:** `.deepagents/agents/developer/AGENTS.md` · **Factory:**
`_create_developer_agent(run_id, modal_session)`

Runs and verifies the Scientist's code via the `execute` tool in the same sandbox. On success →
`workers/<packet>/result.md` (Outcome, Verification, Artifacts). On failure → 3-line
`workers/<packet>/error.md` (packet id / semantic error type / Raindrop pointer) and
`log_raindrop_error`. Makes at most one small fix before failing.

### Persona: Diagnostic (dynamic planning sub-loop)

**File:** `.deepagents/agents/diagnostic/AGENTS.md` · **Factory:**
`_create_diagnostic_agent(run_id, modal_session)`

Triggered when a Developer error is classified as **environment-level** (`ModuleNotFoundError`,
missing system package, CUDA/runtime, "command not found", etc. — see `_is_environment_error`).
Repairs the sandbox (e.g. `pip install`) via `execute`, writes `workers/<packet>/diagnostic.md`,
then the Developer is re-invoked once (`diagnostic_max_attempts`).

---

## Persona: Reviewer

**File:** `.deepagents/agents/reviewer/AGENTS.md` · **Factory:** `_create_reviewer_agent()`

Independent evaluator. Reads only `builder_result.md` + `distilled_brief.md` + the rubric. Scores
four criteria (goal coverage, verification, correctness signals, completeness) and writes
`review.md` with exact `SCORE: <0..1>` and `VERDICT: accept|revise` lines plus required revisions.
The swarm parses the verdict (`_parse_review`); a missing verdict falls back to
`SCORE >= review_pass_score`. Disable with `AUTORESEARCH_REVIEWER_ENABLED=false`.

---

## Research Ledger (long-term memory)

**Module:** `backend/ledger/` (`models.py`, `tools.py`). **Raw store:**
`.research/<run_id>/ledger.json`. **Blackboard view:** `ledger.md`.

Append-only record of every `Attempt` (packet, generation, approach, outcome, error class).
`ResearchLedger.find_blocking_failure()` flags a proposed approach as blocked when its content-word
**Jaccard similarity** to a prior *failed* approach exceeds `ledger_similarity_threshold` (default
`0.8`; stopwords stripped so phrasing boilerplate doesn't inflate similarity). The swarm records
outcomes after each worker; agents may only **read** the ledger via `check_prior_attempts` /
`list_failed_approaches`.

---

## Blackboard (`MarkdownBlackboard`)

```python
blackboard = MarkdownBlackboard(root=cfg.workspace_root, visible_files=cfg.parent_visible_files)
```

| Method | Behaviour |
|--------|-----------|
| `write(name, content)` | Overwrites `name` (supports `workers/<p>/x.md` subpaths); raises if not `.md` or path escapes root. |
| `read(name)` | Returns content or `""` if absent. |
| `append(name, content)` | Appends with blank-line separator. |
| `parent_context()` | Concatenates all `visible_files` into one markdown string for the PI. |

Path safety: absolute paths and `..` traversal are rejected. `virtual_mode=True` on
`FilesystemBackend` enforces the same boundary inside deepagents.

---

## Generations Loop

```python
ledger = load_ledger(run_id)                         # long-term memory persists across generations
for generation in range(1, cfg.max_generations + 1): # default: 3
    await _run_filter(run_id, goal, raw)             # → distilled_brief.md (+ literature graph)
    packets = await _plan_work_packets(...)          # PI: write_todos + submit_work_packets → plan.md
    outcomes = await _run_workers(...)               # parallel Scientist→Developer (+Diagnostic)
    await _merge_worker_results(generation, outcomes)# → builder_result.md / error_summary.md
    await _record_ledger(...)                         # append attempts → ledger.json + ledger.md
    review = await _run_reviewer(...)                # → review.md (SCORE + VERDICT)
    await _run_post_mortem(...)                       # Raindrop → retrospective.md
    if not error_summary.strip() and review.accepted:
        break
# PI produces final_summary from parent-visible blackboard files
```

---

## Experiment Mode (`program.md` training-research loop)

An additive mode for autonomous training research à la
[karpathy/autoresearch](https://github.com/karpathy/autoresearch): given a repo with a
`program.md` contract, run the keep/discard loop with the swarm's brain (ledger memory +
literature ideas + metric gate). It does **not** disturb the general-purpose hierarchy.

```bash
python main.py --experiment-repo /path/to/autoresearch [--max-experiments N]
```

Entry point `agents/experiment_swarm.py::ExperimentSwarm.run(repo_path)`:

1. `ExperimentSpec.from_repo()` reads `program.md` verbatim and extracts machine-actionable
   fields (metric + direction, run command, editable vs read-only files, "no install" constraint).
2. Run the editable file as-is → **baseline** metric; current commit is the kept anchor.
3. Loop: the **Experimenter** deep agent (`.deepagents/agents/experimenter/AGENTS.md`) proposes one
   change to the editable file (consulting the ledger via `check_prior_attempts`) and submits the
   full file via `submit_experiment`. The change is committed and run.
4. **Keep/discard:** if the metric improves (lower `val_bpb`) the branch advances; otherwise
   `git reset --hard` to the last kept commit. Crashes (no metric) are reverted and logged.
5. Every attempt is appended to `results.tsv` (`commit / val_bpb / memory_gb / keep|discard|crash /
   description`) and the **research ledger**, so near-duplicate failed ideas are skipped.

Differences from the general hierarchy (intentional, documented exceptions):

- **Code runs locally**, not in Modal — the reference loop is designed to run on the GPU box and
  edit a real git repo. Execution is behind an `ExperimentRunner` (`LocalSubprocessRunner` for the
  GPU box, `FakeRunner` for tests, swappable for a GPU Modal sandbox).
- **Persistent code state** lives in the git working tree (kept vs reset), not the markdown blackboard.
- The Experimenter is locked to the editable file and must not install packages (enforced by spec +
  prompt), per `program.md` constraints.

Module layout: `backend/experiment/{spec,metrics,workspace,results,runner}.py`. Offline end-to-end
check (temp git repo + `FakeRunner`, no GPU/LLM): `scripts/smoke_experiment.py`.

---

## Configuration (`config.py` / environment)

| Env var | Default | Purpose |
|---------|---------|---------|
| `AUTORESEARCH_MODEL` | `openai:gpt-5.4` | Model string passed to `create_deep_agent` |
| `AUTORESEARCH_WORKSPACE` | `.autoresearch_workspace` | Blackboard root on disk |
| `AUTORESEARCH_MAX_GENERATIONS` | `3` | Maximum Filter→workers→Reviewer iterations |
| `DISTILLED_BRIEF_WORD_LIMIT` | `500` | Hard word cap on `distilled_brief.md` |
| `AUTORESEARCH_MAX_WORKERS` | `3` | Max work packets the PI may emit per generation |
| `AUTORESEARCH_WORKER_CONCURRENCY` | `3` | Max worker pairs running in parallel |
| `AUTORESEARCH_REVIEWER_ENABLED` | `true` | Toggle the Reviewer gate |
| `AUTORESEARCH_REVIEW_PASS_SCORE` | `0.7` | Fallback accept threshold if no `VERDICT` line |
| `AUTORESEARCH_LEDGER_ENABLED` | `true` | Toggle the research ledger |
| `AUTORESEARCH_LEDGER_SIMILARITY` | `0.8` | Jaccard threshold to block a near-duplicate approach |
| `AUTORESEARCH_DIAGNOSTIC_ENABLED` | `true` | Toggle the environment-repair sub-loop |
| `AUTORESEARCH_DIAGNOSTIC_ATTEMPTS` | `1` | Developer retries after a diagnostic repair |
| `AUTORESEARCH_EXPERIMENT_TIMEOUT` | `600` | Per-run kill ceiling for experiment mode (seconds) |
| `AUTORESEARCH_MAX_EXPERIMENTS` | `100` | Experiment-mode budget (keep/discard iterations) |
| `AUTORESEARCH_EXPERIMENT_BRANCH` | — | Optional git branch to run experiments on |
| `AUTORESEARCH_EXPERIMENT_LITERATURE` | `false` | Reserved: seed experiment ideas with a literature pass |
| `LITERATURE_ARXIV_MAX_RESULTS` | `8` | Default max arXiv hits per search tool call |
| `LITERATURE_SCHOLAR_MAX_RESULTS` | `5` | Default max Google Scholar hits per search tool call |
| `LITERATURE_SCHOLAR_ENABLED` | `true` | Toggle Google Scholar search |
| `LITERATURE_ENRICH_CITATIONS` | `true` | Auto-enrich after search (CrossRef + Semantic Scholar) |
| `LITERATURE_SEMANTIC_SCHOLAR_ENABLED` | `true` | Fetch references and citation counts |
| `LITERATURE_CROSSREF_ENABLED` | `true` | Resolve missing DOIs via CrossRef title lookup |
| `LITERATURE_CROSSREF_MAILTO` | `autoresearch@example.com` | Contact email for CrossRef polite pool |
| `LITERATURE_S2_REFERENCE_LIMIT` | `3` | Max reference papers pulled per enriched paper |
| `MODAL_APP_NAME` | `autoresearch-swarm-runtime` | Modal app for sandboxed execution |
| `MODAL_TIMEOUT_SECONDS` | `300` | Per-sandbox Modal timeout |
| `MODAL_PYTHON_VERSION` | `3.12` | Python version inside Modal image |
| `RAINDROP_ENABLED` | `true` | Toggle telemetry (set `false` in tests) |
| `RAINDROP_API_KEY` | — | Auth for Raindrop ingestion API |
| `RAINDROP_BASE_URL` | `http://127.0.0.1:8080` | Raindrop server endpoint |

---

## File Layout

```
autoresearch-orchestrator/
  AGENTS.md                    ← project memory (memory=["./AGENTS.md"]) + this contract
  .deepagents/agents/
    filter/AGENTS.md           ← Filter subagent spec
    scientist/AGENTS.md        ← Scientist subagent spec (writes code)
    developer/AGENTS.md        ← Developer subagent spec (runs code)
    diagnostic/AGENTS.md       ← Diagnostic subagent spec (repairs sandbox env)
    reviewer/AGENTS.md         ← Reviewer subagent spec (rubric scoring)
    experimenter/AGENTS.md     ← Experimenter subagent spec (program.md idea proposer)
  agents/
    personas/
      principal_investigator.md ← PI system prompt (planning + synthesis)
    subagent_loader.py         ← loads .deepagents/agents/*/AGENTS.md
    swarm.py                   ← AutoresearchSwarm, MarkdownBlackboard, RaindropTelemetry,
                               │  worker orchestration, parsing helpers
    experiment_swarm.py        ← ExperimentSwarm (program.md keep/discard loop)
  backend/
    literature/                ← arXiv/Scholar/CrossRef/Semantic Scholar, KnowledgeGraph, tools
    ledger/
      models.py                ← Attempt + ResearchLedger (signatures, near-dup detection)
      tools.py                 ← read-only ledger tools for the Scientist
    experiment/
      spec.py                  ← ExperimentSpec (parses program.md)
      metrics.py               ← run-log metric/memory parsing + improvement comparison
      workspace.py             ← git-backed keep/advance/revert
      results.py               ← results.tsv writer
      runner.py                ← Local/Fake experiment runners (swappable for GPU Modal)
    modal_runtime.py           ← ModalSandboxSession (langchain_modal + CompositeBackend)
    execute_telemetry.py       ← compresses execute output; logs failures to Raindrop
  scripts/
    smoke_experiment.py        ← offline end-to-end test of experiment mode
```

### Adding a new agent persona

1. Update this `AGENTS.md` first — it is the source of truth.
2. Write its spec under `.deepagents/agents/<name>/AGENTS.md` (YAML frontmatter + prompt body).
3. Add a `_create_<name>_agent()` on `AutoresearchSwarm` loading the spec via `load_subagent_by_name()`.
4. The PI picks it up automatically via `load_subagents_dir()`. Wire its invocation into the `run()`
   loop (and the worker pipeline if it is a middle-layer agent).
5. Update `config.py` for any new settings; update the config table above.
