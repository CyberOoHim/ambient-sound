import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Session } from './session';

describe('Session empty mix layer behavior', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session();
    session.layers = [
      {
        kind: 'noise',
        params: {
          id: 'l1',
          type: 'pink',
          volumeLinear: 0.8,
          stereoWidth: 1,
          pan: 0,
          muted: false,
          solo: false,
          lowpassHz: 20000,
          highpassHz: 20,
          panLfoEnabled: false,
          panLfoRateHz: 0.08,
          panLfoDepth: 0.35,
        },
      },
    ];
    session.playing = true;
  });

  it('stops playback and updates playing state to false when the last layer is removed', () => {
    expect(session.playing).toBe(true);
    expect(session.layers.length).toBe(1);

    session.removeLayer('l1');

    expect(session.layers.length).toBe(0);
    expect(session.playing).toBe(false);
  });

  it('stops playback and updates playing state to false when clearAllLayers is called', () => {
    expect(session.playing).toBe(true);

    session.clearAllLayers();

    expect(session.layers.length).toBe(0);
    expect(session.playing).toBe(false);
  });

  it('does not allow playing when layer list is empty', async () => {
    session.clearAllLayers();
    expect(session.playing).toBe(false);

    await session.play();

    expect(session.playing).toBe(false);
  });
});

describe('Session sample download / loading UI state', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session();
    session.layers = [
      {
        kind: 'sample',
        params: {
          id: 's1',
          assetId: 'rain_light',
          label: 'Light rain',
          volumeLinear: 0.7,
          muted: false,
          solo: false,
          pan: 0,
          loopMode: 'crossfade',
          crossfadeMs: 80,
          playbackRate: 1,
          lowpassHz: 20000,
          highpassHz: 20,
          panLfoEnabled: false,
          panLfoRateHz: 0.08,
          panLfoDepth: 0.35,
        },
      },
    ];
    session.playing = true;
    session.loadingLayerIds = new Set(['s1']);
  });

  it('clears loading state when the layer is removed mid-download', () => {
    expect(session.isLayerLoading('s1')).toBe(true);

    session.removeLayer('s1');

    expect(session.isLayerLoading('s1')).toBe(false);
    expect(session.isAnyLayerLoading()).toBe(false);
    expect(session.layers.length).toBe(0);
    expect(session.playing).toBe(false);
  });

  it('clears all loading state when the mix is cleared mid-download', () => {
    session.loadingLayerIds.add('s2');
    session.loadingProgress.set('s2', { ratio: 0.4, determinate: true });
    expect(session.isAnyLayerLoading()).toBe(true);

    session.clearAllLayers();

    expect(session.loadingLayerIds.size).toBe(0);
    expect(session.loadingProgress.size).toBe(0);
    expect(session.layers.length).toBe(0);
    expect(session.playing).toBe(false);
  });

  it('clears progress when a loading layer is removed', () => {
    session.loadingProgress.set('s1', { ratio: 0.55, determinate: true });
    session.removeLayer('s1');
    expect(session.loadingProgress.has('s1')).toBe(false);
    expect(session.isLayerLoading('s1')).toBe(false);
  });

  it('needsSampleFetch is true when the asset is not in the decode cache', async () => {
    const { decodeCache } = await import('../audio/decode-cache');
    const { assetUrl } = await import('../assets/catalog');
    const asset = {
      id: 'unique_uncached_asset',
      title: 'Test',
      category: 'test',
      file: 'core/definitely_not_cached_xyz.ogg',
      loop: { mode: 'crossfade' as const, crossfadeMs: 80 },
      license: { spdx: 'CC0-1.0', author: 'test' },
    };
    expect(decodeCache.has(assetUrl(asset.file))).toBe(false);
    expect(session.needsSampleFetch(asset)).toBe(true);
  });

  it('clearLoadNotice dismisses the user-facing download failure message', () => {
    session.loadNotice = 'Could not load “Rain”. Layer removed from the mix.';
    session.clearLoadNotice();
    expect(session.loadNotice).toBeNull();
  });
});

describe('Session timer countdown and fade state', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session();
    session.layers = [
      {
        kind: 'noise',
        params: {
          id: 'l1',
          type: 'white',
          volumeLinear: 0.5,
          stereoWidth: 1,
          pan: 0,
          muted: false,
          solo: false,
          lowpassHz: 20000,
          highpassHz: 20,
          panLfoEnabled: false,
          panLfoRateHz: 0.08,
          panLfoDepth: 0.35,
        },
      },
    ];
    session.playing = true;
  });

  it('sets timer parameters and calculates remainingMs', () => {
    session.setTimerDefaults(60, 15);
    session.timer = {
      status: 'running',
      endAtMs: Date.now() + 60_000,
      durationSec: 60,
      fadeSec: 15,
    };
    expect(session.timer.status).toBe('running');
    expect(session.timer.durationSec).toBe(60);
    expect(session.timer.fadeSec).toBe(15);
    expect(session.remainingMs()).toBeGreaterThan(0);
  });

  it('transitions timer status to fading when remaining time is within fadeSec window', async () => {
    const { audioEngine } = await import('../audio/engine');
    const spy = vi.spyOn(audioEngine, 'startFadeOut').mockResolvedValue(false);

    session.timer = {
      status: 'running',
      endAtMs: Date.now() + 10_000,
      durationSec: 60,
      fadeSec: 15,
    };

    try {
      await session.tickTimer();
      expect(session.timer.status).toBe('fading');
    } finally {
      spy.mockRestore();
    }
  });

  it('cancels timer and resets status and endAtMs', () => {
    session.timer = {
      status: 'running',
      endAtMs: Date.now() + 60_000,
      durationSec: 60,
      fadeSec: 15,
    };
    expect(session.timer.status).toBe('running');

    session.cancelTimer();
    expect(session.timer.status).toBe('idle');
    expect(session.timer.endAtMs).toBeNull();
    expect(session.remainingMs()).toBeNull();
  });
});

describe('Session binaural configuration state', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session();
  });

  it('updates binaural config and notifies listeners', () => {
    const listener = vi.fn();
    session.subscribe(listener);

    session.updateBinauralConfig({
      enabled: true,
      mode: 'isochronic',
      preset: 'theta',
      carrierFreq: 220,
      beatFreq: 6,
    });

    expect(session.binauralConfig.enabled).toBe(true);
    expect(session.binauralConfig.mode).toBe('isochronic');
    expect(session.binauralConfig.preset).toBe('theta');
    expect(session.binauralConfig.carrierFreq).toBe(220);
    expect(session.binauralConfig.beatFreq).toBe(6);
    expect(listener).toHaveBeenCalled();
  });
});

describe('Session surpriseMe behavior', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session();
    session.catalog = {
      version: 1,
      packId: 'core-test',
      title: 'Test Catalog',
      assets: [
        {
          id: 'cafe_murmur',
          title: 'Cafe murmur',
          category: 'indoor',
          file: 'core/cafe_murmur.ogg',
          loop: { mode: 'crossfade', crossfadeMs: 100 },
          license: { spdx: 'CC0-1.0', author: 'test' },
        },
        {
          id: 'rain_window',
          title: 'Rain on window',
          category: 'rain',
          file: 'core/rain_window.ogg',
          loop: { mode: 'crossfade', crossfadeMs: 100 },
          license: { spdx: 'CC0-1.0', author: 'test' },
        },
        {
          id: 'ac_room',
          title: 'Air conditioner hum',
          category: 'indoor',
          file: 'core/ac_room.ogg',
          loop: { mode: 'crossfade', crossfadeMs: 100 },
          license: { spdx: 'CC0-1.0', author: 'test' },
        },
        {
          id: 'city_soft',
          title: 'Soft city evening',
          category: 'urban',
          file: 'core/city_soft.ogg',
          loop: { mode: 'crossfade', crossfadeMs: 100 },
          license: { spdx: 'CC0-1.0', author: 'test' },
        },
      ],
    };
  });

  it('sets notice when catalog is not ready', async () => {
    const emptySession = new Session();
    emptySession.catalog = null;
    vi.spyOn(emptySession, 'ensureCatalogReady').mockImplementation(async () => {});

    await emptySession.surpriseMe();
    expect(emptySession.loadNotice).toBe('Catalog not ready — try again in a moment.');
  });

  it('builds a multi-layer surprise mix from available catalog items', async () => {
    vi.spyOn(session, 'ensureCatalogReady').mockImplementation(async () => {});

    await session.surpriseMe();

    expect(session.layers.length).toBeGreaterThanOrEqual(2);
    expect(session.loadNotice).toMatch(/^Surprise mix:/);
  });

  it('disables binaural and one-shot by default unless explicitly included', async () => {
    vi.spyOn(session, 'ensureCatalogReady').mockImplementation(async () => {});
    session.binauralConfig.enabled = true;
    session.oneShotConfig.enabled = true;

    await session.surpriseMe();

    expect(session.binauralConfig.enabled).toBe(false);
    expect(session.oneShotConfig.enabled).toBe(false);
  });
});


