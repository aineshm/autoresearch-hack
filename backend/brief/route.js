// Express router for the Brief agent. Mounted at /api/brief in server.js.
import { Router } from 'express';
import { nextStep, briefConfigured, briefModel, briefReasoning } from './agent.js';

const router = Router();

// Is the brief LLM configured? (frontend can show a banner if not)
router.get('/status', (_req, res) =>
  res.json({ configured: briefConfigured(), model: briefModel(), reasoning: briefReasoning() })
);

// One interview step. Body: { goal, dataset?, transcript? }
// Returns: { action:'ask', question } | { action:'finalize', brief }
router.post('/next', async (req, res) => {
  try {
    const { goal, dataset, transcript, model } = req.body || {};
    const step = await nextStep({ goal, dataset, transcript, model });
    return res.json(step);
  } catch (err) {
    console.error('brief error:', err?.message || err);
    return res.status(400).json({ error: err?.message || 'Brief step failed.' });
  }
});

// Run the WHOLE interview server-side in one call (auto-answers each question with its
// default_value) → { transcript, brief }. Lets you/the team exercise the brief end-to-end
// without driving the UI. Body: { goal, dataset? }.
router.post('/simulate', async (req, res) => {
  try {
    const { goal, dataset } = req.body || {};
    const transcript = [];
    const steps = [];
    let brief = null;
    for (let i = 0; i < 6; i++) {
      const step = await nextStep({ goal, dataset, transcript });
      if (step.action === 'finalize') { brief = step.brief; break; }
      const q = step.question;
      const answer = q.default_value ?? q.options?.[0]?.value ?? 'yes';
      transcript.push({ id: q.id, question: q.question, answer });
      steps.push({ question: q, answer });
    }
    return res.json({ questions: steps, transcript, brief });
  } catch (err) {
    console.error('brief simulate error:', err?.message || err);
    return res.status(400).json({ error: err?.message || 'Simulation failed.' });
  }
});

export default router;

