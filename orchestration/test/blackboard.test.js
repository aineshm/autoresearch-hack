import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readProgram, readResults, readRuns, listPasses, writeDirective } from '../lib/blackboard.js';

const here = dirname(fileURLToPath(import.meta.url));
const RUN = join(here, '..', 'fixtures', 'run-overfit');

test('readProgram parses front-matter into a Program', () => {
  const p = readProgram(RUN);
  assert.equal(p.task_type, 'classification');
  assert.equal(p.direction, 'max');
  assert.match(p.success_criteria, /0\.90/);
});

test('readResults returns the validated pass', () => {
  const r = readResults(RUN, 1);
  assert.equal(r.candidates[0].metrics.train, 0.99);
});

test('readRuns parses jsonl lines', () => {
  const runs = readRuns(RUN, 1);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].agent_role, 'code-optimizer');
});

test('listPasses finds pass numbers from results/', () => {
  assert.deepEqual(listPasses(RUN), [1]);
});

test('writeDirective validates and writes directives/pass-N.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bb-'));
  try {
    writeDirective(tmp, 1, { pass: 1, verdict: 'CONTINUE', checks: {}, changes: [], rationale: 'ok', next_hypotheses: [] });
    const written = JSON.parse(readFileSync(join(tmp, 'directives', 'pass-1.json'), 'utf8'));
    assert.equal(written.verdict, 'CONTINUE');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('readResults throws a clear error on a missing pass', () => {
  assert.throws(() => readResults(RUN, 99), /pass-99/);
});
