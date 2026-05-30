import { z } from 'zod';

export const VERDICTS = ['CONTINUE', 'RETRY', 'PIVOT', 'COMMIT', 'ESCALATE'];

export const ProgramSchema = z.object({
  goal: z.string(),
  task_type: z.string(),
  metric: z.string(),
  direction: z.enum(['min', 'max']),
  success_criteria: z.string(),
  plan: z.string(),
});

export const CandidateSchema = z.object({
  id: z.string(),
  hypothesis: z.string(),
  config: z.record(z.any()),
  metrics: z.object({ train: z.number(), val: z.number(), held_out: z.number() }),
  status: z.enum(['ok', 'error']),
  error: z.string().nullable(),
  artifacts: z.array(z.string()),
  run_id: z.string(),
});

export const PassResultsSchema = z.object({
  pass: z.number().int().nonnegative(),
  candidates: z.array(CandidateSchema).min(1, 'a pass must report at least one candidate'),
});

export const RunRecordSchema = z.object({
  run_id: z.string(),
  raindrop_trace_id: z.string(),
  agent_role: z.string(),
  experiment_id: z.string(),
  status: z.string(),
  anomalies: z.array(z.string()),
  summary: z.string(),
});

export const CheckSchema = z.object({ ok: z.boolean(), evidence: z.string() });

export const ChangeSchema = z.object({
  target: z.string(),
  action: z.string(),
  field: z.string().optional(),
  value: z.any().optional(),
  reason: z.string(),
});

export const DirectiveSchema = z.object({
  pass: z.number().int().nonnegative(),
  verdict: z.enum(VERDICTS),
  checks: z.record(CheckSchema),
  changes: z.array(ChangeSchema),
  rationale: z.string(),
  next_hypotheses: z.array(z.string()),
});
