// Self-eval harness: run the whole brief interview autonomously (an LLM plays the
// operator, free-text included), then score the final brief against the PRD rubric.
// Usage: node --env-file=backend/.env backend/brief/eval.mjs
import OpenAI from 'openai';
import { nextStep } from './agent.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.BRIEF_MODEL || 'gpt-5.4-mini';

const GOAL = `We operate a fleet of fixed-wing autonomous drones for aerial surveying. Over the past year we've had 6 unexpected crashes and about a dozen "mystery incidents" where the plane came back but behaved strangely mid-flight. We have all the flight logs. Our pilots say they can sometimes feel something is "off" before it gets bad, but we have no automated way to catch it. We're losing money on repairs and we're worried about liability. Can you help?`;

const PERSONA = `You are the drone-fleet operations lead from this scenario. You are NOT an ML expert; you talk plainly.
Your real preferences (answer consistently with these):
- You want a warning DURING the flight so a pilot can react.
- Catch as many real problems as possible — a missed fault can lose a plane (safety + liability). False alarms are tolerable but you don't want it crying wolf constantly.
- You care about BOTH the crashes AND the recoverable "something felt off" flights, but NOT trivial one-off noise (a brief GPS blip, a gust).
- You want the warning as early as possible.
Answer the question naturally. You MAY pick one of the given options (reply with its value) or, when the options don't fit, type your own short sentence. Reply with ONLY JSON: {"answer":"..."}.`;

const RUBRIC = `You are a strict reviewer grading an L1 Brief against its PRD (ALFA drone fleet test).
A GREAT brief MUST:
1. enriched_question is grounded in the data WE ALREADY HAVE and explicitly says we LEARN FROM THE HISTORICAL INCIDENTS (the 6 crashes + ~12 mystery incidents in the logs) to warn on FUTURE flights. (This is the most important check — heavily penalize if it reads like building from scratch or ignores that the historical labeled incidents are the training signal.)
2. real-time / mid-flight warning, as EARLY as possible (lead time).
3. recall-favored / never-miss stance, with false alarms under a usable budget (safety-critical: false negatives worse).
4. captures "ignore trivial transient noise" (GPS blips/gusts) if the operator said it.
5. intent = object {what_they_want, expertise_level=non_expert-ish}.
6. answer_contract = object {when, what_counts_as_caught (ties to the historical incidents), done_when (held-out UNSEEN flights + explain which signals)}.
7. claims_to_test populated (e.g., pilots sense it early; engine main worry; faults sudden) — kept separate from data_facts.
8. data_facts present and real (n_flights, channels, labels incl. fault onset+type).
9. assumptions NON-EMPTY; confidence set (0-1).
10. NO search_space / models / experiments (scope check — fail if present).
11. <= 3 questions asked.
Return ONLY JSON: {"score": 0-100, "passed": true|false, "missing": ["short gap", ...], "notes": "1-2 sentences"}.`;

async function answerAs(question) {
  const opts = (question.options || []).map((o) => `${o.value} = ${o.label}`).join('; ');
  const r = await openai.chat.completions.create({
    model: MODEL, reasoning_effort: 'low', response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PERSONA },
      { role: 'user', content: `QUESTION: ${question.question}\nOPTIONS: ${opts || '(free text)'}\nReply JSON {"answer":"..."}.` },
    ],
  });
  try { return JSON.parse(r.choices[0].message.content).answer; } catch { return question.default_value || 'yes'; }
}

async function judge(brief, nQuestions) {
  const r = await openai.chat.completions.create({
    model: MODEL, reasoning_effort: 'medium', response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RUBRIC },
      { role: 'user', content: `QUESTIONS ASKED: ${nQuestions}\n\nBRIEF:\n${JSON.stringify(brief, null, 2)}` },
    ],
  });
  return JSON.parse(r.choices[0].message.content);
}

const transcript = [];
let brief = null, n = 0;
for (let i = 0; i < 6; i++) {
  const step = await nextStep({ goal: GOAL, transcript });
  if (step.action === 'finalize') { brief = step.brief; break; }
  const a = await answerAs(step.question);
  transcript.push({ id: step.question.id, question: step.question.question, answer: a });
  n++;
  console.log(`Q${n} [${step.question.input_type}] ${step.question.question}\n   -> ${a}`);
}
console.log('\n========== FINAL BRIEF ==========');
console.log(JSON.stringify(brief, null, 2));
if (brief) {
  const v = await judge(brief, n);
  console.log('\n========== JUDGE (vs PRD) ==========');
  console.log(JSON.stringify(v, null, 2));
} else {
  console.log('\nNO BRIEF PRODUCED (asked too many / loop limit).');
}
