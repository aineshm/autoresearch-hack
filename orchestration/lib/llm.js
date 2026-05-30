import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM = `You are L3, the Synthesizer in AutoLab. You read the research goal and \
one pass of experiment results plus deterministic evidence, then decide the next move. \
Trust the provided numeric evidence; do not invent metrics. Output ONLY JSON matching: \
{ verdict: one of CONTINUE|RETRY|PIVOT|COMMIT|ESCALATE, checks: { overfit:{ok,evidence}, \
stagnation:{ok,evidence} }, changes: [{target,action,field?,value?,reason}], rationale, \
next_hypotheses: [] }. COMMIT only if success_criteria is met. RETRY for fixable issues \
(overfit, bad config). PIVOT/ESCALATE if the path is dead or mis-scoped.`;

export async function llmDirective({ program, evidence }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const user = JSON.stringify({
    goal: program.goal,
    success_criteria: program.success_criteria,
    direction: program.direction,
    pass: evidence.pass,
    gaps: evidence.gaps,
    plateau: evidence.plateau,
    history: evidence.history,
    candidates: evidence.results.candidates.map((c) => ({ id: c.id, metrics: c.metrics, status: c.status, config: c.config })),
    run_anomalies: evidence.runs.flatMap((r) => r.anomalies),
  });
  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
  });
  return JSON.parse(completion.choices[0].message.content);
}
