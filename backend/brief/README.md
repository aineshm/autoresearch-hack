# Brief agent (`backend/brief/`)

The **brief** is the only part of AutoLab that talks to the user. It runs an adaptive, phased
interview and turns a fuzzy goal into **the question, enriched into how it should have been asked** —
a brief the user confirms ("yes, this is what I mean"), which is then handed to the **planner**.

It is an LLM that **decides when to stop** — no hardcoded question counter.

## Files
| File | Role |
|---|---|
| `prompts.js` | the brief agent's system prompt (phases, stop rule, safety inference) + user-prompt builder |
| `schema.js` | step validation + a no-key scripted fallback (so it runs/demos without an API key) |
| `agent.js` | `nextStep()` — one LLM turn: **ask** the next GenUI question, or **finalize** the brief |
| `route.js` | Express router (`/api/brief/*`), mounted in `../server.js` |

## API
Mounted at `/api/brief` (auth-gated, like `/api/chat`).

- `GET /api/brief/status` → `{ configured, model }`
- `POST /api/brief/next` → body `{ goal, dataset?, transcript? }` → one step:
  - `{ "action": "ask", "question": { id, question, why, phase, input_type, options:[{value,label}], allow_free_text, default_value } }`
  - `{ "action": "finalize", "brief": { enriched_question, intent, what_they_want, answer_contract, success_definition, user_claims, findings, constraints, user_expertise, open_questions } }`

`transcript` is the running Q&A: `[{ id, question, answer }]`. The front-end renders each `question`
as a GenUI card with clickable answers, appends the user's answer to `transcript`, and calls `/next`
again until `action === "finalize"`. The user confirms the brief; we hand `brief` to the planner.

## Config (`backend/.env`)
- `OPENAI_API_KEY` — required for the LLM path (without it, the scripted fallback runs).
- `BRIEF_MODEL` — default `gpt-5.4-mini` (a 5.x mini; set `gpt-5.4-pro` for more depth).

## Contract
Canonical interface doc: MDDB `hackathon/autoresearch/l1-contract` ("Brief + Planner — Role & Contracts").
The brief does **not** plan, pick models, or enumerate variables — it defines *what the user wants*
and *what a good answer looks like*. The planner takes the enriched question from here.
