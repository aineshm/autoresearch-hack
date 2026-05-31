// Validation + a no-key fallback so the brief interview still runs (and demos)
// without OPENAI_API_KEY. The real path is LLM-driven (see agent.js).

export function validateStep(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.action === 'ask' && obj.question && typeof obj.question.question === 'string') {
    const q = obj.question;
    return {
      action: 'ask',
      rationale: obj.rationale || '',
      question: {
        id: q.id || 'q',
        question: q.question,
        why: q.why || '',
        phase: q.phase || 1,
        input_type: q.input_type || 'single_select',
        options: Array.isArray(q.options) ? q.options : [],
        allow_free_text: q.allow_free_text !== false,
        default_value: q.default_value ?? null,
      },
    };
  }
  if (obj.action === 'finalize' && obj.brief && typeof obj.brief.enriched_question === 'string') {
    return { action: 'finalize', rationale: obj.rationale || '', brief: obj.brief };
  }
  return null;
}

// --- no-key fallback (scripted, drone-flavored — the one question we optimize for) ---

export const FALLBACK_QUESTIONS = [
  {
    id: 'timing', phase: 1,
    question: 'When do you need to catch the problem?',
    why: 'decides live monitoring vs after-the-fact review (totally different systems)',
    input_type: 'single_select', allow_free_text: false, default_value: 'live',
    options: [
      { value: 'live', label: 'Live, during the flight (so the pilot can react)' },
      { value: 'post', label: 'Right after each flight' },
      { value: 'either', label: 'Either is fine' },
    ],
  },
  {
    id: 'usefulness', phase: 1,
    question: 'What would be most useful to you?',
    why: 'detect vs diagnose vs early-warning',
    input_type: 'single_select', allow_free_text: true, default_value: 'early',
    options: [
      { value: 'warn', label: 'Just warn me something is wrong' },
      { value: 'diagnose', label: "Tell me what's wrong (engine, controls…)" },
      { value: 'early', label: 'Warn me early, before it becomes critical' },
    ],
  },
  {
    id: 'cost_of_error', phase: 2,
    question: 'Which is worse for you?',
    why: 'sets whether we favor catching everything vs avoiding false alarms',
    input_type: 'single_select', allow_free_text: false, default_value: 'miss',
    options: [
      { value: 'miss', label: 'Missing a real problem (a plane is lost)' },
      { value: 'false_alarm', label: 'False alarms (pilots stop trusting it)' },
      { value: 'balanced', label: 'Both equally' },
    ],
  },
  {
    id: 'lead_time', phase: 2,
    question: 'How much warning do you need to be able to act?',
    why: 'sets the lead-time target — and whether "early" is even the goal',
    input_type: 'single_select', allow_free_text: true, default_value: 'asap',
    options: [
      { value: 'secs', label: 'A couple seconds is enough' },
      { value: '10s', label: 'I need ~10+ seconds' },
      { value: 'asap', label: 'As early as possible / not sure' },
    ],
  },
  {
    id: 'labels', phase: 2,
    question: 'Do your logs mark which flights went wrong (and roughly when)?',
    why: 'decides supervised vs unsupervised — what we can train and test against',
    input_type: 'single_select', allow_free_text: true, default_value: 'flights_time',
    options: [
      { value: 'flights_time', label: 'Yes — which flights + rough timing' },
      { value: 'flights_only', label: 'Which flights, but not exactly when' },
      { value: 'none', label: 'No, just raw logs' },
    ],
  },
];

const PHRASE = {
  timing: { live: 'in real time, mid-flight', post: 'right after each flight', either: 'in real time or post-flight' },
  usefulness: { warn: 'flag that something is wrong', diagnose: 'identify what is wrong', early: 'warn early, before it becomes critical' },
  cost_of_error: {
    miss: 'never miss a real fault (catching true problems matters more than the occasional false alarm)',
    false_alarm: 'keep false alarms low so pilots keep trusting it',
    balanced: 'balance missed faults against false alarms',
  },
  lead_time: { secs: 'a few seconds', '10s': '~10+ seconds', asap: 'as much lead time as possible' },
  labels: { flights_time: 'labeled with which flights failed and rough onset times', flights_only: 'labeled by flight but not exact timing', none: 'unlabeled raw logs' },
};

function ans(transcript, id, fallback) {
  const t = (transcript || []).find((x) => x.id === id);
  return t ? t.answer : fallback;
}
const phrase = (id, val) => (PHRASE[id] && PHRASE[id][val]) || val;

export function fallbackBrief({ goal, transcript }) {
  const timing = ans(transcript, 'timing', 'live');
  const useful = ans(transcript, 'usefulness', 'early');
  const cost = ans(transcript, 'cost_of_error', 'miss');
  const lead = ans(transcript, 'lead_time', 'asap');
  const labels = ans(transcript, 'labels', 'flights_time');

  const enriched =
    `From our fixed-wing survey-drone flight logs, automatically detect when a flight is developing a ` +
    `fault — ${phrase('timing', timing)} — and ${phrase('usefulness', useful)}. Prioritize to ` +
    `${phrase('cost_of_error', cost)}, with ${phrase('lead_time', lead)} of lead time to act. The events ` +
    `to catch are the kind behind our 6 crashes and ~12 mystery incidents. A real answer must catch a ` +
    `high share of true incidents at a usable false-alarm rate, validated on flights it never trained on, ` +
    `and explain which sensor signals gave it away. Logs are ${phrase('labels', labels)}.`;

  return {
    enriched_question: enriched,
    intent: 'Stop losing aircraft (and reduce repair cost + liability) by catching in-flight faults automatically.',
    what_they_want: `An automated detector that ${phrase('usefulness', useful)} ${phrase('timing', timing)}.`,
    answer_contract:
      'A detector that flags real fault events with enough lead time to act, at a false-alarm rate pilots ' +
      'will tolerate, validated on held-out flights, plus an explanation of which signals preceded each event.',
    success_definition:
      `Caught = alarm fires before/at fault onset with ${phrase('lead_time', lead)} lead; judged on unseen ` +
      `flights; stance: ${phrase('cost_of_error', cost)}.`,
    user_claims: ['Pilots say they can sometimes "feel" something is off before it gets bad → a precursor signal may exist (TEST this).'],
    findings: ['User has the flight logs in hand; ' + `they are ${phrase('labels', labels)}.`],
    constraints: [
      'SAFETY-CRITICAL: a missed fault can lose an aircraft → false negatives are worse than false alarms; bias the answer toward recall within a usable false-alarm budget.',
    ],
    user_expertise: 'Drone-fleet operator, not an ML practitioner (medium confidence) → explain plainly, verify their domain claims.',
    open_questions: ['Is early warning (lead time > 0) physically achievable, or only fast detection at onset? Empirical — for downstream to determine.'],
  };
}

export function fallbackStep({ goal, transcript }) {
  const answered = new Set((transcript || []).map((t) => t.id));
  const next = FALLBACK_QUESTIONS.find((q) => !answered.has(q.id));
  if (next) return { action: 'ask', rationale: 'scripted (no OPENAI_API_KEY)', question: next };
  return { action: 'finalize', rationale: 'scripted finalize (no OPENAI_API_KEY)', brief: fallbackBrief({ goal, transcript }) };
}
