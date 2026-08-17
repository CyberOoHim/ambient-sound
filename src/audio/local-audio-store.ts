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
  'audio/opus',
  'audio/aiff',
  'audio/x-aiff',
]);

const ALLOWED_EXT = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.webm',
  '.weba',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
  '.aif',
  '.aiff',
]);

export function isAllowedAudioFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const extOk = [...ALLOWED_EXT].some((e) => name.endsWith(e));
  if (extOk) return true;
  if (file.type && ALLOWED_MIME.has(file.type)) return true;
  // Some browsers leave type empty for drag-drop
  return /\.(mp3|wav|ogg|oga|webm|weba|m4a|aac|flac|opus|aif|aiff)$/i.test(file.name);
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
    throw new Error('Unsupported format — use mp3, wav, ogg, opus, flac, webm, aac, aiff, or m4a');
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

/** Total bytes of all imported clips (for storage UX). */
export async function getLocalAudioTotalBytes(): Promise<number> {
  const list = await listLocalAudio();
  return list.reduce((sum, m) => sum + m.byteLength, 0);
}

export interface StorageQuotaInfo {
  /** Used bytes for the origin, if available. */
  usage: number | null;
  /** Quota bytes for the origin, if available. */
  quota: number | null;
  /** Local clip total (IndexedDB clips only). */
  localClipsBytes: number;
}

/** Browser storage estimate + local clip total (ENH-16). */
export async function getStorageQuotaInfo(): Promise<StorageQuotaInfo> {
  const localClipsBytes = await getLocalAudioTotalBytes();
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = typeof est.usage === 'number' ? est.usage : null;
      quota = typeof est.quota === 'number' ? est.quota : null;
    }
  } catch {
    /* private mode / denied */
  }
  return { usage, quota, localClipsBytes };
}

export const LOCAL_BACKUP_KIND = 'ambient-sound-local-backup' as const;

export interface LocalAudioBackupClip {
  id: string;
  title: string;
  mimeType: string;
  createdAt: string;
  /** Base64 of the raw audio bytes. */
  dataBase64: string;
}

export interface LocalAudioBackup {
  version: 1;
  kind: typeof LOCAL_BACKUP_KIND;
  exportedAt: string;
  clips: LocalAudioBackupClip[];
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const cleaned = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const pad = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const len = cleaned.length;
  const outLen = Math.floor((len * 3) / 4) - pad;
  const out = new Uint8Array(Math.max(0, outLen));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const n =
      (alphabet.indexOf(cleaned[i]!) << 18) |
      (alphabet.indexOf(cleaned[i + 1]!) << 12) |
      (alphabet.indexOf(cleaned[i + 2] ?? 'A') << 6) |
      alphabet.indexOf(cleaned[i + 3] ?? 'A');
    if (o < outLen) out[o++] = (n >> 16) & 255;
    if (o < outLen) out[o++] = (n >> 8) & 255;
    if (o < outLen) out[o++] = n & 255;
  }
  return out;
}

/** Export all local clips as a portable JSON backup (ENH-16). */
export async function exportLocalAudioBackup(): Promise<LocalAudioBackup> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const rows = await reqToPromise(store.getAll() as IDBRequest<LocalAudioRecord[]>);
    const clips: LocalAudioBackupClip[] = (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      mimeType: r.mimeType,
      createdAt: r.createdAt,
      dataBase64: bytesToBase64(new Uint8Array(r.data)),
    }));
    return {
      version: 1,
      kind: LOCAL_BACKUP_KIND,
      exportedAt: new Date().toISOString(),
      clips,
    };
  } finally {
    db.close();
  }
}

export function parseLocalAudioBackup(raw: unknown): LocalAudioBackup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || o.kind !== LOCAL_BACKUP_KIND) return null;
  if (!Array.isArray(o.clips)) return null;
  const clips: LocalAudioBackupClip[] = [];
  for (const c of o.clips) {
    if (!c || typeof c !== 'object') continue;
    const row = c as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id.startsWith(LOCAL_ASSET_PREFIX)) continue;
    if (typeof row.title !== 'string' || typeof row.dataBase64 !== 'string') continue;
    if (row.dataBase64.length === 0) continue;
    clips.push({
      id: row.id,
      title: row.title,
      mimeType: typeof row.mimeType === 'string' ? row.mimeType : 'audio/mpeg',
      createdAt:
        typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
      dataBase64: row.dataBase64,
    });
  }
  return {
    version: 1,
    kind: LOCAL_BACKUP_KIND,
    exportedAt:
      typeof o.exportedAt === 'string' ? o.exportedAt : new Date().toISOString(),
    clips,
  };
}

export interface ImportBackupResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Import clips from a backup. Existing ids are skipped unless `overwrite` is true.
 * New random ids are assigned when overwrite is false and the id collides.
 */
export async function importLocalAudioBackup(
  backup: LocalAudioBackup,
  opts?: { overwrite?: boolean },
): Promise<ImportBackupResult> {
  const overwrite = opts?.overwrite === true;
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const clip of backup.clips) {
    try {
      const bytes = base64ToBytes(clip.dataBase64);
      if (bytes.byteLength === 0) {
        skipped++;
        continue;
      }
      if (bytes.byteLength > 25 * 1024 * 1024) {
        errors.push(`“${clip.title}” too large (max 25 MB)`);
        skipped++;
        continue;
      }

      const existing = await getLocalAudioMeta(clip.id);
      let id = clip.id;
      if (existing && !overwrite) {
        id = makeId();
      }

      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const record: LocalAudioRecord = {
        id,
        title: clip.title.trim() || 'Imported sound',
        mimeType: clip.mimeType || 'audio/mpeg',
        byteLength: data.byteLength,
        createdAt: clip.createdAt || new Date().toISOString(),
        data,
      };

      const db = await openDb();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        await reqToPromise(store.put(record));
      } finally {
        db.close();
      }
      imported++;
    } catch (e) {
      errors.push(
        e instanceof Error ? e.message : `Failed to import “${clip.title}”`,
      );
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

/** Delete clips whose ids are in the given list. */
export async function deleteLocalAudioMany(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await openDb();
  let n = 0;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      await reqToPromise(store.delete(id));
      n++;
    }
  } finally {
    db.close();
  }
  return n;
}
