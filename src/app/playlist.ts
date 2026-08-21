export type PlaylistItemType = 'local' | 'youtube';

export interface PlaylistItem {
  id: string;
  type: PlaylistItemType;
  title: string;
  /** For local audio: "local:<id>" */
  assetId?: string;
  /** For YouTube streams */
  videoId?: string;
  url?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
  /** Default playback mode: false = sequence (rotate), true = random (shuffle) */
  shuffleDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const PLAYLISTS_STORAGE_KEY = 'ambient_sound_playlists';

export function uid(prefix = 'pl'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultPlaylists(): Playlist[] {
  return [
    {
      id: 'pl-default-lofi',
      name: 'Chill & Lofi Vibes',
      shuffleDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: 'item-lofi-girl',
          type: 'youtube',
          title: 'Lofi Girl - Relaxing Beats',
          videoId: 'jfKfPfyJRdk',
          url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          thumbnailUrl: 'https://img.youtube.com/vi/jfKfPfyJRdk/mqdefault.jpg',
          addedAt: Date.now(),
        },
        {
          id: 'item-synthwave',
          type: 'youtube',
          title: 'Synthwave Radio - Chill synth / retro beats',
          videoId: '4xDzrJKXOOY',
          url: 'https://www.youtube.com/watch?v=4xDzrJKXOOY',
          thumbnailUrl: 'https://img.youtube.com/vi/4xDzrJKXOOY/mqdefault.jpg',
          addedAt: Date.now() + 1,
        },
      ],
    },
  ];
}

export function loadPlaylistsFromStorage(): Playlist[] {
  if (typeof localStorage === 'undefined') return defaultPlaylists();
  try {
    const raw = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
    if (!raw) {
      const def = defaultPlaylists();
      savePlaylistsToStorage(def);
      return def;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultPlaylists();
    return parsed.map((p, idx) => sanitizePlaylist(p, `pl-${idx}`));
  } catch (err) {
    console.warn('Failed to load playlists from storage:', err);
    return defaultPlaylists();
  }
}

export function savePlaylistsToStorage(playlists: Playlist[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists));
  } catch (err) {
    console.warn('Failed to save playlists to storage:', err);
  }
}

function sanitizePlaylistItem(raw: unknown, fallbackId: string): PlaylistItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = o.type === 'youtube' ? 'youtube' : o.type === 'local' ? 'local' : null;
  if (!type) return null;

  const id = typeof o.id === 'string' && o.id ? o.id : fallbackId;
  const title = typeof o.title === 'string' && o.title ? o.title : 'Untitled Track';

  const item: PlaylistItem = {
    id,
    type,
    title,
    addedAt: typeof o.addedAt === 'number' ? o.addedAt : Date.now(),
  };

  if (type === 'local') {
    if (typeof o.assetId === 'string') {
      item.assetId = o.assetId;
    }
  } else if (type === 'youtube') {
    if (typeof o.videoId === 'string') {
      item.videoId = o.videoId;
      item.url = typeof o.url === 'string' ? o.url : `https://www.youtube.com/watch?v=${o.videoId}`;
      item.thumbnailUrl =
        typeof o.thumbnailUrl === 'string'
          ? o.thumbnailUrl
          : `https://img.youtube.com/vi/${o.videoId}/mqdefault.jpg`;
    }
  }

  if (typeof o.durationSec === 'number') {
    item.durationSec = o.durationSec;
  }

  return item;
}

export function sanitizePlaylist(raw: unknown, fallbackId: string): Playlist {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id ? o.id : fallbackId;
  const name = typeof o.name === 'string' && o.name ? o.name : 'Untitled Playlist';
  const shuffleDefault = Boolean(o.shuffleDefault);
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString();
  const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString();

  const items: PlaylistItem[] = [];
  if (Array.isArray(o.items)) {
    for (let i = 0; i < o.items.length; i++) {
      const sanitized = sanitizePlaylistItem(o.items[i], `item-${i}`);
      if (sanitized) {
        items.push(sanitized);
      }
    }
  }

  return {
    id,
    name,
    items,
    shuffleDefault,
    createdAt,
    updatedAt,
  };
}

export function createPlaylist(name: string, items: PlaylistItem[] = [], shuffleDefault = false): Playlist {
  return {
    id: uid('pl'),
    name: name.trim() || 'New Playlist',
    items,
    shuffleDefault,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function getNextTrackIndex(
  itemsCount: number,
  currentIndex: number,
  shuffle: boolean,
): number {
  if (itemsCount <= 0) return -1;
  if (itemsCount === 1) return 0;

  if (!shuffle) {
    return (currentIndex + 1) % itemsCount;
  }

  // Shuffle / Random mode: pick a different index at random
  let next = Math.floor(Math.random() * itemsCount);
  if (next === currentIndex) {
    next = (currentIndex + 1 + Math.floor(Math.random() * (itemsCount - 1))) % itemsCount;
  }
  return next;
}

export function getPreviousTrackIndex(
  itemsCount: number,
  currentIndex: number,
): number {
  if (itemsCount <= 0) return -1;
  if (itemsCount === 1) return 0;
  return (currentIndex - 1 + itemsCount) % itemsCount;
}
