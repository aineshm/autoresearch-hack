// Pure, deterministic L3 evidence tools. No IO, no LLM. The LLM consumes
// these outputs; it never invents the numbers.

// Generalization gap per candidate: how much worse held_out is than val.
// Larger positive gap => more overfitting.
export function computeHeldOutGap(results) {
  return results.candidates.map((c) => ({
    candidateId: c.id,
    gap: c.metrics.val - c.metrics.held_out,
  }));
}

// Has the best held-out score stalled over the last `window` passes?
// history: [{ pass, bestHeldOut }], ascending by pass.
// direction 'max' => improvement is an increase; 'min' => a decrease.
export function detectPlateau(history, { direction = 'max', minDelta = 0.005, window = 2 } = {}) {
  if (history.length < window + 1) return false;
  const recent = history.slice(-(window + 1));
  const first = recent[0].bestHeldOut;
  const last = recent[recent.length - 1].bestHeldOut;
  const improvement = direction === 'max' ? last - first : first - last;
  return improvement < minDelta;
}

// Fraction of the last `window` attempts that crashed.
export function crashRate(attempts, window = 5) {
  if (!attempts.length) return 0;
  const recent = attempts.slice(-window);
  return recent.filter((a) => a.status === 'crash').length / recent.length;
}

// Plateau on best-so-far metric. history: [{ best }] ascending by generation.
// lowerIsBetter => improvement is a DECREASE in best.
export function detectPlateauMetric(history, { lowerIsBetter = true, minDelta = 0.005, window = 2 } = {}) {
  if (history.length < window) return false;
  const recent = history.slice(-window);
  const first = recent[0].best;
  const last = recent[recent.length - 1].best;
  const improvement = lowerIsBetter ? first - last : last - first;
  return improvement < minDelta;
}
