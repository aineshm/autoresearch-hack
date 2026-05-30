// Scripted plan when no OPENAI_API_KEY — domain-sensible for the ALFA drone case so the
// pipeline still demos end-to-end. The real path is research-driven (agent.js).
export function fallbackPlan(brief) {
  const plan = {
    summary:
      'Learn precursor patterns from the historical labeled flights and warn early on future flights. ' +
      'Start from command-vs-actual residuals and their rate-of-change, scored event-level with lead time.',
    variable_categories: [
      { category: 'command-vs-actual residual features', rationale: 'actuator/engine faults show up as the gap between commanded and actual signals', example_kinds: ['airspeed cmd−actual', 'attitude vs commanded', 'throttle vs airspeed response'], priority: 'high' },
      { category: 'rate-of-change / derivative features', rationale: 'fault onset is often a sharp slope, not just a high value', example_kinds: ['short-window deltas', 'slope over N samples'], priority: 'high' },
      { category: 'windowing & normalization choices', rationale: 'lead time vs stability trade-off; per-flight normalization avoids cross-flight drift', example_kinds: ['window length', 'per-flight vs global scaling'], priority: 'medium' },
      { category: 'detector family', rationale: 'streaming, low-latency, recall-favored', example_kinds: ['threshold-on-residual', 'isolation-forest-style scoring'], priority: 'medium' },
    ],
    start_here: ['residual + derivative features over a short window, per-flight normalized; weight airspeed channels (engine failures are the majority class)'],
    likely_dead_ends: ['heavy sequence models (e.g. LSTM autoencoders) — likely too slow for the lead-time goal; deprioritize, not forbidden'],
    what_useful_output_looks_like:
      'a variable/feature that separates fault from nominal BEFORE labeled onset, generalizes across held-out flights (flight-level split), and keeps false alarms under a usable budget — with the signals that drove it identified',
    open_directions: ['mixture-of-experts per flight regime', 'fault-type-specific detectors'],
    research_sources: [],
    _note: 'scripted fallback (no OPENAI_API_KEY) — run with a key for live web research',
  };
  return { plan, research: [], queries: [] };
}
