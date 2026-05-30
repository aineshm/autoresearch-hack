# Autoresearch Orchestrator — Design & Reproduction Specification

> This document is written so that an engineer (or agent) with no prior context can **recreate the
> system from scratch**. It describes what the system can do, what it must do (invariants), how every
> component works (with real signatures and data contracts), and how to build, run, and test it.

---

## 1. What this system is

A **hierarchical, token-efficient multi-agent research swarm** built on the
[`deepagents`](https://docs.langchain.com/oss/python/deepagents/) harness (LangChain/LangGraph
runtime). It has two operating modes that share the same primitives:

- **General mode** — a Principal Investigator decomposes a goal into work packets; a swarm of
  parallel Scientist+Developer worker pairs implements them in Modal sandboxes; an independent
  Reviewer scores the result; a Research Ledger remembers failures so dead ends are never retried.
- **Experiment mode** — runs an autonomous "edit → train → keep/discard" loop defined by a repo's
  `program.md` (the [karpathy/autoresearch](https://github.com/karpathy/autoresearch) contract),
  using git for persistent code state and a metric (e.g. `val_bpb`) to decide keep vs. revert.

### Capabilities (what it can do)
- Run a literature review (arXiv → Google Scholar → CrossRef → Semantic Scholar), build a citation
  **knowledge graph**, and emit APA/BibTeX bibliographies.
- Decompose a goal and run **N implementation workers in parallel**, each in its own sandbox.
- Execute and verify code in isolated **Modal sandboxes** (general mode) or locally (experiment mode).
- **Self-repair** sandbox environments (install missing deps) via a Diagnostic sub-loop.
- Score results against a rubric and **iterate** across generations until accepted.
- Maintain **long-term memory** of attempted approaches with near-duplicate failure blocking.
- Run a karpathy-style **keep/discard training loop** end-to-end, writing `results.tsv`.
- Keep **raw detail out of model context** at all times (telemetry → Raindrop; ledger raw → JSON).

---

## 2. What it must do (invariants & non-goals)

These are hard constraints. Violating any of them is a bug.

1. **Markdown-only agent exchange.** Agents communicate only via `.md` files on the blackboard.
   `MarkdownBlackboard.write()` rejects non-`.md`. Code lives in sandboxes / git, never the blackboard.
2. **Raw detail never enters agent context.** Full logs, stack traces, raw papers, full command
   output go to `RaindropTelemetry` (and JSON stores). Agents receive short summaries only.
3. **Context budget is paramount.** The parent agent reads only a fixed allowlist of distilled files.
4. **Modal executes all code in general mode.** Code runs in `langchain_modal.ModalSandbox`; full
   output is compressed by `ExecuteTelemetryMiddleware`. (Experiment mode runs locally by design —
   the only documented exception, because that loop is meant to run on the GPU box.)
5. **Unique `thread_id` per invocation:** `f"{run_id}:{role}:{uuid4().hex}"` (workers add the packet
   id). LangGraph checkpoints must never bleed context between invocations.
6. **Workers are stateless and isolated** — each writes only to its `workers/<packet>/` namespace and
   its sandbox; it never mutates config or spawns further subagents.
7. **The ledger is append-only and query-only for agents** — the swarm records outcomes; agents may
   only read it.

Non-goals: the parent never inspects raw material; Raindrop is observability only (not a prompt
store); Modal is not a general shell; agents do not persist conversational memory across invocations
(durable memory lives only in the ledger / git).

---

## 3. Repository layout

```
autoresearch-orchestrator/
  main.py                        ← CLI entry point (general goal OR --experiment-repo)
  config.py                      ← Settings dataclass; all env vars (single source of truth)
  AGENTS.md                      ← project memory (memory=["./AGENTS.md"]) + persona contracts
  DESIGN.md                      ← this document
  requirements.txt               ← deepagents, langchain*, modal, langchain-modal, scholarly
  .env.example                   ← documented environment template

  agents/
    personas/principal_investigator.md   ← PI system prompt (planning + synthesis)
    subagent_loader.py                   ← parse .deepagents/agents/*/AGENTS.md -> subagent spec
    swarm.py                             ← AutoresearchSwarm (general mode) + shared infra
    experiment_swarm.py                  ← ExperimentSwarm (program.md keep/discard loop)

  .deepagents/agents/            ← subagent specs (YAML frontmatter + markdown body)
    filter/AGENTS.md             ← literature review -> distilled brief
    scientist/AGENTS.md          ← writes code into sandbox
    developer/AGENTS.md          ← runs/verifies code
    diagnostic/AGENTS.md         ← repairs sandbox environment
    reviewer/AGENTS.md           ← rubric scoring
    experimenter/AGENTS.md       ← program.md idea proposer

  backend/
    modal_runtime.py             ← ModalSandboxSession, composite backends, BLACKBOARD_ROUTE
    execute_telemetry.py         ← ExecuteTelemetryMiddleware (compress execute output)
    literature/
      models.py                  ← Paper, KnowledgeGraph
      citations.py               ← APA / BibTeX / inline formatting
      arxiv_client.py            ← arXiv Atom API
      scholar_client.py          ← Google Scholar via scholarly
      crossref_client.py         ← DOI lookup by title
      semantic_scholar_client.py ← references + citation counts
      enrichment.py              ← batch DOI/citation enrichment
      tools.py                   ← create_literature_tools() factory (Filter tools)
    ledger/
      models.py                  ← Attempt, ResearchLedger (signatures, near-dup detection)
      tools.py                   ← create_ledger_tools() (read-only query tools)
    experiment/
      spec.py                    ← ExperimentSpec.from_repo (parses program.md)
      metrics.py                 ← parse_log, is_improvement, MetricReading
      workspace.py               ← ExperimentWorkspace (git keep/advance/revert)
      results.py                 ← ResultsTsv, ResultRow
      runner.py                  ← ExperimentRunner protocol; Local/Fake runners

  scripts/
    smoke_experiment.py          ← offline end-to-end test (temp git repo + FakeRunner)
```

---

## 4. Core data contracts

### 4.1 Blackboard files (general mode)
The blackboard root is `Settings.workspace_root` (default `.autoresearch_workspace`). Files visible
to the parent (`Settings.parent_visible_files`):

| File | Producer | Contents |
|------|----------|----------|
| `distilled_brief.md` | Filter | ≤500-word synthesis with inline `[n]` citation keys |
| `literature_graph.md` | Filter | Mermaid knowledge graph + bibliography |
| `citations.md` | Filter | Numbered APA references |
| `plan.md` | PI planner | Work-packet list |
| `builder_result.md` | swarm merge | Per-packet outcomes (merged worker results) |
| `review.md` | Reviewer | `SCORE` + `VERDICT: accept|revise` + revisions |
| `ledger.md` | swarm | Compact "avoid list" rendered from the research ledger |
| `error_summary.md` | swarm merge | Present (non-empty) iff any packet failed |
| `retrospective.md` | post-mortem | Append-only micro-log of root causes |

Worker-internal files (NOT parent-visible): `workers/<packet>/plan.md`, `.../result.md`,
`.../error.md`, `.../diagnostic.md`.

### 4.2 Raw stores (never read by agents)
- Telemetry spool: `workspace_root/.telemetry/<run_id>.jsonl`
- Literature graph + bib: `workspace_root/.research/<run_id>/literature_graph.json`, `references.bib`
- Research ledger: `workspace_root/.research/<run_id>/ledger.json`

### 4.3 Path prefix routing
`BLACKBOARD_ROUTE = "/blackboard/"`. Inside agents, blackboard files are addressed as
`/blackboard/<name>.md`; a `CompositeBackend` routes that prefix to a `FilesystemBackend` rooted at
the blackboard, while the default route is either agent state (general/Filter/Reviewer/PI) or the
Modal sandbox (Scientist/Developer/Diagnostic).

---

## 5. deepagents integration

All agents are created through one checked wrapper (raises a clear error if `deepagents` is missing):

```python
def create_deep_agent_checked(**kwargs):
    from deepagents import create_deep_agent
    return create_deep_agent(**kwargs)
```

`create_deep_agent(...)` is called with: `model` (e.g. `"openai:gpt-5.4"`), `system_prompt`,
`tools` (plain async callables), optional `subagents` (list of dict specs), optional `middleware`,
`memory=["./AGENTS.md"]`, and `backend`. Invocation is always:

```python
await agent.ainvoke(
    {"messages": [{"role": "user", "content": "..."}]},
    config={"configurable": {"thread_id": f"{run_id}:{role}:{uuid4().hex}"}},
)
```

Built-in primitives relied upon: `write_todos` (planning), `task` (parent→subagent delegation),
filesystem tools (`read_file`/`write_file`/`glob`/`grep`), and `execute` (sandbox command runner).

### 5.1 Subagent loader (`agents/subagent_loader.py`)
Each subagent is a folder `.deepagents/agents/<name>/AGENTS.md` with YAML-ish frontmatter and a
markdown body:

```markdown
---
name: scientist
description: one-line description used by the parent for delegation
model: openai:gpt-5.4          # optional; overrides the main model
---
<the markdown body becomes the subagent's system_prompt>
```

- `load_subagent(path) -> {"name","description","system_prompt", ["model"]}` — parses frontmatter
  (lines `key: value`, quotes stripped) and body; requires `name` + `description`.
- `load_subagents_dir(dir) -> list[spec]` — every immediate subfolder containing `AGENTS.md`.
- `load_subagent_by_name(dir, name) -> spec` — single spec; asserts frontmatter `name` == folder.

---

## 6. Shared infrastructure (`agents/swarm.py`)

### 6.1 `MarkdownBlackboard`
```python
MarkdownBlackboard(root: Path, visible_files: Iterable[str])
  .path(name) -> Path           # rejects absolute paths and ".." traversal; allows subdirs
  async write(name, content)    # raises ValueError if not name.endswith(".md")
  async read(name) -> str       # "" if absent
  async append(name, content)   # blank-line separated
  async parent_context() -> str # concatenates all visible_files as "## name\n<text>"
```

### 6.2 `RaindropTelemetry`
Keeps raw traces out of context. `log_trace(run_id, span, level, detail, metadata)` spools a JSONL
line to `.telemetry/<run_id>.jsonl` **and** POSTs to `{raindrop_base_url}/api/traces` (best-effort,
swallows `OSError`). `summarize_run(run_id)` GETs `/api/traces/{run_id}` (falling back to the spool)
and returns a one-line semantic root cause by regex-matching exception signatures
(`ModuleNotFoundError:`, `ImportError:`, `AssertionError:`, `TimeoutError:`, `PermissionError:`,
generic `[A-Za-z]+Error:`). Disabled entirely when `RAINDROP_ENABLED=false`.

### 6.3 `ExecuteTelemetryMiddleware` (`backend/execute_telemetry.py`)
A `langchain.agents.middleware.AgentMiddleware`. `awrap_tool_call` intercepts the `execute` tool:
runs it, parses an exit code via regex `exit code (\d+)`, calls `summarize_execute_output` (keeps the
last 2000 chars; success → "Modal execute passed."; failure → last non-empty line shortened to 180
chars), logs full output to Raindrop on failure, and replaces the `ToolMessage` content with the
compact summary (plus `(exit code N)`). Net effect: the agent never sees raw stdout/stderr.

### 6.4 Modal runtime (`backend/modal_runtime.py`)
```python
ModalSandboxSession(cfg)
  .create()            # modal.App.lookup(modal_app_name, create_if_missing=True);
                       # image = debian_slim(python=modal_python_version).pip_install("pytest");
                       # sandbox = modal.Sandbox.create(app,image,timeout=modal_timeout_seconds);
                       # returns langchain_modal.ModalSandbox(sandbox=...)
  .builder_backend(blackboard_root) -> CompositeBackend(
        default = ModalSandbox,                                  # execute + code files
        routes  = {"/blackboard/": FilesystemBackend(root, virtual_mode=True)})
  .terminate()         # sandbox.terminate(); also __enter__/__exit__

blackboard_backend(blackboard_root) -> CompositeBackend(
        default = StateBackend(),                                # in-agent-state scratch
        routes  = {"/blackboard/": FilesystemBackend(root, virtual_mode=True)})
```
General agents that don't run code (PI, Filter, Reviewer) use `blackboard_backend`; code agents
(Scientist/Developer/Diagnostic) use `builder_backend` so a worker's code persists in its sandbox.

---

## 7. Research Ledger (`backend/ledger/`)

Long-term memory of attempts. Raw store: `.research/<run_id>/ledger.json`; blackboard view:
`ledger.md`.

### 7.1 `Attempt` (models.py)
```python
Attempt.create(attempt_id, packet_id, generation, approach, outcome,  # "success"|"failure"
               error_class="", detail="") -> Attempt
```
Computes `signature` (sha1 of sorted content tokens, 16 hex) and `tokens` (content words). Content
tokens = regex `[a-z0-9]+` minus a stopword set (articles, prepositions, and filler verbs like
"use/implement/build/try/simple") so similarity reflects substance, not phrasing.

### 7.2 `ResearchLedger`
```python
ResearchLedger(similarity_threshold=0.8)
  .record(attempt)
  .find_blocking_failure(approach) -> BlockedMatch | None
        # exact signature match -> similarity 1.0; else max Jaccard over FAILED attempts' tokens;
        # blocks when Jaccard >= similarity_threshold
  .is_blocked(approach) -> bool
  .avoid_list(limit=12) -> list[Attempt]            # most recent failures first
  .avoid_prompt_block(limit=8) -> str               # injected into Scientist/Experimenter prompts
  .to_markdown() -> str                             # ledger.md ("avoid these" + "approaches that worked")
  .stats() / .save_json(path) / .load_json(path, similarity_threshold=0.8)
```

### 7.3 Tools (`tools.py`) — `create_ledger_tools(ledger)`
Read-only async tools given to the Scientist/Experimenter:
- `check_prior_attempts(approach) -> str` — "BLOCKED — a 85%-similar approach already failed ..." or
  "No prior failure matches this approach."
- `list_failed_approaches() -> str`.

---

## 8. Literature pipeline (`backend/literature/`)

### 8.1 `Paper` (models.py)
Fields: `paper_id, title, authors[], year, source, url, summary, categories[], doi, arxiv_id,
semantic_scholar_id, cited_by_count, citation_key, citation_apa, bibtex, references[]`. `to_dict` /
`from_dict` for JSON.

### 8.2 `KnowledgeGraph` (models.py)
In-memory citation/topic graph. Nodes are papers plus synthetic `author:`, `topic:`, `query:` ids.
Edge relations: `authored_by`, `in_topic`, `related_to`, `cites`, `retrieved_by`.
```python
add_paper(paper, merge=True) -> canonical_id   # dedups by arxiv_id then doi; merges metadata;
                                               # enriches citation fields; links authors/topics
link_related(a, b) / link_cites(citing, cited) / link_query(query, paper_id)
numbered_papers() -> [(n, Paper)]              # stable insertion order -> [n] keys
to_markdown() -> str        # stats + mermaid (first ~12 papers / 50 edges) + papers + bibliography
to_citations_markdown()     # "# References\n[n] APA (cited by X) DOI: ..."
to_bibtex() / stats() / save_json(path) / load_json(path)
```

### 8.3 Source clients (all expose sync + `async` (`asyncio.to_thread`) variants)
- `arxiv_client.search_arxiv(query, max_results=8)` — `export.arxiv.org` Atom API; extracts arXiv id
  (version-stripped), DOI (`arxiv:doi`), authors, categories, year, alternate link. `paper_id =
  arxiv:<id>`.
- `scholar_client.search_google_scholar(query, max_results=5)` — via `scholarly` (best-effort,
  brittle; returns a `warning` string on failure). `paper_id = scholar:<sha1[:12]>`.
- `crossref_client.lookup_doi(title)` — CrossRef `works?query.title=` (rows=1); polite User-Agent
  with `mailto`.
- `semantic_scholar_client.enrich_paper(paper, reference_limit=3)` — S2 graph API; matches by
  `ARXIV:`/`DOI:`/`paperId`/title; fills `semantic_scholar_id`, missing DOI/arXiv, `cited_by_count`;
  returns up to N reference stub `Paper`s.

### 8.4 Enrichment (`enrichment.py`)
- `enrich_graph_citations(graph, cfg, paper_ids=None) -> GraphEnrichmentSummary` — for each target:
  CrossRef DOI lookup if missing (when enabled), then S2 enrichment; adds reference papers and
  `cites` edges. Returns counts + ≤5 warnings.
- `apply_papers_to_graph(graph, papers, query)` — add papers + `retrieved_by` query edges.

### 8.5 Filter tools (`tools.py`) — `create_literature_tools(run_id, graph, cfg, telemetry, research_dir=None, blackboard_writer=None)`
Returns async tools bound to a run-scoped graph; persists `literature_graph.json` + `references.bib`
after each call: `search_arxiv_literature`, `search_google_scholar_literature`,
`enrich_literature_citations`, `get_citation_bibliography`, `render_literature_knowledge_graph`
(writes `literature_graph.md` + `citations.md` via `blackboard_writer`), `get_literature_graph_summary`.
All return compact summaries only; raw abstracts go to the research dir / telemetry.

---

## 9. General mode: `AutoresearchSwarm` (`agents/swarm.py`)

### 9.1 Control loop
```python
run(user_goal, raw_materials=""):
    run_id = uuid4().hex
    write retrospective.md ("run started")
    ledger = load_ledger(run_id); publish ledger.md
    for generation in 1..max_generations:
        _run_filter(run_id, goal, raw)                  # literature -> distilled_brief.md (+graph)
        packets = _plan_work_packets(run_id, goal, ledger)   # PI planner -> plan.md
        outcomes = _run_workers(run_id, generation, packets, ledger)   # parallel Scientist+Developer
        _merge_worker_results(generation, outcomes)     # builder_result.md / error_summary.md
        _record_ledger(run_id, generation, outcomes, ledger)  # ledger.json + ledger.md
        review = _run_reviewer(run_id, generation)      # review.md -> ReviewVerdict
        _run_post_mortem(run_id, generation)            # Raindrop summary -> retrospective.md
        if not error_summary.strip() and (review.accepted or not reviewer_enabled):
            break
    parent = _create_parent_agent()                     # PI synthesis from parent_visible files
    return SwarmRunResult(run_id, final_summary, blackboard_root)
```

### 9.2 Stages in detail
- **Filter** (`_run_filter`): builds a Filter agent (`blackboard_backend`, literature tools, with a
  `blackboard_writer` closure), instructs it to search arXiv→Scholar, enrich, render the graph, and
  write `distilled_brief.md`. Afterward the swarm finalizes the graph (writes JSON/BibTeX +
  `literature_graph.md`/`citations.md`) and clips the brief to `distilled_word_limit`.
- **PI planning** (`_plan_work_packets`): a PI agent gets a `submit_work_packets(packets: list[str])`
  tool (closure capturing the list, capped at `max_workers`), plus the brief, the ledger avoid-block,
  and any prior `review.md`/`builder_result.md`. The captured list (fallback `[goal]`) is written to
  `plan.md`.
- **Workers** (`_run_workers` → `_run_worker`): `asyncio.gather` over packets bounded by a
  `Semaphore(worker_concurrency)`. Each worker: create its own `ModalSandboxSession` (in a thread),
  run **Scientist** (writes code into the sandbox + `workers/<p>/plan.md`), parse the approach
  (`_extract_approach`), run **Developer** (runs `execute`, writes `result.md` or `error.md`). If the
  error is environment-class (`_is_environment_error` over tokens: modulenotfound, importerror, no
  module, command not found, cuda, filenotfound, oserror, libcudart, not installed, no such file) and
  `diagnostic_enabled`, run **Diagnostic** (same sandbox) then re-invoke the Developer once.
  `success = result.md non-empty AND error.md empty`. Any exception is caught → failure outcome +
  Raindrop. The sandbox is always terminated.
- **Merge** (`_merge_worker_results`): writes `builder_result.md` (completed + failed packets) and
  sets `error_summary.md` non-empty iff any failed.
- **Reviewer** (`_run_reviewer`): reads `builder_result.md` + `distilled_brief.md`; writes
  `review.md`. `_parse_review` extracts `SCORE:` (float) and `VERDICT:` (accept/revise); if no
  verdict line, accepts when `score >= review_pass_score`.
- **Ledger record** (`_record_ledger`): one `Attempt` per outcome (`error_class` "" / "crash" /
  whatever the developer reported); persists JSON + republishes `ledger.md`.

### 9.3 Personas (subagent specs)
Each lives under `.deepagents/agents/<name>/AGENTS.md`; summaries:
- **Principal Investigator** (`agents/personas/principal_investigator.md`) — strategy + work-packet
  decomposition (`write_todos` + `submit_work_packets`) and final synthesis; reads only distilled files.
- **Filter** — literature review → `distilled_brief.md` (+ graph + citations); ≤500 words, inline `[n]`.
- **Scientist** — calls `check_prior_attempts`, writes code FILES into the sandbox, records approach +
  files + run command in `workers/<p>/plan.md`.
- **Developer** — runs the verification command via `execute`; writes compact `result.md` or 3-line
  `error.md`; at most one small fix.
- **Diagnostic** — repairs the sandbox env (e.g. `pip install`) and confirms the command runs; writes
  `diagnostic.md`. (In experiment mode this behavior is disallowed by `program.md`.)
- **Reviewer** — scores four rubric criteria; writes `SCORE` + `VERDICT` + required revisions.

---

## 10. Experiment mode: `ExperimentSwarm` (`agents/experiment_swarm.py`)

Runs the `program.md` keep/discard loop. Code runs **locally** (the reference loop targets the GPU
box) and persistent state is the **git working tree**.

### 10.1 `ExperimentSpec` (`backend/experiment/spec.py`)
```python
ExperimentSpec.from_repo(repo_path, timeout_seconds=600) -> ExperimentSpec
```
Reads `program.md` verbatim and overrides defaults via `with_program_hints()` (regex detection):
- `run_command` from a backticked `uv run ...`/`python ...` (redirection stripped — the runner
  captures output itself).
- `metric_name`/`metric_pattern`/`lower_is_better` from `val_bpb|val_loss|accuracy|score|reward`.
- `log_file` from a `*.log` mention; `results_tsv` from `results.tsv`.
- `allow_install=False` when it matches "cannot/can't/do not ... install ... package".
Defaults match the reference repo: edit `train.py`, read-only `prepare.py`, metric `val_bpb`
(lower better), `uv run train.py`, `run.log`, `results.tsv`.

### 10.2 Metrics (`backend/experiment/metrics.py`)
- `parse_log(text, spec) -> MetricReading(value, memory_gb, crashed, tail)` — multiline regex for the
  metric and `peak_vram_mb` (→ GB). `crashed=True` when the metric is absent.
- `is_improvement(new, best, lower_is_better)` — strict; ties do not improve; first value always wins.

### 10.3 Workspace (`backend/experiment/workspace.py`)
`ExperimentWorkspace(repo_path)` wraps git: `head()`, `current_branch()`, `is_clean()`, `read`,
`write`, `checkout_branch(name, create=True)`, `commit(message, paths=None)` (stages, allows empty),
`reset_hard(ref)` / `revert_to(ref)`.

### 10.4 Results (`backend/experiment/results.py`)
`ResultsTsv(path)` writes header `commit\tval_bpb\tmemory_gb\tstatus\tdescription` on first use;
`append(ResultRow)` (crashes recorded as `0.000000`/`0.0`); `tail(n)`.

### 10.5 Runner (`backend/experiment/runner.py`)
`ExperimentRunner` protocol: `async run(command, cwd, log_path, timeout) -> RunResult(log_text,
exit_code, timed_out)`. Implementations: `LocalSubprocessRunner` (async shell, captures combined
output to `log_path`, kills on timeout), `FakeRunner(logs=[...])` (scripted, for tests). A GPU Modal
runner can be added behind the same protocol.

### 10.6 Loop
```python
run(repo_path, max_experiments=None):
    spec = ExperimentSpec.from_repo(repo_path, timeout=experiment_timeout_seconds)
    ws = ExperimentWorkspace(spec.repo_path); results = ResultsTsv(spec.results_path())
    ledger = load_ledger(run_id)
    if experiment_branch: ws.checkout_branch(experiment_branch)
    # baseline: run as-is; current commit is the kept anchor
    last_kept = ws.head(); baseline = run_training(spec); best = baseline.value
    results.append(commit=last_kept, value, mem, "keep" if ok else "crash", "baseline")
    for i in 1..(max_experiments or budget):
        description, new_code = propose_idea(spec, current_code, best, ledger, results.tail())
        if empty: break
        if ledger.is_blocked(description): continue          # skip near-duplicate dead end
        write new_code to spec.edit_path(); commit = ws.commit(description, paths=edit_files)
        reading = run_training(spec)
        if reading.crashed:                 status="crash";   ws.revert_to(last_kept)
        elif is_improvement(reading.value): status="keep";    best=value; last_kept=ws.head()
        else:                               status="discard"; ws.revert_to(last_kept)
        results.append(commit, value, mem, status, description)
        record Attempt(outcome="success" if keep else "failure",
                       error_class="crash"|"no-improvement"|"")
        telemetry.log_trace(full tail)
    return ExperimentRunResult(run_id, best_value, experiments_run, kept, results_path, head_commit)
```
`propose_idea` is injectable (tests pass a fake). The default builds the **Experimenter** agent
(`submit_experiment(description, file_content)` tool + ledger tools) and feeds it `program.md`, the
constraints summary, the best metric, the ledger avoid-block, the `results.tsv` tail, and the current
editable file; the agent submits the full edited file. The Experimenter is locked to the editable
file and forbidden from installing packages.

---

## 11. Configuration (`config.py`)

`Settings` is a frozen dataclass; every field reads an env var at import. Full reference:

| Env var | Default | Purpose |
|---|---|---|
| `AUTORESEARCH_APP_NAME` | `autoresearch-swarm` | App label |
| `AUTORESEARCH_MODEL` | `openai:gpt-5.4` | Model string for `create_deep_agent` |
| `AUTORESEARCH_WORKSPACE` | `.autoresearch_workspace` | Blackboard + stores root |
| `AUTORESEARCH_MAX_GENERATIONS` | `3` | General-mode iterations |
| `DISTILLED_BRIEF_WORD_LIMIT` | `500` | Hard cap on the brief |
| `AUTORESEARCH_MAX_WORKERS` | `3` | Max packets per generation |
| `AUTORESEARCH_WORKER_CONCURRENCY` | `3` | Parallel workers |
| `AUTORESEARCH_REVIEWER_ENABLED` | `true` | Reviewer gate |
| `AUTORESEARCH_REVIEW_PASS_SCORE` | `0.7` | Accept threshold without a verdict line |
| `AUTORESEARCH_LEDGER_ENABLED` | `true` | Research ledger |
| `AUTORESEARCH_LEDGER_SIMILARITY` | `0.8` | Jaccard near-dup block threshold |
| `AUTORESEARCH_DIAGNOSTIC_ENABLED` | `true` | Environment repair sub-loop |
| `AUTORESEARCH_DIAGNOSTIC_ATTEMPTS` | `1` | Developer retries after a repair |
| `AUTORESEARCH_EXPERIMENT_TIMEOUT` | `600` | Per-run kill ceiling (s) |
| `AUTORESEARCH_MAX_EXPERIMENTS` | `100` | Experiment budget |
| `AUTORESEARCH_EXPERIMENT_BRANCH` | — | Optional git branch |
| `AUTORESEARCH_EXPERIMENT_LITERATURE` | `false` | Reserved: seed ideas with literature |
| `LITERATURE_ARXIV_MAX_RESULTS` | `8` | arXiv hits/call |
| `LITERATURE_SCHOLAR_MAX_RESULTS` | `5` | Scholar hits/call |
| `LITERATURE_SCHOLAR_ENABLED` | `true` | Toggle Scholar |
| `LITERATURE_ENRICH_CITATIONS` | `true` | Auto-enrich after search |
| `LITERATURE_SEMANTIC_SCHOLAR_ENABLED` | `true` | S2 references/citations |
| `LITERATURE_CROSSREF_ENABLED` | `true` | CrossRef DOI lookup |
| `LITERATURE_CROSSREF_MAILTO` | `autoresearch@example.com` | Polite-pool contact |
| `LITERATURE_S2_REFERENCE_LIMIT` | `3` | References per enriched paper |
| `MODAL_APP_NAME` | `autoresearch-swarm-runtime` | Modal app |
| `MODAL_TIMEOUT_SECONDS` | `300` | Sandbox timeout |
| `MODAL_PYTHON_VERSION` | `3.12` | Sandbox Python |
| `RAINDROP_ENABLED` | `true` | Telemetry (false offline/tests) |
| `RAINDROP_API_KEY` | — | Ingestion bearer token |
| `RAINDROP_BASE_URL` | `http://127.0.0.1:8080` | Raindrop endpoint |
| `RAINDROP_PROJECT` | `autoresearch-swarm` | Project tag |

Provider keys are read by LangChain, not `config.py`: set `OPENAI_API_KEY` (default model), or
`ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` if you change the model. Modal needs `modal setup` (or
`MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`).

---

## 12. How to use

```bash
# Install (Python 3.12/3.13)
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt langchain-openai      # provider package for the default model

# Configure
cp .env.example .env && $EDITOR .env
set -a; source .env; set +a                            # config.py does not auto-load .env

# General mode (literature + parallel workers + reviewer; needs Modal)
python main.py "Implement and benchmark a rate limiter in Python" --raw-file notes.md

# Experiment mode (program.md keep/discard loop; runs locally on the GPU box)
python main.py --experiment-repo /path/to/autoresearch --max-experiments 50
```

Outputs: general mode prints the PI final summary and the blackboard path; experiment mode prints
`best`, `kept/runs`, the head commit, and the `results.tsv` path.

---

## 13. Testing & verification

Run the full offline suite (no GPU, no LLM, no network except one unreachable Raindrop POST):

```bash
cd backend/autoresearch-orchestrator
pip install -r requirements.txt   # includes pytest + pytest-asyncio
RAINDROP_ENABLED=false pytest tests/ -v
```

**58 tests** across `tests/` covering:

| Module | File | What is tested |
|--------|------|----------------|
| Config | `test_config.py` | `_env_bool`, default settings |
| Swarm | `test_swarm.py` | `MarkdownBlackboard`, parsing helpers, merge |
| Subagent loader | `test_subagent_loader.py` | frontmatter parsing, real AGENTS.md specs |
| Ledger | `test_ledger.py` | dedup, persistence, async tools |
| Literature | `test_literature.py` | citations, `KnowledgeGraph`, JSON roundtrip |
| Literature tools | `test_literature_tools.py` | tool factory with mocked arXiv search |
| Enrichment | `test_enrichment.py` | `apply_papers_to_graph` |
| Experiment | `test_experiment.py` | spec, metrics, git workspace, TSV, runners |
| Experiment swarm | `test_experiment_swarm.py` | full keep/discard/crash loop + ledger skip |
| Telemetry | `test_telemetry.py` | exit-code parsing, execute summarization |
| Raindrop | `test_raindrop.py` | disabled mode, local JSONL spool, root-cause regex |

Git fixtures require a working `git` binary (creates `.git/hooks/`). The legacy script
`scripts/smoke_experiment.py` duplicates the main experiment-swarm integration test.

Construction checks (instantiate deep agents) and live API calls (arXiv, Scholar, Modal) are
intentionally excluded — add `@pytest.mark.integration` tests separately if needed.

---

## 14. Reproduction build order

1. `config.py` — `Settings` dataclass with the env vars in §11.
2. `agents/subagent_loader.py` — frontmatter parser (§5.1).
3. `agents/swarm.py` infra — `MarkdownBlackboard`, `RaindropTelemetry`, `create_deep_agent_checked`,
   parsing helpers (§6, §9.2).
4. `backend/execute_telemetry.py` + `backend/modal_runtime.py` — middleware + sandbox/composite
   backends (§6.3–6.4).
5. `backend/ledger/` — `Attempt`, `ResearchLedger`, tools (§7).
6. `backend/literature/` — `Paper`, `KnowledgeGraph`, source clients, enrichment, tool factory (§8).
7. Persona files under `.deepagents/agents/*` + `agents/personas/principal_investigator.md` (§9.3).
8. `AutoresearchSwarm` control loop wiring all of the above (§9.1).
9. `backend/experiment/` — spec, metrics, workspace, results, runner (§10.1–10.5).
10. `agents/experiment_swarm.py` — the keep/discard loop + experimenter persona (§10.6).
11. `main.py` CLI (general + `--experiment-repo`) and `.env.example`.
12. `scripts/smoke_experiment.py` to verify experiment mode end-to-end.

---

## 15. Known gaps / production hardening

- The swarm orchestrates workers directly (deterministic control); the PI `task` delegation path
  exists but is not the primary route.
- Deep Agents filesystem permissions are not enforced per role (workers could in principle write
  outside their namespace).
- Worker "target file state" is the visible markdown only — no real project source snapshot or
  write-back from the sandbox to a repo (general mode).
- Reviewer scoring is rubric-prompted, not independently verified against ground truth.
- Experiment mode runs locally and sequentially per repo working tree; parallel experiments would
  need git worktrees + per-GPU isolation (or a GPU Modal runner).
- Raindrop API paths are adapter placeholders; align with the deployed ingestion/query API.
- No automated integration tests yet assert that raw text never reaches the PI prompt, nor a
  full multi-generation general-mode run with fakes.
