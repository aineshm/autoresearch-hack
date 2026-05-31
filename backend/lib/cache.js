// Record/replay cache. First time an input is seen, the live output is recorded; every later
// time the SAME input is seen, the recorded output is returned. Makes the demo look like a real
// live interaction while being deterministic and instant (no LLM/web variance).
// Persisted to backend/data/cache.json so it survives restarts.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(dataDir, { recursive: true });
const FILE = join(dataDir, 'cache.json');

let store = {};
try { store = JSON.parse(readFileSync(FILE, 'utf8')); } catch { store = {}; }

function persist() {
  try { writeFileSync(FILE, JSON.stringify(store)); } catch (e) { console.error('cache persist failed:', e?.message); }
}

// Light normalization so trivial typing differences (spacing/case) still match the recorded input.
function norm(v) {
  if (typeof v === 'string') return v.trim().replace(/\s+/g, ' ').toLowerCase();
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = norm(v[k]);
    return o;
  }
  return v;
}

export function key(scope, input) {
  const h = createHash('sha256').update(JSON.stringify(norm(input))).digest('hex').slice(0, 24);
  return `${scope}:${h}`;
}
export function get(k) {
  return store[k];
}
export function set(k, value) {
  store[k] = value;
  persist();
}
export function clearCache() {
  store = {};
  persist();
}
export function stats() {
  const scopes = {};
  for (const k of Object.keys(store)) {
    const s = k.split(':')[0];
    scopes[s] = (scopes[s] || 0) + 1;
  }
  return { entries: Object.keys(store).length, scopes };
}
