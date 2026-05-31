// Tiny zero-dependency AutoLab client (browser or Node 18+ with global fetch).
//   import { createClient } from './autolab.mjs';
//   const autolab = createClient({ baseUrl: 'http://localhost:4000', apiKey: 'autolab_pk_...' });

export function createClient({ baseUrl, apiKey, token } = {}) {
  if (!baseUrl) throw new Error('baseUrl is required');
  const base = baseUrl.replace(/\/$/, '');
  const headers = {
    'content-type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  async function call(path, body) {
    const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
    return data;
  }

  return {
    /** One interview step. */
    briefNext: (goal, transcript = [], dataset) => call('/api/brief/next', { goal, transcript, dataset }),

    /** Whole interview auto-answered → { questions, transcript, brief }. */
    briefSimulate: (goal, dataset) => call('/api/brief/simulate', { goal, dataset }),

    /** Brief → research-backed plan → { plan, research, queries }. */
    plan: (brief) => call('/api/planner/plan', { brief }),

    /**
     * Drive the full brief interview. `answer(question)` returns the user's answer
     * (string). Resolves to the finalized brief.
     */
    async runBrief(goal, answer, { dataset, maxSteps = 6 } = {}) {
      const transcript = [];
      for (let i = 0; i < maxSteps; i++) {
        const step = await this.briefNext(goal, transcript, dataset);
        if (step.action === 'finalize') return step.brief;
        const a = await answer(step.question);
        transcript.push({ id: step.question.id, question: step.question.question, answer: a });
      }
      // hit the step cap: finalize via simulate as a fallback
      return (await this.briefSimulate(goal, dataset)).brief;
    },

    /** Stream the planner; calls onEvent(evt) per NDJSON line; resolves to the plan. */
    async planStream(brief, onEvent) {
      const res = await fetch(base + '/api/planner/plan/stream', { method: 'POST', headers, body: JSON.stringify({ brief }) });
      if (!res.ok || !res.body) throw new Error(`plan stream failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', plan = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line);
          if (evt.type === 'plan') plan = evt.plan;
          onEvent?.(evt);
        }
      }
      return plan;
    },
  };
}
