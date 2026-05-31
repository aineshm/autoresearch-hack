#!/usr/bin/env node
import { synthesize, synthesizeL2 } from '../lib/synthesize.js';
import { llmDirective } from '../lib/llm.js';

const args = process.argv.slice(2);
const l2flag = args.indexOf('--l2');
const runDir = l2flag !== -1 ? args[l2flag + 1] : args[0];
if (!runDir) { console.error('Usage: synthesize [--l2] <runDir>'); process.exit(1); }

const fn = l2flag !== -1 ? synthesizeL2 : synthesize;
fn(runDir, { llm: llmDirective })
  .then((d) => { console.log(`L3 verdict: ${d.verdict} (pass ${d.pass})`); console.log(JSON.stringify(d, null, 2)); })
  .catch((err) => { console.error('synthesize failed:', err.message); process.exit(1); });
