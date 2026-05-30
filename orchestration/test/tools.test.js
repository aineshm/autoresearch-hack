import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHeldOutGap, detectPlateau, crashRate, detectPlateauMetric } from '../lib/tools.js';

test('computeHeldOutGap returns val-minus-held_out per candidate', () => {
  const results = { pass: 1, candidates: [
    { id: 'c1', metrics: { train: 0.99, val: 0.88, held_out: 0.82 } },
    { id: 'c2', metrics: { train: 0.90, val: 0.89, held_out: 0.885 } },
  ]};
  const gaps = computeHeldOutGap(results);
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].candidateId, 'c1');
  assert.ok(Math.abs(gaps[0].gap - 0.06) < 1e-9);
  assert.ok(Math.abs(gaps[1].gap - 0.005) < 1e-9);
});

test('detectPlateau is true when best held_out has not improved across history', () => {
  const history = [
    { pass: 1, bestHeldOut: 0.80 },
    { pass: 2, bestHeldOut: 0.801 },
    { pass: 3, bestHeldOut: 0.801 },
  ];
  assert.equal(detectPlateau(history, { direction: 'max', minDelta: 0.005, window: 2 }), true);
});

test('detectPlateau is false when improving', () => {
  const history = [
    { pass: 1, bestHeldOut: 0.80 },
    { pass: 2, bestHeldOut: 0.86 },
    { pass: 3, bestHeldOut: 0.90 },
  ];
  assert.equal(detectPlateau(history, { direction: 'max', minDelta: 0.005, window: 2 }), false);
});

test('detectPlateau is false with too little history', () => {
  assert.equal(detectPlateau([{ pass: 1, bestHeldOut: 0.8 }], { direction: 'max', minDelta: 0.005, window: 2 }), false);
});

test('crashRate is the fraction of crashed attempts in the window', () => {
  const attempts = [
    { status: 'keep' }, { status: 'crash' }, { status: 'discard' }, { status: 'crash' },
  ];
  assert.ok(Math.abs(crashRate(attempts, 4) - 0.5) < 1e-9);
});

test('detectPlateauMetric handles lower-is-better best-so-far', () => {
  const history = [{ best: 1.0 }, { best: 0.99 }, { best: 0.989 }];
  assert.equal(detectPlateauMetric(history, { lowerIsBetter: true, minDelta: 0.005, window: 2 }), true);
});

test('detectPlateauMetric false while clearly improving (lower-is-better)', () => {
  const history = [{ best: 1.0 }, { best: 0.9 }, { best: 0.8 }];
  assert.equal(detectPlateauMetric(history, { lowerIsBetter: true, minDelta: 0.005, window: 2 }), false);
});
