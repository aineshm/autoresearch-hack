# AutoLab API

The brief + planner tiers exposed over HTTP. Two ways to authenticate:

- **API key** (external callers): header `x-api-key: <AUTOLAB_API_KEY>` (or `?api_key=`). Works on `/api/brief/*` and `/api/planner/*`.
- **JWT** (the web app): `Authorization: Bearer <token>` from `/api/auth/login`. Required for `/api/projects/*`.

**Base URL:** your server, e.g. `http://localhost:4000` locally, or the public tunnel URL (cloudflared/ngrok).

Discovery: `GET /api/info` lists the endpoints.

---

## Brief (L1): fuzzy goal to an enriched brief

The brief runs an adaptive interview. Call `next` in a loop, sending the running `transcript`, until you get `action:"finalize"`.

### `POST /api/brief/next`
Body: `{ "goal": string, "transcript"?: [{id, question, answer}], "dataset"?: object }`
- `dataset` (optional): pre-inspected data facts (e.g. from a project upload). If omitted, the agent decides the domain and asks what data you have.
Returns one of:
```jsonc
{ "action": "ask", "question": {
    "id": "slug", "question": "one plain question", "why": "...",
    "input_type": "single_select|multi_select|boolean|text|number",
    "options": [{"value":"...","label":"..."}], "allow_free_text": true, "default_value": "..." } }
// or
{ "action": "finalize", "brief": {
    "enriched_question": "...",
    "intent": { "what_they_want": "...", "expertise_level": "non_expert|intermediate|expert" },
    "answer_contract": { "when": "...", "what_counts_as_caught": "...", "done_when": "..." },
    "claims_to_test": ["..."], "data_facts": { }, "assumptions": ["..."], "confidence": 0.0 } }
```

### `POST /api/brief/simulate`
Body: `{ "goal": string, "dataset"?: object }` → runs the whole interview auto-answered in one call:
`{ "questions": [...], "transcript": [...], "brief": { ... } }`

```bash
curl -X POST $BASE/api/brief/next -H "content-type: application/json" -H "x-api-key: $KEY" \
  -d '{"goal":"predict customer churn from our CRM csv","transcript":[]}'
```

---

## Planner (L2 feed): brief to a research-backed plan

### `POST /api/planner/plan`
Body: `{ "brief": <brief object> }` → `{ "plan", "research", "queries" }`. The `plan`:
```jsonc
{ "summary": "...",
  "variable_categories": [{ "category","rationale","example_kinds":[],"priority":"high|medium|low" }],
  "start_here": ["..."], "likely_dead_ends": ["..."],
  "what_useful_output_looks_like": "...", "open_directions": ["..."],
  "research_sources": [{ "title","url" }] }
```
The plan gives variable **categories/types**, not exact configs (the orchestration agent generates those).

### `POST /api/planner/plan/stream`
Same body, streams **NDJSON** events for a live research trace (one JSON object per line):
`{type:"stage",label}` · `{type:"queries",queries}` · `{type:"search_start",angle,query}` · `{type:"search_done",angle,sources,found}` · `{type:"plan",plan}`

---

## Projects (web app, JWT only)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET  | `/api/projects` | — | `{ projects: [...] }` (seeds a demo "Flight Data" project on first call) |
| POST | `/api/projects` | `{ name }` | `{ project }` |
| GET  | `/api/projects/:id` | — | `{ project }` |
| POST | `/api/projects/:id/upload` | `{ filename, csv }` | `{ project }` (csv profiled into `dataFacts`) |

A `project` carries `{ id, name, kind, hasData, datasetName, dataFacts }`. Pass `dataFacts` as the brief's `dataset`.

---

## SDK

A tiny zero-dependency JS client is in [`sdk/autolab.mjs`](../sdk/autolab.mjs):

```js
import { createClient } from './sdk/autolab.mjs';
const autolab = createClient({ baseUrl: 'http://localhost:4000', apiKey: 'autolab_pk_...' });

// drive the brief interview with your own answer function, then plan
const brief = await autolab.runBrief('predict machine failures from sensor logs', async (q) => q.default_value);
const { plan } = await autolab.plan(brief);
```
