// Launch bridge: turn an L1 plan into a running L2 research swarm.
//
// createRunDir() writes a Karpathy-style program.md (from the plan) + a starter
// train.py into a fresh run directory and git-inits it (the swarm needs git for
// commit/revert). spawnSwarm() launches the Python experiment swarm over that dir
// as a detached subprocess and returns immediately; the swarm writes results.tsv +
// directives/ into the dir, which the SwarmMonitor polls via /api/monitor/<runId>.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// backend/run/ -> backend/ -> repo root
const REPO_ROOT = resolve(__dirname, '..', '..');
const L2_DIR = join(REPO_ROOT, 'backend', 'autoresearch-orchestrator');
const L2_PYTHON = join(L2_DIR, '.venv', 'bin', 'python');

function runsBase() {
  return process.env.MONITOR_RUNS_DIR || '/tmp/autolab-runs';
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Build a Karpathy-style program.md from the L1 plan. The plan narrative drives
// the research; experiment defaults (metric, run command, edit file) let L2's
// deterministic loop run, score, and keep/discard.
// TODO: optionally route plan->program.md through L2's PI agent for a richer compile.
function programMdFromPlan(plan) {
  const summary = plan?.summary || 'Improve the model on the held-out metric.';
  const cats = asList(plan?.variable_categories)
    .map((c) => `- **${c.category || 'category'}** (${c.priority || 'medium'}): ${c.rationale || ''}`)
    .join('\n');
  const starts = asList(plan?.start_here).map((s) => `- ${s}`).join('\n');

  return `# Autoresearch run

## Goal
${summary}

## What the swarm should explore
${cats || '- (no categories provided)'}

## Start here
${starts || '- Establish a baseline, then iterate.'}

## Experiment contract
Edit \`train.py\`. Run with \`python train.py\`. The metric is \`val_bpb\` (lower is better).
Improve val_bpb generation over generation. Do not install new packages.
`;
}

// A starter train.py so the baseline run produces a metric the loop can build on.
const STARTER_TRAIN_PY = `# Starter experiment. The swarm edits this file to improve val_bpb.
print('val_bpb: 1.0')
print('peak_vram_mb: 10.0')
`;

export function createRunDir(runId, plan) {
  const dir = join(runsBase(), runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'program.md'), programMdFromPlan(plan), 'utf8');
  writeFileSync(join(dir, 'train.py'), STARTER_TRAIN_PY, 'utf8');

  // git init + baseline commit (the experiment loop commits/reverts per experiment).
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=run@autolab', '-c', 'user.name=autolab', 'commit', '-q', '-m', 'baseline');
  return dir;
}

export function spawnSwarm(runDir, { maxExperiments = 3 } = {}) {
  const logFd = openSync(join(runDir, 'swarm.log'), 'a');
  const child = spawn(
    L2_PYTHON,
    ['main.py', '--experiment-repo', runDir, '--max-experiments', String(maxExperiments)],
    {
      cwd: L2_DIR,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        PYTHONPATH: '.',
        EXPERIMENT_USE_MODAL: process.env.EXPERIMENT_USE_MODAL || 'true',
        USE_L3_PROPOSER: 'true',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      },
    },
  );
  child.unref();
  return child.pid;
}
