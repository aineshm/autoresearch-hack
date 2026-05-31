// Express router for launching a research run. Mounted at /api/run in server.js.
// POST /launch { plan } -> { runId, cached } so the SwarmMonitor can poll /api/monitor/<runId>.
//
// Two modes:
//   - cached (DEFAULT for the demo): progressively replay a curated recorded run into a
//     fresh run dir — instant, no Modal/OpenAI/Python. The monitor can't tell the difference.
//   - live: spawn the real Python swarm (Modal sandboxes + L3). Opt in with `?live=1`,
//     body { live: true }, or env LIVE_SWARM=true.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createRunDir, spawnSwarm } from './launch.js';
import { startReplay } from './replay.js';
import { join } from 'node:path';

const router = Router();

const RUNS_BASE = () => process.env.MONITOR_RUNS_DIR || '/tmp/autolab-runs';

function wantsLive(req) {
  return (
    process.env.LIVE_SWARM === 'true' ||
    req.query?.live === '1' ||
    req.body?.live === true
  );
}

router.post('/launch', (req, res) => {
  try {
    const plan = req.body?.plan;
    if (!plan || typeof plan !== 'object') {
      return res.status(400).json({ error: 'A plan object is required.' });
    }
    const runId = randomUUID();

    if (wantsLive(req)) {
      const runDir = createRunDir(runId, plan);
      const pid = spawnSwarm(runDir, { maxExperiments: 3 });
      return res.status(202).json({ runId, cached: false, pid });
    }

    // Cached demo path: replay a curated run, progressively, into a fresh dir.
    startReplay(join(RUNS_BASE(), runId));
    return res.status(202).json({ runId, cached: true });
  } catch (err) {
    console.error('run launch error:', err?.message || err);
    return res.status(400).json({ error: err?.message || 'Failed to launch the run.' });
  }
});

export default router;
