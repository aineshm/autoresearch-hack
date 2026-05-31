import { Router } from 'express';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const router = Router();

const BASE_DIR = process.env.MONITOR_RUNS_DIR || '/tmp/autolab-runs';

// Metric names where lower value is better.
const LOWER_IS_BETTER_RE = /\b(val_bpb|val_loss)\b/i;
// All metric names we can detect.
const METRIC_RE = /\b(val_bpb|val_loss|accuracy|score|reward)\b/i;

/**
 * Safely resolve a runId to an absolute directory path.
 * Returns null if runId is suspicious (path traversal attempt).
 */
function resolveRunDir(runId) {
  if (!runId || runId.includes('/') || runId.includes('..')) return null;
  return join(BASE_DIR, runId);
}

/**
 * Parse results.tsv rows into experiment objects.
 * TSV columns: commit\tval_bpb\tmemory_gb\tstatus\tdescription
 * Returns { experiments, counts, generations }.
 */
function parseResultsTsv(content) {
  const experiments = [];
  const counts = { keep: 0, discard: 0, crash: 0 };

  const lines = content.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 4) continue;

    const [commit, rawVal, , status, ...descParts] = cols;
    const normalizedStatus = (status || '').trim().toLowerCase();

    // Skip header rows — status column must be keep/discard/crash
    if (!['keep', 'discard', 'crash'].includes(normalizedStatus)) continue;

    const description = descParts.join('\t').trim();
    const value = normalizedStatus === 'crash' ? null : (() => {
      const n = parseFloat(rawVal);
      return isNaN(n) ? null : n;
    })();

    if (normalizedStatus in counts) counts[normalizedStatus]++;

    experiments.push({
      generation: experiments.length + 1,
      commit: (commit || '').trim(),
      value,
      status: normalizedStatus,
      description,
    });
  }

  return { experiments, counts, generations: experiments.length };
}

/**
 * Extract the metric name and lowerIsBetter flag from program.md content.
 */
function extractMetricInfo(content) {
  const m = content.match(METRIC_RE);
  if (!m) return { metric: 'val_bpb', lowerIsBetter: true };
  const metric = m[1].toLowerCase();
  return { metric, lowerIsBetter: LOWER_IS_BETTER_RE.test(metric) };
}

/**
 * Compute the best non-crash metric value given direction.
 */
function computeBest(experiments, lowerIsBetter) {
  const valid = experiments.filter((e) => e.value !== null);
  if (!valid.length) return null;
  return valid.reduce((best, e) => {
    if (best === null) return e.value;
    return lowerIsBetter ? Math.min(best, e.value) : Math.max(best, e.value);
  }, null);
}

/**
 * Load the latest directive from directives/pass-N.json.
 * "Latest" = highest pass number.
 */
async function loadLatestDirective(runDir) {
  const dirPath = join(runDir, 'directives');
  let files;
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }

  const passFiles = files
    .map((f) => {
      const m = f.match(/^pass-(\d+)\.json$/);
      return m ? { file: f, pass: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.pass - a.pass);

  if (!passFiles.length) return null;

  let raw;
  try {
    raw = JSON.parse(await readFile(join(dirPath, passFiles[0].file), 'utf8'));
  } catch {
    return null;
  }

  // Transform checks from object to array and camelCase fields
  const checks = raw.checks
    ? Object.entries(raw.checks).map(([name, { ok, evidence }]) => ({ name, ok: !!ok, evidence: evidence || '' }))
    : [];

  return {
    pass: raw.pass ?? passFiles[0].pass,
    verdict: (raw.verdict || '').toUpperCase(),
    rationale: raw.rationale || '',
    checks,
    nextHypotheses: Array.isArray(raw.next_hypotheses) ? raw.next_hypotheses : [],
  };
}

// GET /:runId/status
router.get('/:runId/status', async (req, res) => {
  const { runId } = req.params;
  const runDir = resolveRunDir(runId);

  if (!runDir) {
    return res.status(400).json({ error: 'Invalid runId.' });
  }

  try {
    // --- metric info from program.md (optional) ---
    let metric = 'val_bpb';
    let lowerIsBetter = true;
    try {
      const programMd = await readFile(join(runDir, 'program.md'), 'utf8');
      ({ metric, lowerIsBetter } = extractMetricInfo(programMd));
    } catch {
      // program.md absent — use defaults
    }

    // --- results from results.tsv (may not exist yet) ---
    let tsvContent;
    try {
      tsvContent = await readFile(join(runDir, 'results.tsv'), 'utf8');
    } catch {
      tsvContent = null;
    }

    if (!tsvContent) {
      // Run directory exists but no results yet — pending state
      const latestDirective = await loadLatestDirective(runDir);
      return res.json({
        runId,
        status: 'pending',
        metric,
        lowerIsBetter,
        best: null,
        generations: 0,
        counts: { keep: 0, discard: 0, crash: 0 },
        experiments: [],
        latestDirective,
      });
    }

    const { experiments, counts, generations } = parseResultsTsv(tsvContent);
    const best = computeBest(experiments, lowerIsBetter);
    const latestDirective = await loadLatestDirective(runDir);

    return res.json({
      runId,
      metric,
      lowerIsBetter,
      best,
      generations,
      counts,
      experiments,
      latestDirective,
    });
  } catch (err) {
    console.error(`[monitor] Error reading run ${runId}:`, err?.message || err);
    return res.status(500).json({ error: 'Failed to read run status.' });
  }
});

export default router;
