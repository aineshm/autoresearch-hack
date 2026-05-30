// The Planner: confirmed brief -> a plan of what TYPE of variables the swarm should hunt.
// Pipeline: decompose (mini) -> research each angle in parallel (OpenAI web search) ->
// distill each (mini) -> synthesize the plan (bigger model). Falls back to a scripted plan
// with no key so it still demos.
import OpenAI from 'openai';
import {
  DECOMPOSE_SYSTEM, decomposeUser, DISTILL_SYSTEM, distillUser, SYNTH_SYSTEM, synthUser,
} from './prompts.js';
import { fallbackPlan } from './fallback.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const SEARCH_MODEL = process.env.PLANNER_SEARCH_MODEL || 'gpt-5-search-api'; // web search
const MINI_MODEL = process.env.PLANNER_MINI_MODEL || 'gpt-5.4-mini';        // decompose + distill
const SYNTH_MODEL = process.env.PLANNER_SYNTH_MODEL || 'gpt-5.4';           // the bigger agent
const REASONING = process.env.PLANNER_REASONING_EFFORT || 'medium';
const MAX_ANGLES = Number(process.env.PLANNER_MAX_ANGLES || 4);

export function plannerConfigured() {
  return !!openai;
}
export function plannerModels() {
  return { search: SEARCH_MODEL, mini: MINI_MODEL, synth: SYNTH_MODEL, reasoning: REASONING };
}

async function jsonCall(model, system, user, { reasoning = REASONING } = {}) {
  const completion = await openai.chat.completions.create({
    model,
    reasoning_effort: reasoning,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return JSON.parse(completion.choices?.[0]?.message?.content || '{}');
}

// One web-search call (search models auto-search; no reasoning_effort/temperature).
async function researchOne({ angle, query }) {
  try {
    const completion = await openai.chat.completions.create({
      model: SEARCH_MODEL,
      messages: [{
        role: 'user',
        content: `Research, with sources: ${query}\nFocus on what would help decide what kinds of features/variables/approaches to try. Be concrete and cite sources.`,
      }],
    });
    const msg = completion.choices?.[0]?.message || {};
    const sources = (msg.annotations || [])
      .filter((a) => a.type === 'url_citation' && a.url_citation)
      .map((a) => ({ title: a.url_citation.title || a.url_citation.url, url: a.url_citation.url }));
    return { angle, query, findings: msg.content || '', sources };
  } catch (err) {
    return { angle, query, findings: `(research failed: ${err?.message || err})`, sources: [] };
  }
}

// Non-streaming convenience wrapper.
export async function runPlan({ brief } = {}) {
  return runPlanStream({ brief, emit: () => {} });
}

/**
 * Streaming pipeline. `emit(event)` fires as work happens so the UI can show a
 * Perplexity-style live research trace. Events:
 *   {type:'stage', stage, label}
 *   {type:'queries', queries:[{angle,query}]}
 *   {type:'search_start', angle, query}
 *   {type:'search_done', angle, query, sources:[{title,url}], found}
 *   {type:'plan', plan}
 * @returns {Promise<{plan:object, research:Array, queries:Array}>}
 */
export async function runPlanStream({ brief, emit = () => {} } = {}) {
  if (!brief || !brief.enriched_question) throw new Error('a confirmed brief is required');
  if (!openai) {
    const fb = fallbackPlan(brief);
    emit({ type: 'plan', plan: fb.plan });
    return fb;
  }

  // 1) decompose into research angles
  emit({ type: 'stage', stage: 'decompose', label: 'Planning research' });
  const dec = await jsonCall(MINI_MODEL, DECOMPOSE_SYSTEM, decomposeUser(brief));
  const queries = (Array.isArray(dec.queries) ? dec.queries : []).slice(0, MAX_ANGLES);
  if (!queries.length) {
    const fb = fallbackPlan(brief);
    emit({ type: 'plan', plan: fb.plan });
    return fb;
  }
  emit({ type: 'queries', queries });

  // 2) research each angle in parallel (web search) — emit per-search progress
  emit({ type: 'stage', stage: 'research', label: 'Researching the domain' });
  const research = await Promise.all(
    queries.map(async (q) => {
      emit({ type: 'search_start', angle: q.angle, query: q.query });
      const r = await researchOne(q);
      emit({ type: 'search_done', angle: q.angle, query: q.query, sources: r.sources, found: r.sources.length });
      return r;
    })
  );

  // 3) distill each result (mini)
  emit({ type: 'stage', stage: 'distill', label: 'Reading the research' });
  const distilled = await Promise.all(
    research.map((r) =>
      jsonCall(MINI_MODEL, DISTILL_SYSTEM, distillUser({ ...r, brief }))
        .then((d) => ({ ...d, sources: d.sources?.length ? d.sources : r.sources }))
        .catch(() => ({ angle: r.angle, useful_findings: [], suggested_variable_categories: [], caveats: [], sources: r.sources }))
    )
  );

  // 4) synthesize the plan (bigger agent)
  emit({ type: 'stage', stage: 'synthesize', label: 'Writing the plan' });
  const plan = await jsonCall(SYNTH_MODEL, SYNTH_SYSTEM, synthUser({ brief, distilled }));
  if (!Array.isArray(plan.research_sources) || !plan.research_sources.length) {
    plan.research_sources = distilled.flatMap((d) => d.sources || []).slice(0, 8);
  }
  emit({ type: 'plan', plan });
  return { plan, research: distilled, queries };
}
