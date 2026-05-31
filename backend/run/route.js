// Express router for launching a research run. Mounted at /api/run in server.js.
// POST /launch { plan } -> creates a run dir from the plan, spawns the L2 swarm
// detached, and returns { runId } so the SwarmMonitor can poll /api/monitor/<runId>.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createRunDir, spawnSwarm } from './launch.js';

const router = Router();

router.post('/launch', (req, res) => {
  try {
    const plan = req.body?.plan;
    if (!plan || typeof plan !== 'object') {
      return res.status(400).json({ error: 'A plan object is required.' });
    }
    const runId = randomUUID();
    const runDir = createRunDir(runId, plan);
    const pid = spawnSwarm(runDir, { maxExperiments: 3 });
    return res.status(202).json({ runId, pid });
  } catch (err) {
    console.error('run launch error:', err?.message || err);
    return res.status(400).json({ error: err?.message || 'Failed to launch the run.' });
  }
});

export default router;
