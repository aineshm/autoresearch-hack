# orchestration — AutoLab L2+L3 (MVP)

L3 Synthesizer + the shared blackboard contract. JS ESM, Node 24, zod, `node --test`.

## Blackboard contract (Phase 0 — PROPOSED, pending teammate ratification)
A `runDir/` holds: `program.md` (L1), `results/pass-N.json` (L2), `runs/pass-N.jsonl` (monitor),
`directives/pass-N.json` (L3). Join key across results/runs/Raindrop: `run_id`.

## L3
`synthesize(runDir, { llm })` reads the latest pass, runs deterministic checks
(held-out gap, plateau), asks the LLM to fill a directive, validates + writes it.

    npm install
    npm test
    node bin/synthesize.js <runDir>     # needs OPENAI_API_KEY

## Status: MVP. [Later]: literature/validity checks, runs/ Raindrop evidence,
live Workshop-MCP drill-down, progress.md, deepagents subagent wrapper.
