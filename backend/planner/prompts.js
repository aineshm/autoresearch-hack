// The Planner's three LLM roles: decompose → distill → synthesize.
// Input: the confirmed enriched brief. Output: a PLAN of what TYPE of variables the swarm
// should hunt + what a useful output looks like. NEVER exact variables/models (orchestration owns that).

// 1) DECOMPOSE (mini) — turn the brief into a few web-research angles that would reveal the
//    CATEGORIES of variables / approaches worth trying.
export const DECOMPOSE_SYSTEM = `You are the Planner's research planner. Given a confirmed research brief, produce 3-4 focused WEB-SEARCH queries whose answers would reveal what CATEGORIES of variables / approaches would move the needle on this problem. Aim across: (a) known precursor signals / features in this domain, (b) feature-engineering approaches, (c) model/approach families that fit the data + constraints, (d) evaluation methods (metrics, splits, lead-time). Queries must be specific and searchable. Do NOT ask for exact hyperparameters.
Use no em-dashes in any text. Respond with ONLY JSON: {"queries":[{"angle":"short label","query":"the web search query"}]}`;

export function decomposeUser(brief) {
  return `CONFIRMED BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nProduce 3-4 research angles + queries (JSON).`;
}

// 2) DISTILL (mini) — read one web-research result and extract the useful bits + what variable
//    CATEGORIES/approaches it suggests adding to the plan.
export const DISTILL_SYSTEM = `You are the Planner's research distiller. You are given a research ANGLE, the BRIEF, and raw WEB FINDINGS (with sources). Extract only what is USEFUL for deciding what TYPES of variables the swarm should explore. Translate findings into variable CATEGORIES / approaches (not exact configs). Be honest about what looks promising vs weak.
Respond with ONLY JSON:
{"angle":"...","useful_findings":["..."],"suggested_variable_categories":["category/approach, with one-line why"],"caveats":["what to be skeptical of"],"sources":[{"title":"...","url":"..."}]}`;

export function distillUser({ angle, query, findings, brief }) {
  return `ANGLE: ${angle}\nQUERY: ${query}\n\nBRIEF (for relevance):\n${JSON.stringify(brief).slice(0, 1200)}\n\nRAW WEB FINDINGS:\n${findings}\n\nDistill (JSON).`;
}

// 3) SYNTHESIZE (bigger model) — fuse the brief + distilled research into the PLAN.
export const SYNTH_SYSTEM = `You are the Planner. Using the confirmed BRIEF and the DISTILLED RESEARCH, write the plan that tells the downstream orchestration agent WHERE TO START hunting for variables and WHAT A USEFUL OUTPUT LOOKS LIKE. You do NOT name exact variables, models, or hyperparameters — only the CATEGORIES/types and the rationale; the orchestration agent + swarm turn those into concrete experiments.
Principles: ground every category in the brief and the research; respect the brief's answer_contract and constraints; "likely_dead_ends" are DEPRIORITIZATIONS (a prior), never hard walls, and never claim something is useless without evidence; keep it tight and actionable. WRITING STYLE: never use em-dashes (the long dash) anywhere in your output; use commas, periods, or parentheses instead.
Respond with ONLY JSON:
{
  "summary": "2-3 sentences: the research approach in plain terms",
  "variable_categories": [
    {"category":"the TYPE of variable/feature/approach to explore", "rationale":"why it should move the needle (cite the brief/research)", "example_kinds":["illustrative kinds, NOT exact configs"], "priority":"high|medium|low"}
  ],
  "start_here": ["the highest-value places to look FIRST (priors / seed directions)"],
  "likely_dead_ends": ["approaches research suggests are probably low-value here — deprioritize, not forbidden"],
  "what_useful_output_looks_like": "the criteria the introspection agent uses to judge whether a finding is real/useful for THIS brief",
  "open_directions": ["promising but uncertain angles worth a small exploration budget"],
  "research_sources": [{"title":"...","url":"..."}]
}`;

export function synthUser({ brief, distilled }) {
  return `CONFIRMED BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nDISTILLED RESEARCH (per angle):\n${JSON.stringify(distilled, null, 2)}\n\nWrite the PLAN (JSON). Categories/types only — no exact variables.`;
}
