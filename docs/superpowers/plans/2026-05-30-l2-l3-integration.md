# L2↔L3 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the live L2↔L3 loop: L2 runs each experiment generation, L3 reads L2's real output and emits a full-LLM directive each generation, L2 ingests it and steers the next experiment — with experiments actually executing on Modal.

**Architecture:** File-bridge between Python L2 (`backend/autoresearch-orchestrator/`) and JS L3 (`orchestration/`). Per run, a shared `runDir` holds `program.md`, L2's `results/` + `ledger`, and L3's `directives/`. L2's existing `idea_proposer` injectable is wrapped to (1) before proposing, read the latest L3 directive and act on its verdict; (2) after each generation, invoke L3's `synthesize` CLI. L3 is realigned to L2's single-metric reality.

**Tech Stack:** Python 3.13 (L2, uv venv at `backend/autoresearch-orchestrator/.venv`), JS ESM Node 24 (L3, `orchestration/`), Modal (`langchain-modal`, already authed), OpenAI (`gpt-4o-mini` default).

**Branch:** `l2-l3-integration`.

---

## Context from the L2 vet (decisions baked into this plan)
- **Modal is NOT used for experiments today** — `LocalSubprocessRunner` runs training locally. We add a `ModalExperimentRunner` implementing the `ExperimentRunner` Protocol (`backend/experiment/runner.py:25`) and inject it. (Task 5)
- **`results.tsv` writes crashed value as `0.000000`** which looks like a perfect score under lower-is-better. L3's reader MUST gate on the `status` column. (Task 3)
- **Ledger resets each `run()`** (fresh uuid run_id). For cross-pass dedup, L3/L2 must share a stable run dir. We pass an explicit `runDir` and keep the ledger there. (Task 4)
- **Metric parse takes first match + rejects negatives/sci-notation** — out of scope to fix here; noted as a known limitation.
- **`idea_proposer` carries no directive arg** — bind the runDir via closure; the proposer reads the directive file itself. (Task 4)

---

## Realigned L3 contract (supersedes held-out shape)
- A "candidate"/attempt has ONE metric `value` + `status` (keep|discard|crash) + `description` + `commit`, not train/val/held_out.
- L3 checks that apply: **plateau** (best metric over generations), **stagnation** (ledger repeated-failure/dedup density), **crash-rate** (recent crash fraction). The held-out overfit check is DROPPED.
- Verdict vocabulary unchanged: CONTINUE / RETRY / PIVOT / COMMIT / ESCALATE.
- LLM decides the verdict each generation (full-LLM), fed deterministic evidence.

---

## File Structure
**L3 (JS, `orchestration/`):**
- `lib/l2adapter.js` — parse L2's `results.tsv` + ledger json → L3 evidence (status-aware, single-metric)
- `lib/schemas.js` — MODIFY: add `L2ResultRow`, realign evidence; keep DirectiveSchema
- `lib/tools.js` — MODIFY: add `crashRate`, adapt `detectPlateau` to single-metric history; keep as pure
- `lib/synthesize.js` — MODIFY: build evidence from l2adapter, drop held-out
- `lib/llm.js` — MODIFY: coerce booleans, retry on invalid JSON, deterministic fallback verdict
- `bin/synthesize.js` — already exists; ensure it accepts an L2 run dir
- `test/l2adapter.test.js`, fixtures `fixtures/l2-run/` — new

**L2 (Python, `backend/autoresearch-orchestrator/`):**
- `backend/experiment/modal_runner.py` — NEW: `ModalExperimentRunner(ExperimentRunner)`
- `agents/l3_proposer.py` — NEW: `make_l3_proposer(run_dir)` → an `idea_proposer` that reads directives + invokes L3
- `tests/test_modal_runner.py`, `tests/test_l3_proposer.py` — new

---

## Task 1: Fix llm.js — boolean coercion + resilient verdict (the loop depends on it)

**Files:**
- Modify: `orchestration/lib/llm.js`
- Test: `orchestration/test/llm.test.js` (new — tests the pure coercion/fallback, not the live API)

- [ ] **Step 1: Write the failing test** for a pure helper `normalizeDirective(raw, evidence)` that coerces string-bools and fills a deterministic fallback verdict.

`orchestration/test/llm.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDirective } from '../lib/llm.js';

test('coerces string booleans in checks', () => {
  const d = normalizeDirective(
    { verdict: 'CONTINUE', checks: { plateau: { ok: 'false', evidence: 'x' } }, changes: [], rationale: 'r', next_hypotheses: [] },
    { pass: 1 },
  );
  assert.equal(d.checks.plateau.ok, false);
});

test('falls back to a valid verdict when the model omits one', () => {
  const d = normalizeDirective(
    { checks: {}, rationale: 'r' },
    { pass: 2, plateau: true, crashRate: 0 },
  );
  assert.ok(['CONTINUE', 'RETRY', 'PIVOT', 'COMMIT', 'ESCALATE'].includes(d.verdict));
  assert.equal(d.pass, 2);
  assert.ok(Array.isArray(d.changes));
  assert.ok(Array.isArray(d.next_hypotheses));
});

test('plateau evidence drives a non-CONTINUE fallback verdict', () => {
  const d = normalizeDirective({ checks: {} }, { pass: 3, plateau: true, crashRate: 0 });
  assert.notEqual(d.verdict, 'COMMIT');
});
```

- [ ] **Step 2: Run** `cd orchestration && node --test test/llm.test.js` → FAIL (no `normalizeDirective` export).

- [ ] **Step 3: Implement** in `orchestration/lib/llm.js` — add and export `normalizeDirective`, and use it inside `llmDirective`:

```js
const VERDICTS = ['CONTINUE', 'RETRY', 'PIVOT', 'COMMIT', 'ESCALATE'];

function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  return Boolean(v);
}

// Make a raw LLM object schema-shaped; supply a deterministic verdict if missing/invalid.
export function normalizeDirective(raw, evidence) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const checks = {};
  for (const [k, v] of Object.entries(r.checks || {})) {
    checks[k] = { ok: coerceBool(v?.ok), evidence: String(v?.evidence ?? '') };
  }
  let verdict = VERDICTS.includes(r.verdict) ? r.verdict : null;
  if (!verdict) {
    // Deterministic fallback from evidence signals.
    if (evidence?.crashRate >= 0.5) verdict = 'ESCALATE';
    else if (evidence?.plateau) verdict = 'PIVOT';
    else verdict = 'CONTINUE';
  }
  return {
    pass: evidence?.pass ?? r.pass ?? 0,
    verdict,
    checks,
    changes: Array.isArray(r.changes) ? r.changes : [],
    rationale: String(r.rationale ?? ''),
    next_hypotheses: Array.isArray(r.next_hypotheses) ? r.next_hypotheses : [],
  };
}
```

And in `llmDirective`, after `JSON.parse(...)`, change the return to `return normalizeDirective(parsed, evidence);` and harden the prompt: add "Every `ok` field MUST be a JSON boolean (true/false), never a string." Also wrap the API call in a try/catch that, on any failure, returns `normalizeDirective({}, evidence)` (deterministic fallback) so the loop never dies. Pass `evidence` into `llmDirective`'s args.

- [ ] **Step 4: Run** `cd orchestration && node --test test/llm.test.js` → PASS (3 tests).

- [ ] **Step 5: Full suite** `cd orchestration && npm test` → all green (was 18, now 21).

- [ ] **Step 6: Commit**
```bash
git add orchestration/lib/llm.js orchestration/test/llm.test.js && git commit -m "fix(l3): coerce LLM bools + deterministic fallback verdict (live-loop resilience)"
```

---

## Task 2: L3 single-metric tools — crashRate + plateau over L2 history

**Files:**
- Modify: `orchestration/lib/tools.js`
- Test: `orchestration/test/tools.test.js` (extend)

- [ ] **Step 1: Add failing tests** to `orchestration/test/tools.test.js`:
```js
import { crashRate, detectPlateauMetric } from '../lib/tools.js';

test('crashRate is the fraction of crashed attempts in the window', () => {
  const attempts = [
    { status: 'keep' }, { status: 'crash' }, { status: 'discard' }, { status: 'crash' },
  ];
  assert.ok(Math.abs(crashRate(attempts, 4) - 0.5) < 1e-9);
});

test('detectPlateauMetric handles lower-is-better best-so-far', () => {
  // lower_is_better: best improves when value DROPS.
  const history = [{ best: 1.0 }, { best: 0.99 }, { best: 0.989 }];
  assert.equal(detectPlateauMetric(history, { lowerIsBetter: true, minDelta: 0.005, window: 2 }), true);
});

test('detectPlateauMetric false while clearly improving (lower-is-better)', () => {
  const history = [{ best: 1.0 }, { best: 0.9 }, { best: 0.8 }];
  assert.equal(detectPlateauMetric(history, { lowerIsBetter: true, minDelta: 0.005, window: 2 }), false);
});
```

- [ ] **Step 2: Run** `cd orchestration && node --test test/tools.test.js` → FAIL (new exports missing).

- [ ] **Step 3: Implement** in `orchestration/lib/tools.js` (keep the existing `computeHeldOutGap`/`detectPlateau` for backward-compat; ADD):
```js
// Fraction of the last `window` attempts that crashed.
export function crashRate(attempts, window = 5) {
  if (!attempts.length) return 0;
  const recent = attempts.slice(-window);
  return recent.filter((a) => a.status === 'crash').length / recent.length;
}

// Plateau on best-so-far metric. history: [{ best }] ascending by generation.
// lowerIsBetter => improvement is a DECREASE in best.
export function detectPlateauMetric(history, { lowerIsBetter = true, minDelta = 0.005, window = 2 } = {}) {
  if (history.length < window + 1) return false;
  const recent = history.slice(-(window + 1));
  const first = recent[0].best;
  const last = recent[recent.length - 1].best;
  const improvement = lowerIsBetter ? first - last : last - first;
  return improvement < minDelta;
}
```

- [ ] **Step 4: Run** `cd orchestration && node --test test/tools.test.js` → PASS.

- [ ] **Step 5: Commit**
```bash
git add orchestration/lib/tools.js orchestration/test/tools.test.js && git commit -m "feat(l3): crashRate + single-metric plateau tools for L2 reality"
```

---

## Task 3: L3 read adapter — parse L2's results.tsv + ledger (status-aware)

**Files:**
- Create: `orchestration/lib/l2adapter.js`
- Test: `orchestration/test/l2adapter.test.js`
- Fixture: `orchestration/fixtures/l2-run/results.tsv`, `orchestration/fixtures/l2-run/ledger.json`, `orchestration/fixtures/l2-run/program.md`

- [ ] **Step 1: Create fixtures** mirroring L2's real format.

`orchestration/fixtures/l2-run/results.tsv` (tab-separated; note crash row has value 0.000000):
```
commit	val_bpb	memory_gb	status	description
abc123	1.000000	43.9	keep	baseline
def456	0.990000	43.9	keep	increase LR to 0.04
aaa111	1.020000	43.9	discard	switch to GeLU
bbb222	0.000000	43.9	crash	double model width (OOM)
ccc333	0.991000	43.9	discard	add dropout 0.1
```

`orchestration/fixtures/l2-run/ledger.json`:
```json
{ "similarity_threshold": 0.8, "attempts": [
  { "attempt_id": "a1", "packet_id": "exp1", "generation": 1, "approach": "increase LR to 0.04", "outcome": "success", "error_class": "", "detail": "metric=0.990000", "signature": "s1", "tokens": ["lr","04"], "timestamp": "2026-05-30T22:37:31Z" },
  { "attempt_id": "a2", "packet_id": "exp2", "generation": 2, "approach": "switch to GeLU", "outcome": "failure", "error_class": "", "detail": "metric=1.020000", "signature": "s2", "tokens": ["gelu"], "timestamp": "2026-05-30T22:38:00Z" },
  { "attempt_id": "a3", "packet_id": "exp3", "generation": 3, "approach": "double model width", "outcome": "failure", "error_class": "OOM", "detail": "crash", "signature": "s3", "tokens": ["double","width"], "timestamp": "2026-05-30T22:39:00Z" }
]}
```

`orchestration/fixtures/l2-run/program.md` (Karpathy-style — freeform; metric line present):
```markdown
# Speedrun: minimize val_bpb on the tabular task

Edit `train.py`. Run with `uv run train.py`. The metric is `val_bpb` (lower is better).
Goal: get val_bpb below 0.95. Do not install new packages.
```

- [ ] **Step 2: Write the failing test** `orchestration/test/l2adapter.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readL2Results, readL2Ledger, readL2Program, buildL2Evidence } from '../lib/l2adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const RUN = join(here, '..', 'fixtures', 'l2-run');

test('readL2Results parses rows and flags crash status', () => {
  const rows = readL2Results(RUN);
  assert.equal(rows.length, 5);
  const crash = rows.find((r) => r.status === 'crash');
  assert.equal(crash.value, null);            // crash 0.000000 must NOT be read as a real metric
});

test('readL2Program extracts metric + direction from freeform program.md', () => {
  const p = readL2Program(RUN);
  assert.equal(p.metric, 'val_bpb');
  assert.equal(p.lowerIsBetter, true);
});

test('buildL2Evidence computes best-so-far ignoring crashes + crashRate', () => {
  const ev = buildL2Evidence(RUN);
  assert.equal(ev.pass, 5);                   // 5 result rows
  assert.ok(Math.abs(ev.best - 0.99) < 1e-9); // best kept metric, crash ignored
  assert.ok(ev.crashRate > 0);                // one crash present
  assert.ok(typeof ev.plateau === 'boolean');
});
```

- [ ] **Step 3: Run** → FAIL (no module).

- [ ] **Step 4: Implement** `orchestration/lib/l2adapter.js`:
```js
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { crashRate, detectPlateauMetric } from './tools.js';

// Parse L2's results.tsv. CRITICAL: a 'crash' row stores value 0.000000 which would
// look like a perfect score under lower-is-better — so we null the value on crash.
export function readL2Results(runDir) {
  const path = join(runDir, 'results.tsv');
  if (!existsSync(path)) throw new Error(`Missing results.tsv at ${path}`);
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const rows = [];
  for (const line of lines.slice(1)) {            // skip header
    const [commit, val, mem, status, ...desc] = line.split('\t');
    rows.push({
      commit,
      value: status === 'crash' ? null : Number(val),
      memory_gb: Number(mem),
      status,
      description: desc.join('\t'),
    });
  }
  return rows;
}

export function readL2Ledger(runDir) {
  const path = join(runDir, 'ledger.json');
  if (!existsSync(path)) return { attempts: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readL2Program(runDir) {
  const path = join(runDir, 'program.md');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const m = text.match(/\b(val_bpb|val_loss|accuracy|score|reward)\b/);
  const metric = m ? m[1] : 'val_bpb';
  const lowerIsBetter = !['accuracy', 'score', 'reward'].includes(metric);
  return { metric, lowerIsBetter, program_md: text };
}

// Best-so-far over non-crash rows, respecting direction.
function bestSoFar(values, lowerIsBetter) {
  const real = values.filter((v) => v !== null);
  if (!real.length) return null;
  return lowerIsBetter ? Math.min(...real) : Math.max(...real);
}

export function buildL2Evidence(runDir) {
  const program = readL2Program(runDir);
  const rows = readL2Results(runDir);
  const ledger = readL2Ledger(runDir);

  // history of best-so-far after each row
  const history = [];
  const seen = [];
  for (const r of rows) {
    seen.push(r.value);
    history.push({ best: bestSoFar(seen, program.lowerIsBetter) });
  }

  return {
    program,
    pass: rows.length,
    rows,
    ledger,
    best: bestSoFar(rows.map((r) => r.value), program.lowerIsBetter),
    crashRate: crashRate(rows, 5),
    plateau: detectPlateauMetric(history, { lowerIsBetter: program.lowerIsBetter }),
    history,
  };
}
```

- [ ] **Step 5: Run** `cd orchestration && node --test test/l2adapter.test.js` → PASS (3 tests).

- [ ] **Step 6: Full suite** `npm test` → all green.

- [ ] **Step 7: Commit**
```bash
git add orchestration/lib/l2adapter.js orchestration/test/l2adapter.test.js orchestration/fixtures/l2-run && git commit -m "feat(l3): L2 read adapter — status-aware results.tsv + ledger -> evidence"
```

---

## Task 4: synthesize-from-L2 + CLI for the loop

**Files:**
- Modify: `orchestration/lib/synthesize.js` — add `synthesizeL2(runDir, { llm })`
- Modify: `orchestration/bin/synthesize.js` — support `--l2 <runDir>`
- Test: `orchestration/test/synthesize.test.js` (extend)

- [ ] **Step 1: Add failing test** to `orchestration/test/synthesize.test.js`:
```js
import { synthesizeL2 } from '../lib/synthesize.js';

test('synthesizeL2 writes a directive from an L2 run dir using injected llm', async () => {
  const { cpSync, mkdtempSync, rmSync, existsSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(join(tmpdir(), 'l2syn-'));
  cpSync(join(FIX, 'l2-run'), tmp, { recursive: true });
  try {
    const fakeLlm = async ({ evidence }) => ({
      verdict: evidence.plateau ? 'PIVOT' : 'CONTINUE',
      checks: { plateau: { ok: !evidence.plateau, evidence: 'x' }, crash: { ok: evidence.crashRate < 0.5, evidence: 'y' } },
      changes: [], rationale: 'test', next_hypotheses: ['try smaller lr'],
    });
    const d = await synthesizeL2(tmp, { llm: fakeLlm });
    assert.ok(['CONTINUE', 'RETRY', 'PIVOT', 'COMMIT', 'ESCALATE'].includes(d.verdict));
    assert.ok(existsSync(join(tmp, 'directives', 'pass-5.json')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
```
(`FIX` is already defined at the top of this test file.)

- [ ] **Step 2: Run** → FAIL (no `synthesizeL2`).

- [ ] **Step 3: Implement** in `orchestration/lib/synthesize.js` (add; reuse `writeDirective` from blackboard, `buildL2Evidence` from l2adapter):
```js
import { buildL2Evidence } from './l2adapter.js';
// (writeDirective already imported)

export async function synthesizeL2(runDir, { llm } = {}) {
  if (typeof llm !== 'function') throw new Error('synthesizeL2 requires an llm function');
  const evidence = buildL2Evidence(runDir);
  const partial = await llm({ program: evidence.program, evidence });
  const directive = { ...partial, pass: evidence.pass };
  return writeDirective(runDir, evidence.pass, directive);
}
```

- [ ] **Step 4: Update CLI** `orchestration/bin/synthesize.js` to branch on `--l2`:
```js
#!/usr/bin/env node
import { synthesize, synthesizeL2 } from '../lib/synthesize.js';
import { llmDirective } from '../lib/llm.js';

const args = process.argv.slice(2);
const l2flag = args.indexOf('--l2');
const runDir = l2flag !== -1 ? args[l2flag + 1] : args[0];
if (!runDir) { console.error('Usage: synthesize [--l2] <runDir>'); process.exit(1); }

const fn = l2flag !== -1 ? synthesizeL2 : synthesize;
fn(runDir, { llm: llmDirective })
  .then((d) => { console.log(`L3 verdict: ${d.verdict} (pass ${d.pass})`); console.log(JSON.stringify(d, null, 2)); })
  .catch((err) => { console.error('synthesize failed:', err.message); process.exit(1); });
```

- [ ] **Step 5: Run** `cd orchestration && node --test test/synthesize.test.js` → PASS. Then `npm test` → all green.

- [ ] **Step 6: Smoke the CLI** with fake-LLM-free deterministic path:
```bash
cd orchestration && node bin/synthesize.js --l2 fixtures/l2-run 2>&1 | head -2 || true
```
(This calls the real llm; if no key/quota it should still print a verdict via the fallback in Task 1. Revert any fixture write: `git checkout orchestration/fixtures/l2-run`.)

- [ ] **Step 7: Commit**
```bash
git add orchestration/lib/synthesize.js orchestration/bin/synthesize.js orchestration/test/synthesize.test.js && git commit -m "feat(l3): synthesizeL2 + CLI --l2 flag for the live loop"
```

---

## Task 5: ModalExperimentRunner (experiments actually run on Modal)

**Files:**
- Create: `backend/autoresearch-orchestrator/backend/experiment/modal_runner.py`
- Test: `backend/autoresearch-orchestrator/tests/test_modal_runner.py`

> Read `backend/experiment/runner.py` first for the exact `ExperimentRunner` Protocol + `RunResult` shape. The Modal runner must satisfy the same interface as `LocalSubprocessRunner` so it drops into `ExperimentSwarm(runner=...)`.

- [ ] **Step 1: Write the failing test** (mock Modal — do NOT spin a real sandbox in unit tests). `tests/test_modal_runner.py`:
```python
import pytest
from backend.experiment.modal_runner import ModalExperimentRunner


@pytest.mark.asyncio
async def test_modal_runner_satisfies_protocol_shape(monkeypatch):
    # Fake the Modal sandbox exec so no network/GPU is needed.
    calls = {}

    class FakeProc:
        returncode = 0
        async def wait(self): return 0
        def stdout_read(self): return "val_bpb: 0.95\n"

    def fake_exec(self, command, cwd, timeout):
        calls["command"] = command
        return 0, "val_bpb: 0.95\n"

    runner = ModalExperimentRunner.__new__(ModalExperimentRunner)
    monkeypatch.setattr(ModalExperimentRunner, "_exec_in_sandbox", fake_exec, raising=False)
    result = await runner.run(command="uv run train.py", cwd="/tmp", timeout_seconds=60)
    assert result.exit_code == 0
    assert "val_bpb" in result.output
    assert calls["command"] == "uv run train.py"
```

- [ ] **Step 2: Run** `cd backend/autoresearch-orchestrator && source .venv/bin/activate && python -m pytest tests/test_modal_runner.py -q` → FAIL (no module).

- [ ] **Step 3: Implement** `backend/experiment/modal_runner.py` — mirror `RunResult`/Protocol from `runner.py` exactly (adapt field names to whatever `runner.py` actually defines):
```python
"""Run experiment training inside a Modal sandbox (GPU-capable)."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from config import Settings, settings


# Mirror the shape returned by LocalSubprocessRunner (see runner.py — adapt names to match).
@dataclass(slots=True)
class RunResult:
    exit_code: int
    output: str


class ModalExperimentRunner:
    """ExperimentRunner that executes the training command in a Modal sandbox."""

    def __init__(self, cfg: Settings = settings) -> None:
        self.cfg = cfg
        self._sandbox = None

    def _ensure_sandbox(self):
        import modal
        if self._sandbox is None:
            app = modal.App.lookup(self.cfg.modal_app_name, create_if_missing=True)
            image = modal.Image.debian_slim(python_version=self.cfg.modal_python_version)
            self._sandbox = modal.Sandbox.create(
                app=app, image=image, timeout=self.cfg.modal_timeout_seconds,
            )
        return self._sandbox

    def _exec_in_sandbox(self, command: str, cwd: str, timeout: int):
        sb = self._ensure_sandbox()
        proc = sb.exec("bash", "-lc", f"cd {cwd} && {command}")
        out = proc.stdout.read()
        proc.wait()
        return proc.returncode, out

    async def run(self, *, command: str, cwd: str | Path, timeout_seconds: int) -> RunResult:
        code, out = self._exec_in_sandbox(command, str(cwd), timeout_seconds)
        return RunResult(exit_code=code, output=out)
```
> IMPORTANT: after reading `runner.py`, make `RunResult` and the `run()` signature byte-match what `ExperimentSwarm` consumes (it calls `self.runner.run(command=..., cwd=..., timeout_seconds=...)` and reads `.output`/`.exit_code` or whatever the real names are). Align exactly; the test asserts the consumed shape.

- [ ] **Step 4: Run** the test → PASS. Then full L2 suite `python -m pytest -q` → still 58+ pass.

- [ ] **Step 5: Wire it (config flag).** In `main.py` where `ExperimentSwarm()` is built, inject `ModalExperimentRunner()` when `settings.experiment_use_modal` is true (add that setting to `config.py`, default False so existing tests/local runs are unaffected). Show the diff in the commit.

- [ ] **Step 6: Commit**
```bash
git add backend/autoresearch-orchestrator/backend/experiment/modal_runner.py backend/autoresearch-orchestrator/tests/test_modal_runner.py backend/autoresearch-orchestrator/config.py backend/autoresearch-orchestrator/main.py && git commit -m "feat(l2): ModalExperimentRunner so experiments execute on Modal (flagged)"
```

---

## Task 6: L3 proposer — the write-back seam (Python reads directive, invokes L3)

**Files:**
- Create: `backend/autoresearch-orchestrator/agents/l3_proposer.py`
- Test: `backend/autoresearch-orchestrator/tests/test_l3_proposer.py`

> Read `agents/experiment_swarm.py` `_propose_idea` + the `IdeaProposer` type first. The proposer is called with kwargs `(spec, current_code, best, ledger, results_tail)` and must return `(description, new_code)`. Empty strings = stop.

- [ ] **Step 1: Write the failing test** (mock the L3 subprocess + a fallback inner proposer). `tests/test_l3_proposer.py`:
```python
import json
import pytest
from pathlib import Path
from agents.l3_proposer import make_l3_proposer


@pytest.mark.asyncio
async def test_proposer_stops_on_commit(tmp_path, monkeypatch):
    run_dir = tmp_path
    (run_dir / "directives").mkdir()
    (run_dir / "directives" / "pass-1.json").write_text(json.dumps({
        "pass": 1, "verdict": "COMMIT", "checks": {}, "changes": [],
        "rationale": "good enough", "next_hypotheses": []
    }))

    async def inner(**kwargs):  # the normal experimenter
        return ("desc", "new code")

    # Skip the real L3 call; pretend synthesize already wrote pass-1.
    monkeypatch.setattr("agents.l3_proposer._invoke_l3", lambda rd: None)
    proposer = make_l3_proposer(run_dir, inner=inner, latest_pass=lambda: 1)
    desc, code = await proposer(spec=None, current_code="", best=0.9, ledger=None, results_tail="")
    assert desc == "" and code == ""        # COMMIT => stop


@pytest.mark.asyncio
async def test_proposer_continues_with_inner_on_continue(tmp_path, monkeypatch):
    run_dir = tmp_path
    (run_dir / "directives").mkdir()
    (run_dir / "directives" / "pass-1.json").write_text(json.dumps({
        "pass": 1, "verdict": "CONTINUE", "checks": {}, "changes": [],
        "rationale": "keep going", "next_hypotheses": ["try x"]
    }))

    async def inner(**kwargs):
        return ("desc", "new code")

    monkeypatch.setattr("agents.l3_proposer._invoke_l3", lambda rd: None)
    proposer = make_l3_proposer(run_dir, inner=inner, latest_pass=lambda: 1)
    desc, code = await proposer(spec=None, current_code="", best=0.9, ledger=None, results_tail="")
    assert desc == "desc" and code == "new code"
```

- [ ] **Step 2: Run** `python -m pytest tests/test_l3_proposer.py -q` → FAIL (no module).

- [ ] **Step 3: Implement** `agents/l3_proposer.py`:
```python
"""Wrap an idea_proposer so L3 directives steer the experiment loop.

Flow each generation: invoke the L3 CLI (reads results.tsv/ledger, writes
directives/pass-N.json), read the directive, then act on its verdict:
  COMMIT/ESCALATE -> ('', '')  (stop the loop)
  PIVOT/RETRY/CONTINUE -> delegate to the inner proposer (optionally hinted).
"""
from __future__ import annotations
import json
import subprocess
from pathlib import Path
from typing import Awaitable, Callable

L3_CLI = Path(__file__).resolve().parents[2] / "orchestration" / "bin" / "synthesize.js"

STOP_VERDICTS = {"COMMIT", "ESCALATE"}


def _invoke_l3(run_dir: Path) -> None:
    """Run the L3 synthesize CLI against the L2 run dir (writes directives/)."""
    subprocess.run(["node", str(L3_CLI), "--l2", str(run_dir)], check=False, capture_output=True)


def _read_latest_directive(run_dir: Path, pass_no: int) -> dict | None:
    path = run_dir / "directives" / f"pass-{pass_no}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text())


def make_l3_proposer(
    run_dir: Path,
    *,
    inner: Callable[..., Awaitable[tuple[str, str]]],
    latest_pass: Callable[[], int],
):
    run_dir = Path(run_dir)

    async def proposer(**kwargs) -> tuple[str, str]:
        _invoke_l3(run_dir)
        directive = _read_latest_directive(run_dir, latest_pass())
        if directive and directive.get("verdict") in STOP_VERDICTS:
            return ("", "")  # stop the loop
        # Optionally thread next_hypotheses as a hint to the inner proposer.
        hints = (directive or {}).get("next_hypotheses") or []
        return await inner(hint=hints, **kwargs) if _accepts_hint(inner) else await inner(**kwargs)

    return proposer


def _accepts_hint(fn) -> bool:
    import inspect
    try:
        return "hint" in inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False
```

- [ ] **Step 4: Run** the test → PASS (2 tests). Then full L2 suite → still green.

- [ ] **Step 5: Commit**
```bash
git add backend/autoresearch-orchestrator/agents/l3_proposer.py backend/autoresearch-orchestrator/tests/test_l3_proposer.py && git commit -m "feat(integration): L3 proposer seam — directives steer L2 experiment loop"
```

---

## Task 7: End-to-end loop smoke + docs

**Files:**
- Create: `backend/autoresearch-orchestrator/scripts/demo_l2_l3.py` (a tiny driver that builds an ExperimentSwarm with the L3 proposer over a throwaway run dir using a stub runner)
- Create/update: `orchestration/README.md` — document the file-bridge contract

- [ ] **Step 1: Write the driver** that wires `ExperimentSwarm(runner=<stub or modal>, idea_proposer=make_l3_proposer(...))` against a minimal fixture repo with a fake `train.py` that prints a metric, runs 2-3 generations, and prints the directives L3 emitted. (No assertions; it's a smoke/demo. Use the stub runner so it needs no Modal/GPU.)

- [ ] **Step 2: Run it** `cd backend/autoresearch-orchestrator && source .venv/bin/activate && python scripts/demo_l2_l3.py` — confirm: L2 runs generations, L3 writes `directives/pass-N.json`, and a COMMIT/ESCALATE stops the loop. Capture the output.

- [ ] **Step 3: Document the bridge** in `orchestration/README.md`: the shared runDir layout (`program.md`, `results.tsv`, `ledger.json`, `directives/pass-N.json`), how L2 invokes L3 (`node bin/synthesize.js --l2 <runDir>`), and the verdict→action mapping.

- [ ] **Step 4: Full both-suite check.** `cd orchestration && npm test` (all green) AND `cd backend/autoresearch-orchestrator && source .venv/bin/activate && python -m pytest -q` (all green). Report both totals.

- [ ] **Step 5: Commit**
```bash
git add backend/autoresearch-orchestrator/scripts/demo_l2_l3.py orchestration/README.md && git commit -m "feat(integration): end-to-end L2<->L3 loop demo + bridge docs"
```

- [ ] **Step 6: STOP — backend loop complete.** Do NOT start the UI here. The monitoring UI is a separate, post-design effort.

---

## Self-Review notes
- **Vet fixes covered:** Modal-not-used → Task 5; results.tsv crash=0.000000 → Task 3 (null on crash, status-gated); ledger-resets-per-run → Tasks 4/6 share a stable runDir; idea_proposer no-directive-arg → Task 6 binds runDir via closure. ✓
- **Realignment covered:** held-out dropped (Task 3 evidence has no train/val/held_out); plateau+crashRate added (Task 2); single-metric program parse (Task 3). ✓
- **Loop resilience:** full-LLM verdict each generation, but Task 1 guarantees a valid directive even on LLM bool-garbage/429 (coercion + deterministic fallback) so the loop never dies. ✓
- **Type consistency:** `buildL2Evidence`→`{program,pass,rows,ledger,best,crashRate,plateau,history}` consumed identically by `synthesizeL2` + the fake llm in tests; `make_l3_proposer(run_dir, inner, latest_pass)` signature matches its test. ✓
