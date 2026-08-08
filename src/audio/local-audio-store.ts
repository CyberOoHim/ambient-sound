/**
 * IndexedDB persistence for user-imported audio files (ENH-13).
 * Stores raw ArrayBuffers so samples work offline after first import.
 */
import { LOCAL_ASSET_PREFIX } from './types';

const DB_NAME = 'ambient-sound-local-audio';
const DB_VERSION = 1;
const STORE = 'clips';

export interface LocalAudioMeta {
  id: string;
  title: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
}

interface LocalAudioRecord extends LocalAudioMeta {
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function makeId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 12)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${LOCAL_ASSET_PREFIX}${rand}`;
}

function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim();
  return base || 'Imported sound';
}

const ALLOWED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/oga',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
]);

const ALLOWED_EXT = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.webm',
  '.m4a',
  '.aac',
  '.flac',
]);

export function isAllowedAudioFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const extOk = [...ALLOWED_EXT].some((e) => name.endsWith(e));
  if (extOk) return true;
  if (file.type && ALLOWED_MIME.has(file.type)) return true;
  // Some browsers leave type empty for drag-drop
  return /\.(mp3|wav|ogg|oga|webm|m4a|aac|flac)$/i.test(file.name);
}

/** List metadata for all imported clips (no ArrayBuffers). */
export async function listLocalAudio(): Promise<LocalAudioMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const rows = await reqToPromise(store.getAll() as IDBRequest<LocalAudioRecord[]>);
    return (rows ?? [])
      .map((r) => ({
        id: r.id,
        title: r.title,
        mimeType: r.mimeType,
        byteLength: r.byteLength,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } finally {
    db.close();
  }
}

/** Fetch raw bytes for decode. */
export async function getLocalAudioData(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const row = await reqToPromise(store.get(id) as IDBRequest<LocalAudioRecord | undefined>);
    if (!row?.data) return null;
    // Return a copy so decodeAudioData can detach safely
    return row.data.slice(0);
  } finally {
    db.close();
  }
}

export async function getLocalAudioMeta(id: string): Promise<LocalAudioMeta | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const row = await reqToPromise(store.get(id) as IDBRequest<LocalAudioRecord | undefined>);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      mimeType: row.mimeType,
      byteLength: row.byteLength,
      createdAt: row.createdAt,
    };
  } finally {
    db.close();
  }
}

/** Import a File into IndexedDB; returns metadata. */
export async function importLocalAudioFile(file: File): Promise<LocalAudioMeta> {
  if (!isAllowedAudioFile(file)) {
    throw new Error('Unsupported format — use mp3, wav, ogg, or similar');
  }
  // Soft size cap (~25 MB) to avoid filling disk / OOM on mobile
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new Error('File too large (max 25 MB)');
  }

  const data = await file.arrayBuffer();
  const meta: LocalAudioMeta = {
    id: makeId(),
    title: titleFromFileName(file.name),
    mimeType: file.type || 'audio/mpeg',
    byteLength: data.byteLength,
    createdAt: new Date().toISOString(),
  };
  const record: LocalAudioRecord = { ...meta, data };

  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    await reqToPromise(store.put(record));
  } finally {
    db.close();
  }
  return meta;
}

export async function deleteLocalAudio(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    await reqToPromise(store.delete(id));
  } finally {
    db.close();
  }
}

export async function renameLocalAudio(id: string, title: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const row = await reqToPromise(store.get(id) as IDBRequest<LocalAudioRecord | undefined>);
    if (!row) return;
    row.title = title.trim() || row.title;
    await reqToPromise(store.put(row));
  } finally {
    db.close();
  }
}
