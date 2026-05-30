import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramSchema, PassResultsSchema, RunRecordSchema, DirectiveSchema } from './schemas.js';

// Minimal YAML front-matter parser (flat key: value only — sufficient for program.md).
function parseFrontMatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('program.md is missing a --- front-matter block');
  const obj = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    obj[key] = line.slice(idx + 1).trim();
  }
  return obj;
}

export function readProgram(runDir) {
  const path = join(runDir, 'program.md');
  if (!existsSync(path)) throw new Error(`Missing program.md at ${path}`);
  const fm = parseFrontMatter(readFileSync(path, 'utf8'));
  return ProgramSchema.parse(fm);
}

export function readResults(runDir, pass) {
  const path = join(runDir, 'results', `pass-${pass}.json`);
  if (!existsSync(path)) throw new Error(`Missing results pass-${pass} at ${path}`);
  return PassResultsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function readRuns(runDir, pass) {
  const path = join(runDir, 'runs', `pass-${pass}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => RunRecordSchema.parse(JSON.parse(l)));
}

export function listPasses(runDir) {
  const dir = join(runDir, 'results');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^pass-(\d+)\.json$/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

export function writeDirective(runDir, pass, directive) {
  const validated = DirectiveSchema.parse(directive);
  const dir = join(runDir, 'directives');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `pass-${pass}.json`), JSON.stringify(validated, null, 2));
  return validated;
}
