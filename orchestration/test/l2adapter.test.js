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
  assert.equal(crash.value, null);
});

test('readL2Ledger parses attempts with outcomes', () => {
  const ledger = readL2Ledger(RUN);
  assert.equal(ledger.attempts.length, 3);
  assert.equal(ledger.attempts.find((a) => a.error_class === 'OOM').outcome, 'failure');
});

test('readL2Program extracts metric + direction from freeform program.md', () => {
  const p = readL2Program(RUN);
  assert.equal(p.metric, 'val_bpb');
  assert.equal(p.lowerIsBetter, true);
});

test('buildL2Evidence computes best-so-far ignoring crashes + crashRate', () => {
  const ev = buildL2Evidence(RUN);
  assert.equal(ev.pass, 5);
  assert.ok(Math.abs(ev.best - 0.99) < 1e-9);
  assert.ok(ev.crashRate > 0);
  assert.ok(typeof ev.plateau === 'boolean');
});
