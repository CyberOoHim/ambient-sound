/** Progress while fetching and decoding a sample file. */
export interface DecodeProgress {
  /** Bytes received so far (fetch phase). */
  loaded: number;
  /** Total bytes if Content-Length is known, otherwise null. */
  total: number | null;
  phase: 'fetch' | 'decode';
  /**
   * 0..1 overall progress (fetch ~0–0.9, decode ~0.9–1).
   * When total is unknown, ratio is a soft estimate during fetch.
   */
  ratio: number;
  /** True when ratio is based on a known Content-Length. */
  determinate: boolean;
}

export type DecodeProgressCallback = (p: DecodeProgress) => void;

export interface DecodeGetOptions {
  fetchFn?: typeof fetch;
  onProgress?: DecodeProgressCallback;
}

function overallRatio(
  phase: 'fetch' | 'decode',
  loaded: number,
  total: number | null,
): { ratio: number; determinate: boolean } {
  if (phase === 'decode') {
    return { ratio: 1, determinate: total != null && total > 0 };
  }
  if (total != null && total > 0) {
    const fetchPart = Math.min(1, loaded / total);
    return { ratio: fetchPart * 0.9, determinate: true };
  }
  // Soft estimate when length is unknown (asymptotic toward 0.85).
  const soft = 1 - 1 / (1 + loaded / 120_000);
  return { ratio: Math.min(0.85, soft * 0.9), determinate: false };
}

/**
 * Read a Response body with optional byte progress.
 * Falls back to arrayBuffer() when the body stream is unavailable.
 */
export async function readResponseArrayBuffer(
  res: Response,
  onBytes?: (loaded: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const lenHeader = res.headers.get('Content-Length');
  const parsed = lenHeader != null ? Number(lenHeader) : NaN;
  const total = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  if (!res.body) {
    const ab = await res.arrayBuffer();
    onBytes?.(ab.byteLength, ab.byteLength);
    return ab;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      loaded += value.byteLength;
      onBytes?.(loaded, total);
    }
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onBytes?.(loaded, total ?? loaded);
  return out.buffer;
}

/** Simple decode cache with max concurrent buffers and fetch progress. */
export class DecodeCache {
  private cache = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer>>();
  /** Progress listeners for in-flight URL fetches (shared across joiners). */
  private progressListeners = new Map<string, Set<DecodeProgressCallback>>();
  private maxEntries: number;

  constructor(maxEntries = 4) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.cache.size;
  }

  has(url: string): boolean {
    return this.cache.has(url);
  }

  /** Insert a pre-decoded buffer (e.g. local IndexedDB import). */
  put(url: string, buffer: AudioBuffer): void {
    if (this.cache.size >= this.maxEntries && !this.cache.has(url)) {
      const first = this.cache.keys().next().value as string | undefined;
      if (first) this.cache.delete(first);
    }
    this.cache.set(url, buffer);
  }

  /** Drop a single cache entry (e.g. after deleting a local clip). */
  delete(url: string): void {
    this.cache.delete(url);
    this.inflight.delete(url);
    this.progressListeners.delete(url);
  }

  async get(
    ctx: AudioContext,
    url: string,
    fetchFnOrOpts: typeof fetch | DecodeGetOptions = fetch,
  ): Promise<AudioBuffer> {
    const opts: DecodeGetOptions =
      typeof fetchFnOrOpts === 'function'
        ? { fetchFn: fetchFnOrOpts }
        : fetchFnOrOpts;
    const fetchFn = opts.fetchFn ?? fetch;
    const onProgress = opts.onProgress;

    const hit = this.cache.get(url);
    if (hit) {
      // Refresh key position for true LRU order
      this.cache.delete(url);
      this.cache.set(url, hit);
      onProgress?.({
        loaded: 0,
        total: 0,
        phase: 'decode',
        ratio: 1,
        determinate: true,
      });
      return hit;
    }

    if (onProgress) {
      let set = this.progressListeners.get(url);
      if (!set) {
        set = new Set();
        this.progressListeners.set(url, set);
      }
      set.add(onProgress);
    }

    const pending = this.inflight.get(url);
    if (pending) {
      try {
        return await pending;
      } finally {
        if (onProgress) {
          this.progressListeners.get(url)?.delete(onProgress);
        }
      }
    }

    const emit = (p: DecodeProgress) => {
      const listeners = this.progressListeners.get(url);
      if (!listeners) return;
      for (const cb of listeners) {
        try {
          cb(p);
        } catch {
          /* ignore listener errors */
        }
      }
    };

    const p = (async () => {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Failed to fetch audio ${url}: ${res.status}`);

      const ab = await readResponseArrayBuffer(res, (loaded, total) => {
        const { ratio, determinate } = overallRatio('fetch', loaded, total);
        emit({ loaded, total, phase: 'fetch', ratio, determinate });
      });

      const { ratio: decodeStart, determinate } = overallRatio(
        'fetch',
        ab.byteLength,
        ab.byteLength,
      );
      emit({
        loaded: ab.byteLength,
        total: ab.byteLength,
        phase: 'decode',
        ratio: Math.max(decodeStart, 0.9),
        determinate,
      });

      const buffer = await ctx.decodeAudioData(ab.slice(0));

      emit({
        loaded: ab.byteLength,
        total: ab.byteLength,
        phase: 'decode',
        ratio: 1,
        determinate: true,
      });

      // Evict oldest if over cap (Map insertion order)
      if (this.cache.size >= this.maxEntries && !this.cache.has(url)) {
        const first = this.cache.keys().next().value as string | undefined;
        if (first) this.cache.delete(first);
      }
      this.cache.set(url, buffer);
      return buffer;
    })()
      .finally(() => {
        this.inflight.delete(url);
        this.progressListeners.delete(url);
      });

    this.inflight.set(url, p);
    return p;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
    this.progressListeners.clear();
  }
}

export const decodeCache = new DecodeCache(4);
