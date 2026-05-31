// Express router for the Planner. Mounted at /api/planner in server.js.
import { Router } from 'express';
import { runPlan, runPlanStream, plannerConfigured, plannerModels } from './agent.js';

const router = Router();

router.get('/status', (_req, res) => res.json({ configured: plannerConfigured(), models: plannerModels() }));

// Body: { brief }  ->  { plan, research, queries }
// Runs the full pipeline (decompose → web research → distill → synthesize). Can take ~20-40s.
router.post('/plan', async (req, res) => {
  try {
    const brief = req.body?.brief;
    const out = await runPlan({ brief });
    return res.json(out);
  } catch (err) {
    console.error('planner error:', err?.message || err);
    return res.status(400).json({ error: err?.message || 'Planning failed.' });
  }
});

// Streaming variant — NDJSON events as the pipeline runs (live research trace for the UI).
// Body: { brief }. Emits one JSON object per line; final line is {type:'plan', plan}.
router.post('/plan/stream', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const emit = (e) => {
    try { res.write(JSON.stringify(e) + '\n'); } catch { /* client gone */ }
  };
  try {
    await runPlanStream({ brief: req.body?.brief, emit });
  } catch (err) {
    console.error('planner stream error:', err?.message || err);
    emit({ type: 'error', error: err?.message || 'Planning failed.' });
  } finally {
    res.end();
  }
});

export default router;
