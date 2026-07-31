/** Simple decode cache with max concurrent buffers. */
export class DecodeCache {
  private cache = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer>>();
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

  async get(
    ctx: AudioContext,
    url: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<AudioBuffer> {
    const hit = this.cache.get(url);
    if (hit) return hit;

    const pending = this.inflight.get(url);
    if (pending) return pending;

    const p = (async () => {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Failed to fetch audio ${url}: ${res.status}`);
      const ab = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab.slice(0));
      // Evict oldest if over cap (Map insertion order)
      if (this.cache.size >= this.maxEntries && !this.cache.has(url)) {
        const first = this.cache.keys().next().value as string | undefined;
        if (first) this.cache.delete(first);
      }
      this.cache.set(url, buffer);
      this.inflight.delete(url);
      return buffer;
    })().catch((err) => {
      this.inflight.delete(url);
      throw err;
    });

    this.inflight.set(url, p);
    return p;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}

export const decodeCache = new DecodeCache(4);
