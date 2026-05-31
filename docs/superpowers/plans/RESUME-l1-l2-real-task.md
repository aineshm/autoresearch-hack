# RESUME — Make L1→L2 produce a REAL runnable experiment

_Last updated 2026-05-31. Read this first when resuming in a new session._

## Where we are (one paragraph)
The full AutoLab pipeline is **built and demoable**: L1 (brief→research→plan) → "Run autoresearch" → L2/L3 swarm → live SwarmMonitor UI with a deliverable result card. It works end-to-end **in cached/demo mode** (instant replay of curated ALFA results: F1 0.000→0.800, 437ms engine-failure catch). The **live path also works** (real Modal sandboxes per experiment + real L3 Research Judge + OpenAI) — verified: distinct sandbox IDs created/terminated, real directives written. BUT the live path runs a **STUB training task**, not a real one.

## THE TASK WE'RE ON (the one real gap)
**The L1→L2 launch bridge writes a hardcoded stub `train.py` (`print('val_bpb: 1.0')`) that ignores what L1 actually planned.** So "L1 drives L2" is currently cosmetic — the plan's text flavors the narrative, but the actual experiment is always the same toy.

**DECISION MADE (by user):** Build an **LLM compiler step** in the launch bridge that turns the L1 plan (+ dataset facts) into a REAL runnable experiment: `program.md` + `prepare.py` (fixed eval harness) + a weak seed `train.py` (real code for THIS task). Then the swarm genuinely improves it. This makes "L1 drives L2" true for any goal — the real system working end-to-end.

**NEXT STEP when resuming:** I was about to call the advisor to design this LLM-compiler step, then build it. Start there.

## Key files for this task
- `backend/run/launch.js` — `createRunDir()` writes the stub (lines ~30-58: `programMdFromPlan` + `STARTER_TRAIN_PY`). The `TODO` on line 29 marks the exact spot to add the LLM compile. `spawnSwarm()` launches the Python swarm.
- `backend/run/route.js` — `POST /api/run/launch {plan}`; cached (default, replay) vs live (`?live=1`/`LIVE_SWARM=true`).
- L2 swarm contract: Karpathy-style. `backend/autoresearch-orchestrator/backend/experiment/spec.py` — repo needs `program.md` + editable `train.py` + readonly `prepare.py`, `run_command` default `uv run train.py`, metric parsed from program.md.
- `backend/autoresearch-orchestrator/main.py` — `--experiment-repo <dir>`, env `USE_L3_PROPOSER=true` wires L3, `EXPERIMENT_USE_MODAL=true` uses Modal.

## Design constraints / gotchas (learned this session)
1. **Modal sandbox image is bare debian_slim** (`modal_runner.py` `_exec_in_sandbox`) — only ever ran `print(...)`. Any real training (numpy/sklearn/pandas) FAILS on import until the image gets `.pip_install(...)`. **Must add deps to the image for real training to run on Modal.** This is a required sub-task.
2. The generated `train.py` must print exactly `<metric>: <float>` (one line) — that's how L2 parses results (`metrics.py` regex, first match). Seed must be deliberately weak so there's headroom for the swarm to discover improvements.
3. `prepare.py` is read-only (the swarm can't change the eval/split) — keeps the metric honest across experiments.
4. The L1 plan shape (from `backend/planner/`): `{ summary, variable_categories:[{category,priority,rationale}], start_here:[], ... }`. Dataset facts available via `project.dataFacts` in the frontend.
5. I started a hand-written `experiments/digits-demo/program.md` then STOPPED — user correctly said "isn't L1 supposed to produce this?" That dir can be deleted or kept as a reference for what a real experiment repo looks like. The point: DON'T hand-write the task; the LLM compiler should generate it from the plan.

## ALFA context (the demo data)
- The pasted F1=0.800 output came from a DIFFERENT system (`runner.main`, EXPLORE/EXPLOIT rounds) the teammate ran separately for demo data. It is NOT our L2/L3 swarm (CONTINUE/PIVOT, one experiment/generation) and `runner/` is NOT in this repo.
- The real ALFA dataset IS live on a Modal volume `alfa-dataset` at `/data/alfa/processed/` (47 flights, mavros CSV topics per flight). `backend/autoresearch-orchestrator/backend/experiment/dataset_volume.py` hosts/mounts it. ALFA onset labels are NOT in obvious CSVs (encoded in .mat or derived) — reconstructing ALFA's exact harness is hours; we chose to validate the system on a SMALL real task first, then user pivoted to "go through L1" (the LLM-compiler approach above).

## Branch / state
- **Working branch: `l2-l3-integration`** (has our live SwarmMonitor + result card; pushed). This is where to keep working.
- **`main` (origin)**: at `aaaaecc` — teammate added their own static `AutoresearchRun` UI (animated, no backend) which OVERRIDES our live monitor in Chat.jsx there. User said: keep our live work on `l2-l3-integration`, leave main as teammate's. Do NOT merge our branch to main without checking — they diverge on the run UI (their `kind:'autoresearch'` static vs our `kind:'monitor'` live).
- Local main was reset to origin/main (untouched). Our work is safe on `l2-l3-integration`.

## What's working (don't rebuild)
- L3 (JS, `orchestration/`): schemas, blackboard, tools, synthesize, llm, L2 adapter, CLI. 29 tests.
- L2 (Python, `backend/autoresearch-orchestrator/`): keep/discard swarm, Modal runner (fresh sandbox per experiment + repo mount + dataset volume), L3 proposer seam. 73 tests. venv at `.venv` (py3.13), modal authed, langchain-openai installed.
- SwarmMonitor UI: live polling + deliverable result card (hero metric lift, held-out proof, config, learnings). Plugs into chat like L1 panels (`kind:'monitor'`).
- Demo cache: `backend/run/replay.js` + `recordings/demo-arc.json` (real ALFA results) → instant progressive replay + done-state. ~7s.

## How to run / test
- Backend: `cd backend && MONITOR_RUNS_DIR=/tmp/autolab-runs npm start` (add `LIVE_SWARM=true` for real swarm). OPENAI key in `backend/.env`.
- Frontend: `cd frontend && npm run dev` (port 5173, proxies /api → 4000).
- L2 tests: `cd backend/autoresearch-orchestrator && source .venv/bin/activate && python -m pytest -q`.
- Live launch test (curl): `POST /api/run/launch?live=1 {plan:{...}}` → watch `swarm.log` in the run dir for `[modal] fresh sandbox ... created/terminated` + check `directives/`.

## MDDB
Team knowledge base updated: `hackathon/autoresearch/l2-l3-integration-status` has full history. Token in `../mddb-connect-prompt.md`.
