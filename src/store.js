const DB_NAME = 'marsad-ohlcv';
const DB_VERSION = 1;
let connection;

export function openStore() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const candles = db.createObjectStore('candles', { keyPath: ['datasetId', 'seq'] });
      candles.createIndex('byDataset', 'datasetId', { unique: false });
      db.createObjectStore('datasets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('تعذّر فتح مخزن المتصفح'));
  });
  return connection;
}

export async function listDatasets() {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const request = db.transaction('datasets', 'readonly').objectStore('datasets').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.timeframe.localeCompare(b.timeframe)));
    request.onerror = () => reject(request.error);
  });
}

export async function getDataset(id) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const request = db.transaction('datasets', 'readonly').objectStore('datasets').get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDataset(meta) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('datasets', 'readwrite');
    tx.objectStore('datasets').put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putCandleBatch(datasetId, entries) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('candles', 'readwrite');
    const store = tx.objectStore('candles');
    for (const entry of entries) store.put({ datasetId, seq: entry.seq, ...entry.candle });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('فشل حفظ دفعة الشموع'));
  });
}

export async function getCandleRange(datasetId, startSeq, endSeq) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('candles', 'readonly');
    const range = IDBKeyRange.bound([datasetId, startSeq], [datasetId, endSeq]);
    const request = tx.objectStore('candles').getAll(range);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDataset(id) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['candles', 'datasets'], 'readwrite');
    const store = tx.objectStore('candles');
    const request = store.index('byDataset').openKeyCursor(IDBKeyRange.only(id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
    };
    tx.objectStore('datasets').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStore() {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['candles', 'datasets'], 'readwrite');
    tx.objectStore('candles').clear();
    tx.objectStore('datasets').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
