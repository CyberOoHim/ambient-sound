import { describe, expect, it, vi } from 'vitest';
import {
  DecodeCache,
  readResponseArrayBuffer,
  type DecodeProgress,
} from './decode-cache';

function streamResponse(
  bytes: Uint8Array,
  contentLength?: number,
): Response {
  const total = contentLength ?? bytes.byteLength;
  let offset = 0;
  const chunkSize = Math.max(1, Math.floor(bytes.byteLength / 4));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Length': String(total) },
  });
}

describe('readResponseArrayBuffer', () => {
  it('reports progressive byte counts when Content-Length is known', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const updates: Array<{ loaded: number; total: number | null }> = [];
    const ab = await readResponseArrayBuffer(streamResponse(data), (loaded, total) => {
      updates.push({ loaded, total });
    });
    expect(new Uint8Array(ab)).toEqual(data);
    expect(updates.length).toBeGreaterThan(1);
    expect(updates[updates.length - 1]).toEqual({
      loaded: data.byteLength,
      total: data.byteLength,
    });
    expect(updates.every((u) => u.total === data.byteLength)).toBe(true);
  });
});

describe('DecodeCache progress', () => {
  it('emits fetch then decode progress and caches the buffer', async () => {
    const data = new Uint8Array(32).fill(9);
    const fakeBuffer = { duration: 1 } as AudioBuffer;
    const ctx = {
      decodeAudioData: vi.fn(async () => fakeBuffer),
    } as unknown as AudioContext;

    const cache = new DecodeCache(4);
    const progress: DecodeProgress[] = [];
    const fetchFn = vi.fn(async () => streamResponse(data));

    const result = await cache.get(ctx, '/sounds/core/test.ogg', {
      fetchFn: fetchFn as unknown as typeof fetch,
      onProgress: (p) => progress.push({ ...p }),
    });

    expect(result).toBe(fakeBuffer);
    expect(cache.has('/sounds/core/test.ogg')).toBe(true);
    expect(progress.some((p) => p.phase === 'fetch')).toBe(true);
    expect(progress[progress.length - 1]?.ratio).toBe(1);
    expect(progress[progress.length - 1]?.phase).toBe('decode');

    // Second get is a cache hit at 100%
    const hitProgress: DecodeProgress[] = [];
    await cache.get(ctx, '/sounds/core/test.ogg', {
      onProgress: (p) => hitProgress.push(p),
    });
    expect(hitProgress[0]?.ratio).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('propagates fetch failures', async () => {
    const ctx = {
      decodeAudioData: vi.fn(),
    } as unknown as AudioContext;
    const cache = new DecodeCache(4);
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      cache.get(ctx, '/missing.ogg', {
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/404/);
    expect(cache.has('/missing.ogg')).toBe(false);
  });
});
