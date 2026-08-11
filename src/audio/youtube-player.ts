/**
 * YouTube IFrame Player API Wrapper
 * Dynamic lazy-loading of YouTube API and manager for player instances per layer.
 */

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId?: string;
          playerVars?: {
            autoplay?: number;
            controls?: number;
            loop?: number;
            modestbranding?: number;
            playsinline?: number;
            playlist?: string;
            rel?: number;
            origin?: string;
          };
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        },
      ) => YTPlayerInstance;
      PlayerState?: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
  getIframe: () => HTMLIFrameElement;
}

let apiLoadingPromise: Promise<void> | null = null;

/**
 * Lazy-loads YouTube IFrame API script on demand.
 */
export function loadYouTubeApi(): Promise<void> {
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  if (apiLoadingPromise) {
    return apiLoadingPromise;
  }

  apiLoadingPromise = new Promise((resolve, reject) => {
    // If API ready callback already defined or pending
    const existingCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (existingCallback) existingCallback();
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiLoadingPromise = null;
      reject(new Error('Failed to load YouTube IFrame API'));
    };
    document.head.appendChild(script);
  });

  return apiLoadingPromise;
}

export class YouTubePlayerManager {
  private players = new Map<string, { player: YTPlayerInstance; isReady: boolean; pendingVolume?: number; pendingMuted?: boolean }>();
  private globalPlaying = false;

  public setGlobalPlaying(playing: boolean): void {
    this.globalPlaying = playing;
    for (const [id, entry] of this.players.entries()) {
      if (entry.isReady) {
        if (playing) {
          entry.player.playVideo();
        } else {
          entry.player.pauseVideo();
        }
      }
    }
  }

  /**
   * Create a YouTube player instance inside a container element for a layer.
   */
  public async createPlayer(
    layerId: string,
    videoId: string,
    hostElement: HTMLElement,
    initialVolumeLinear: number,
    initialMuted: boolean,
    isPlaying: boolean,
  ): Promise<void> {
    await loadYouTubeApi();

    if (!window.YT || !window.YT.Player) {
      console.error('YouTube IFrame API failed to load');
      return;
    }

    // Destroy existing player if re-creating for layer
    if (this.players.has(layerId)) {
      this.destroyPlayer(layerId);
    }

    const containerId = `yt-player-frame-${layerId}`;
    const frameDiv = document.createElement('div');
    frameDiv.id = containerId;
    hostElement.appendChild(frameDiv);

    this.globalPlaying = isPlaying;

    return new Promise((resolve) => {
      const initialVolumePercent = Math.round(Math.max(0, Math.min(1, initialVolumeLinear)) * 100);

      const player = new window.YT!.Player(frameDiv, {
        videoId,
        playerVars: {
          autoplay: isPlaying ? 1 : 0,
          controls: 0,
          loop: 1,
          playlist: videoId, // Required for loop=1 to work in YT iframe api
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            const entry = this.players.get(layerId);
            if (entry) {
              entry.isReady = true;
              event.target.setVolume(initialVolumePercent);
              if (initialMuted) {
                event.target.mute();
              } else {
                event.target.unMute();
              }
              if (this.globalPlaying) {
                event.target.playVideo();
              } else {
                event.target.pauseVideo();
              }
            }
            resolve();
          },
          onStateChange: (event) => {
            // Loop fallback if YT loop option stops at end
            if (event.data === window.YT?.PlayerState?.ENDED && this.globalPlaying) {
              player.playVideo();
            }
          },
          onError: (err) => {
            console.warn(`YouTube player error for layer ${layerId}:`, err);
            resolve();
          },
        },
      });

      this.players.set(layerId, {
        player,
        isReady: false,
        pendingVolume: initialVolumePercent,
        pendingMuted: initialMuted,
      });
    });
  }

  /**
   * Set linear volume 0..1 for a layer.
   */
  public setVolume(layerId: string, volumeLinear: number): void {
    const entry = this.players.get(layerId);
    if (!entry) return;

    const volumePercent = Math.round(Math.max(0, Math.min(1, volumeLinear)) * 100);
    entry.pendingVolume = volumePercent;

    if (entry.isReady) {
      entry.player.setVolume(volumePercent);
    }
  }

  /**
   * Set mute state for a layer.
   */
  public setMute(layerId: string, muted: boolean): void {
    const entry = this.players.get(layerId);
    if (!entry) return;

    entry.pendingMuted = muted;

    if (entry.isReady) {
      if (muted) {
        entry.player.mute();
      } else {
        entry.player.unMute();
      }
    }
  }

  /**
   * Destroy player for a layer.
   */
  public destroyPlayer(layerId: string): void {
    const entry = this.players.get(layerId);
    if (entry) {
      try {
        entry.player.destroy();
      } catch (err) {
        console.warn(`Error destroying YT player for ${layerId}:`, err);
      }
      this.players.delete(layerId);
    }
    // Fallback: remove orphaned DOM element if player wasn't fully initialized
    if (typeof document !== 'undefined') {
      document.getElementById(`yt-player-frame-${layerId}`)?.remove();
    }
  }

  /**
   * Destroy all active players.
   */
  public destroyAll(): void {
    for (const layerId of Array.from(this.players.keys())) {
      this.destroyPlayer(layerId);
    }
  }
}

export const youtubePlayerManager = new YouTubePlayerManager();
