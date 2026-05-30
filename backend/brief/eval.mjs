// Self-eval harness. Runs the whole brief interview autonomously (an LLM plays the user),
// then scores the brief against a rubric. Also checks two hard rules: questions are ATOMIC
// (one ask each) and NO em-dashes anywhere in the output.
// Usage: node --env-file=backend/.env backend/brief/eval.mjs            (default: general/churn)
//        EVAL_SCENARIO=drone node --env-file=backend/.env backend/brief/eval.mjs
import OpenAI from 'openai';
import { nextStep } from './agent.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.BRIEF_MODEL || 'gpt-5.4-mini';

const SCENARIOS = {
  churn: {
    label: 'SaaS churn (general / normal research)',
    domain: 'SaaS subscription churn prediction from account usage, billing, and support data',
    goal: "We're a SaaS company and we want to predict which customers are going to cancel their subscription so our success team can step in early. We have a CSV with each account's usage, plan, billing history, and support tickets.",
    persona: `You are the head of customer success at a SaaS company. You are NOT an ML expert and speak plainly.
Preferences: you care most about catching customers who will actually churn (a missed churner is lost revenue), but you don't want to flood the team with false alarms. "Churn" means they cancel or fail to renew. You'd want a few weeks of lead time to act.
Answer the question naturally; pick one of the options (reply its value) or type your own short answer. Reply ONLY JSON {"answer":"..."}.`,
  },
  drone: {
    label: 'UAV fault detection (the special-case pack)',
    domain: 'early in-flight fault/anomaly detection for fixed-wing UAVs from flight logs',
    goal: `We operate a fleet of fixed-wing autonomous drones for aerial surveying. Over the past year we've had 6 unexpected crashes and about a dozen "mystery incidents". We have all the flight logs. Can you help?`,
    persona: `You are a drone-fleet ops lead, not an ML expert. You want a mid-flight warning so a pilot can react; catching real faults matters more than avoiding false alarms (a miss can lose a plane), but don't cry wolf constantly; ignore trivial transient glitches; warn as early as possible. Reply ONLY JSON {"answer":"..."}.`,
  },
};

const KEY = process.env.EVAL_SCENARIO || 'churn';
const S = SCENARIOS[KEY] || SCENARIOS.churn;

const RUBRIC = `You are a strict reviewer grading an L1 Brief for this domain: ${S.domain}.
A GREAT brief MUST:
1. enriched_question is grounded in what the user ACTUALLY wants in THIS domain. Heavily penalize any facts borrowed from an unrelated domain, or any data details the user never gave.
2. intent = {what_they_want, expertise_level} (operator/non-expert tone respected).
3. answer_contract = {when, what_counts_as_caught, done_when} with done_when referencing held-out / unseen evaluation.
4. claims_to_test populated with the user's domain claims, kept SEPARATE from data_facts.
5. data_facts reflect ONLY what the user actually said about their data (not invented).
6. captures the user's cost-of-error stance; assumptions NON-EMPTY; confidence set.
7. NO search_space / models / experiments (scope check).
Return ONLY JSON: {"score":0-100,"passed":true|false,"missing":["short gap"],"notes":"1-2 sentences"}.`;

const ATOMIC_RUBRIC = `For each question below, say whether it asks EXACTLY ONE thing. A question is NOT atomic if it bundles two asks (e.g. "X, and also Y?", "what counts as churn and how far ahead?"). Return ONLY JSON: {"all_atomic":true|false,"compound":["the question text that bundles 2+ asks"]}.`;

async function answerAs(question) {
  const opts = (question.options || []).map((o) => `${o.value} = ${o.label}`).join('; ');
  const r = await openai.chat.completions.create({
    model: MODEL, reasoning_effort: 'low', response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: S.persona },
               { role: 'user', content: `QUESTION: ${question.question}\nOPTIONS: ${opts || '(free text)'}\nReply JSON {"answer":"..."}.` }],
  });
  try { return JSON.parse(r.choices[0].message.content).answer; } catch { return question.default_value || 'yes'; }
}
async function judge(system, user) {
  const r = await openai.chat.completions.create({
    model: MODEL, reasoning_effort: 'medium', response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return JSON.parse(r.choices[0].message.content);
}

const EMDASH = /[—–]/; // em-dash or en-dash

const transcript = [];
const asked = [];
let brief = null, n = 0;
console.log(`scenario: ${S.label}\nmodel: ${MODEL}\n`);
for (let i = 0; i < 6; i++) {
  const step = await nextStep({ goal: S.goal, transcript });
  if (step.action === 'finalize') { brief = step.brief; break; }
  const q = step.question;
  asked.push(q);
  const a = await answerAs(q);
  transcript.push({ id: q.id, question: q.question, answer: a });
  n++;
  console.log(`Q${n} [${q.input_type}] ${q.question}`);
  console.log('   options:', (q.options || []).map((o) => o.label).join(' | ') || '(free text)');
  console.log('   -> answer:', a, '\n');
}

console.log('========== FINAL BRIEF ==========');
console.log(JSON.stringify(brief, null, 2));

// hard checks
const emdashHits = [];
for (const q of asked) { if (EMDASH.test(JSON.stringify(q))) emdashHits.push(`Q: ${q.question}`); }
if (brief && EMDASH.test(JSON.stringify(brief))) emdashHits.push('BRIEF');
console.log('\n========== HARD CHECKS ==========');
console.log('questions asked:', n);
console.log('em-dash free:', emdashHits.length === 0 ? 'PASS ✓' : `FAIL ✗ (${emdashHits.join(' | ')})`);

const atom = asked.length ? await judge(ATOMIC_RUBRIC, asked.map((q, i) => `${i + 1}. ${q.question}`).join('\n')) : { all_atomic: true, compound: [] };
console.log('atomic questions:', atom.all_atomic ? 'PASS ✓' : `FAIL ✗ (${(atom.compound || []).join(' | ')})`);

if (brief) {
  const v = await judge(RUBRIC, `QUESTIONS ASKED: ${n}\n\nBRIEF:\n${JSON.stringify(brief, null, 2)}`);
  console.log('\n========== JUDGE (vs rubric) ==========');
  console.log(JSON.stringify(v, null, 2));
}
