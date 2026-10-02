const CATALOG_URL = new URL('../data/catalog.json', import.meta.url);
const HEADER_ALIASES = {
  time: ['timestamp', 'time', 'date', 'datetime', 'opentime', 't', 'unix', 'candleopen'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c'],
  volume: ['volume', 'vol', 'v', 'basevolume', 'tickvolume']
};

const normalizeHeader = value => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[ _-]/g, '');

export function validateCatalog(document) {
  if (!document || !Array.isArray(document.datasets)) {
    throw new Error('يجب أن يحتوي data/catalog.json على مصفوفة datasets.');
  }
  const seen = new Set();
  const datasets = document.datasets.map((item, index) => {
    const symbol = String(item?.symbol ?? '').trim().toUpperCase();
    const timeframe = String(item?.timeframe ?? '').trim();
    const file = String(item?.file ?? '').trim();
    if (!/^[A-Z0-9_-]{2,24}$/.test(symbol)) throw new Error(`رمز الأصل غير صالح في datasets رقم ${index + 1}.`);
    if (!/^\d+(?:m|h|d|w|M)$/.test(timeframe)) throw new Error(`الفريم غير صالح لـ ${symbol}: استخدم مثل 1h أو 4h أو 1d.`);
    if (!isSafeCsvPath(file)) throw new Error(`مسار CSV غير آمن أو غير صالح لـ ${symbol} · ${timeframe}.`);
    const id = `${symbol}::${timeframe}`;
    if (seen.has(id)) throw new Error(`يوجد أكثر من ملف مسجل لـ ${symbol} · ${timeframe}.`);
    seen.add(id);
    return { id, symbol, timeframe, file };
  });
  return datasets.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.timeframe.localeCompare(b.timeframe, 'en', { numeric: true }));
}

export function isSafeCsvPath(file) {
  if (typeof file !== 'string' || !file || file.startsWith('/') || file.includes('\\') || /[%?#:]/.test(file)) return false;
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.csv$/i.test(file)) return false;
  return !file.split('/').some(part => !part || part === '.' || part === '..');
}

export async function loadCatalog(fetcher = globalThis.fetch) {
  const response = await fetcher(CATALOG_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`تعذّر قراءة كتالوج البيانات (HTTP ${response.status}).`);
  return { url: CATALOG_URL, datasets: validateCatalog(await response.json()) };
}

export function resolveCsvUrl(file, catalogUrl = CATALOG_URL) {
  if (!isSafeCsvPath(file)) throw new Error('مسار الملف يجب أن يكون CSV نسبيًا داخل مجلد data/.');
  return new URL(file, catalogUrl);
}

export async function loadCsvDataset(dataset, fetcher = globalThis.fetch, catalogUrl = CATALOG_URL) {
  const url = resolveCsvUrl(dataset.file, catalogUrl);
  const response = await fetcher(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`تعذّر تحميل ${dataset.file} (HTTP ${response.status}). تأكد من رفع الملف إلى المسار المسجل في الكتالوج.`);
  const parsed = parseOHLCVCsv(await response.text());
  return { ...parsed, url: url.href };
}

export function parseOHLCVCsv(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw new Error('ملف CSV فارغ.');
  const delimiter = detectDelimiter(lines[0]);
  const firstFields = parseCsvLine(lines[0], delimiter);
  const header = mapHeaders(firstFields);
  let columns;
  let firstDataLine = 0;
  if (header) {
    columns = header;
    firstDataLine = 1;
  } else {
    if (!looksLikeTimestamp(firstFields[0])) {
      throw new Error('لم أتعرف إلى ترويسة CSV. استخدم الأعمدة timestamp,open,high,low,close,volume.');
    }
    columns = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 };
  }
  for (const field of ['time', 'open', 'high', 'low', 'close', 'volume']) {
    if (columns[field] == null) throw new Error(`عمود ${field} مفقود من ملف CSV.`);
  }

  const candles = [];
  let skippedRows = 0;
  let previousTimestamp = -Infinity;
  for (let lineIndex = firstDataLine; lineIndex < lines.length; lineIndex++) {
    const fields = parseCsvLine(lines[lineIndex], delimiter);
    const candle = parseCandle(fields, columns);
    if (!candle) { skippedRows++; continue; }
    const timestamp = Date.parse(candle.time);
    if (timestamp <= previousTimestamp) {
      throw new Error(`الشموع غير مرتبة أو يوجد وقت مكرر قرب السطر ${lineIndex + 1}. رتّبها من الأقدم إلى الأحدث واحذف المكرر.`);
    }
    previousTimestamp = timestamp;
    candles.push(candle);
  }
  if (!candles.length) throw new Error('لم أجد شموع OHLCV صالحة في الملف.');
  return { candles, skippedRows };
}

function mapHeaders(fields) {
  const normalized = fields.map(normalizeHeader);
  const result = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex(value => aliases.includes(value));
    if (index >= 0) result[field] = index;
  }
  return ['time', 'open', 'high', 'low', 'close', 'volume'].every(key => result[key] != null) ? result : null;
}

function parseCandle(fields, columns) {
  const time = parseTimestamp(fields[columns.time]);
  const values = ['open', 'high', 'low', 'close', 'volume'].map(key => {
    const value = String(fields[columns[key]] ?? '').trim();
    return value ? Number(value) : NaN;
  });
  if (!time || values.some(value => !Number.isFinite(value))) return null;
  const [open, high, low, close, volume] = values;
  if (volume < 0 || high < low || high < Math.max(open, close) || low > Math.min(open, close)) return null;
  return { time, open, high, low, close, volume };
}

function parseTimestamp(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    let number = Number(raw);
    if (!Number.isFinite(number)) return null;
    if (Math.abs(number) < 1e11) number *= 1000;
    const date = new Date(number);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function looksLikeTimestamp(value) {
  const raw = String(value ?? '').trim();
  return /^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isNaN(new Date(raw).valueOf());
}

function detectDelimiter(line) {
  const counts = new Map([['\t', 0], [',', 0], [';', 0]]);
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && counts.has(character)) counts.set(character, counts.get(character) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsvLine(line, delimiter) {
  const fields = [];
  let field = '', quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      fields.push(field); field = '';
    } else field += character;
  }
  fields.push(field);
  return fields;
}
