/**
 * Media Session API: lock-screen / Control Center metadata + play/pause
 * on iOS, Android, and desktop browsers that support it.
 */

export interface MediaSessionHandlers {
  play: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  /** Cycle to next saved preset (lock-screen next track). */
  nexttrack?: () => void | Promise<void>;
  /** Cycle to previous saved preset. */
  previoustrack?: () => void | Promise<void>;
}

let handlers: MediaSessionHandlers | null = null;

function baseUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) {
    const base = import.meta.env.BASE_URL;
    return base.endsWith('/') ? base : `${base}/`;
  }
  return '/';
}

function artworkEntries(): MediaImage[] {
  const root = baseUrl();
  return [
    { src: `${root}icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${root}icon-512.png`, sizes: '512x512', type: 'image/png' },
  ];
}

export function installMediaSessionHandlers(h: MediaSessionHandlers): void {
  handlers = h;
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  try {
    navigator.mediaSession.setActionHandler('play', () => {
      void handlers?.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      void handlers?.pause();
    });
    // stop is treated as pause for ambient use
    navigator.mediaSession.setActionHandler('stop', () => {
      void handlers?.pause();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      void handlers?.nexttrack?.();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      void handlers?.previoustrack?.();
    });
  } catch {
    /* some browsers throw on unsupported actions */
  }
}

export function setMediaSessionPlayback(
  playing: boolean,
  title = 'Ambient sounds',
  artist = 'Ambient',
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: 'Soft sounds',
      artwork: artworkEntries(),
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  } catch {
    /* MediaMetadata / playbackState unsupported */
  }
}

export function clearMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
  } catch {
    /* */
  }
}
