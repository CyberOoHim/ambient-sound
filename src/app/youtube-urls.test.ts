import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractYouTubeVideoId,
  getYouTubeThumbnailUrl,
  fetchYouTubeTitle,
  loadSavedYouTubeItems,
  addYouTubeItem,
  deleteYouTubeItem,
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

describe('YouTube URLs Manager', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('extractYouTubeVideoId', () => {
    it('extracts ID from standard watch URL', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeVideoId('https://youtube.com/watch?v=4xDzrJKXOOY&t=10s')).toBe('4xDzrJKXOOY');
    });

    it('extracts ID from short URL (youtu.be)', () => {
      expect(extractYouTubeVideoId('https://youtu.be/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
    });

    it('extracts ID from live/embed/shorts path URLs', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/live/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeVideoId('https://www.youtube.com/embed/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeVideoId('https://www.youtube.com/shorts/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
    });

    it('returns raw ID if given valid 11-character string', () => {
      expect(extractYouTubeVideoId('jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
    });

    it('returns null for invalid inputs', () => {
      expect(extractYouTubeVideoId('')).toBeNull();
      expect(extractYouTubeVideoId('not-a-valid-id')).toBeNull();
      expect(extractYouTubeVideoId('https://example.com')).toBeNull();
    });
  });

  describe('getYouTubeThumbnailUrl', () => {
    it('returns standard mqdefault thumbnail URL', () => {
      expect(getYouTubeThumbnailUrl('jfKfPfyJRdk')).toBe(
        'https://img.youtube.com/vi/jfKfPfyJRdk/mqdefault.jpg',
      );
    });
  });

  describe('fetchYouTubeTitle', () => {
    it('returns oEmbed title on successful response', async () => {
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
      expect(items[0].videoId).toBe('jfKfPfyJRdk');
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
