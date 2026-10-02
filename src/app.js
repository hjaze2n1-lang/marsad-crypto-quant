import { analyze, annualVolumePeaks } from './analysis.js';
import { drawChart, setHover } from './chart.js';
import { clearStore, deleteDataset, getCandleRange, listDatasets, openStore, putCandleBatch, saveDataset } from './store.js';

const $ = s => document.querySelector(s);
const els = {
  file: $('#fileInput'), symbol: $('#symbolSelect'), timeframe: $('#timeframeSelect'), canvas: $('#priceChart'), empty: $('#chartEmpty'),
  status: $('#dataStatus'), chartTitle: $('#chartTitle'), chartSubtitle: $('#chartSubtitle'), lastTime: $('#lastCandleTime'), count: $('#chartCount'),
  older: $('#olderBtn'), latest: $('#latestBtn'), dataList: $('#datasetList'), progress: $('#importProgress'), progressText: $('#progressText'), progressBar: $('#progressBar'), toast: $('#toast')
};
let datasets = [], selectedMeta = null, candles = [], currentAnalysis = null, viewStart = 0, windowSize = 240, toastTimer;

const HALVINGS = [
  { label: 'الأول', date: '2012-11-28', block: '210,000', reward: '25 BTC' },
  { label: 'الثاني', date: '2016-07-09', block: '420,000', reward: '12.5 BTC' },
  { label: 'الثالث', date: '2020-05-11', block: '630,000', reward: '6.25 BTC' },
  { label: 'الرابع', date: '2024-04-20', block: '840,000', reward: '3.125 BTC' },
  { label: 'الخامس', date: 'تقديري · 2028', block: '1,050,000', reward: '1.5625 BTC' }
];

function toast(message) { els.toast.textContent = message; els.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3100); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
function fmtNum(value, max = 6) { return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumSignificantDigits: max }).format(value) : '—'; }
function fmtVol(value) { return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value) : '—'; }
function fmtDate(value, withTime = false) { const date = new Date(value); if (Number.isNaN(date.valueOf())) return '—'; return new Intl.DateTimeFormat('ar', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date); }
function datasetId(symbol, timeframe) { return `${symbol.trim().toUpperCase()}::${timeframe.trim()}`; }

async function init() {
  $('#halvingRows').innerHTML = HALVINGS.map((h, i) => `<tr><td>${esc(h.label)}</td><td class="mono">${esc(h.date)}</td><td class="mono">${esc(h.block)}</td><td>${esc(h.reward)}</td><td><span class="tag ${i < 4 ? 'tag-up' : 'tag-open'}">${i < 4 ? 'حدث تاريخي' : 'موعد غير محسوم'}</span></td></tr>`).join('');
  $('#clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' UTC';
  setInterval(() => { $('#clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' UTC'; }, 1000);
  try { await openStore(); datasets = await listDatasets(); for (const d of datasets.filter(x => x.id.includes('::staging-'))) await deleteDataset(d.id); datasets = await listDatasets(); renderDatasets(); fillSymbols(); if (datasets.length) await selectFromControls(); else drawEmpty(); }
  catch (error) { toast(`تعذّر فتح قاعدة المتصفح: ${error.message}`); drawEmpty(); }
  bindEvents();
}

function bindEvents() {
  $('#importTopBtn').addEventListener('click', () => els.file.click()); $('#emptyImportBtn').addEventListener('click', () => els.file.click()); $('#dataImportBtn').addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', async event => { const files = [...event.target.files]; event.target.value = ''; if (!files.length) return; await importFiles(files); });
  $('#demoBtn').addEventListener('click', loadDemo);
  els.symbol.addEventListener('change', () => { fillTimeframes(); selectFromControls(); });
  els.timeframe.addEventListener('change', selectFromControls);
  $('#rangeButtons').addEventListener('click', event => { const button = event.target.closest('button[data-count]'); if (!button || !selectedMeta) return; windowSize = Number(button.dataset.count); $('#rangeButtons').querySelectorAll('button').forEach(b => b.classList.toggle('selected', b === button)); viewStart = Math.max(0, selectedMeta.count - windowSize); loadWindow(); });
  els.older.addEventListener('click', () => { if (!selectedMeta) return; viewStart = Math.max(0, viewStart - windowSize); loadWindow(); });
  els.latest.addEventListener('click', () => { if (!selectedMeta) return; viewStart = Math.max(0, selectedMeta.count - windowSize); loadWindow(); });
  $('#mainNav').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (!button) return; document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x === button)); document.querySelectorAll('.view-panel').forEach(x => x.classList.toggle('active', x.id === `view-${button.dataset.view}`)); if (button.dataset.view === 'structure') renderStructure(); if (button.dataset.view === 'volume') renderAnnual(); });
  $('#clearDataBtn').addEventListener('click', async () => { if (!datasets.length) return; if (!confirm('سيؤدي هذا إلى حذف جميع ملفات الشموع المخزنة محليًا في هذا المتصفح. هل تريد المتابعة؟')) return; await clearStore(); datasets = []; selectedMeta = null; candles = []; fillSymbols(); renderDatasets(); drawEmpty(); updateStats(null); toast('تم مسح البيانات المحلية.'); });
  els.dataList.addEventListener('click', async event => { const button = event.target.closest('[data-delete]'); if (!button) return; const id = button.dataset.delete; if (!confirm(`حذف مجموعة ${id} من هذا المتصفح؟`)) return; await deleteDataset(id); datasets = await listDatasets(); renderDatasets(); fillSymbols(); if (selectedMeta?.id === id) { selectedMeta = null; candles = []; drawEmpty(); updateStats(null); } toast('حُذفت المجموعة.'); });
  window.addEventListener('resize', () => candles.length && drawChart(els.canvas, candles, currentAnalysis));
  els.canvas.addEventListener('pointermove', event => { const rect = els.canvas.getBoundingClientRect(); setHover({ x: event.clientX - rect.left, y: event.clientY - rect.top }); drawChart(els.canvas, candles, currentAnalysis, (text, candle) => { if (candle) { els.chartSubtitle.textContent = `O ${fmtNum(candle.open)} · H ${fmtNum(candle.high)} · L ${fmtNum(candle.low)} · C ${fmtNum(candle.close)} · V ${fmtVol(candle.volume)}`; } else updateSubtitle(); }); });
  els.canvas.addEventListener('pointerleave', () => { setHover(null); if (candles.length) { drawChart(els.canvas, candles, currentAnalysis); updateSubtitle(); } });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') setHover(null); });
}

function fillSymbols() {
  const symbols = [...new Set(datasets.map(d => d.symbol))];
  els.symbol.innerHTML = symbols.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  els.symbol.disabled = !symbols.length;
  if (selectedMeta && symbols.includes(selectedMeta.symbol)) els.symbol.value = selectedMeta.symbol;
  fillTimeframes();
}
function fillTimeframes() {
  const symbol = els.symbol.value;
  const frames = datasets.filter(d => d.symbol === symbol).map(d => d.timeframe);
  els.timeframe.innerHTML = frames.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  els.timeframe.disabled = !frames.length;
  if (selectedMeta && frames.includes(selectedMeta.timeframe)) els.timeframe.value = selectedMeta.timeframe;
}
async function selectFromControls() {
  const id = datasetId(els.symbol.value || '', els.timeframe.value || '');
  selectedMeta = datasets.find(d => d.id === id) || null;
  if (!selectedMeta) { candles = []; drawEmpty(); updateStats(null); return; }
  viewStart = Math.max(0, selectedMeta.count - windowSize); await loadWindow();
}
async function loadWindow() {
  if (!selectedMeta) return;
  const end = Math.min(selectedMeta.count - 1, viewStart + windowSize - 1);
  if (end < viewStart) { candles = []; drawEmpty(); return; }
  try {
    candles = await getCandleRange(selectedMeta.id, viewStart, end);
    candles.sort((a, b) => a.seq - b.seq);
    currentAnalysis = analyze(candles);
    const visibleSeqs = new Map(candles.map((c, index) => [c.seq, index]));
    currentAnalysis.annualPeaks = (selectedMeta.annual || []).filter(p => visibleSeqs.has(p.peakIndex)).map(p => ({ index: visibleSeqs.get(p.peakIndex), year: p.year }));
    renderChart(); updateStats(currentAnalysis); updateSubtitle(); renderDatasets();
  } catch (error) { toast(`تعذّر تحميل نافذة الرسم: ${error.message}`); }
}
function drawEmpty() { els.canvas.getContext('2d').clearRect(0, 0, els.canvas.width, els.canvas.height); els.empty.classList.add('visible'); els.status.classList.remove('ready'); els.status.innerHTML = '<span class="status-icon">◌</span><span>لا توجد بيانات محمّلة</span>'; els.chartTitle.textContent = 'مخطط الشموع'; els.chartSubtitle.textContent = 'استورد OHLCV لعرض الشارت والتحليل'; els.lastTime.textContent = '—'; els.count.textContent = '0 شمعة'; els.older.disabled = true; els.latest.disabled = true; }
function renderChart() {
  els.empty.classList.toggle('visible', !candles.length);
  if (!candles.length) { drawEmpty(); return; }
  drawChart(els.canvas, candles, currentAnalysis);
  els.status.classList.add('ready'); els.status.innerHTML = `<span class="privacy-dot"></span><span>${esc(selectedMeta.symbol)} · ${esc(selectedMeta.timeframe)}</span>`;
  els.chartTitle.textContent = `${selectedMeta.symbol} · ${selectedMeta.timeframe}`;
  els.lastTime.textContent = fmtDate(candles.at(-1).time, true) + ' UTC';
  els.count.textContent = `${candles.length} من ${selectedMeta.count.toLocaleString('en-US')} شمعة`;
  els.older.disabled = viewStart <= 0; els.latest.disabled = viewStart + candles.length >= selectedMeta.count;
}
function updateSubtitle() {
  if (!selectedMeta || !candles.length) return;
  const first = candles[0], last = candles.at(-1);
  els.chartSubtitle.textContent = `${fmtDate(first.time)} — ${fmtDate(last.time)} · عرض نافذة ${candles.length} شمعة`;
}

function updateStats(result) {
  const trend = $('#trendValue'), rsiValue = $('#rsiValue'), swingValue = $('#swingValue'), zonesValue = $('#zonesValue');
  [trend, rsiValue, swingValue, zonesValue].forEach(e => { e.className = 'stat-value'; });
  if (!result || !candles.length) {
    trend.textContent = rsiValue.textContent = swingValue.textContent = zonesValue.textContent = '—';
    $('#trendNote').textContent = 'بانتظار البيانات'; $('#rsiNote').textContent = 'فوق 70 تشبع شرائي · دون 30 تشبع بيعي'; $('#rsiMeter').style.width = '0%';
    $('#insightBody').innerHTML = '<p class="muted">ستظهر هنا قراءة المؤشرات ومناطق السعر عند استيراد بياناتك.</p>';
    $('#swingsTable').innerHTML = '<div class="empty-inline">استورد بيانات لعرض النقاط المحورية.</div>';
    $('#zonesTable').innerHTML = '<div class="empty-inline">لا توجد مناطق معروضة بعد.</div>';
    $('#annualTable').innerHTML = '<div class="empty-inline">استورد بيانات OHLCV لاحتساب النشاط السنوي.</div>'; return;
  }
  const trendMap = { bull: ['صاعد', 'اتجاه صاعد وفق EMA 20/50 وميل EMA 20', 'up'], bear: ['هابط', 'اتجاه هابط وفق EMA 20/50 وميل EMA 20', 'down'], range: ['عرضي / مختلط', 'المتوسطات لا تؤكد اتجاهًا متسقًا', 'neutral'], unknown: ['بيانات غير كافية', 'نحتاج 50 شمعة على الأقل', 'neutral'] };
  const [label, note, cls] = trendMap[result.trend]; trend.textContent = label; trend.classList.add(cls); $('#trendNote').textContent = note;
  if (result.rsi == null) { rsiValue.textContent = '—'; $('#rsiNote').textContent = 'تحتاج 15 إغلاقًا على الأقل'; $('#rsiMeter').style.width = '0%'; }
  else { rsiValue.textContent = result.rsi.toFixed(1); rsiValue.classList.toggle('down', result.rsi >= 70); rsiValue.classList.toggle('up', result.rsi <= 30); $('#rsiNote').textContent = result.rsi >= 70 ? 'تشبع شرائي حسب RSI (≥70)' : result.rsi <= 30 ? 'تشبع بيعي حسب RSI (≤30)' : 'ضمن النطاق الوسطي (30–70)'; $('#rsiMeter').style.width = `${result.rsi}%`; $('#rsiMeter').className = result.rsi >= 70 ? 'overbought' : result.rsi <= 30 ? 'oversold' : ''; }
  const recentSwings = result.swings.filter(s => s.index >= Math.max(0, candles.length - 180)); swingValue.textContent = String(recentSwings.length); $('#swingNote').textContent = `${recentSwings.filter(s => s.type === 'high').length} قمة · ${recentSwings.filter(s => s.type === 'low').length} قاع (ضمن العرض)`;
  zonesValue.textContent = String(result.zones.length); $('#zonesNote').textContent = `${result.fvgs.length} FVG · ${result.obs.length} OB؛ يُرسم أحدث 12 فقط`;
  const trendText = label;
  $('#insightBody').innerHTML = `<div class="insight-list"><div class="insight-item"><b>اتجاه المتوسطات</b><span>${esc(trendText)}. EMA 20 ${fmtNum(result.e20.at(-1))} مقابل EMA 50 ${fmtNum(result.e50.at(-1))}.</span></div><div class="insight-item"><b>الزخم</b><span>${result.rsi == null ? 'لا تتوفر شموع كافية لحساب RSI.' : `RSI(14) عند ${result.rsi.toFixed(1)}؛ ${result.rsi >= 70 ? 'ضمن تشبع شرائي' : result.rsi <= 30 ? 'ضمن تشبع بيعي' : 'لا يقع في نطاق التشبع المحدد'}.`}</span></div><div class="insight-item"><b>بنية السعر في النافذة</b><span>${recentSwings.length} نقاط محورية مؤكدة و${result.zones.length} مناطق غير مكتملة وفق قواعد مرصد.</span></div></div><p>القراءة وصفية فقط، تعتمد على نافذة الرسم الحالية؛ لا تُعد إشارة دخول أو توقعًا للسعر.</p>`;
  renderStructure(); renderAnnual();
}

function renderStructure() {
  if (!currentAnalysis || !candles.length) return;
  const swings = currentAnalysis.swings.slice(-12).reverse();
  $('#swingsTable').innerHTML = swings.length ? `<table><thead><tr><th>النوع</th><th>الوقت</th><th>السعر</th><th>تأكيد</th></tr></thead><tbody>${swings.map(s => `<tr><td><span class="tag ${s.type === 'high' ? 'tag-down' : 'tag-up'}">${s.type === 'high' ? 'قمة' : 'قاع'}</span></td><td>${esc(fmtDate(s.time))}</td><td class="mono">${fmtNum(s.price)}</td><td>${Math.min(5, candles.length - 1 - s.index)} شموع لاحقة</td></tr>`).join('')}</tbody></table>` : '<div class="empty-inline">لا نقاط مؤكدة في النافذة. تحتاج pivots إلى خمس شموع يمينًا ويسارًا.</div>';
  const zones = currentAnalysis.zones.slice().sort((a, b) => b.start - a.start).slice(0, 16);
  $('#zonesTable').innerHTML = zones.length ? `<table><thead><tr><th>النوع</th><th>الاتجاه</th><th>من</th><th>إلى</th><th>تاريخ الإنشاء</th></tr></thead><tbody>${zones.map(z => `<tr><td><span class="tag ${z.kind === 'FVG' ? 'tag-open' : 'tag-ob'}">${z.kind}</span></td><td>${z.type === 'bull' ? 'صاعدة' : 'هابطة'}</td><td class="mono">${fmtNum(z.bottom)}</td><td class="mono">${fmtNum(z.top)}</td><td>${esc(fmtDate(z.created))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-inline">لا توجد فجوات/كتل غير مكتملة مكتشفة داخل نافذة العرض.</div>';
}

async function renderAnnual() {
  if (!selectedMeta) return;
  let peaks = selectedMeta.annual;
  if (!peaks?.length) { peaks = annualVolumePeaks(candles); }
  const rows = [...peaks].sort((a, b) => b.year - a.year);
  $('#annualTable').innerHTML = rows.length ? `<table><thead><tr><th>السنة</th><th>أعلى حجم شمعة</th><th>وقت الذروة</th><th>إغلاقها</th><th>التغير بعد 20 شمعة</th></tr></thead><tbody>${rows.map(x => `<tr><td class="mono">${esc(x.year)}</td><td class="mono">${fmtVol(x.peakVolume ?? x.peak?.volume)}</td><td>${esc(fmtDate(x.peakTime ?? x.peak?.time))}</td><td class="mono">${fmtNum(x.peakClose ?? x.peak?.close)}</td><td class="mono">${x.reaction == null ? 'غير متاح' : `<span class="${x.reaction >= 0 ? 'tag tag-up' : 'tag tag-down'}">${x.reaction >= 0 ? '+' : ''}${x.reaction.toFixed(2)}%</span>`}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-inline">لا توجد بيانات سنوية.</div>';
}

function renderDatasets() {
  if (!datasets.length) { els.dataList.innerHTML = '<div class="empty-inline">لا توجد مجموعات محفوظة.</div>'; return; }
  els.dataList.innerHTML = datasets.map(d => `<div class="dataset-item"><div><div class="dataset-name">${esc(d.symbol)} · ${esc(d.timeframe)}</div><div class="dataset-meta">${Number(d.count).toLocaleString('en-US')} شمعة · ${esc(d.source || 'ملف محلي')}${d.synthetic ? ' · اصطناعية' : ''}</div></div><button type="button" data-delete="${esc(d.id)}">حذف</button></div>`).join('');
}

function normalizedHeader(text) { return String(text ?? '').trim().toLowerCase().replace(/[ _-]/g, '').replace(/^\uFEFF/, ''); }
const aliases = {
  time: ['timestamp','time','date','datetime','opentime','open_time','t','unix','candleopen'], open: ['open','o'], high: ['high','h'], low: ['low','l'], close: ['close','c'], volume: ['volume','vol','v','basevolume','tickvolume']
};
function headerMap(headers) {
  const normalized = headers.map(normalizedHeader), map = {};
  for (const [field, choices] of Object.entries(aliases)) { const at = normalized.findIndex(h => choices.map(normalizedHeader).includes(h)); if (at >= 0) map[field] = at; }
  for (const field of ['open','high','low','close','volume']) if (map[field] == null) return null;
  return map.time == null ? null : map;
}
function parseCsvLine(line, delimiter = ',') {
  const fields = []; let field = '', quote = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (quote && line[i + 1] === '"') { field += '"'; i++; } else quote = !quote; } else if (c === delimiter && !quote) { fields.push(field); field = ''; } else field += c; }
  fields.push(field); return fields;
}
function detectDelimiter(line) { const candidates = [',', ';', '\t']; return candidates.sort((a, b) => line.split(b).length - line.split(a).length)[0]; }
function parseTimestamp(value) {
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) { let n = Number(value); if (!Number.isFinite(n)) return null; if (n < 1e11) n *= 1000; const d = new Date(n); return Number.isNaN(d.valueOf()) ? null : d.toISOString(); }
  const d = new Date(String(value).trim()); return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}
function toCandle(row, map) {
  let time, nums;
  if (Array.isArray(row)) { time = parseTimestamp(row[0]); nums = row.slice(1, 6).map(Number); }
  else {
    const normalized = Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [normalizedHeader(k), v]));
    const get = (field) => { const keys = aliases[field].map(normalizedHeader); return Object.keys(normalized).find(k => keys.includes(k)); };
    const tkey = get('time'); time = parseTimestamp(tkey == null ? '' : normalized[tkey]);
    nums = ['open', 'high', 'low', 'close', 'volume'].map(field => { const key = get(field); return key == null ? NaN : Number(normalized[key]); });
  }
  const [open, high, low, close, volume] = nums;
  if (!time || nums.some(n => !Number.isFinite(n)) || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
  return { time, open, high, low, close, volume };
}
function inferSymbol(filename, fallback) {
  const tokens = filename.toUpperCase().split(/[._\-\s]+/).filter(Boolean);
  const pair = tokens.find(token => /^[A-Z0-9]{2,15}(?:USDT|USD|BTC|ETH)$/.test(token));
  return pair || fallback.toUpperCase();
}

async function importFiles(files) {
  els.progress.hidden = false; let succeeded = 0; const orderingWarnings = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const fallbackSymbol = $('#importSymbol').value.trim() || 'UNKNOWN';
    const fallbackFrame = $('#importTimeframe').value.trim() || '1d';
    const symbol = inferSymbol(file.name, fallbackSymbol);
    const frameMatch = file.name.match(/(?:^|[._-])(\d+(?:m|h|d|w|M))(?:[._-]|$)/i);
    const timeframe = frameMatch ? frameMatch[1] : fallbackFrame;
    const id = datasetId(symbol, timeframe);
    const stagingId = `${id}::staging-${Date.now()}-${index}`;
    let stagedMeta;
    try {
      stagedMeta = { id: stagingId, symbol, timeframe, count: 0, source: file.name, importedAt: new Date().toISOString(), annual: [], synthetic: false };
      await saveDataset(stagedMeta);
      const onProgress = loaded => { els.progressText.textContent = `استيراد ${file.name} (${index + 1}/${files.length}) — ${Math.round(loaded / Math.max(1, file.size) * 100)}%`; els.progressBar.value = Math.round(loaded / Math.max(1, file.size) * 100); };
      const result = file.name.toLowerCase().endsWith('.json') ? await importJson(file, stagedMeta, onProgress) : await importCsv(file, stagedMeta, onProgress);
      if (!result.count) throw new Error('لم أجد شموعًا صالحة. راجع أسماء الأعمدة وترتيبها.');
      stagedMeta.count = result.count; stagedMeta.firstTime = result.firstTime; stagedMeta.lastTime = result.lastTime;
      stagedMeta.annual = await calculateAnnual(stagedMeta);
      if (result.outOfOrder) orderingWarnings.push(file.name);
      const targetId = datasetId(stagedMeta.symbol, stagedMeta.timeframe);
      if (datasets.some(d => d.id === targetId) && !confirm(`توجد بيانات ${stagedMeta.symbol} · ${stagedMeta.timeframe}. استبدالها بالملف الجديد؟`)) {
        await deleteDataset(stagingId); continue;
      }
      await commitStagedDataset(stagedMeta, targetId);
      datasets = await listDatasets();
      succeeded++;
    } catch (error) { await deleteDataset(stagingId); toast(`${file.name}: ${error.message}`); }
  }
  datasets = await listDatasets(); renderDatasets(); fillSymbols();
  if (datasets.length) { const last = datasets.find(d => d.source === files.at(-1).name) || datasets.at(-1); els.symbol.value = last.symbol; fillTimeframes(); els.timeframe.value = last.timeframe; await selectFromControls(); }
  els.progress.hidden = true; els.progressBar.value = 0;
  if (succeeded) toast(`تم حفظ ${succeeded} مجموعة بيانات على هذا الجهاز.`);
  if (orderingWarnings.length) toast(`تنبيه: ترتيب التواريخ غير تصاعدي في ${orderingWarnings.length} ملف؛ رتّب الشموع زمنيًا لإظهار تحليل صحيح.`);
}

async function importCsv(file, meta, onProgress) {
  const reader = file.stream().getReader(), decoder = new TextDecoder('utf-8');
  let carry = '', map = null, delimiter = ',', firstLine = true, seq = 0, chunk = [], firstTime = null, lastTime = null, previousTime = null, outOfOrder = 0, bytes = 0;
  const flush = async () => { if (!chunk.length) return; await putCandleBatch(meta.id, chunk); chunk = []; };
  while (true) {
    const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; onProgress(bytes);
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/); carry = lines.pop() ?? '';
    for (let raw of lines) {
      if (!raw.trim()) continue;
      if (firstLine) delimiter = detectDelimiter(raw);
      const fields = parseCsvLine(raw.replace(/^\uFEFF/, ''), delimiter);
      if (firstLine) {
        firstLine = false; const candidate = headerMap(fields);
        if (candidate) { map = candidate; continue; }
        map = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 };
      }
      const vals = fields;
      let candle;
      if (map) { const row = {}; for (const [key, idx] of Object.entries(map)) row[key] = vals[idx]; candle = toCandle(row, null); }
      if (!candle) continue;
      if (previousTime && candle.time <= previousTime) outOfOrder++; if (!firstTime) firstTime = candle.time; lastTime = candle.time; previousTime = candle.time;
      chunk.push({ seq, candle }); seq++;
      if (chunk.length >= 500) await flush();
    }
  }
  carry += decoder.decode();
  if (carry.trim()) {
    if (firstLine) delimiter = detectDelimiter(carry);
    const fields = parseCsvLine(carry, delimiter); if (firstLine) { const candidate = headerMap(fields); if (candidate) { map = candidate; firstLine = false; } else { map = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 }; firstLine = false; } }
    if (map) { const row = {}; for (const [key, idx] of Object.entries(map)) row[key] = fields[idx]; const candle = toCandle(row, null); if (candle) { if (previousTime && candle.time <= previousTime) outOfOrder++; if (!firstTime) firstTime = candle.time; lastTime = candle.time; previousTime = candle.time; chunk.push({ seq, candle }); seq++; } }
  }
  await flush(); return { count: seq, firstTime, lastTime, outOfOrder };
}

async function importJson(file, meta, onProgress) {
  const text = await file.text(); onProgress(file.size);
  let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('ملف JSON غير صالح.'); }
  const rows = Array.isArray(parsed) ? parsed : parsed?.candles || parsed?.data;
  if (!Array.isArray(rows)) throw new Error('صيغة JSON المتوقعة مصفوفة شموع أو كائن candles.');
  if (parsed.symbol) meta.symbol = String(parsed.symbol).toUpperCase();
  if (parsed.timeframe) meta.timeframe = String(parsed.timeframe);
  let seq = 0, firstTime = null, lastTime = null, previousTime = null, outOfOrder = 0, chunk = [];
  for (const row of rows) {
    const candle = toCandle(row, null); if (!candle) continue;
    if (previousTime && candle.time <= previousTime) outOfOrder++; if (!firstTime) firstTime = candle.time; lastTime = candle.time; previousTime = candle.time;
    chunk.push({ seq, candle }); seq++;
    if (chunk.length >= 500) { await putCandleBatch(meta.id, chunk); chunk = []; }
  }
  if (chunk.length) await putCandleBatch(meta.id, chunk);
  return { count: seq, firstTime, lastTime, outOfOrder };
}

async function commitStagedDataset(stagedMeta, targetId) {
  const savedId = stagedMeta.id;
  if (savedId !== targetId) {
    await deleteDataset(targetId);
    for (let start = 0; start < stagedMeta.count; start += 2000) {
      const batch = await getCandleRange(savedId, start, Math.min(stagedMeta.count - 1, start + 1999));
      await putCandleBatch(targetId, batch.map(c => ({ seq: c.seq, candle: { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume } })));
    }
  }
  const finalMeta = { ...stagedMeta, id: targetId };
  await saveDataset(finalMeta);
  if (savedId !== targetId) await deleteDataset(savedId);
}

async function calculateAnnual(meta) {
  const groups = new Map(), batchSize = 2000;
  for (let start = 0; start < meta.count; start += batchSize) {
    const batch = await getCandleRange(meta.id, start, Math.min(meta.count - 1, start + batchSize - 1));
    for (const c of batch) {
      const year = new Date(c.time).getUTCFullYear(); let g = groups.get(year);
      if (!g) { g = { year, totalVolume: 0, candles: 0, peakVolume: -Infinity, peakIndex: c.seq, peakTime: c.time, peakClose: c.close }; groups.set(year, g); }
      g.totalVolume += c.volume; g.candles++;
      if (c.volume > g.peakVolume) { g.peakVolume = c.volume; g.peakIndex = c.seq; g.peakTime = c.time; g.peakClose = c.close; }
    }
  }
  const result = [];
  for (const g of groups.values()) {
    const after = g.peakIndex + 20 < meta.count ? await getCandleRange(meta.id, g.peakIndex + 20, g.peakIndex + 20) : [];
    result.push({ ...g, reaction: after.length ? (after[0].close / g.peakClose - 1) * 100 : null, reactionBars: after.length ? 20 : Math.max(0, meta.count - g.peakIndex - 1) });
  }
  return result.sort((a, b) => b.year - a.year);
}

async function loadDemo() {
  const symbol = 'DEMOUSDT', timeframe = '1d', id = datasetId(symbol, timeframe);
  await deleteDataset(id);
  const count = 900, now = Date.now(), chunk = [], meta = { id, symbol, timeframe, count, source: 'عينة مصطنعة', importedAt: new Date().toISOString(), annual: [], synthetic: true };
  let price = 42000;
  for (let i = 0; i < count; i++) {
    const open = price;
    price = 42000 + Math.sin(i / 84) * 9000 + Math.sin(i / 22) * 2300 + Math.sin(i * 1.7) * 250;
    const high = Math.max(open, price) * (1 + Math.abs(Math.sin(i * .8)) * .004);
    const low = Math.min(open, price) * (1 - Math.abs(Math.cos(i * .6)) * .004);
    const candle = { time: new Date(now - (count - i) * 86400000).toISOString(), open, high, low, close: price, volume: 100 + Math.abs(Math.sin(i * 1.2)) * 1100 + (i % 89 === 0 ? 2500 : 0) };
    chunk.push({ seq: i, candle });
    if (chunk.length === 500) { await putCandleBatch(id, chunk.splice(0)); }
  }
  if (chunk.length) await putCandleBatch(id, chunk);
  meta.firstTime = new Date(now - count * 86400000).toISOString(); meta.lastTime = new Date(now - 86400000).toISOString(); meta.annual = await calculateAnnual(meta); await saveDataset(meta);
  datasets = await listDatasets(); renderDatasets(); fillSymbols(); els.symbol.value = symbol; fillTimeframes(); els.timeframe.value = timeframe; await selectFromControls(); toast('تم تحميل عينة اصطناعية للتجربة، وليست بيانات سوق حقيقية.');
}

init();
