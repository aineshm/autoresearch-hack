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
