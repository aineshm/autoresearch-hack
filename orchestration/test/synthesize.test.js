import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { synthesize, buildEvidence } from '../lib/synthesize.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '..', 'fixtures');

function copyRun(name) {
  const tmp = mkdtempSync(join(tmpdir(), 'syn-'));
  cpSync(join(FIX, name), tmp, { recursive: true });
  return tmp;
}

test('buildEvidence flags overfit on the overfit fixture', () => {
  const ev = buildEvidence(join(FIX, 'run-overfit'));
  assert.equal(ev.pass, 1);
  assert.ok(ev.gaps[0].gap > 0.05);
  assert.equal(ev.plateau, false);
});

test('buildEvidence detects plateau across 3 passes', () => {
  const ev = buildEvidence(join(FIX, 'run-plateau'));
  assert.equal(ev.pass, 3);
  assert.equal(ev.plateau, true);
});

test('synthesize writes a schema-valid directive using the injected llm', async () => {
  const run = copyRun('run-overfit');
  try {
    const fakeLlm = async ({ evidence }) => ({
      verdict: evidence.gaps[0].gap > 0.05 ? 'RETRY' : 'CONTINUE',
      checks: { overfit: { ok: evidence.gaps[0].gap <= 0.05, evidence: `gap ${evidence.gaps[0].gap}` },
                stagnation: { ok: !evidence.plateau, evidence: evidence.plateau ? 'plateau' : 'moving' } },
      changes: [], rationale: 'test', next_hypotheses: [],
    });
    const directive = await synthesize(run, { llm: fakeLlm });
    assert.equal(directive.verdict, 'RETRY');
    assert.ok(existsSync(join(run, 'directives', 'pass-1.json')));
    const onDisk = JSON.parse(readFileSync(join(run, 'directives', 'pass-1.json'), 'utf8'));
    assert.equal(onDisk.checks.overfit.ok, false);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
});
