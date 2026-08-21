/**
 * YouTube IFrame Player API Wrapper
 * Dynamic lazy-loading of YouTube API and manager for player instances per layer.
 *
 * Design notes:
 * - Players are reused across Play/Pause (same videoId) so start stays inside
 *   the user-gesture chain when possible.
 * - API load + onReady are time-bounded; failures never hang the transport UI.
 * - Status is exposed for mix-layer UX.
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
  getPlayerState?: () => number;
  loadVideoById?: (videoId: string | { videoId: string; startSeconds?: number }) => void;
  cueVideoById?: (videoId: string | { videoId: string; startSeconds?: number }) => void;
}

/** Lifecycle status for a layer's YouTube player (UI + diagnostics). */
export type YoutubePlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'error';

export const YOUTUBE_API_LOAD_TIMEOUT_MS = 10_000;
export const YOUTUBE_PLAYER_READY_TIMEOUT_MS = 12_000;
/** After playVideo, if still not PLAYING, treat as autoplay-blocked. */
export const YOUTUBE_AUTOPLAY_PROBE_MS = 4_500;

let apiLoadingPromise: Promise<void> | null = null;

/**
 * Lazy-loads YouTube IFrame API script on demand (with timeout).
 */
export function loadYouTubeApi(
  timeoutMs: number = YOUTUBE_API_LOAD_TIMEOUT_MS,
): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube API requires a browser window'));
  }

  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  if (apiLoadingPromise) {
    return apiLoadingPromise;
  }

  apiLoadingPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const finishOk = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollId != null) clearInterval(pollId);
      resolve();
    };

    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollId != null) clearInterval(pollId);
      apiLoadingPromise = null;
      reject(err);
    };

    const timer = setTimeout(() => {
      finishErr(new Error('YouTube IFrame API load timed out'));
    }, timeoutMs);

    const existingCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        if (existingCallback) existingCallback();
      } catch {
        /* */
      }
      finishOk();
    };

    if (!document.querySelector('script[data-ambient-yt-api]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ambientYtApi = '1';
      script.onerror = () => {
        finishErr(new Error('Failed to load YouTube IFrame API'));
      };
      document.head.appendChild(script);
    }

    // Cached/partial loads may expose YT.Player without the global callback.
    pollId = setInterval(() => {
      if (window.YT && window.YT.Player) {
        finishOk();
      }
    }, 100);
  });

  return apiLoadingPromise;
}

/** Reset API loader state (tests only). */
export function __resetYouTubeApiLoaderForTests(): void {
  apiLoadingPromise = null;
}

interface PlayerEntry {
  player: YTPlayerInstance | null;
  videoId: string;
  isReady: boolean;
  layerVolumeLinear: number;
  pendingMuted: boolean;
  status: YoutubePlayerStatus;
  /** Bumps on each create attempt so stale timeouts ignore old players. */
  generation: number;
  autoplayProbeTimer: ReturnType<typeof setTimeout> | null;
}

export type YoutubeStatusListener = (
  layerId: string,
  status: YoutubePlayerStatus,
) => void;

export class YouTubePlayerManager {
  private players = new Map<string, PlayerEntry>();
  private globalPlaying = false;
  private masterVolumeLinear = 1;
  private errorCallback?: (layerId: string, errorCode: number) => void;
  private endedCallback?: (layerId: string) => void;
  private statusListeners = new Set<YoutubeStatusListener>();

  public onError(cb: (layerId: string, errorCode: number) => void): void {
    this.errorCallback = cb;
  }

  public onTrackEnded(cb: (layerId: string) => void): void {
    this.endedCallback = cb;
  }

  public onStatusChange(cb: YoutubeStatusListener): void {
    this.statusListeners.add(cb);
  }

  public offStatusChange(cb: YoutubeStatusListener): void {
    this.statusListeners.delete(cb);
  }

  public getStatus(layerId: string): YoutubePlayerStatus {
    return this.players.get(layerId)?.status ?? 'idle';
  }

  public getVideoId(layerId: string): string | null {
    return this.players.get(layerId)?.videoId ?? null;
  }

  private setStatus(layerId: string, status: YoutubePlayerStatus): void {
    const entry = this.players.get(layerId);
    if (!entry) return;
    if (entry.status === status) return;
    entry.status = status;
    for (const cb of this.statusListeners) {
      try {
        cb(layerId, status);
      } catch {
        /* */
      }
    }
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

  private clearAutoplayProbe(entry: PlayerEntry): void {
    if (entry.autoplayProbeTimer != null) {
      clearTimeout(entry.autoplayProbeTimer);
      entry.autoplayProbeTimer = null;
    }
  }

  private scheduleAutoplayProbe(layerId: string, generation: number): void {
    const entry = this.players.get(layerId);
    if (!entry) return;
    this.clearAutoplayProbe(entry);
    entry.autoplayProbeTimer = setTimeout(() => {
      const e = this.players.get(layerId);
      if (!e || e.generation !== generation || !this.globalPlaying) return;
      if (e.status === 'playing' || e.status === 'error') return;
      // Still not PLAYING after playVideo — browser likely blocked unmuted autoplay.
      this.setStatus(layerId, 'blocked');
    }, YOUTUBE_AUTOPLAY_PROBE_MS);
  }

  private tryPlayEntry(layerId: string): void {
    const entry = this.players.get(layerId);
    if (!entry || !entry.isReady || !entry.player) return;
    try {
      this.applyPlayerState(layerId);
      entry.player.playVideo();
      this.scheduleAutoplayProbe(layerId, entry.generation);
    } catch (err) {
      console.warn(`Error playing YT player ${layerId}:`, err);
    }
  }

  private tryPauseEntry(layerId: string): void {
    const entry = this.players.get(layerId);
    if (!entry) return;
    this.clearAutoplayProbe(entry);
    if (!entry.isReady || !entry.player) return;
    try {
      entry.player.pauseVideo();
      this.setStatus(layerId, 'paused');
    } catch (err) {
      console.warn(`Error pausing YT player ${layerId}:`, err);
    }
  }

  /**
   * Synchronously start all ready-but-idle players.
   * MUST be called from within a user-gesture handler (click/tap)
   * before any `await`, so the browser's user-activation propagates
   * through postMessage to the YouTube iframe and unmuted playback
   * is allowed on the first click.
   */
  public playAllReadyForGesture(): void {
    this.globalPlaying = true;
    for (const [layerId, entry] of this.players.entries()) {
      if (!entry.isReady || !entry.player) continue;
      this.applyPlayerState(layerId);
      entry.player.playVideo();
      this.scheduleAutoplayProbe(layerId, entry.generation);
    }
  }

  public setGlobalPlaying(playing: boolean): void {
    this.globalPlaying = playing;
    for (const id of this.players.keys()) {
      const entry = this.players.get(id);
      if (!entry) continue;
      if (playing) {
        if (entry.isReady && entry.player) {
          this.tryPlayEntry(id);
        } else if (entry.status === 'loading') {
          // onReady will honor globalPlaying
        } else if (entry.status === 'blocked') {
          // Retry play on existing ready player (second user gesture path)
          if (entry.isReady && entry.player) {
            this.tryPlayEntry(id);
          }
        }
      } else {
        this.tryPauseEntry(id);
      }
    }
  }

  public isGlobalPlaying(): boolean {
    return this.globalPlaying;
  }

  public hasActivePlayers(): boolean {
    return this.players.size > 0;
  }

  public hasPlayer(layerId: string): boolean {
    return this.players.has(layerId);
  }

  public isPlayerReady(layerId: string): boolean {
    const e = this.players.get(layerId);
    return Boolean(e?.isReady && e.player);
  }

  /**
   * Ensure a player exists for the layer. Reuses an existing ready player when
   * the videoId matches (Play/Pause must not tear down the iframe).
   *
   * Resolves when the player is ready, reused, or after a timeout/error —
   * never hangs indefinitely.
   */
  public async ensurePlayer(
    layerId: string,
    videoId: string,
    hostElement: HTMLElement,
    initialVolumeLinear: number,
    initialMuted: boolean,
    wantPlay: boolean,
  ): Promise<void> {
    this.globalPlaying = wantPlay || this.globalPlaying;

    const existing = this.players.get(layerId);
    if (existing) {
      existing.layerVolumeLinear = Math.max(0, Math.min(1, initialVolumeLinear));
      existing.pendingMuted = initialMuted;

      // Case 1: Same video, ready
      if (existing.videoId === videoId && existing.isReady && existing.player) {
        this.applyPlayerState(layerId);
        if (wantPlay || this.globalPlaying) {
          this.tryPlayEntry(layerId);
        } else {
          this.tryPauseEntry(layerId);
        }
        return;
      }

      // Case 2: Same video, still loading
      if (existing.videoId === videoId && existing.status === 'loading') {
        return this.waitForReady(layerId, YOUTUBE_PLAYER_READY_TIMEOUT_MS);
      }

      // Case 3: Different video, but existing player is already READY!
      // Reuse the existing iframe by calling loadVideoById / cueVideoById.
      // This avoids tearing down the iframe, preserving the user-activation origin and avoiding autoplay blocks.
      if (existing.isReady && existing.player) {
        existing.videoId = videoId;
        this.applyPlayerState(layerId);
        try {
          if (wantPlay || this.globalPlaying) {
            this.setStatus(layerId, 'loading');
            if (typeof existing.player.loadVideoById === 'function') {
              existing.player.loadVideoById(videoId);
            } else {
              this.tryPlayEntry(layerId);
            }
            this.scheduleAutoplayProbe(layerId, existing.generation);
          } else {
            if (typeof existing.player.cueVideoById === 'function') {
              existing.player.cueVideoById(videoId);
            } else {
              this.tryPauseEntry(layerId);
            }
            this.setStatus(layerId, 'paused');
          }
          return;
        } catch (err) {
          console.warn(
            `Error switching video on existing player for ${layerId}, recreating:`,
            err,
          );
        }
      }
    }

    // Different video or no ready player: (re)create
    return this.createPlayer(
      layerId,
      videoId,
      hostElement,
      initialVolumeLinear,
      initialMuted,
      wantPlay || this.globalPlaying,
    );
  }

  /**
   * Create a YouTube player instance inside a container element for a layer.
   * Prefer {@link ensurePlayer} from call sites.
   */
  public async createPlayer(
    layerId: string,
    videoId: string,
    hostElement: HTMLElement,
    initialVolumeLinear: number,
    initialMuted: boolean,
    isPlaying: boolean,
  ): Promise<void> {
    // Destroy existing player if re-creating for layer
    if (this.players.has(layerId)) {
      this.destroyPlayer(layerId);
    }

    const entry: PlayerEntry = {
      player: null,
      videoId,
      isReady: false,
      layerVolumeLinear: Math.max(0, Math.min(1, initialVolumeLinear)),
      pendingMuted: initialMuted,
      status: 'idle',
      generation: 1,
      autoplayProbeTimer: null,
    };
    this.players.set(layerId, entry);
    this.setStatus(layerId, 'loading');

    try {
      await loadYouTubeApi();
    } catch (err) {
      console.error('YouTube IFrame API failed to load', err);
      this.setStatus(layerId, 'error');
      this.players.delete(layerId);
      this.errorCallback?.(layerId, -2);
      return;
    }

    // Layer may have been destroyed while API was loading
    if (this.players.get(layerId) !== entry) return;

    if (!window.YT || !window.YT.Player) {
      console.error('YouTube IFrame API failed to load');
      this.setStatus(layerId, 'error');
      this.players.delete(layerId);
      this.errorCallback?.(layerId, -2);
      return;
    }

    this.globalPlaying = isPlaying || this.globalPlaying;

    const containerId = `yt-player-frame-${layerId}`;
    // Remove any orphan node with same id
    document.getElementById(containerId)?.remove();
    const frameDiv = document.createElement('div');
    frameDiv.id = containerId;
    frameDiv.style.position = 'absolute';
    frameDiv.style.width = '1px';
    frameDiv.style.height = '1px';
    frameDiv.style.opacity = '0';
    frameDiv.style.overflow = 'hidden';
    frameDiv.style.pointerEvents = 'none';
    hostElement.appendChild(frameDiv);

    const generation = entry.generation;

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        resolve();
      };

      const readyTimer = setTimeout(() => {
        const e = this.players.get(layerId);
        if (!e || e.generation !== generation) {
          settle();
          return;
        }
        if (!e.isReady) {
          console.warn(
            `YouTube player ready timed out for layer ${layerId}`,
          );
          this.setStatus(layerId, 'error');
          try {
            e.player?.destroy();
          } catch {
            /* */
          }
          this.players.delete(layerId);
          document.getElementById(containerId)?.remove();
          this.errorCallback?.(layerId, -3);
        }
        settle();
      }, YOUTUBE_PLAYER_READY_TIMEOUT_MS);

      let validOrigin: string | undefined;
      try {
        const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
        if (
          origin &&
          origin !== 'null' &&
          /^https?:\/\//i.test(origin)
        ) {
          validOrigin = origin;
        }
      } catch {
        /* no location in test / worker envs */
      }

      let player: YTPlayerInstance;
      try {
        player = new window.YT!.Player(frameDiv, {
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
              const e = this.players.get(layerId);
              if (!e || e.generation !== generation) {
                settle();
                return;
              }
              e.isReady = true;
              e.player = event.target;
              try {
                const iframe = event.target.getIframe?.();
                if (iframe && typeof iframe.setAttribute === 'function') {
                  iframe.setAttribute(
                    'allow',
                    'autoplay; encrypted-media; picture-in-picture; accelerometer; clipboard-write; gyroscope',
                  );
                  iframe.setAttribute('playsinline', '1');
                  iframe.setAttribute('webkit-playsinline', '1');
                  if (iframe.style) {
                    iframe.style.opacity = '0';
                    iframe.style.width = '1px';
                    iframe.style.height = '1px';
                    iframe.style.pointerEvents = 'none';
                  }
                }
              } catch {
                /* */
              }
              this.setStatus(layerId, 'ready');
              this.applyPlayerState(layerId);
              if (this.globalPlaying) {
                this.tryPlayEntry(layerId);
              } else {
                try {
                  event.target.pauseVideo();
                } catch {
                  /* */
                }
                this.setStatus(layerId, 'paused');
              }
              settle();
            },
            onStateChange: (event) => {
              const e = this.players.get(layerId);
              if (!e || e.generation !== generation) return;

              const state = event.data;
              const PS = window.YT?.PlayerState;

              if (PS && state === PS.PLAYING) {
                if (!this.globalPlaying) {
                  try {
                    player.pauseVideo();
                  } catch {
                    /* */
                  }
                  return;
                }
                this.clearAutoplayProbe(e);
                this.applyPlayerState(layerId);
                this.setStatus(layerId, 'playing');
                return;
              }

              if (PS && state === PS.PAUSED) {
                if (!this.globalPlaying) {
                  this.setStatus(layerId, 'paused');
                }
                return;
              }

              if (PS && state === PS.BUFFERING && this.globalPlaying) {
                this.setStatus(layerId, 'loading');
                return;
              }

              // Loop fallback or playlist onEnded advance
              if (PS && state === PS.ENDED && this.globalPlaying) {
                if (this.endedCallback) {
                  this.endedCallback(layerId);
                } else {
                  try {
                    player.playVideo();
                  } catch {
                    /* */
                  }
                }
              }
            },
            onError: (errEvent) => {
              const e = this.players.get(layerId);
              if (!e || e.generation !== generation) {
                settle();
                return;
              }
              const errCode =
                errEvent && typeof errEvent.data === 'number'
                  ? errEvent.data
                  : -1;
              console.warn(
                `YouTube player error for layer ${layerId}: code ${errCode}`,
              );
              this.setStatus(layerId, 'error');
              this.errorCallback?.(layerId, errCode);
              settle();
            },
          },
        });
      } catch (err) {
        console.warn(`YouTube Player constructor failed for ${layerId}:`, err);
        this.setStatus(layerId, 'error');
        this.players.delete(layerId);
        document.getElementById(containerId)?.remove();
        this.errorCallback?.(layerId, -4);
        settle();
        return;
      }

      entry.player = player;
    });
  }

  private waitForReady(layerId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const e = this.players.get(layerId);
        if (!e) {
          resolve();
          return;
        }
        if (e.isReady || e.status === 'error' || e.status === 'blocked') {
          resolve();
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
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
      this.clearAutoplayProbe(entry);
      entry.generation += 1;
      if (entry.player) {
        try {
          entry.player.destroy();
        } catch (err) {
          console.warn(`Error destroying YT player for ${layerId}:`, err);
        }
      }
      this.players.delete(layerId);
      for (const cb of this.statusListeners) {
        try {
          cb(layerId, 'idle');
        } catch {
          /* */
        }
      }
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
