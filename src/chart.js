const COLORS = { up: '#48d6a1', down: '#ff6f7c', grid: '#23303c', text: '#8291a1', fvg: '#8e80ff', ob: '#f4bb5f', swing: '#68a8ff', ema20: '#55c0ff', ema50: '#e1b967' };
let hoverPoint = null;
let lastGeometry = null;

export function setHover(point) { hoverPoint = point; }
export function chartGeometry() { return lastGeometry; }

export function drawChart(canvas, candles, analysis, onHover = null) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(320, rect.width), height = Math.max(240, rect.height);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!candles.length) { lastGeometry = null; return; }

  const pad = { top: 18, right: 76, bottom: 27, left: 10 };
  const plotH = height * .72 - pad.top;
  const volumeTop = pad.top + plotH + 20;
  const volumeH = Math.max(18, height - volumeTop - pad.bottom);
  const plotW = Math.max(1, width - pad.left - pad.right);
  let min = Infinity, max = -Infinity, maxVol = 1;
  for (const candle of candles) {
    if (candle.low < min) min = candle.low;
    if (candle.high > max) max = candle.high;
    if (candle.volume > maxVol) maxVol = candle.volume;
  }
  const spread = Math.max(max - min, Math.abs(max) * .001, 1e-8);
  const lo = min - spread * .06, hi = max + spread * .06;
  const y = price => pad.top + (hi - price) / (hi - lo) * plotH;
  const step = plotW / candles.length;
  const bodyW = Math.max(1, Math.min(12, step * .68));
  const x = index => pad.left + index * step + step / 2;
  lastGeometry = { width, height, pad, plotH, volumeTop, volumeH, plotW, lo, hi, step, x, y, candles };

  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let index = 0; index <= 5; index++) {
    const yy = pad.top + plotH * index / 5;
    const price = hi - (hi - lo) * index / 5;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right + 7, yy);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(formatPrice(price), width - pad.right + 12, yy);
  }
  ctx.fillStyle = '#6f809033';
  ctx.fillRect(pad.left, volumeTop - 9, plotW, 1);
  ctx.fillStyle = COLORS.text;
  ctx.fillText('VOL', width - pad.right + 12, volumeTop + 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();
  const visibleZones = (analysis?.zones || []).slice().sort((a, b) => b.start - a.start).slice(0, 16).sort((a, b) => a.start - b.start);
  for (const zone of visibleZones) {
    const left = Math.max(pad.left, x(zone.start) - step / 2);
    const right = width - pad.right;
    if (right <= left) continue;
    const top = y(zone.top), bottom = y(zone.bottom);
    ctx.fillStyle = zone.kind === 'FVG' ? (zone.type === 'bull' ? '#8274ff18' : '#ff748118') : (zone.type === 'bull' ? '#48d6a113' : '#f4bb5f16');
    ctx.fillRect(left, top, right - left, Math.max(1, bottom - top));
    ctx.strokeStyle = zone.kind === 'FVG' ? `${COLORS.fvg}88` : `${COLORS.ob}88`;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, right - left, Math.max(1, bottom - top));
    ctx.setLineDash([]);
    ctx.fillStyle = zone.kind === 'FVG' ? COLORS.fvg : COLORS.ob;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(zone.kind, left + 3, Math.min(bottom - 3, top + 10));
  }
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const xx = x(index);
    const up = candle.close >= candle.open;
    const color = up ? COLORS.up : COLORS.down;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.min(2, step * .18));
    ctx.beginPath();
    ctx.moveTo(xx, y(candle.high));
    ctx.lineTo(xx, y(candle.low));
    ctx.stroke();
    ctx.fillStyle = color;
    const top = y(Math.max(candle.open, candle.close));
    const bottom = y(Math.min(candle.open, candle.close));
    ctx.fillRect(xx - bodyW / 2, top, bodyW, Math.max(1, bottom - top));
    const volumeHeight = Math.max(1, candle.volume / maxVol * volumeH);
    ctx.fillStyle = up ? '#48d6a166' : '#ff6f7c66';
    ctx.fillRect(xx - bodyW / 2, volumeTop + volumeH - volumeHeight, bodyW, volumeHeight);
  }
  drawLine(ctx, analysis?.e20, x, y, COLORS.ema20);
  drawLine(ctx, analysis?.e50, x, y, COLORS.ema50);
  for (const swing of analysis?.swings || []) {
    if (swing.index < 0 || swing.index >= candles.length) continue;
    const xx = x(swing.index), yy = y(swing.price);
    ctx.fillStyle = COLORS.swing;
    ctx.beginPath();
    ctx.arc(xx, yy + (swing.type === 'high' ? -7 : 7), 2.6, 0, Math.PI * 2);
    ctx.fill();
    if (step > 4) {
      ctx.font = '8px "IBM Plex Mono", monospace';
      ctx.fillStyle = COLORS.swing;
      ctx.textAlign = 'center';
      ctx.fillText(swing.type === 'high' ? 'H' : 'L', xx, yy + (swing.type === 'high' ? -14 : 15));
    }
  }
  for (const peak of analysis?.annualPeaks || []) {
    if (peak.index < 0 || peak.index >= candles.length) continue;
    const xx = x(peak.index), yy = y(candles[peak.index].high) - 9;
    ctx.fillStyle = COLORS.ob;
    ctx.beginPath();
    ctx.moveTo(xx, yy - 4); ctx.lineTo(xx + 4, yy); ctx.lineTo(xx, yy + 4); ctx.lineTo(xx - 4, yy);
    ctx.closePath(); ctx.fill();
    if (step > 5) {
      ctx.font = '8px "IBM Plex Mono", monospace';
      ctx.fillStyle = COLORS.ob;
      ctx.textAlign = 'center';
      ctx.fillText(`V${peak.year}`, xx, yy - 8);
    }
  }
  ctx.restore();

  const labelEvery = Math.max(1, Math.ceil(candles.length / 7));
  ctx.fillStyle = COLORS.text;
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  for (let index = 0; index < candles.length; index++) {
    if (index % labelEvery === 0 || index === candles.length - 1) ctx.fillText(formatTime(candles[index].time), x(index), height - 10);
  }
  if (hoverPoint && hoverPoint.x >= pad.left && hoverPoint.x <= width - pad.right && hoverPoint.y >= pad.top && hoverPoint.y <= volumeTop + volumeH) {
    const index = Math.max(0, Math.min(candles.length - 1, Math.floor((hoverPoint.x - pad.left) / step)));
    const candle = candles[index], xx = x(index);
    ctx.strokeStyle = '#afbbc566';
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(xx, pad.top); ctx.lineTo(xx, height - pad.bottom); ctx.stroke();
    ctx.setLineDash([]);
    onHover?.('', candle);
  } else onHover?.('', null);
}

function drawLine(ctx, values, x, y, color) {
  if (!values) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let started = false;
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) return;
    if (!started) { ctx.moveTo(x(index), y(value)); started = true; }
    else ctx.lineTo(x(index), y(value));
  });
  ctx.stroke();
}
function formatPrice(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(value) : '—';
}
function formatTime(time) {
  const date = new Date(time);
  return Number.isNaN(date.valueOf()) ? '' : `${String(date.getUTCFullYear()).slice(-2)}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
