import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPlaylist,
  getNextTrackIndex,
  getPreviousTrackIndex,
  sanitizePlaylist,
  loadPlaylistsFromStorage,
  savePlaylistsToStorage,
  defaultPlaylists,
  type Playlist,
  type PlaylistItem,
} from './playlist';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('Playlist Management & Serialization', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage();
  });

  it('creates default playlist with curated YouTube streams and sequence mode', () => {
    const defaults = defaultPlaylists();
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults[0].name).toBeDefined();
    expect(defaults[0].shuffleDefault).toBe(false); // default at sequence
    expect(defaults[0].items.length).toBeGreaterThanOrEqual(2);
  });

  it('creates new playlist with given name and mode', () => {
    const pl = createPlaylist('Study Vibes', [], true);
    expect(pl.name).toBe('Study Vibes');
    expect(pl.shuffleDefault).toBe(true);
    expect(pl.items).toEqual([]);
    expect(pl.id).toMatch(/^pl-/);
  });

  it('calculates sequential (rotate) track index correctly', () => {
    const count = 4;
    expect(getNextTrackIndex(count, 0, false)).toBe(1);
    expect(getNextTrackIndex(count, 1, false)).toBe(2);
    expect(getNextTrackIndex(count, 2, false)).toBe(3);
    expect(getNextTrackIndex(count, 3, false)).toBe(0); // wraps around (rotate)

    expect(getPreviousTrackIndex(count, 0)).toBe(3); // wraps backwards
    expect(getPreviousTrackIndex(count, 2)).toBe(1);
  });

  it('calculates random (shuffle) track index correctly', () => {
    const count = 5;
    for (let i = 0; i < 20; i++) {
      const curr = 2;
      const next = getNextTrackIndex(count, curr, true);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(count);
      expect(next).not.toBe(curr); // avoids repeating current index when count > 1
    }
  });

  it('handles single item or empty playlist indices safely', () => {
    expect(getNextTrackIndex(0, 0, false)).toBe(-1);
    expect(getNextTrackIndex(1, 0, false)).toBe(0);
    expect(getNextTrackIndex(1, 0, true)).toBe(0);
    expect(getPreviousTrackIndex(0, 0)).toBe(-1);
    expect(getPreviousTrackIndex(1, 0)).toBe(0);
  });

  it('sanitizes and persists playlist with both local audio and YouTube tracks', () => {
    const sampleItems: PlaylistItem[] = [
      {
        id: 'item-1',
        type: 'local',
        title: 'Rain on Tin Roof',
        assetId: 'local:rain-tin',
        addedAt: Date.now(),
      },
      {
        id: 'item-2',
        type: 'youtube',
        title: 'Lofi Girl Livestream',
        videoId: 'jfKfPfyJRdk',
        url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
        thumbnailUrl: 'https://img.youtube.com/vi/jfKfPfyJRdk/mqdefault.jpg',
        addedAt: Date.now(),
      },
    ];

    const playlist = createPlaylist('Focus Mix', sampleItems, false);
    savePlaylistsToStorage([playlist]);

    const loaded = loadPlaylistsFromStorage();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe('Focus Mix');
    expect(loaded[0].items.length).toBe(2);
    expect(loaded[0].items[0].type).toBe('local');
    expect(loaded[0].items[0].assetId).toBe('local:rain-tin');
    expect(loaded[0].items[1].type).toBe('youtube');
    expect(loaded[0].items[1].videoId).toBe('jfKfPfyJRdk');
  });
});
