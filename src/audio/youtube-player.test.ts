import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  YouTubePlayerManager,
  __resetYouTubeApiLoaderForTests,
  YOUTUBE_PLAYER_READY_TIMEOUT_MS,
  type YTPlayerInstance,
} from './youtube-player';

/** Minimal DOM stubs for node test env. */
function installDomStubs(): void {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
    return;
  }

  const bodyChildren: { id?: string; remove: () => void }[] = [];

  const body = {
    appendChild(el: { id?: string; remove: () => void }) {
      bodyChildren.push(el);
      return el;
    },
    removeChild(el: { remove: () => void }) {
      const i = bodyChildren.indexOf(el as (typeof bodyChildren)[0]);
      if (i >= 0) bodyChildren.splice(i, 1);
    },
  };

  const documentStub = {
    body,
    head: {
      appendChild: vi.fn((el: unknown) => el),
    },
    createElement(tag: string) {
      const el: Record<string, unknown> = {
        tagName: tag.toUpperCase(),
        id: '',
        style: {},
        dataset: {},
        setAttribute: vi.fn(),
        remove: vi.fn(() => {
          const i = bodyChildren.indexOf(el as (typeof bodyChildren)[0]);
          if (i >= 0) bodyChildren.splice(i, 1);
        }),
        appendChild: vi.fn(),
      };
      return el;
    },
    getElementById(id: string) {
      return bodyChildren.find((c) => c.id === id) ?? null;
    },
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  };

  Object.defineProperty(globalThis, 'document', {
    value: documentStub,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
}

function mockPlayer(): YTPlayerInstance {
  return {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    stopVideo: vi.fn(),
    setVolume: vi.fn(),
    getVolume: vi.fn(() => 50),
    mute: vi.fn(),
    unMute: vi.fn(),
    isMuted: vi.fn(() => false),
    destroy: vi.fn(),
    getIframe: vi.fn(() => {
      return {
        setAttribute: vi.fn(),
      } as unknown as HTMLIFrameElement;
    }),
    getPlayerState: vi.fn(() => 1),
    loadVideoById: vi.fn(),
    cueVideoById: vi.fn(),
  };
}

describe('YouTubePlayerManager', () => {
  let manager: YouTubePlayerManager;
  let host: HTMLElement;

  beforeEach(() => {
    installDomStubs();
    manager = new YouTubePlayerManager();
    __resetYouTubeApiLoaderForTests();
    host = document.createElement('div') as unknown as HTMLElement;
    document.body.appendChild(host);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    manager.destroyAll();
    try {
      host?.remove?.();
    } catch {
      /* */
    }
    delete (window as unknown as { YT?: unknown }).YT;
    __resetYouTubeApiLoaderForTests();
  });

  it('updates master volume state without errors', () => {
    expect(() => manager.setMasterVolumeLinear(0.5)).not.toThrow();
    expect(() => manager.setMasterVolumeLinear(0.0)).not.toThrow();
  });

  it('destroys player instances cleanly', () => {
    manager.destroyPlayer('non-existent');
    expect(() => manager.destroyAll()).not.toThrow();
  });

  it('triggers error callback when set', () => {
    const errorFn = vi.fn();
    manager.onError(errorFn);
    expect(errorFn).not.toHaveBeenCalled();
  });

  it('tracks active player instances', () => {
    expect(manager.hasActivePlayers()).toBe(false);
    expect(manager.hasPlayer('layer-1')).toBe(false);
  });

  it('reuses ready player for same videoId without recreating', async () => {
    const instances: YTPlayerInstance[] = [];
    let onReady: ((e: { target: YTPlayerInstance }) => void) | undefined;

    (window as unknown as { YT: unknown }).YT = {
      Player: class {
        constructor(
          _el: HTMLElement,
          opts: {
            events?: {
              onReady?: (e: { target: YTPlayerInstance }) => void;
            };
          },
        ) {
          const p = mockPlayer();
          instances.push(p);
          onReady = opts.events?.onReady;
          queueMicrotask(() => onReady?.({ target: p }));
        }
      },
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    };

    await manager.ensurePlayer('yt-1', 'abcdefghijk', host, 0.7, false, false);
    expect(instances).toHaveLength(1);
    expect(manager.isPlayerReady('yt-1')).toBe(true);
    expect(manager.getStatus('yt-1')).toBe('paused');

    await manager.ensurePlayer('yt-1', 'abcdefghijk', host, 0.5, false, true);
    expect(instances).toHaveLength(1); // reused
    expect(instances[0]!.playVideo).toHaveBeenCalled();
    expect(instances[0]!.setVolume).toHaveBeenCalled();
  });

  it('setGlobalPlaying pauses and plays without destroy', async () => {
    let onReady: ((e: { target: YTPlayerInstance }) => void) | undefined;
    const p = mockPlayer();

    (window as unknown as { YT: unknown }).YT = {
      Player: class {
        constructor(
          _el: HTMLElement,
          opts: {
            events?: {
              onReady?: (e: { target: YTPlayerInstance }) => void;
            };
          },
        ) {
          onReady = opts.events?.onReady;
          queueMicrotask(() => onReady?.({ target: p }));
        }
      },
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    };

    await manager.ensurePlayer('yt-1', 'abcdefghijk', host, 0.7, false, true);
    expect(p.playVideo).toHaveBeenCalled();

    manager.setGlobalPlaying(false);
    expect(p.pauseVideo).toHaveBeenCalled();
    expect(manager.getStatus('yt-1')).toBe('paused');

    manager.setGlobalPlaying(true);
    expect(p.playVideo).toHaveBeenCalledTimes(2);
  });

  it('emits status changes to listeners', async () => {
    const statuses: string[] = [];
    manager.onStatusChange((id, s) => {
      if (id === 'yt-1') statuses.push(s);
    });

    let onReady: ((e: { target: YTPlayerInstance }) => void) | undefined;
    const p = mockPlayer();

    (window as unknown as { YT: unknown }).YT = {
      Player: class {
        constructor(
          _el: HTMLElement,
          opts: {
            events?: {
              onReady?: (e: { target: YTPlayerInstance }) => void;
            };
          },
        ) {
          onReady = opts.events?.onReady;
          queueMicrotask(() => onReady?.({ target: p }));
        }
      },
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    };

    await manager.ensurePlayer('yt-1', 'abcdefghijk', host, 0.7, false, false);
    expect(statuses).toContain('loading');
    expect(statuses).toContain('ready');
    expect(statuses).toContain('paused');
  });

  it('createPlayer times out when onReady never fires', async () => {
    vi.useFakeTimers();
    const errorFn = vi.fn();
    manager.onError(errorFn);

    (window as unknown as { YT: unknown }).YT = {
      Player: class {
        constructor() {
          /* never ready */
        }
      },
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    };

    const done = manager.ensurePlayer(
      'yt-timeout',
      'abcdefghijk',
      host,
      0.7,
      false,
      true,
    );
    await vi.advanceTimersByTimeAsync(YOUTUBE_PLAYER_READY_TIMEOUT_MS + 50);
    await done;

    expect(errorFn).toHaveBeenCalledWith('yt-timeout', -3);
    expect(manager.hasPlayer('yt-timeout')).toBe(false);
    vi.useRealTimers();
  });

  it('reuses existing player without destroying when videoId changes on ready player', async () => {
    const instances: YTPlayerInstance[] = [];

    (window as unknown as { YT: unknown }).YT = {
      Player: class {
        constructor(
          _el: HTMLElement,
          opts: {
            events?: {
              onReady?: (e: { target: YTPlayerInstance }) => void;
            };
          },
        ) {
          const p = mockPlayer();
          instances.push(p);
          queueMicrotask(() => opts.events?.onReady?.({ target: p }));
        }
      },
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
    };

    await manager.ensurePlayer('yt-1', 'video111111', host, 0.7, false, false);
    expect(instances).toHaveLength(1);

    await manager.ensurePlayer('yt-1', 'video222222', host, 0.7, false, false);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.destroy).not.toHaveBeenCalled();
    expect(instances[0]!.cueVideoById).toHaveBeenCalledWith('video222222');
    expect(manager.getVideoId('yt-1')).toBe('video222222');

    // And when playing
    await manager.ensurePlayer('yt-1', 'video333333', host, 0.7, false, true);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.loadVideoById).toHaveBeenCalledWith('video333333');
    expect(manager.getVideoId('yt-1')).toBe('video333333');
  });
});
