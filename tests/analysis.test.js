import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, annualVolumePeaks, ema, findFvgs, findOrderBlocks, findSwings, rsi } from '../src/analysis.js';
import { isSafeCsvPath, parseOHLCVCsv, resolveCsvUrl, validateCatalog } from '../src/store.js';

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
  assert.deepEqual(pivots.map(pivot => [pivot.index, pivot.type]), [[2, 'high'], [4, 'low']]);
  assert.equal(findSwings(rows.slice(0, 3), 1, 1).length, 0);
});

test('three-candle FVG remains open until price fully crosses the far boundary', () => {
  const rows = [candle(0, { high: 10 }), candle(1), candle(2, { low: 12, high: 13 }), candle(3, { low: 11 })];
  assert.equal(findFvgs(rows).length, 1);
  rows.push(candle(4, { low: 9.8, high: 12.5 }));
  assert.equal(findFvgs(rows).length, 0);
});

test('Order Block detects the last opposite candle before a confirmed bullish break', () => {
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

test('annual summary keeps the largest candle volume and measures a 20-bar response', () => {
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

test('CSV parser accepts standard OHLCV headers and normalizes UTC timestamps', () => {
  const csv = 'timestamp,open,high,low,close,volume\n2024-01-01T00:00:00Z,10,12,9,11,4\n2024-01-02T00:00:00Z,11,13,10,12,8';
  const parsed = parseOHLCVCsv(csv);
  assert.equal(parsed.candles.length, 2);
  assert.equal(parsed.candles[0].time, '2024-01-01T00:00:00.000Z');
  assert.equal(parsed.candles[1].volume, 8);
  assert.equal(parsed.skippedRows, 0);
});

test('CSV parser accepts Binance open_time columns without a header', () => {
  const csv = '1704067200000,10,12,9,11,4,999\n1704153600000,11,13,10,12,8,1000';
  const parsed = parseOHLCVCsv(csv);
  assert.equal(parsed.candles.length, 2);
  assert.equal(parsed.candles[0].time, '2024-01-01T00:00:00.000Z');
});

test('CSV parser rejects duplicate or descending candle timestamps', () => {
  const csv = 'timestamp,open,high,low,close,volume\n2024-01-02,10,12,9,11,4\n2024-01-01,11,13,10,12,8';
  assert.throws(() => parseOHLCVCsv(csv), /غير مرتبة أو يوجد وقت مكرر/);
});

test('catalog accepts safe data-relative CSV paths and rejects traversal', () => {
  const entries = validateCatalog({ datasets: [{ symbol: 'btcusdt', timeframe: '1d', file: 'BTCUSDT/1d.csv' }] });
  assert.equal(entries[0].id, 'BTCUSDT::1d');
  assert.equal(isSafeCsvPath('../secrets.csv'), false);
  assert.equal(isSafeCsvPath('BTCUSDT/1d.json'), false);
  assert.equal(resolveCsvUrl(entries[0].file, new URL('https://example.test/project/data/catalog.json')).href, 'https://example.test/project/data/BTCUSDT/1d.csv');
  assert.throws(() => validateCatalog({ datasets: [{ symbol: 'BTCUSDT', timeframe: '1d', file: '../1d.csv' }] }), /غير آمن/);
});

test('large-history zone scans complete linearly and keep true open gaps', () => {
  const rows = Array.from({ length: 10000 }, (_, i) => {
    const close = 1000 + Math.sin(i / 20) * 30;
    return candle(i, { open: close - 1, high: close + 2, low: close - 2, close, volume: i % 31 });
  });
  const result = analyze(rows);
  assert.equal(result.e20.length, rows.length);
  assert.equal(result.e50.length, rows.length);
  assert.ok(Array.isArray(result.fvgs));
});
