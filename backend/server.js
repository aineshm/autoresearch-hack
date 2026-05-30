import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import db from './db.js';
import briefRouter from './brief/route.js';
import plannerRouter from './planner/route.js';

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'autolab-dev-secret-change-me';
const TOKEN_TTL = '7d';

// OpenAI — powers the chat assistant. Optional: if no key is set the app
// still runs and /api/chat returns a friendly "not configured" message.
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are AutoLab — an agentic ML engineer. AutoLab is an environment \
for self-learning systems to be adapted into any domain: a user brings a fuzzy goal and a \
dataset, and AutoLab formulates the ML problem (task, target, metric, eval harness), researches \
the domain, runs a swarm of experiments to build and train candidate models, and delivers the \
best model with an explanation of what mattered. Help the user go from prompt to production. \
Be concise, technical, and concrete. When a user describes a goal, clarify the task type, the \
data they have, and the metric that defines success.`;

const app = express();
app.use(cors());
app.use(express.json());

// --- helpers ---
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// --- prepared statements ---
const insertUser = db.prepare(
  'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'
);
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');

// --- routes ---
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim() || null;

    if (!emailRe.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    if (findByEmail.get(email))
      return res.status(409).json({ error: 'An account with that email already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const info = insertUser.run(email, name, hash);
    const user = findById.get(info.lastInsertRowid);

    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = findByEmail.get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const user = findById.get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ user: publicUser(user) });
});

// Chat endpoint (auth required) — powered by OpenAI.
// Accepts either { messages: [{role, content}, ...] } (preferred, full
// conversation) or { message: "..." } (single turn).
app.post('/api/chat', authRequired, async (req, res) => {
  const history = Array.isArray(req.body?.messages) ? req.body.messages : null;
  const single = String(req.body?.message || '').trim();

  if (!history?.length && !single) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  if (!openai) {
    return res.json({
      reply:
        'The AutoLab assistant is not configured yet. Add OPENAI_API_KEY to ' +
        'backend/.env (see .env.example) and restart the server to enable AI responses.',
    });
  }

  const turns = (history || [{ role: 'user', content: single }])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }));

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...turns],
    });
    const reply = completion.choices?.[0]?.message?.content?.trim() || '(no response)';
    return res.json({ reply });
  } catch (err) {
    console.error('OpenAI error:', err?.message || err);
    return res.status(502).json({ error: 'The assistant failed to respond. Check the API key and server logs.' });
  }
});

// Brief agent — adaptive interview that turns a fuzzy goal into the enriched brief.
app.use('/api/brief', authRequired, briefRouter);
// Planner — confirmed brief → web research → plan (what TYPE of variables to hunt).
app.use('/api/planner', authRequired, plannerRouter);

app.listen(PORT, () => {
  console.log(`AutoLab backend listening on http://localhost:${PORT}`);
});
