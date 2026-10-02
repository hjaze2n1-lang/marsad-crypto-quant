import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, annualVolumePeaks, ema, findFvgs, findOrderBlocks, findSwings, rsi } from '../src/analysis.js';

const candle = (i, overrides = {}) => ({
  time: new Date(Date.UTC(2024, 0, i + 1)).toISOString(),
  open: 10, high: 11, low: 9, close: 10, volume: 100, ...overrides
});

test('EMA uses an initial simple average then exponential weighting', () => {
  assert.deepEqual(ema([1, 2, 3], 2), [null, 1.5, 2.5]);
});

test('RSI returns 100 in a strictly rising sequence', () => {
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14).at(-1), 100);
});

test('pivot swings only mark strict local extrema after right-side candles exist', () => {
  const rows = [candle(0), candle(1), candle(2, { high: 15 }), candle(3), candle(4, { low: 5 }), candle(5)];
  const pivots = findSwings(rows, 1, 1);
  assert.deepEqual(pivots.map(p => [p.index, p.type]), [[2, 'high'], [4, 'low']]);
  assert.equal(findSwings(rows.slice(0, 3), 1, 1).length, 0);
});

test('three-candle FVG remains open until price fully crosses the far boundary', () => {
  const rows = [candle(0, { high: 10 }), candle(1), candle(2, { low: 12, high: 13 }), candle(3, { low: 11 })];
  assert.equal(findFvgs(rows).length, 1);
  rows.push(candle(4, { low: 9.8, high: 12.5 }));
  assert.equal(findFvgs(rows).length, 0);
});

test('order block detects the last opposite candle before a confirmed bullish break', () => {
  const rows = Array.from({ length: 15 }, (_, i) => candle(i));
  rows[2] = candle(2, { high: 14 });
  rows[7] = candle(7, { open: 10, close: 9.5, high: 10.5, low: 9 });
  rows[8] = candle(8, { open: 9.5, close: 15, high: 15.2, low: 9.2 });
  const blocks = findOrderBlocks(rows, findSwings(rows, 1, 1));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'OB');
  assert.equal(blocks[0].type, 'bull');
  assert.equal(blocks[0].start, 7);
});

test('annual summary keeps the largest candle volume and measures 20-bar response', () => {
  const rows = Array.from({ length: 25 }, (_, i) => candle(i, { close: 100 + i, volume: i === 2 ? 900 : 100 }));
  const [summary] = annualVolumePeaks(rows);
  assert.equal(summary.year, 2024);
  assert.equal(summary.peakIndex, 2);
  assert.equal(summary.peak.volume, 900);
  assert.ok(Math.abs(summary.reaction - ((122 / 102 - 1) * 100)) < 1e-9);
});

test('analysis classifies a sustained rising series and computes RSI', () => {
  const rows = Array.from({ length: 80 }, (_, i) => candle(i, { open: 100 + i, close: 101 + i, high: 102 + i, low: 99 + i }));
  const result = analyze(rows);
  assert.equal(result.trend, 'bull');
  assert.equal(result.rsi, 100);
});
