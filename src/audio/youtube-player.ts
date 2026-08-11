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
            enablejsapi?: number;
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

interface PlayerEntry {
  player: YTPlayerInstance | null;
  isReady: boolean;
  layerVolumeLinear: number;
  pendingMuted: boolean;
}

export class YouTubePlayerManager {
  private players = new Map<string, PlayerEntry>();
  private globalPlaying = false;
  private masterVolumeLinear = 1;
  private errorCallback?: (layerId: string, errorCode: number) => void;

  public onError(cb: (layerId: string, errorCode: number) => void): void {
    this.errorCallback = cb;
  }

  public setMasterVolumeLinear(masterVolumeLinear: number): void {
    this.masterVolumeLinear = Math.max(0, Math.min(1, masterVolumeLinear));
    for (const layerId of this.players.keys()) {
      this.applyPlayerState(layerId);
    }
  }

  private calculateEffectiveVolumePercent(layerVolumeLinear: number): number {
    const effectiveLinear = Math.max(
      0,
      Math.min(1, layerVolumeLinear * this.masterVolumeLinear),
    );
    return Math.round(effectiveLinear * 100);
  }

  private applyPlayerState(layerId: string): void {
    const entry = this.players.get(layerId);
    if (!entry || !entry.isReady || !entry.player) return;

    try {
      const volumePercent = this.calculateEffectiveVolumePercent(
        entry.layerVolumeLinear,
      );
      entry.player.setVolume(volumePercent);

      if (entry.pendingMuted || this.masterVolumeLinear === 0) {
        entry.player.mute();
      } else {
        entry.player.unMute();
      }
    } catch (err) {
      console.warn(`Error applying YT player state for ${layerId}:`, err);
    }
  }

  public setGlobalPlaying(playing: boolean): void {
    this.globalPlaying = playing;
    for (const [id, entry] of this.players.entries()) {
      if (entry.isReady && entry.player) {
        try {
          if (playing) {
            this.applyPlayerState(id);
            entry.player.playVideo();
          } else {
            entry.player.pauseVideo();
          }
        } catch (err) {
          console.warn(`Error updating play state for YT player ${id}:`, err);
        }
      }
    }
  }

  public hasActivePlayers(): boolean {
    return this.players.size > 0;
  }

  public hasPlayer(layerId: string): boolean {
    return this.players.has(layerId);
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

    const entry: PlayerEntry = {
      player: null,
      isReady: false,
      layerVolumeLinear: Math.max(0, Math.min(1, initialVolumeLinear)),
      pendingMuted: initialMuted,
    };
    this.players.set(layerId, entry);

    return new Promise((resolve) => {
      let validOrigin: string | undefined;
      if (
        typeof window !== 'undefined' &&
        window.location.origin &&
        window.location.origin !== 'null' &&
        /^https?:\/\//i.test(window.location.origin)
      ) {
        validOrigin = window.location.origin;
      }

      const player = new window.YT!.Player(frameDiv, {
        videoId,
        playerVars: {
          autoplay: isPlaying ? 1 : 0,
          controls: 0,
          enablejsapi: 1,
          loop: 1,
          playlist: videoId, // Required for loop=1 to work in YT iframe api
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          ...(validOrigin ? { origin: validOrigin } : {}),
        },
        events: {
          onReady: (event) => {
            entry.isReady = true;
            try {
              const iframe = event.target.getIframe?.();
              if (iframe && typeof iframe.setAttribute === 'function') {
                iframe.setAttribute(
                  'allow',
                  'autoplay; encrypted-media; picture-in-picture; accelerometer; clipboard-write; gyroscope',
                );
                iframe.setAttribute('playsinline', '1');
                iframe.setAttribute('webkit-playsinline', '1');
              }
            } catch {
              /* */
            }
            this.applyPlayerState(layerId);
            if (this.globalPlaying) {
              try {
                event.target.playVideo();
              } catch {
                /* */
              }
            } else {
              try {
                event.target.pauseVideo();
              } catch {
                /* */
              }
            }
            resolve();
          },
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState?.PLAYING) {
              // If the master transport is paused, iOS may still
              // auto-resume the iframe.  Force it back to paused so
              // the user doesn't hear random YouTube audio.
              if (!this.globalPlaying) {
                try {
                  player.pauseVideo();
                } catch { /* */ }
                return;
              }
              this.applyPlayerState(layerId);
            }
            // Loop fallback if YT loop option stops at end
            if (
              event.data === window.YT?.PlayerState?.ENDED &&
              this.globalPlaying
            ) {
              try {
                player.playVideo();
              } catch {
                /* */
              }
            }
          },
          onError: (errEvent) => {
            const errCode =
              errEvent && typeof errEvent.data === 'number'
                ? errEvent.data
                : -1;
            console.warn(
              `YouTube player error for layer ${layerId}: code ${errCode}`,
            );
            this.errorCallback?.(layerId, errCode);
            resolve();
          },
        },
      });

      entry.player = player;
    });
  }

  /**
   * Set linear volume 0..1 for a layer.
   */
  public setVolume(layerId: string, volumeLinear: number): void {
    const entry = this.players.get(layerId);
    if (!entry) return;

    entry.layerVolumeLinear = Math.max(0, Math.min(1, volumeLinear));
    this.applyPlayerState(layerId);
  }

  /**
   * Set mute state for a layer.
   */
  public setMute(layerId: string, muted: boolean): void {
    const entry = this.players.get(layerId);
    if (!entry) return;

    entry.pendingMuted = muted;
    this.applyPlayerState(layerId);
  }

  /**
   * Destroy player for a layer.
   */
  public destroyPlayer(layerId: string): void {
    const entry = this.players.get(layerId);
    if (entry) {
      if (entry.player) {
        try {
          entry.player.destroy();
        } catch (err) {
          console.warn(`Error destroying YT player for ${layerId}:`, err);
        }
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

