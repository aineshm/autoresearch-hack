// Demo replay: instead of spawning the real Python swarm (Modal + OpenAI, minutes
// per generation), progressively write a curated recorded run into a fresh run dir.
// The SwarmMonitor reads the run dir exactly the same way — it cannot tell replay
// from live. One generation is appended every STEP_MS so the monitor shows it evolve.
// When the last generation is written, a summary.json is dropped to mark the run DONE.
//
// No venv, no Modal, no OpenAI, no Python: a cache-hit launch runs on the backend alone.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECORDING = join(__dirname, 'recordings', 'demo-arc.json');
// Pace generations so the whole L2/L3 phase finishes well under the 1-minute demo
// budget while still visibly streaming. ~1.6s/gen → ~8s for the 5-generation arc.
// Override with REPLAY_STEP_MS if you want it slower/faster.
const STEP_MS = Number(process.env.REPLAY_STEP_MS) || 1600;

const TSV_HEADER = 'commit\tval_bpb\tmemory_gb\tstatus\tdescription';

function row(r) {
  const v = r.status === 'crash' ? '0.000000' : Number(r.value).toFixed(6);
  const mem = Number(r.memory_gb ?? 0).toFixed(1);
  const desc = String(r.description ?? '').replace(/[\t\n]/g, ' ');
  return `${r.commit}\t${v}\t${mem}\t${r.status}\t${desc}`;
}

// Populate `runDir` from the curated recording, one generation at a time.
// Returns immediately; the appends happen on timers so the monitor sees it grow.
export function startReplay(runDir) {
  const rec = JSON.parse(readFileSync(RECORDING, 'utf8'));
  mkdirSync(runDir, { recursive: true });
  mkdirSync(join(runDir, 'directives'), { recursive: true });
  writeFileSync(join(runDir, 'program.md'), rec.program_md ?? '# Autoresearch run\n', 'utf8');
  // Seed the results header so the monitor shows a 'pending'->'running' transition.
  if (!existsSync(join(runDir, 'results.tsv'))) {
    writeFileSync(join(runDir, 'results.tsv'), TSV_HEADER + '\n', 'utf8');
  }

  const gens = Array.isArray(rec.generations) ? rec.generations : [];
  gens.forEach((gen, i) => {
    setTimeout(() => {
      try {
        appendFileSync(join(runDir, 'results.tsv'), row(gen.result) + '\n', 'utf8');
        if (gen.directive) {
          const pass = gen.directive.pass ?? i + 1;
          writeFileSync(
            join(runDir, 'directives', `pass-${pass}.json`),
            JSON.stringify(gen.directive, null, 2),
            'utf8',
          );
        }
        // After the LAST generation, drop the done marker + final report.
        if (i === gens.length - 1 && rec.summary) {
          writeFileSync(
            join(runDir, 'summary.json'),
            JSON.stringify(rec.summary, null, 2),
            'utf8',
          );
        }
      } catch (err) {
        console.error('replay step failed:', err?.message);
      }
    }, i * STEP_MS);
  });
}
