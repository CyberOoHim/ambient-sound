/**
 * YouTube URL Manager
 * Handles URL parsing, oEmbed title fetching, and LocalStorage CRUD for user-added YouTube streams.
 */

export interface YouTubeItem {
  id: string;
  videoId: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  addedAt: number;
}

const STORAGE_KEY = 'ambient_sound_youtube_saved_urls';

/** Default curated ambient YouTube streams for initial quick selection */
const DEFAULT_YOUTUBE_ITEMS: Omit<YouTubeItem, 'id' | 'addedAt'>[] = [
  {
    videoId: 'jfKfPfyJRdk',
    title: 'Lofi Girl - lofi hip hop radio - beats to relax/study to',
    url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    thumbnailUrl: 'https://img.youtube.com/vi/jfKfPfyJRdk/mqdefault.jpg',
  },
  {
    videoId: '4xDzrJKXOOY',
    title: 'Lofi Girl - synthwave radio - chill beats to relax/study to',
    url: 'https://www.youtube.com/watch?v=4xDzrJKXOOY',
    thumbnailUrl: 'https://img.youtube.com/vi/4xDzrJKXOOY/mqdefault.jpg',
  },
  {
    videoId: 'mPZkdNFkNps',
    title: 'Relaxing Rain Sounds for Sleeping & Studying',
    url: 'https://www.youtube.com/watch?v=mPZkdNFkNps',
    thumbnailUrl: 'https://img.youtube.com/vi/mPZkdNFkNps/mqdefault.jpg',
  },
];

/**
 * Extract YouTube 11-character video ID from various link formats.
 * e.g.
 * - https://www.youtube.com/watch?v=jfKfPfyJRdk
 * - https://youtu.be/jfKfPfyJRdk
 * - https://www.youtube.com/live/jfKfPfyJRdk
 * - https://www.youtube.com/embed/jfKfPfyJRdk
 * - jfKfPfyJRdk
 */
export function extractYouTubeVideoId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // If input is already an 11-character alphanumeric video ID (with _ or -)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const urlObj = new URL(trimmed);
    
    // youtube.com / m.youtube.com / www.youtube.com
    if (urlObj.hostname.includes('youtube.com')) {
      // /watch?v=VIDEO_ID
      const v = urlObj.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }
      // /live/VIDEO_ID or /embed/VIDEO_ID or /v/VIDEO_ID
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);
      const seg0 = pathSegments[0];
      if (seg0 && ['live', 'embed', 'v', 'shorts'].includes(seg0) && pathSegments[1]) {
        const id = pathSegments[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
          return id;
        }
      }
    }

    // youtu.be/VIDEO_ID
    if (urlObj.hostname.includes('youtu.be')) {
      const id = urlObj.pathname.replace(/^\/|\/$/g, '').trim();
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return id;
      }
    }
  } catch {
    // Regex fallback for non-standard URL strings containing v=... or youtu.be/...
    const match = trimmed.match(/(?:v=|\/live\/|\/embed\/|\/v\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Build thumbnail image URL for YouTube video ID.
 */
export function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Fetch video title via YouTube public oEmbed endpoint.
 * Returns default fallback string on network error or CORS limitation.
 */
export async function fetchYouTubeTitle(videoId: string): Promise<string> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;

  try {
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.title === 'string' && data.title.trim()) {
        return data.title.trim();
      }
    }
  } catch {
    // Ignore fetch error, fallback below
  }

  return `YouTube Stream (${videoId})`;
}

/**
 * Load user's saved YouTube list from localStorage.
 * Populates with default streams on first run.
 */
export function loadSavedYouTubeItems(): YouTubeItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Fall back to default items
  }

  // Populate default items with IDs and timestamps
  const defaults: YouTubeItem[] = DEFAULT_YOUTUBE_ITEMS.map((item, idx) => ({
    ...item,
    id: `yt-default-${idx + 1}`,
    addedAt: Date.now() - (DEFAULT_YOUTUBE_ITEMS.length - idx) * 1000,
  }));

  saveYouTubeItemsToStorage(defaults);
  return defaults;
}

/**
 * Save YouTube list to localStorage.
 */
export function saveYouTubeItemsToStorage(items: YouTubeItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to save YouTube items to localStorage:', err);
  }
}

/**
 * Add a new YouTube URL to saved list. Returns the created item or null if invalid URL.
 */
export async function addYouTubeItem(urlOrId: string): Promise<{ item: YouTubeItem | null; error?: string }> {
  const videoId = extractYouTubeVideoId(urlOrId);
  if (!videoId) {
    return { item: null, error: 'Invalid YouTube URL or Video ID' };
  }

  const saved = loadSavedYouTubeItems();
  const existing = saved.find((it) => it.videoId === videoId);
  if (existing) {
    return { item: existing }; // Already saved
  }

  const title = await fetchYouTubeTitle(videoId);
  const newItem: YouTubeItem = {
    id: `yt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: getYouTubeThumbnailUrl(videoId),
    addedAt: Date.now(),
  };

  const updated = [newItem, ...saved];
  saveYouTubeItemsToStorage(updated);
  return { item: newItem };
}

/**
 * Delete an item from saved YouTube list by item ID.
 */
export function deleteYouTubeItem(id: string): YouTubeItem[] {
  const saved = loadSavedYouTubeItems();
  const filtered = saved.filter((it) => it.id !== id);
  saveYouTubeItemsToStorage(filtered);
  return filtered;
}
