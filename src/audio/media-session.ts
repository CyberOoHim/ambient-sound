/**
 * Media Session API: lock-screen / Control Center metadata + play/pause
 * on iOS, Android, and desktop browsers that support it.
 */

export interface MediaSessionHandlers {
  play: () => void | Promise<void>;
  pause: () => void | Promise<void>;
}

let handlers: MediaSessionHandlers | null = null;

export function installMediaSessionHandlers(h: MediaSessionHandlers): void {
  handlers = h;
  if (!('mediaSession' in navigator)) return;

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
  } catch {
    /* some browsers throw on unsupported actions */
  }
}

export function setMediaSessionPlayback(
  playing: boolean,
  title = 'Ambient sounds',
): void {
  if (!('mediaSession' in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'Ambient',
      album: 'Soft sounds',
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
