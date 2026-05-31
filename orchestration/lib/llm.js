import OpenAI from 'openai';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM = `You are the Research Judge in AutoLab — an introspection layer over an \
autonomous ML experiment swarm. You read the research goal and the swarm's experiment \
history (each experiment has one metric value + a keep/discard/crash status) plus \
deterministic evidence (best-so-far, plateau, crash rate, repeated ledger failures). \
Decide the next move. Trust the provided numbers; never invent metrics. \
Output ONLY JSON matching: { verdict: one of CONTINUE|RETRY|PIVOT|COMMIT|ESCALATE, \
checks: { plateau:{ok,evidence}, crash:{ok,evidence}, stagnation:{ok,evidence} }, \
changes: [{target,action,field?,value?,reason}], rationale, next_hypotheses: [] }. \
COMMIT when the goal metric is reached. PIVOT when progress has plateaued — steer toward \
a new family of approaches. ESCALATE when crash rate is high or the path is dead/mis-scoped. \
CONTINUE/RETRY when the current direction is still improving. \
For each check, ok=true means HEALTHY (no problem); ok=false means the issue fired. \
Every \`ok\` field MUST be a JSON boolean (true or false), never a string.`;

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

// Build the prompt payload from L2 single-metric evidence (rows + ledger),
// defensively so a shape surprise can never throw before the try/catch.
function evidenceToPayload(program, evidence) {
  const rows = Array.isArray(evidence?.rows) ? evidence.rows : [];
  const attempts = Array.isArray(evidence?.ledger?.attempts) ? evidence.ledger.attempts : [];
  return {
    metric: program?.metric ?? 'val_bpb',
    lower_is_better: program?.lowerIsBetter ?? true,
    program: (program?.program_md ?? '').slice(0, 800),
    pass: evidence?.pass ?? 0,
    best: evidence?.best ?? null,
    plateau: evidence?.plateau ?? false,
    crash_rate: evidence?.crashRate ?? 0,
    history: evidence?.history ?? [],
    experiments: rows.map((r) => ({
      commit: r.commit, value: r.value, status: r.status, description: r.description,
    })),
    ledger_failures: attempts.filter((a) => a.outcome === 'failure').map((a) => a.approach),
  };
}

export async function llmDirective({ program, evidence }) {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const user = JSON.stringify(evidenceToPayload(program, evidence));
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return normalizeDirective(parsed, evidence);
  } catch {
    return normalizeDirective({}, evidence);
  }
}
