import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProgramSchema, PassResultsSchema, RunRecordSchema, DirectiveSchema } from '../lib/schemas.js';

test('PassResultsSchema accepts a valid pass', () => {
  const ok = PassResultsSchema.parse({
    pass: 1,
    candidates: [{
      id: 'candidate-1', hypothesis: 'baseline', config: { model: 'xgboost' },
      metrics: { train: 0.91, val: 0.86, held_out: 0.84 },
      status: 'ok', error: null, artifacts: [], run_id: 'rd-1',
    }],
  });
  assert.equal(ok.candidates[0].metrics.held_out, 0.84);
});

test('PassResultsSchema rejects a candidate missing run_id', () => {
  assert.throws(() => PassResultsSchema.parse({
    pass: 1,
    candidates: [{ id: 'c1', hypothesis: 'x', config: {}, metrics: { train: 1, val: 1, held_out: 1 }, status: 'ok', error: null, artifacts: [] }],
  }));
});

test('DirectiveSchema requires a known verdict', () => {
  assert.throws(() => DirectiveSchema.parse({ pass: 1, verdict: 'BOGUS', checks: {}, changes: [], rationale: '', next_hypotheses: [] }));
});

test('ProgramSchema and RunRecordSchema parse valid input', () => {
  ProgramSchema.parse({ goal: 'g', task_type: 'classification', metric: 'accuracy', direction: 'max', success_criteria: 'held_out >= 0.9', plan: 'do it' });
  RunRecordSchema.parse({ run_id: 'rd-1', raindrop_trace_id: 'rd-1', agent_role: 'code-optimizer', experiment_id: 'candidate-1', status: 'ok', anomalies: [], summary: 's' });
});
