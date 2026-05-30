import { readProgram, readResults, readRuns, listPasses, writeDirective } from './blackboard.js';
import { computeHeldOutGap, detectPlateau } from './tools.js';
import { buildL2Evidence } from './l2adapter.js';

// Best held-out for a pass, respecting optimization direction.
function bestHeldOut(results, direction) {
  const vals = results.candidates.map((c) => c.metrics.held_out);
  return direction === 'max' ? Math.max(...vals) : Math.min(...vals);
}

// Gather deterministic evidence for the latest pass. Pure (reads files, no LLM).
export function buildEvidence(runDir) {
  const program = readProgram(runDir);
  const passes = listPasses(runDir);
  if (passes.length === 0) throw new Error(`No results/ passes found in ${runDir}`);
  const pass = passes[passes.length - 1];
  const results = readResults(runDir, pass);
  const runs = readRuns(runDir, pass);

  const history = passes.map((p) => ({
    pass: p,
    bestHeldOut: bestHeldOut(readResults(runDir, p), program.direction),
  }));

  return {
    program,
    pass,
    results,
    runs,
    gaps: computeHeldOutGap(results),
    plateau: detectPlateau(history, { direction: program.direction }),
    history,
  };
}

// Default LLM contract: ({ program, evidence }) => directive-without-pass.
// Injected in tests; the real one lives in ./llm.js.
export async function synthesize(runDir, { llm } = {}) {
  if (typeof llm !== 'function') throw new Error('synthesize requires an llm function');
  const evidence = buildEvidence(runDir);
  const partial = await llm({ program: evidence.program, evidence });
  const directive = { ...partial, pass: evidence.pass };
  return writeDirective(runDir, evidence.pass, directive);
}

// L2-format run dir variant: reads results.tsv + ledger.json + program.md via l2adapter.
export async function synthesizeL2(runDir, { llm } = {}) {
  if (typeof llm !== 'function') throw new Error('synthesizeL2 requires an llm function');
  const evidence = buildL2Evidence(runDir);
  const partial = await llm({ program: evidence.program, evidence });
  const directive = { ...partial, pass: evidence.pass };
  return writeDirective(runDir, evidence.pass, directive);
}
