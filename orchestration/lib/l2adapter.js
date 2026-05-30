import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { crashRate, detectPlateauMetric } from './tools.js';

// Parse L2's results.tsv. CRITICAL: a 'crash' row stores value 0.000000 which would
// look like a perfect score under lower-is-better — so we null the value on crash.
export function readL2Results(runDir) {
  const path = join(runDir, 'results.tsv');
  if (!existsSync(path)) throw new Error(`Missing results.tsv at ${path}`);
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const [commit, val, mem, status, ...desc] = line.split('\t');
    rows.push({
      commit,
      value: status === 'crash' ? null : Number(val),
      memory_gb: Number(mem),
      status,
      description: desc.join('\t'),
    });
  }
  return rows;
}

export function readL2Ledger(runDir) {
  const path = join(runDir, 'ledger.json');
  if (!existsSync(path)) return { attempts: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readL2Program(runDir) {
  const path = join(runDir, 'program.md');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const m = text.match(/\b(val_bpb|val_loss|accuracy|score|reward)\b/);
  const metric = m ? m[1] : 'val_bpb';
  const lowerIsBetter = !['accuracy', 'score', 'reward'].includes(metric);
  return { metric, lowerIsBetter, program_md: text };
}

function bestSoFar(values, lowerIsBetter) {
  const real = values.filter((v) => v !== null);
  if (!real.length) return null;
  return lowerIsBetter ? Math.min(...real) : Math.max(...real);
}

export function buildL2Evidence(runDir) {
  const program = readL2Program(runDir);
  const rows = readL2Results(runDir);
  const ledger = readL2Ledger(runDir);

  const history = [];
  const seen = [];
  for (const r of rows) {
    seen.push(r.value);
    history.push({ best: bestSoFar(seen, program.lowerIsBetter) });
  }

  return {
    program,
    pass: rows.length,
    rows,
    ledger,
    best: bestSoFar(rows.map((r) => r.value), program.lowerIsBetter),
    crashRate: crashRate(rows, 5),
    plateau: detectPlateauMetric(history, { lowerIsBetter: program.lowerIsBetter }),
    history,
  };
}
