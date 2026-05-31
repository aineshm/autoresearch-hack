// ALFA research loop endpoint — streams the Python runner live to the frontend.
// Set env var ALFA_REPO_PATH to the path of the autoresearch-hack repo.
// Default: sibling directory ../autoresearch-hack relative to this backend.
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ALFA_REPO = process.env.ALFA_REPO_PATH
  || resolve(join(__dirname, '..', '..', '..', 'autoresearch-hack'));

const router = Router();

// POST /api/alfa/run/stream — SSE: spawns the Python runner and streams every stdout
// line back as an SSE event. Also parses key lines into structured events so the
// frontend can build a live experiment table without regex.
router.post('/run/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const maxRounds = Math.min(Number(req.body?.max_rounds) || 3, 6);
  const maxExp    = Math.min(Number(req.body?.max_experiments) || 12, 32);

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  if (!existsSync(ALFA_REPO)) {
    send('error', { message: `Repo not found at ${ALFA_REPO}. Set ALFA_REPO_PATH.` });
    res.end();
    return;
  }

  send('log', { line: `[autolab] Starting research loop (rounds=${maxRounds}, exps=${maxExp})` });
  send('log', { line: `[autolab] Repo: ${ALFA_REPO}` });

  const child = spawn(
    'python',
    ['-m', 'runner.main', '--use-modal', '--fresh',
     '--max-rounds', String(maxRounds),
     '--max-experiments', String(maxExp)],
    {
      cwd: ALFA_REPO,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    },
  );

  let buf = '';

  function handleLine(raw) {
    const line = raw.replace(/\r$/, '');
    send('log', { line });

    // Experiment result row: "  abc12345  Rnd 1  F1=0.667  FAR=0.00  lat=792ms  PASS  window=30  residuals_only"
    const expRe = /([0-9a-f]{8})\s+Rnd\s*(\d+)\s+F1=([\d.]+)\s+FAR=([\d.]+)\s+lat=(\d+)ms\s+(\w+)\s+window=(\d+)\s+(\S+)/;
    const em = line.match(expRe);
    if (em) {
      send('experiment', {
        id: em[1], round: +em[2],
        f1: +em[3], far: +em[4], latency: +em[5],
        gate: em[6], window: +em[7], features: em[8],
      });
    }

    // L3 synthesis decision
    const dm = line.match(/^Decision:\s+(\w+)/);
    if (dm) send('decision', { decision: dm[1] });

    // Insight
    const im = line.match(/^Insight:\s+(.+)/);
    if (im) send('insight', { text: im[1] });

    // Fault detection alarm in replay
    if (line.includes('!!!  FAULT DETECTED  !!!')) send('alarm', { line });
    if (line.includes('Latency:') && line.includes('ms')) {
      const lm = line.match(/Latency:\s+([\d.]+)\s*ms/);
      if (lm) send('latency', { ms: +lm[1] });
    }

    // Best config header
    if (line.includes('BEST CONFIGURATION FOUND')) send('phase', { name: 'best' });
    if (line.includes('Ground-Truth Replay')) send('phase', { name: 'replay' });
  }

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  });

  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) send('log', { line, stderr: true });
    }
  });

  child.on('error', (err) => {
    send('error', { message: err.message });
    res.end();
  });

  child.on('close', (code) => {
    if (buf.trim()) handleLine(buf.trim());
    send('done', { code });
    res.end();
  });

  req.on('close', () => child.kill('SIGTERM'));
});

// GET /api/alfa/ledger — return the last run's experiment ledger.
router.get('/ledger', (_req, res) => {
  try {
    const p = join(ALFA_REPO, 'ledger.json');
    const records = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
    res.json({ records });
  } catch (e) {
    res.json({ records: [], error: e.message });
  }
});

export default router;
