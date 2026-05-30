#!/usr/bin/env node
import { synthesize } from '../lib/synthesize.js';
import { llmDirective } from '../lib/llm.js';

const runDir = process.argv[2];
if (!runDir) {
  console.error('Usage: node bin/synthesize.js <runDir>');
  process.exit(1);
}

synthesize(runDir, { llm: llmDirective })
  .then((directive) => {
    console.log(`L3 verdict: ${directive.verdict} (pass ${directive.pass})`);
    console.log(JSON.stringify(directive, null, 2));
  })
  .catch((err) => {
    console.error('synthesize failed:', err.message);
    process.exit(1);
  });
