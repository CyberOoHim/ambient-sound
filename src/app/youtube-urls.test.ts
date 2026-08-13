import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractYouTubeVideoId,
  getYouTubeThumbnailUrl,
  fetchYouTubeTitle,
  loadSavedYouTubeItems,
  addYouTubeItem,
  deleteYouTubeItem,
  restoreDefaultYouTubeItems,
} from './youtube-urls';

// Simple in-memory localStorage mock for node environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('youtube-urls', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  describe('extractYouTubeVideoId', () => {
    it('extracts video ID from standard watch URL', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeVideoId('https://youtube.com/watch?v=4xDzrJKXOOY&t=10s')).toBe('4xDzrJKXOOY');
    });

    it('extracts video ID from short link (youtu.be)', () => {
      expect(extractYouTubeVideoId('https://youtu.be/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
    });

    it('extracts video ID from live / embed / shorts paths', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/live/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeVideoId('https://www.youtube.com/embed/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeVideoId('https://www.youtube.com/shorts/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
    });

    it('accepts raw 11-char video ID', () => {
      expect(extractYouTubeVideoId('jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
    });

    it('returns null for invalid inputs', () => {
      expect(extractYouTubeVideoId('')).toBeNull();
      expect(extractYouTubeVideoId('not-a-valid-id')).toBeNull();
      expect(extractYouTubeVideoId('https://example.com')).toBeNull();
    });
  });

  describe('getYouTubeThumbnailUrl', () => {
    it('returns valid mqdefault thumbnail URL', () => {
      expect(getYouTubeThumbnailUrl('jfKfPfyJRdk')).toBe(
        'https://img.youtube.com/vi/jfKfPfyJRdk/mqdefault.jpg',
      );
    });
  });

  describe('fetchYouTubeTitle', () => {
    it('returns fetched title when oEmbed succeeds', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: 'Test Ambient Stream' }),
      } as Response);

      const title = await fetchYouTubeTitle('jfKfPfyJRdk');
      expect(title).toBe('Test Ambient Stream');
    });

    it('falls back to default title on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const title = await fetchYouTubeTitle('jfKfPfyJRdk');
      expect(title).toBe('YouTube Stream (jfKfPfyJRdk)');
    });
  });

  describe('LocalStorage CRUD', () => {
    it('loads default curated items when localStorage is empty', () => {
      const items = loadSavedYouTubeItems();
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].videoId).toBe('P2fbPIIVNMg');
    });

    it('keeps empty list when user deletes all items, and adding new item under empty list does not restore defaults', async () => {
      const initial = loadSavedYouTubeItems();
      for (const item of initial) {
        deleteYouTubeItem(item.id);
      }

      const empty = loadSavedYouTubeItems();
      expect(empty).toEqual([]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: 'Custom Stream Title' }),
      } as Response);

      const res = await addYouTubeItem('https://www.youtube.com/watch?v=abc12345678');
      expect(res.item).not.toBeNull();

      const afterAdd = loadSavedYouTubeItems();
      expect(afterAdd.length).toBe(1);
      expect(afterAdd[0].videoId).toBe('abc12345678');
    });

    it('restores default items using restoreDefaultYouTubeItems while retaining custom items', async () => {
      const initial = loadSavedYouTubeItems();
      for (const item of initial) {
        deleteYouTubeItem(item.id);
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: 'My Custom Stream' }),
      } as Response);

      await addYouTubeItem('https://www.youtube.com/watch?v=custom11111');
      expect(loadSavedYouTubeItems().length).toBe(1);

      const restored = restoreDefaultYouTubeItems();
      expect(restored.length).toBe(4);
      expect(restored.some((it) => it.videoId === 'custom11111')).toBe(true);
      expect(restored.some((it) => it.videoId === 'P2fbPIIVNMg')).toBe(true);
    });

    it('adds new YouTube item', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: 'Custom Stream Title' }),
      } as Response);

      const res = await addYouTubeItem('https://www.youtube.com/watch?v=abc12345678');
      expect(res.item).not.toBeNull();
      expect(res.item?.title).toBe('Custom Stream Title');

      const saved = loadSavedYouTubeItems();
      expect(saved.some((item) => item.videoId === 'abc12345678')).toBe(true);
    });

    it('deletes item from saved list', async () => {
      const initial = loadSavedYouTubeItems();
      const firstId = initial[0].id;

      const updated = deleteYouTubeItem(firstId);
      expect(updated.some((item) => item.id === firstId)).toBe(false);
    });
  });
});
