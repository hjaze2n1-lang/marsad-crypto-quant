const COLORS = {
  up: '#48d6a1',
  down: '#ff6f7c',
  grid: '#23303c',
  text: '#8291a1',
  ema20: '#55c0ff',
  ema50: '#e1b967',
  fvgBull: 'rgba(142, 128, 255, 0.14)',
  fvgBear: 'rgba(255, 111, 124, 0.12)',
  obBull: 'rgba(72, 214, 161, 0.12)',
  obBear: 'rgba(244, 187, 95, 0.14)'
};

function epochSeconds(value) {
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

function formatUtcTime(time) {
  const seconds = typeof time === 'number' ? time : epochSeconds(time);
  if (!Number.isFinite(seconds)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(seconds * 1000));
}

function zoneColors(zone) {
  if (zone.kind === 'FVG') {
    return zone.type === 'bull'
      ? { fill: COLORS.fvgBull, edge: 'rgba(142, 128, 255, 0.72)' }
      : { fill: COLORS.fvgBear, edge: 'rgba(255, 111, 124, 0.72)' };
  }
  return zone.type === 'bull'
    ? { fill: COLORS.obBull, edge: 'rgba(72, 214, 161, 0.72)' }
    : { fill: COLORS.obBear, edge: 'rgba(244, 187, 95, 0.78)' };
}

export function createTradingViewChart(container, { onCrosshairChange = () => {}, onVisibleRangeChange = () => {} } = {}) {
  const LC = window.LightweightCharts;
  if (!LC?.createChart || !LC?.CandlestickSeries || !LC?.createSeriesMarkers) {
    throw new Error('تعذّر تحميل مكتبة TradingView المحلية. تحقّق من ملف vendor/lightweight-charts.standalone.production.js.');
  }

  const chart = LC.createChart(container, {
    width: Math.max(320, container.clientWidth || 320),
    height: Math.max(300, container.clientHeight || 430),
    layout: {
      background: { type: LC.ColorType?.Solid || 'solid', color: '#101823' },
      textColor: COLORS.text,
      fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
      fontSize: 11,
      attributionLogo: true,
      panes: { enableResize: true, separatorColor: '#293744', separatorHoverColor: 'rgba(178, 181, 189, 0.28)' }
    },
    grid: {
      vertLines: { color: COLORS.grid, style: LC.LineStyle?.Dotted },
      horzLines: { color: COLORS.grid, style: LC.LineStyle?.Dotted }
    },
    rightPriceScale: { borderColor: '#2a3948', autoScale: true, scaleMargins: { top: 0.08, bottom: 0.04 } },
    leftPriceScale: { visible: false, borderColor: '#2a3948' },
    timeScale: {
      borderColor: '#2a3948',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
      barSpacing: 7,
      minBarSpacing: 0.5,
      lockVisibleTimeRangeOnResize: true,
      tickMarkFormatter: time => formatUtcTime(time)
    },
    localization: { locale: 'en-US', timeFormatter: formatUtcTime },
    crosshair: {
      mode: LC.CrosshairMode?.Normal,
      vertLine: { color: '#aab7c466', width: 1, style: LC.LineStyle?.Dashed, labelBackgroundColor: '#263544' },
      horzLine: { color: '#aab7c466', width: 1, style: LC.LineStyle?.Dashed, labelBackgroundColor: '#263544' }
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    kineticScroll: { mouse: true, touch: true },
    addDefaultPane: true
  });

  const candleSeries = chart.addSeries(LC.CandlestickSeries, {
    upColor: COLORS.up,
    downColor: COLORS.down,
    borderVisible: false,
    wickUpColor: COLORS.up,
    wickDownColor: COLORS.down,
    priceLineVisible: true,
    lastValueVisible: true,
    title: 'OHLC'
  }, 0);

  const closeLineSeries = chart.addSeries(LC.LineSeries, {
    color: '#c3d1de',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    crosshairMarkerVisible: true,
    title: 'Close',
    visible: false
  }, 0);

  const ema20Series = chart.addSeries(LC.LineSeries, {
    color: COLORS.ema20,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    title: 'EMA 20'
  }, 0);

  const ema50Series = chart.addSeries(LC.LineSeries, {
    color: COLORS.ema50,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    title: 'EMA 50'
  }, 0);

  const volumeSeries = chart.addSeries(LC.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    lastValueVisible: true,
    priceLineVisible: false,
    title: 'Volume'
  }, 1);

  const panes = chart.panes();
  if (panes[0] && panes[1]) {
    panes[0].setStretchFactor(4);
    panes[1].setStretchFactor(1);
  }

  const markerPlugin = LC.createSeriesMarkers(candleSeries, []);
  let zoneSeries = [];
  let data = [];
  let times = [];
  let candlesByTime = new Map();
  let markers = [];
  let layerState = { ema20: true, ema50: true, fvg: true, ob: true, markers: true };
  let chartType = 'candles';
  let pendingFit = false;

  function getVisibleRange() {
    if (!data.length) return null;
    const logical = chart.timeScale().getVisibleLogicalRange();
    if (!logical) return null;
    const fromIndex = Math.max(0, Math.min(data.length - 1, Math.floor(logical.from)));
    const toIndex = Math.max(fromIndex, Math.min(data.length - 1, Math.ceil(logical.to)));
    return {
      fromIndex,
      toIndex,
      from: fromIndex + 1,
      to: toIndex + 1,
      total: data.length,
      visible: Math.max(0, toIndex - fromIndex + 1),
      full: fromIndex === 0 && toIndex === data.length - 1
    };
  }

  function notifyRange() {
    onVisibleRangeChange(getVisibleRange());
  }

  function applyLayers() {
    ema20Series.applyOptions({ visible: layerState.ema20 });
    ema50Series.applyOptions({ visible: layerState.ema50 });
    for (const item of zoneSeries) {
      item.series.applyOptions({ visible: item.kind === 'FVG' ? layerState.fvg : layerState.ob });
    }
    markerPlugin.setMarkers(layerState.markers ? markers : []);
  }

  function clearZones() {
    for (const item of zoneSeries) chart.removeSeries(item.series);
    zoneSeries = [];
  }

  function makeMarkers(analysis, annualPeaks) {
    const byTime = new Map();
    const add = (time, marker) => {
      if (!Number.isFinite(time)) return;
      const existing = byTime.get(time);
      if (existing) {
        if (marker.text && !existing.text.includes(marker.text)) existing.text = `${existing.text} ${marker.text}`.trim();
        return;
      }
      byTime.set(time, { time, ...marker });
    };

    for (const swing of analysis?.swings || []) {
      const time = times[swing.index];
      add(time, {
        position: swing.type === 'high' ? 'aboveBar' : 'belowBar',
        color: '#68a8ff',
        shape: swing.type === 'high' ? 'arrowDown' : 'arrowUp',
        text: swing.type === 'high' ? 'H' : 'L',
        size: 0.8
      });
    }
    for (const peak of annualPeaks || []) {
      const time = times[peak.peakIndex];
      add(time, { position: 'aboveBar', color: '#f4bb5f', shape: 'square', text: `V${String(peak.year).slice(-2)}`, size: 0.8 });
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }

  function addZones(analysis) {
    clearZones();
    const lastTime = times.at(-1);
    const visibleZones = (analysis?.zones || []).slice().sort((a, b) => b.start - a.start).slice(0, 16).reverse();
    for (const zone of visibleZones) {
      const startTime = times[zone.start];
      if (!Number.isFinite(startTime) || !Number.isFinite(lastTime) || startTime >= lastTime || !(zone.top > zone.bottom)) continue;
      const color = zoneColors(zone);
      const series = chart.addSeries(LC.BaselineSeries, {
        baseValue: { type: 'price', price: zone.bottom },
        topFillColor1: color.fill,
        topFillColor2: color.fill,
        topLineColor: color.edge,
        bottomFillColor1: 'rgba(0, 0, 0, 0)',
        bottomFillColor2: 'rgba(0, 0, 0, 0)',
        bottomLineColor: 'rgba(0, 0, 0, 0)',
        lineVisible: false,
        pointMarkersVisible: false,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        baseLineVisible: false,
        priceScaleId: 'right',
        title: zone.kind
      }, 0);
      series.setData([{ time: startTime, value: zone.top }, { time: lastTime, value: zone.top }]);
      zoneSeries.push({ kind: zone.kind, series });
    }
  }

  function fitContent() {
    if (!data.length) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    volumeSeries.priceScale().applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
    pendingFit = false;
    notifyRange();
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) return;
    chart.resize(width, height);
    if (pendingFit && data.length) fitContent();
  }

  const rangeHandler = () => notifyRange();
  chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
  chart.subscribeCrosshairMove(param => {
    if (!param?.point || param.time == null) {
      onCrosshairChange(null);
      return;
    }
    const candle = candlesByTime.get(Number(param.time));
    onCrosshairChange(candle || null);
  });

  let resizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
  } else {
    window.addEventListener('resize', resize);
  }

  function setData(nextCandles, analysis, annualPeaks = []) {
    data = Array.isArray(nextCandles) ? nextCandles : [];
    times = data.map(candle => epochSeconds(candle.time));
    candlesByTime = new Map(data.map((candle, index) => [times[index], candle]));
    clearZones();

    if (!data.length || times.some(time => !Number.isFinite(time))) {
      candleSeries.setData([]);
      closeLineSeries.setData([]);
      ema20Series.setData([]);
      ema50Series.setData([]);
      volumeSeries.setData([]);
      markers = [];
      markerPlugin.setMarkers([]);
      notifyRange();
      return;
    }

    candleSeries.setData(data.map((candle, index) => ({
      time: times[index], open: candle.open, high: candle.high, low: candle.low, close: candle.close
    })));
    closeLineSeries.setData(data.map((candle, index) => ({ time: times[index], value: candle.close })));
    ema20Series.setData(data.flatMap((candle, index) => Number.isFinite(analysis?.e20?.[index]) ? [{ time: times[index], value: analysis.e20[index] }] : []));
    ema50Series.setData(data.flatMap((candle, index) => Number.isFinite(analysis?.e50?.[index]) ? [{ time: times[index], value: analysis.e50[index] }] : []));
    volumeSeries.setData(data.map((candle, index) => ({
      time: times[index],
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(72, 214, 161, 0.64)' : 'rgba(255, 111, 124, 0.64)'
    })));

    markers = makeMarkers(analysis, annualPeaks);
    markerPlugin.setMarkers(layerState.markers ? markers : []);
    addZones(analysis);
    applyLayers();
    closeLineSeries.applyOptions({ visible: chartType === 'line' });
    candleSeries.applyOptions({ visible: chartType === 'candles' });

    const width = Math.floor(container.getBoundingClientRect().width);
    if (width > 0) fitContent();
    else pendingFit = true;
    onCrosshairChange(null);
  }

  function setChartType(type) {
    chartType = type === 'line' ? 'line' : 'candles';
    candleSeries.applyOptions({ visible: chartType === 'candles' });
    closeLineSeries.applyOptions({ visible: chartType === 'line' });
  }

  function setLayer(name, visible) {
    if (!(name in layerState)) return;
    layerState[name] = Boolean(visible);
    applyLayers();
  }

  function zoom(direction) {
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range || data.length < 2) return;
    const currentSize = Math.max(2, range.to - range.from);
    const nextSize = direction > 0 ? Math.max(8, currentSize / 1.5) : Math.min(data.length, currentSize * 1.5);
    const center = (range.from + range.to) / 2;
    let from = center - nextSize / 2;
    let to = center + nextSize / 2;
    if (from < 0) { to -= from; from = 0; }
    if (to > data.length - 1) { from -= to - (data.length - 1); to = data.length - 1; }
    from = Math.max(0, from);
    chart.timeScale().setVisibleLogicalRange({ from, to });
  }

  function pan(direction) {
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range || data.length < 2) return;
    const size = Math.max(1, range.to - range.from);
    const shift = Math.max(1, size * 0.72) * direction;
    let from = range.from + shift;
    let to = range.to + shift;
    if (from < 0) { to -= from; from = 0; }
    if (to > data.length - 1) { from -= to - (data.length - 1); to = data.length - 1; }
    from = Math.max(0, from);
    chart.timeScale().setVisibleLogicalRange({ from, to });
  }

  return {
    setData,
    setChartType,
    setLayer,
    getVisibleRange,
    fitContent,
    zoom,
    pan,
    resize,
    destroy() {
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler);
      chart.remove();
    }
  };
}
