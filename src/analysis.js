export function ema(values, period) {
  if (values.length < period) return values.map(() => null);
  const out = Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, number) => sum + number, 0) / period;
  out[period - 1] = value;
  for (let index = period; index < values.length; index++) {
    value = values[index] * alpha + value * (1 - alpha);
    out[index] = value;
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    gain += Math.max(0, change);
    loss += Math.max(0, -change);
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(0, change)) / period;
    loss = (loss * (period - 1) + Math.max(0, -change)) / period;
    out[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function rollingMax(values, end, length) {
  let maximum = -Infinity;
  for (let index = Math.max(0, end - length); index < end; index++) maximum = Math.max(maximum, values[index]);
  return maximum;
}
function rollingMin(values, end, length) {
  let minimum = Infinity;
  for (let index = Math.max(0, end - length); index < end; index++) minimum = Math.min(minimum, values[index]);
  return minimum;
}
function suffixExtreme(values, mode) {
  const result = Array(values.length + 1).fill(mode === 'min' ? Infinity : -Infinity);
  for (let index = values.length - 1; index >= 0; index--) {
    result[index] = mode === 'min' ? Math.min(values[index], result[index + 1]) : Math.max(values[index], result[index + 1]);
  }
  return result;
}

export function findSwings(candles, left = 5, right = 5) {
  const swings = [];
  for (let index = left; index < candles.length - right; index++) {
    const candle = candles[index];
    let high = true, low = true;
    for (let neighbor = index - left; neighbor <= index + right; neighbor++) {
      if (neighbor === index) continue;
      if (candles[neighbor].high >= candle.high) high = false;
      if (candles[neighbor].low <= candle.low) low = false;
      if (!high && !low) break;
    }
    if (high) swings.push({ index, type: 'high', price: candle.high, time: candle.time });
    if (low) swings.push({ index, type: 'low', price: candle.low, time: candle.time });
  }
  return swings;
}

export function findFvgs(candles) {
  const zones = [];
  const futureMinLow = suffixExtreme(candles.map(candle => candle.low), 'min');
  const futureMaxHigh = suffixExtreme(candles.map(candle => candle.high), 'max');
  for (let index = 2; index < candles.length; index++) {
    let zone = null;
    if (candles[index].low > candles[index - 2].high) {
      zone = { type: 'bull', kind: 'FVG', start: index - 2, bottom: candles[index - 2].high, top: candles[index].low, created: candles[index].time };
    } else if (candles[index].high < candles[index - 2].low) {
      zone = { type: 'bear', kind: 'FVG', start: index - 2, bottom: candles[index].high, top: candles[index - 2].low, created: candles[index].time };
    }
    if (!zone) continue;
    const filled = zone.type === 'bull' ? futureMinLow[index + 1] <= zone.bottom : futureMaxHigh[index + 1] >= zone.top;
    if (!filled) zones.push(zone);
  }
  return zones;
}

export function findOrderBlocks(candles, swings = findSwings(candles)) {
  const zones = [];
  const highs = candles.map(candle => candle.high);
  const lows = candles.map(candle => candle.low);
  const closes = candles.map(candle => candle.close);
  const futureMinClose = suffixExtreme(closes, 'min');
  const futureMaxClose = suffixExtreme(closes, 'max');
  let swingCursor = 0, lastHigh = null, lastLow = null;

  for (let index = 2; index < candles.length - 1; index++) {
    while (swingCursor < swings.length && swings[swingCursor].index < index) {
      const swing = swings[swingCursor++];
      if (swing.type === 'high') lastHigh = swing;
      else if (swing.type === 'low') lastLow = swing;
    }
    const priorHigh = lastHigh && lastHigh.index >= index - 24 ? lastHigh : null;
    const priorLow = lastLow && lastLow.index >= index - 24 ? lastLow : null;
    const candle = candles[index];
    const body = Math.abs(candle.close - candle.open);
    const range = Math.max(candle.high - candle.low, Number.EPSILON);
    if (body / range < 0.6) continue;

    let type = null;
    if (candle.close > candle.open && priorHigh && candle.close > priorHigh.price && candle.close > rollingMax(highs, index, 12)) type = 'bull';
    if (candle.close < candle.open && priorLow && candle.close < priorLow.price && candle.close < rollingMin(lows, index, 12)) type = 'bear';
    if (!type) continue;

    let origin = -1;
    for (let previous = index - 1; previous >= Math.max(0, index - 5); previous--) {
      if ((type === 'bull' && candles[previous].close < candles[previous].open) || (type === 'bear' && candles[previous].close > candles[previous].open)) {
        origin = previous;
        break;
      }
    }
    if (origin < 0) continue;
    const opposite = candles[origin];
    const invalid = type === 'bull' ? futureMinClose[index + 1] < opposite.low : futureMaxClose[index + 1] > opposite.high;
    if (!invalid) {
      zones.push({ type, kind: 'OB', start: origin, bottom: Math.min(opposite.open, opposite.close, opposite.low), top: Math.max(opposite.open, opposite.close, opposite.high), created: opposite.time });
    }
  }
  return zones;
}

export function analyze(candles) {
  const closes = candles.map(candle => candle.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), rsis = rsi(closes, 14);
  const last = closes.length - 1;
  let trend = 'unknown';
  if (last >= 49 && e20[last] != null && e50[last] != null) {
    const slope = e20[last] - e20[last - 5];
    trend = e20[last] > e50[last] && slope > 0 ? 'bull' : e20[last] < e50[last] && slope < 0 ? 'bear' : 'range';
  }
  const swings = findSwings(candles);
  const fvgs = findFvgs(candles), obs = findOrderBlocks(candles, swings);
  return { e20, e50, rsi: rsis[last] ?? null, trend, swings, fvgs, obs, zones: [...fvgs, ...obs] };
}

export function annualVolumePeaks(candles, lookahead = 20) {
  const years = new Map();
  candles.forEach((candle, index) => {
    const year = new Date(candle.time).getUTCFullYear();
    if (!years.has(year)) years.set(year, { year, total: 0, count: 0, peak: candle, peakIndex: index });
    const group = years.get(year);
    group.total += candle.volume;
    group.count++;
    if (candle.volume > group.peak.volume) { group.peak = candle; group.peakIndex = index; }
  });
  return [...years.values()].sort((a, b) => b.year - a.year).map(group => {
    const futureIndex = Math.min(candles.length - 1, group.peakIndex + lookahead);
    const future = candles[futureIndex];
    const reaction = future && futureIndex > group.peakIndex ? (future.close / group.peak.close - 1) * 100 : null;
    return { ...group, reaction, reactionBars: futureIndex - group.peakIndex };
  });
}
