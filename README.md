# AutoLab

> **An environment for self-learning systems to be adapted into any domain.**
> Describe a goal, bring your data — AutoLab takes it from **prompt to production.**

AutoLab is an *agentic ML engineer*. Instead of freezing the task, metric, and harness by hand and only optimizing the model (the usual AutoML setup), AutoLab automates the **first half** too: a user brings a fuzzy, niche goal plus a dataset, and an orchestration swarm **formulates the ML problem**, researches the domain, runs experiments in parallel to build and train candidate models, and delivers the **best model with an explanation of what mattered**.

This repository is the **application layer** — the web app users talk to (landing, auth, and the chat interface that drives the agent).

---

## How it works

AutoLab is built around a **Formulate → Execute → Reflect** control loop over a shared blackboard:

| Tier | Role | What it does |
|------|------|--------------|
| **L1 — Formulator** | intake & narrowing | Turns a fuzzy goal + data into a scoped `ResearchSpec` (task type, target, metric, eval harness, search space). Inspects the data first; asks only blocking questions. |
| **L2 — Conductor** | intra-round execution | Dispatches K candidate pipelines in parallel, enforces budget/timeouts, retries crashes, and watches research progress + agent health. |
| **L3 — Synthesizer** | inter-round strategy | Reads results → ablation/insight report + a decision (`EXPLORE` / `EXPLOIT` / `COMMIT` / `ESCALATE`) and the next hypotheses. |
| **Workers** | generate & train | Propose and train candidate pipelines (features + model + hyperparameters), scored on a held-out test. |

The trust story is an **honest statistical gatekeeper** with a held-out test set, so the delivered model is real — not overfit to its own metric.

---

## This repo

A monorepo with two apps:

```
autolab/
├── frontend/   Vite + React (JS) — landing page + auth + chat UI
├── backend/    Express + SQLite — auth + OpenAI-powered chat API
└── README.md
```

### Frontend — `frontend/`
- **Vite 8 + React 19** (JavaScript, no TypeScript).
- Animated **dithered-wave WebGL background** (single-pass GLSL shader) with a liquid-glass landing and the *Prompt to Production* hero.
- **Auth modal** (email / password) and a **ChatGPT-style chat interface**: collapsible sidebar, conversation list, and an avatar logout popover.
- Per-component folder structure (`Component/Component.jsx` + `Component.css`); global styles in `src/index.css`.

### Backend — `backend/`
- **Express 4** with a local **SQLite** database via Node's built-in `node:sqlite` (no native build step).
- Auth: signup / login / session with **bcrypt** password hashing and **JWT** (7-day expiry).
- Chat: **OpenAI-powered** `/api/chat` (auth-gated) that streams the AutoLab assistant persona.

---

## Getting started

**Prerequisites:** Node.js **22+** (uses `node:sqlite` and `--env-file`). Tested on Node 24.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # then edit .env
npm run dev                 # http://localhost:4000
```

Set these in `backend/.env`:

| Variable | Description |
|----------|-------------|
| `PORT` | API port (default `4000`) |
| `JWT_SECRET` | Secret for signing JWTs — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `OPENAI_API_KEY` | Your OpenAI key — enables AI chat responses ([get one](https://platform.openai.com/api-keys)) |
| `OPENAI_MODEL` | Chat model (default `gpt-4o-mini`) |

> Without `OPENAI_API_KEY`, the app still runs — `/api/chat` returns a friendly "not configured" message.

The SQLite database is created automatically at `backend/data/app.db`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Vite proxies `/api/*` to `http://localhost:4000`, so run both servers together. Open **http://localhost:5173**, sign up, and you'll land in the chat.

---

## API

| Method | Path | Auth | Body | Returns |
|--------|------|------|------|---------|
| `GET`  | `/api/health` | — | — | `{ ok: true }` |
| `POST` | `/api/auth/signup` | — | `{ email, password, name? }` | `{ token, user }` |
| `POST` | `/api/auth/login` | — | `{ email, password }` | `{ token, user }` |
| `GET`  | `/api/auth/me` | Bearer | — | `{ user }` |
| `POST` | `/api/chat` | Bearer | `{ messages: [{ role, content }] }` | `{ reply }` |

---

## Roadmap

- [x] Web app shell: landing, auth, chat interface
- [x] OpenAI-powered conversational entry point
- [ ] L1 Formulator: data profiling → `ResearchSpec`
- [ ] L2 Conductor: parallel candidate training (Modal)
- [ ] L3 Synthesizer: ablation insight report + decisions
- [ ] Honest statistical gatekeeper with held-out test
- [ ] Agent observability (Raindrop Workshop traces)

---

*Built at the Autoresearch Systems Hackathon, 2026.*
