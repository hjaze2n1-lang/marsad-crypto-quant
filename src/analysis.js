export function ema(values, period) {
  if (values.length < period) return values.map(() => null);
  const out = Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = value;
  for (let i = period; i < values.length; i++) { value = values[i] * alpha + value * (1 - alpha); out[i] = value; }
  return out;
}

export function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; gain += Math.max(0, d); loss += Math.max(0, -d); }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function rollingMax(values, end, length) { let m = -Infinity; for (let i = Math.max(0, end - length); i < end; i++) m = Math.max(m, values[i]); return m; }
function rollingMin(values, end, length) { let m = Infinity; for (let i = Math.max(0, end - length); i < end; i++) m = Math.min(m, values[i]); return m; }

export function findSwings(candles, left = 5, right = 5) {
  const swings = [];
  for (let i = left; i < candles.length - right; i++) {
    const c = candles[i];
    let high = true, low = true;
    for (let j = i - left; j <= i + right; j++) if (j !== i) {
      if (candles[j].high >= c.high) high = false;
      if (candles[j].low <= c.low) low = false;
      if (!high && !low) break;
    }
    if (high) swings.push({ index: i, type: 'high', price: c.high, time: c.time });
    if (low) swings.push({ index: i, type: 'low', price: c.low, time: c.time });
  }
  return swings;
}

export function findFvgs(candles) {
  const zones = [];
  for (let i = 2; i < candles.length; i++) {
    let zone = null;
    if (candles[i].low > candles[i - 2].high) zone = { type: 'bull', kind: 'FVG', start: i - 2, bottom: candles[i - 2].high, top: candles[i].low, created: candles[i].time };
    else if (candles[i].high < candles[i - 2].low) zone = { type: 'bear', kind: 'FVG', start: i - 2, bottom: candles[i].high, top: candles[i - 2].low, created: candles[i].time };
    if (!zone) continue;
    const later = candles.slice(i + 1);
    const filled = zone.type === 'bull' ? later.some(c => c.low <= zone.bottom) : later.some(c => c.high >= zone.top);
    if (!filled) zones.push(zone);
  }
  return zones;
}

export function findOrderBlocks(candles, swings = findSwings(candles)) {
  const zones = [];
  const confirmedHighs = swings.filter(s => s.type === 'high');
  const confirmedLows = swings.filter(s => s.type === 'low');
  for (let i = 2; i < candles.length - 1; i++) {
    const c = candles[i], prev = candles[i - 1];
    const body = Math.abs(c.close - c.open);
    const range = Math.max(c.high - c.low, Number.EPSILON);
    const displaced = body / range >= 0.6;
    if (!displaced) continue;
    const priorHigh = confirmedHighs.filter(s => s.index >= i - 24 && s.index < i).at(-1);
    const priorLow = confirmedLows.filter(s => s.index >= i - 24 && s.index < i).at(-1);
    let type = null;
    if (c.close > c.open && priorHigh && c.close > priorHigh.price && c.close > rollingMax(candles.map(x => x.high), i, 12)) type = 'bull';
    if (c.close < c.open && priorLow && c.close < priorLow.price && c.close < rollingMin(candles.map(x => x.low), i, 12)) type = 'bear';
    if (!type) continue;
    let origin = -1;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      if ((type === 'bull' && candles[j].close < candles[j].open) || (type === 'bear' && candles[j].close > candles[j].open)) { origin = j; break; }
    }
    if (origin < 0) continue;
    const ob = candles[origin];
    const bottom = Math.min(ob.open, ob.close), top = Math.max(ob.open, ob.close);
    const later = candles.slice(i + 1);
    const invalid = type === 'bull' ? later.some(x => x.close < ob.low) : later.some(x => x.close > ob.high);
    if (!invalid) zones.push({ type, kind: 'OB', start: origin, bottom: Math.min(bottom, ob.low), top: Math.max(top, ob.high), created: ob.time });
  }
  return zones;
}

export function analyze(candles) {
  const closes = candles.map(c => c.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), rsis = rsi(closes, 14);
  const last = closes.length - 1;
  let trend = 'unknown';
  if (last >= 49 && e20[last] != null && e50[last] != null) {
    const slope = last > 5 ? e20[last] - e20[last - 5] : 0;
    trend = e20[last] > e50[last] && slope > 0 ? 'bull' : e20[last] < e50[last] && slope < 0 ? 'bear' : 'range';
  }
  const swings = findSwings(candles);
  const fvgs = findFvgs(candles), obs = findOrderBlocks(candles, swings);
  return { e20, e50, rsi: rsis[last] ?? null, trend, swings, fvgs, obs, zones: [...fvgs, ...obs] };
}

export function annualVolumePeaks(candles, lookahead = 20) {
  const years = new Map();
  candles.forEach((c, i) => {
    const y = new Date(c.time).getUTCFullYear();
    if (!years.has(y)) years.set(y, { year: y, total: 0, count: 0, peak: c, peakIndex: i });
    const group = years.get(y); group.total += c.volume; group.count++;
    if (c.volume > group.peak.volume) { group.peak = c; group.peakIndex = i; }
  });
  return [...years.values()].sort((a, b) => b.year - a.year).map(x => {
    const future = candles[Math.min(candles.length - 1, x.peakIndex + lookahead)];
    const reaction = future && future !== x.peak ? ((future.close / x.peak.close) - 1) * 100 : null;
    return { ...x, reaction, reactionBars: Math.min(lookahead, candles.length - 1 - x.peakIndex) };
  });
}
