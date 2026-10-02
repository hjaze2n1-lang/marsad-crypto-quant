import { analyze, annualVolumePeaks } from './analysis.js';
import { drawChart, setHover } from './chart.js';
import { loadCatalog, loadCsvDataset } from './store.js';

const $ = selector => document.querySelector(selector);
const HALVINGS = [
  { label: 'الأول', date: '2012-11-28', block: '210,000', reward: '25 BTC' },
  { label: 'الثاني', date: '2016-07-09', block: '420,000', reward: '12.5 BTC' },
  { label: 'الثالث', date: '2020-05-11', block: '630,000', reward: '6.25 BTC' },
  { label: 'الرابع', date: '2024-04-20', block: '840,000', reward: '3.125 BTC' },
  { label: 'الخامس', date: 'تقديري · 2028', block: '1,050,000', reward: '1.5625 BTC' }
];
const els = {
  source: $('#sourceStatus'), status: $('#dataStatus'), chartStatus: $('#chartStatus'),
  symbol: $('#symbolSelect'), timeframe: $('#timeframeSelect'), canvas: $('#priceChart'), empty: $('#chartEmpty'),
  chartTitle: $('#chartTitle'), chartSubtitle: $('#chartSubtitle'), lastTime: $('#lastCandleTime'),
  count: $('#chartCount'), range: $('#rangeReadout'), older: $('#olderBtn'), latest: $('#latestBtn'),
  zoomIn: $('#zoomInBtn'), zoomOut: $('#zoomOutBtn'), fitAll: $('#fitAllBtn'),
  readout: $('#ohlcvReadout'), toast: $('#toast')
};
let catalog = [], selectedMeta = null, candles = [], currentAnalysis = null, annualPeaks = [];
let chartStart = 0, chartSize = 0, loadToken = 0, toastTimer;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function fmtNum(value, max = 6) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumSignificantDigits: max }).format(value) : '—';
}
function fmtVol(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value) : '—';
}
function fmtDate(value, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat('ar', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4200);
}
function setView(name) {
  const known = ['overview', 'chart', 'structure', 'volume', 'cycles', 'files'];
  const view = known.includes(name) ? name : 'overview';
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `view-${view}`));
  if (view === 'chart') requestAnimationFrame(drawVisibleChart);
  if (view === 'structure') renderStructure();
  if (view === 'volume') renderAnnual();
}
function selectedViewFromHash() { return location.hash.replace(/^#/, '') || 'overview'; }

function renderHalvings() {
  $('#halvingRows').innerHTML = HALVINGS.map((event, index) => `<tr><td>${escapeHtml(event.label)}</td><td class="mono">${escapeHtml(event.date)}</td><td class="mono">${escapeHtml(event.block)}</td><td>${escapeHtml(event.reward)}</td><td><span class="tag ${index < 4 ? 'tag-up' : 'tag-open'}">${index < 4 ? 'حدث تاريخي' : 'موعد غير محسوم'}</span></td></tr>`).join('');
}
function updateClock() {
  $('#clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' UTC';
}

function bindEvents() {
  $('#mainNav').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    if (location.hash !== `#${button.dataset.view}`) location.hash = button.dataset.view;
    else setView(button.dataset.view);
  });
  window.addEventListener('hashchange', () => setView(selectedViewFromHash()));
  document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => {
    const view = button.dataset.openView;
    if (location.hash !== `#${view}`) location.hash = view;
    else setView(view);
  }));
  els.symbol.addEventListener('change', () => { fillTimeframes(); loadSelectedDataset(); });
  els.timeframe.addEventListener('change', loadSelectedDataset);
  els.fitAll.addEventListener('click', fitAllCandles);
  els.zoomIn.addEventListener('click', () => zoomChart(1));
  els.zoomOut.addEventListener('click', () => zoomChart(-1));
  els.older.addEventListener('click', () => panChart(-1));
  els.latest.addEventListener('click', () => panChart(1));
  els.canvas.addEventListener('pointermove', event => {
    const rect = els.canvas.getBoundingClientRect();
    setHover({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    drawVisibleChart();
  });
  els.canvas.addEventListener('pointerleave', () => { setHover(null); drawVisibleChart(); });
  window.addEventListener('resize', drawVisibleChart);
  window.addEventListener('keydown', event => {
    if (!$('#view-chart').classList.contains('active') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomChart(1); }
    else if (event.key === '-') { event.preventDefault(); zoomChart(-1); }
    else if (event.key === 'Home') { event.preventDefault(); fitAllCandles(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); panChart(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); panChart(1); }
  });
  for (const table of [$('#catalogTable'), $('#catalogSummary')]) {
    table.addEventListener('click', event => {
      const button = event.target.closest('[data-select-dataset]');
      if (!button) return;
      const entry = catalog.find(item => item.id === button.dataset.selectDataset);
      if (!entry) return;
      els.symbol.value = entry.symbol;
      fillTimeframes();
      els.timeframe.value = entry.timeframe;
      loadSelectedDataset();
      if (location.hash !== '#chart') location.hash = 'chart';
      else setView('chart');
    });
  }
}

function populateSelectors() {
  const symbols = [...new Set(catalog.map(entry => entry.symbol))];
  els.symbol.innerHTML = symbols.map(symbol => `<option value="${escapeHtml(symbol)}">${escapeHtml(symbol)}</option>`).join('');
  els.symbol.disabled = symbols.length === 0;
  if (symbols.length) {
    const preferred = catalog.some(entry => entry.symbol === 'BTCUSDT') ? 'BTCUSDT' : symbols[0];
    els.symbol.value = preferred;
  }
  fillTimeframes();
}
function fillTimeframes() {
  const entries = catalog.filter(entry => entry.symbol === els.symbol.value);
  els.timeframe.innerHTML = entries.map(entry => `<option value="${escapeHtml(entry.timeframe)}">${escapeHtml(entry.timeframe)}</option>`).join('');
  els.timeframe.disabled = entries.length === 0;
}
function getSelectedEntry() {
  return catalog.find(entry => entry.symbol === els.symbol.value && entry.timeframe === els.timeframe.value) || null;
}

async function loadSelectedDataset() {
  const entry = getSelectedEntry();
  if (!entry) { clearLoadedDataset(); return; }
  const token = ++loadToken;
  setLoadingState(entry);
  try {
    const result = await loadCsvDataset(entry);
    if (token !== loadToken) return;
    selectedMeta = entry;
    candles = result.candles;
    currentAnalysis = analyze(candles);
    annualPeaks = annualVolumePeaks(candles);
    chartStart = 0;
    chartSize = candles.length;
    updateLoadedState(result.skippedRows);
    updateStats();
    renderCatalog();
    drawVisibleChart();
  } catch (error) {
    if (token !== loadToken) return;
    els.source.textContent = 'تعذّر تحميل ملف السوق';
    els.source.classList.add('source-error');
    els.chartStatus.innerHTML = `<span class="status-icon">!</span><span>${escapeHtml(entry.symbol)} · ${escapeHtml(entry.timeframe)}</span>`;
    els.chartSubtitle.textContent = error.message;
    els.empty.classList.add('visible');
    $('#chartEmpty b').textContent = 'تعذّر قراءة ملف CSV';
    $('#chartEmpty span').textContent = error.message;
    toast(error.message);
  }
}
function setLoadingState(entry) {
  els.source.textContent = `تحميل ${entry.symbol} · ${entry.timeframe}…`;
  els.source.classList.remove('source-error');
  els.chartStatus.innerHTML = `<span class="status-icon">◌</span><span>تحميل ${escapeHtml(entry.symbol)} · ${escapeHtml(entry.timeframe)}</span>`;
  $('#chartEmpty b').textContent = 'جارٍ تحميل الشموع';
  $('#chartEmpty span').textContent = `قراءة ${entry.file} من مجلد data.`;
  els.empty.classList.add('visible');
}
function updateLoadedState(skippedRows) {
  const datasetLabel = `${selectedMeta.symbol} · ${selectedMeta.timeframe}`;
  els.source.textContent = `${catalog.length} ملف سوق مسجل`;
  els.source.classList.remove('source-error');
  els.status.classList.add('ready');
  els.status.innerHTML = `<span class="privacy-dot"></span><span>${escapeHtml(datasetLabel)} · ${candles.length.toLocaleString('en-US')} شمعة</span>`;
  els.chartStatus.classList.add('ready');
  els.chartStatus.innerHTML = `<span class="privacy-dot"></span><span>${escapeHtml(datasetLabel)}</span>`;
  $('#chartEmpty b').textContent = 'الشارت جاهز';
  $('#chartEmpty span').textContent = 'غيّر الزوج أو الفريم من أدوات الشارت.';
  if (skippedRows) toast(`تم تحميل ${candles.length.toLocaleString('en-US')} شمعة؛ تم تجاهل ${skippedRows} صف غير صالح.`);
}
function clearLoadedDataset() {
  ++loadToken;
  selectedMeta = null;
  candles = [];
  currentAnalysis = null;
  annualPeaks = [];
  chartStart = chartSize = 0;
  els.source.textContent = 'لا توجد ملفات مسجلة';
  els.status.classList.remove('ready');
  els.status.innerHTML = '<span class="status-icon">◌</span><span>لا توجد بيانات مسجلة</span>';
  els.chartStatus.classList.remove('ready');
  els.chartStatus.innerHTML = '<span class="status-icon">◌</span><span>—</span>';
  $('#chartEmpty b').textContent = 'الشارت ينتظر ملفًا مسجلًا';
  $('#chartEmpty span').textContent = 'أضف CSV إلى مجلد data في المستودع ثم سجّله في data/catalog.json.';
  els.empty.classList.add('visible');
  updateStats();
  drawVisibleChart();
}

function updateStats() {
  const statElements = ['#trendValue', '#rsiValue', '#swingValue', '#zonesValue'].map($);
  statElements.forEach(element => { element.className = 'stat-value'; element.textContent = '—'; });
  $('#rsiMeter').style.width = '0%';
  if (!currentAnalysis || !candles.length) {
    $('#trendNote').textContent = 'اختر سوقًا من صفحة الشارت';
    $('#rsiNote').textContent = 'فوق 70 تشبع شرائي · دون 30 تشبع بيعي';
    $('#swingNote').textContent = 'Pivot يتأخر خمس شمعات للتأكيد';
    $('#zonesNote').textContent = 'FVG وOrder Block وفق قواعد مرصد';
    $('#insightBody').innerHTML = '<p class="muted">لا توجد شموع محمّلة. سجّل ملف CSV في كتالوج المشروع أولًا.</p>';
    renderStructure(); renderAnnual();
    return;
  }
  const trendLabels = {
    bull: ['صاعد', 'اتجاه صاعد وفق EMA 20/50 وميل EMA 20', 'up'],
    bear: ['هابط', 'اتجاه هابط وفق EMA 20/50 وميل EMA 20', 'down'],
    range: ['عرضي / مختلط', 'المتوسطات لا تؤكد اتجاهًا متسقًا', 'neutral'],
    unknown: ['بيانات غير كافية', 'نحتاج 50 إغلاقًا على الأقل', 'neutral']
  };
  const [trendLabel, trendNote, trendClass] = trendLabels[currentAnalysis.trend];
  $('#trendValue').textContent = trendLabel;
  $('#trendValue').classList.add(trendClass);
  $('#trendNote').textContent = trendNote;
  if (currentAnalysis.rsi == null) {
    $('#rsiNote').textContent = 'تحتاج 15 إغلاقًا على الأقل';
  } else {
    const rsiValue = currentAnalysis.rsi;
    $('#rsiValue').textContent = rsiValue.toFixed(1);
    $('#rsiValue').classList.toggle('down', rsiValue >= 70);
    $('#rsiValue').classList.toggle('up', rsiValue <= 30);
    $('#rsiNote').textContent = rsiValue >= 70 ? 'تشبع شرائي حسب RSI (≥70)' : rsiValue <= 30 ? 'تشبع بيعي حسب RSI (≤30)' : 'ضمن النطاق الوسطي (30–70)';
    $('#rsiMeter').style.width = `${rsiValue}%`;
    $('#rsiMeter').className = rsiValue >= 70 ? 'overbought' : rsiValue <= 30 ? 'oversold' : '';
  }
  $('#swingValue').textContent = String(currentAnalysis.swings.length);
  $('#swingNote').textContent = `${currentAnalysis.swings.filter(swing => swing.type === 'high').length} قمة · ${currentAnalysis.swings.filter(swing => swing.type === 'low').length} قاع في كامل الملف`;
  $('#zonesValue').textContent = String(currentAnalysis.zones.length);
  $('#zonesNote').textContent = `${currentAnalysis.fvgs.length} FVG · ${currentAnalysis.obs.length} OB غير مكتملة`;
  const last = candles.length - 1;
  const e20 = currentAnalysis.e20[last], e50 = currentAnalysis.e50[last];
  const momentum = currentAnalysis.rsi == null ? 'لا تتوفر شموع كافية لحساب RSI.' : `RSI(14) عند ${currentAnalysis.rsi.toFixed(1)}؛ ${currentAnalysis.rsi >= 70 ? 'ضمن تشبع شرائي' : currentAnalysis.rsi <= 30 ? 'ضمن تشبع بيعي' : 'في النطاق الوسطي'}.`;
  $('#insightBody').innerHTML = `<div class="insight-list"><div class="insight-item"><b>اتجاه المتوسطات</b><span>${escapeHtml(trendLabel)}. EMA 20 ${fmtNum(e20)} مقابل EMA 50 ${fmtNum(e50)}.</span></div><div class="insight-item"><b>الزخم</b><span>${escapeHtml(momentum)}</span></div><div class="insight-item"><b>حجم الملف</b><span>${candles.length.toLocaleString('en-US')} شمعة · ${escapeHtml(fmtDate(candles[0].time))} إلى ${escapeHtml(fmtDate(candles.at(-1).time))} UTC.</span></div></div><p>القراءة وصفية، محسوبة على كامل الملف ولا تمثل إشارة دخول أو توقعًا للسعر.</p>`;
  renderStructure();
  renderAnnual();
}

function renderStructure() {
  if (!currentAnalysis || !candles.length) {
    $('#swingsTable').innerHTML = '<div class="empty-inline">حمّل ملفًا من كتالوج البيانات.</div>';
    $('#zonesTable').innerHTML = '<div class="empty-inline">حمّل ملفًا من كتالوج البيانات.</div>';
    return;
  }
  const swings = currentAnalysis.swings.slice(-30).reverse();
  $('#swingsTable').innerHTML = swings.length ? `<table><thead><tr><th>النوع</th><th>التاريخ</th><th>السعر</th><th>تأكيد</th></tr></thead><tbody>${swings.map(swing => `<tr><td><span class="tag ${swing.type === 'high' ? 'tag-down' : 'tag-up'}">${swing.type === 'high' ? 'قمة' : 'قاع'}</span></td><td>${escapeHtml(fmtDate(swing.time))}</td><td class="mono">${fmtNum(swing.price)}</td><td>5 شموع لاحقة</td></tr>`).join('')}</tbody></table>` : '<div class="empty-inline">لا توجد نقاط محورية مؤكدة في الملف.</div>';
  const zones = [...currentAnalysis.zones].sort((a, b) => b.start - a.start).slice(0, 30);
  $('#zonesTable').innerHTML = zones.length ? `<table><thead><tr><th>النوع</th><th>الاتجاه</th><th>الحد الأدنى</th><th>الحد الأعلى</th><th>التاريخ</th></tr></thead><tbody>${zones.map(zone => `<tr><td><span class="tag ${zone.kind === 'FVG' ? 'tag-open' : 'tag-ob'}">${zone.kind}</span></td><td>${zone.type === 'bull' ? 'صاعدة' : 'هابطة'}</td><td class="mono">${fmtNum(zone.bottom)}</td><td class="mono">${fmtNum(zone.top)}</td><td>${escapeHtml(fmtDate(zone.created))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-inline">لا توجد مناطق مفتوحة حسب قواعد مرصد.</div>';
}
function renderAnnual() {
  if (!annualPeaks.length) {
    $('#annualTable').innerHTML = '<div class="empty-inline">حمّل ملفًا من كتالوج البيانات.</div>';
    return;
  }
  const rows = [...annualPeaks].sort((a, b) => b.year - a.year);
  $('#annualTable').innerHTML = `<table><thead><tr><th>السنة</th><th>حجم الذروة</th><th>وقت الذروة</th><th>إغلاقها</th><th>التغير بعد 20 شمعة</th></tr></thead><tbody>${rows.map(item => `<tr><td class="mono">${item.year}</td><td class="mono">${fmtVol(item.peak.volume)}</td><td>${escapeHtml(fmtDate(item.peak.time))}</td><td class="mono">${fmtNum(item.peak.close)}</td><td class="mono">${item.reaction == null ? 'غير متاح' : `<span class="tag ${item.reaction >= 0 ? 'tag-up' : 'tag-down'}">${item.reaction >= 0 ? '+' : ''}${item.reaction.toFixed(2)}%</span>`}</td></tr>`).join('')}</tbody></table>`;
}

function renderCatalog() {
  $('#catalogCount').textContent = `${catalog.length} ملف سوق`;
  if (!catalog.length) {
    const empty = '<div class="empty-inline">الكتالوج فارغ؛ أضف أول CSV وسجّله أعلاه.</div>';
    $('#catalogTable').innerHTML = empty;
    $('#catalogSummary').innerHTML = empty;
    return;
  }
  const rows = catalog.map(entry => `<tr><td class="mono">${escapeHtml(entry.symbol)}</td><td class="mono">${escapeHtml(entry.timeframe)}</td><td class="mono">data/${escapeHtml(entry.file)}</td><td><button type="button" class="text-button" data-select-dataset="${escapeHtml(entry.id)}">فتح الشارت</button></td></tr>`).join('');
  const table = `<table><thead><tr><th>الأصل</th><th>الفريم</th><th>ملف CSV في GitHub</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  $('#catalogTable').innerHTML = table;
  $('#catalogSummary').innerHTML = table;
}

function drawVisibleChart() {
  if (!els.canvas || !currentAnalysis || !candles.length) {
    if (els.canvas) {
      const context = els.canvas.getContext('2d');
      context.clearRect(0, 0, els.canvas.width, els.canvas.height);
      els.empty.classList.add('visible');
      updateChartControls();
    }
    return;
  }
  const start = Math.max(0, Math.min(chartStart, candles.length - 1));
  const end = Math.min(candles.length, start + chartSize);
  const visibleCandles = candles.slice(start, end);
  const visibleAnalysis = {
    e20: currentAnalysis.e20.slice(start, end),
    e50: currentAnalysis.e50.slice(start, end),
    swings: currentAnalysis.swings.filter(item => item.index >= start && item.index < end).map(item => ({ ...item, index: item.index - start })),
    zones: currentAnalysis.zones.filter(item => item.start < end).map(item => ({ ...item, start: Math.max(0, item.start - start) })),
    annualPeaks: annualPeaks.filter(item => item.peakIndex >= start && item.peakIndex < end).map(item => ({ index: item.peakIndex - start, year: item.year }))
  };
  els.empty.classList.remove('visible');
  drawChart(els.canvas, visibleCandles, visibleAnalysis, (_text, candle) => {
    els.readout.textContent = candle ? `${fmtDate(candle.time)} · O ${fmtNum(candle.open)} H ${fmtNum(candle.high)} L ${fmtNum(candle.low)} C ${fmtNum(candle.close)} V ${fmtVol(candle.volume)}` : 'حرّك المؤشر فوق شمعة لقراءة OHLCV';
  });
  els.chartTitle.textContent = `${selectedMeta.symbol} · ${selectedMeta.timeframe}`;
  els.chartSubtitle.textContent = `${fmtDate(visibleCandles[0].time)} — ${fmtDate(visibleCandles.at(-1).time)} · ${start === 0 && end === candles.length ? 'كامل السجل' : 'نطاق مكبّر'}`;
  els.lastTime.textContent = `${fmtDate(candles.at(-1).time, true)} UTC`;
  els.count.textContent = `${visibleCandles.length.toLocaleString('en-US')} شمعة مرئية · ${candles.length.toLocaleString('en-US')} في الملف`;
  updateChartControls();
}
function updateChartControls() {
  const total = candles.length;
  const end = Math.min(total, chartStart + chartSize);
  els.range.textContent = total ? `${(chartStart + 1).toLocaleString('en-US')}–${end.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}` : '—';
  const disabled = total === 0;
  [els.fitAll, els.zoomIn, els.zoomOut, els.older, els.latest].forEach(button => { button.disabled = disabled; });
  els.zoomIn.disabled = disabled || chartSize <= 30;
  els.zoomOut.disabled = disabled || chartSize >= total;
  els.older.disabled = disabled || chartStart <= 0;
  els.latest.disabled = disabled || chartStart + chartSize >= total;
}
function fitAllCandles() {
  if (!candles.length) return;
  chartStart = 0;
  chartSize = candles.length;
  setHover(null);
  drawVisibleChart();
}
function zoomChart(direction) {
  if (!candles.length) return;
  const oldEnd = chartStart + chartSize;
  const nextSize = direction > 0 ? Math.max(30, Math.floor(chartSize / 1.5)) : Math.min(candles.length, Math.ceil(chartSize * 1.5));
  chartSize = nextSize;
  chartStart = Math.max(0, Math.min(candles.length - chartSize, oldEnd - chartSize));
  setHover(null);
  drawVisibleChart();
}
function panChart(direction) {
  if (!candles.length || chartSize >= candles.length) return;
  chartStart = Math.max(0, Math.min(candles.length - chartSize, chartStart + direction * Math.max(1, Math.floor(chartSize * 0.75))));
  setHover(null);
  drawVisibleChart();
}

async function init() {
  renderHalvings();
  updateClock();
  setInterval(updateClock, 1000);
  bindEvents();
  setView(selectedViewFromHash());
  try {
    const result = await loadCatalog();
    catalog = result.datasets;
    renderCatalog();
    if (!catalog.length) {
      els.source.textContent = 'لا توجد ملفات مسجلة';
      clearLoadedDataset();
      return;
    }
    els.source.textContent = `${catalog.length} ملف سوق مسجل`;
    populateSelectors();
    await loadSelectedDataset();
  } catch (error) {
    catalog = [];
    renderCatalog();
    els.source.textContent = 'تعذّر قراءة الكتالوج';
    els.source.classList.add('source-error');
    clearLoadedDataset();
    $('#chartEmpty b').textContent = 'تعذّر قراءة كتالوج البيانات';
    $('#chartEmpty span').textContent = error.message;
    toast(error.message);
  }
}

init();
