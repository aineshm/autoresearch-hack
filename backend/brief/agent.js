// The Brief agent core: one LLM that, each turn, decides to ASK the next GenUI
// question or FINALIZE the enriched brief. It judges when to stop — no hardcoded
// question counter. Falls back to a scripted interview when no key is set.
import OpenAI from 'openai';
import { BRIEF_SYSTEM, buildUserPrompt } from './prompts.js';
import { validateStep, fallbackStep } from './schema.js';
import { ALFA_PACK } from './packs/alfa.js';
import * as cache from '../lib/cache.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// The brief wants a model smart enough to know when to stop asking. 5.x mini by default;
// override with BRIEF_MODEL (e.g. gpt-5.4-pro for more depth).
const BRIEF_MODEL = process.env.BRIEF_MODEL || 'gpt-5.4-mini';
// Reasoning is ON — these are reasoning models. minimal | low | medium | high.
const BRIEF_REASONING_EFFORT = process.env.BRIEF_REASONING_EFFORT || 'medium';
// PRD knob: cap blocking questions.
const MAX_QUESTIONS = Number(process.env.BRIEF_MAX_QUESTIONS || 3);

// Decide whether the conversation is actually the ALFA/UAV scenario (the one we have data for).
// Only then do we attach the ALFA data pack — otherwise the brief runs general (no fabricated data).
const ALFA_RE = /\b(drone|uav|uas|fixed[- ]?wing|aircraft|aeroplane|airplane|\bplane\b|aerial|flight log|flight logs|telemetry|aviation|fleet of .*(drone|aircraft|plane)|autopilot|pixhawk|ardupilot)\b/i;
function detectPack(goal, transcript) {
  const text = [goal || '', ...(transcript || []).map((t) => `${t.question} ${t.answer}`)].join(' ');
  return ALFA_RE.test(text) ? ALFA_PACK : null;
}

// Guarantee NO em-dashes/en-dashes in anything we return (the prompt asks the model to avoid
// them, but this makes it deterministic). "a — b" -> "a, b"; "10—20" -> "10-20".
function deEmDash(s) {
  return s
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    .replace(/(\S)\s*[—–]\s*(\S)/g, '$1, $2')
    .replace(/[—–]/g, '-');
}
function sanitize(v) {
  if (typeof v === 'string') return deEmDash(v);
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = sanitize(v[k]); return v; }
  return v;
}
function sanitizeStep(step) {
  if (step?.question) step.question = sanitize(step.question);
  if (step?.brief) step.brief = sanitize(step.brief);
  return step;
}

export function briefConfigured() {
  return !!openai;
}
export function briefModel() {
  return BRIEF_MODEL;
}
export function briefReasoning() {
  return BRIEF_REASONING_EFFORT;
}

/**
 * One step of the interview.
 * @param {{goal:string, dataset?:any, transcript?:Array<{id,question,answer}>, model?:string}} state
 * @returns {Promise<{action:'ask',question:object,rationale:string}|{action:'finalize',brief:object,rationale:string}>}
 */
export async function nextStep({ goal, dataset = null, transcript = [], model } = {}) {
  if (!goal || !String(goal).trim()) throw new Error('goal is required');

  // Attach data facts ONLY when we genuinely have them: an explicitly-passed dataset, or the
  // ALFA pack when the conversation is actually about that UAV scenario. Otherwise run general
  // (no fabricated data — the brief asks the user what data they have).
  const ds = dataset || detectPack(goal, transcript)?.data_facts || null;

  // Record/replay: same inputs -> same recorded output (deterministic demo).
  const ck = cache.key('brief.next', { goal, transcript, dataset: ds });
  const hit = cache.get(ck);
  if (hit) return { ...hit, cached: true }; // replay (flag is transient, not stored)

  let result;
  if (!openai) {
    result = sanitizeStep(fallbackStep({ goal, transcript }));
  } else {
    const completion = await openai.chat.completions.create({
      model: model || BRIEF_MODEL,
      reasoning_effort: BRIEF_REASONING_EFFORT,
      messages: [
        { role: 'system', content: BRIEF_SYSTEM },
        { role: 'user', content: buildUserPrompt({ goal, dataset: ds, transcript, maxQuestions: MAX_QUESTIONS }) },
      ],
      response_format: { type: 'json_object' },
    });
    let parsed = null;
    try { parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}'); } catch { /* fallback */ }
    const step = validateStep(parsed);
    if (!step) {
      result = sanitizeStep(fallbackStep({ goal, transcript })); // never break the interview on a bad shape
    } else {
      if (step.action === 'finalize') normalizeBrief(step.brief, ds);
      result = sanitizeStep(step);
    }
  }
  cache.set(ck, result);
  return { ...result, cached: false }; // generated live
}

// Guarantee the brief always carries the full PRD shape, so the UI + Planner never see missing
// fields. data_facts are authoritative (we inspected the data) — always re-attach them.
function normalizeBrief(b, ds) {
  b.data_facts = ds || b.data_facts || {};
  if (!b.intent || typeof b.intent !== 'object') {
    b.intent = { what_they_want: String(b.enriched_question || '').slice(0, 160), expertise_level: 'non_expert' };
  }
  if (!b.answer_contract || typeof b.answer_contract !== 'object') {
    b.answer_contract = { when: '', what_counts_as_caught: '', done_when: '' };
  }
  if (!Array.isArray(b.claims_to_test)) b.claims_to_test = [];
  if (!Array.isArray(b.assumptions) || b.assumptions.length === 0) {
    b.assumptions = ['Safety-critical: a missed fault is treated as worse than a false alarm.'];
  }
  if (typeof b.confidence !== 'number') b.confidence = 0.75;
}
