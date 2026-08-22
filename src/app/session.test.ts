import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Session } from './session';
import { DUPLICATE_MIN_OFFSET_DEFAULT_SEC } from '../audio/dsp/loop';

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

describe('Session transport pause/play state', () => {
  it('togglePlay flips playing and is safe when already false', async () => {
    const session = new Session();
    session.layers = [
      {
        kind: 'noise',
        params: {
          id: 'n1',
          type: 'pink',
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

    // pause path (uses real engine suspend — must not throw)
    await session.pause();
    expect(session.playing).toBe(false);

    await session.pause();
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
    vi.spyOn(emptySession as any, 'ensureCatalogReady').mockImplementation(async () => {});

    await emptySession.surpriseMe();
    expect(emptySession.loadNotice).toBe('Catalog not ready — try again in a moment.');
  });

  it('builds a multi-layer surprise mix from available catalog items', async () => {
    vi.spyOn(session as any, 'ensureCatalogReady').mockImplementation(async () => {});

    await session.surpriseMe();

    expect(session.layers.length).toBeGreaterThanOrEqual(2);
    expect(session.loadNotice).toMatch(/^Surprise mix:/);
  });
});

describe('Session setLayerSpatial physics model', () => {
  it('applies air absorption filter roll-off when coupleFilter is enabled', () => {
    const session = new Session();
    session.addNoiseLayer('rain');
    const layerId = session.layers[0].params.id;

    // Near field (vol = 1.0) -> high cutoff (14,000 Hz)
    session.setLayerSpatial(layerId, 0.5, 1.0, { coupleFilter: true });
    expect(session.layers[0].params.pan).toBe(0.5);
    expect(session.layers[0].params.volumeLinear).toBe(1.0);
    expect(session.layers[0].params.lowpassHz).toBe(14000);

    // Mid field (vol = 0.5) -> distance factor 0.5 -> ~7,600 Hz
    session.setLayerSpatial(layerId, -0.2, 0.5, { coupleFilter: true });
    expect(session.layers[0].params.pan).toBe(-0.2);
    expect(session.layers[0].params.volumeLinear).toBe(0.5);
    expect(session.layers[0].params.lowpassHz).toBe(7600);

    // Far field (vol = 0.0) -> air absorbed (~1,200 Hz)
    session.setLayerSpatial(layerId, 0, 0, { coupleFilter: true });
    expect(session.layers[0].params.volumeLinear).toBe(0);
    expect(session.layers[0].params.lowpassHz).toBe(1200);
  });

  it('locks pan to 0 for youtube streaming layers', async () => {
    const session = new Session();
    await session.addYoutubeLayer('abc12345678', 'https://www.youtube.com/watch?v=abc12345678', 'Test YT Video', '');
    const ytLayerId = session.layers.find((l) => l.kind === 'youtube')?.params.id;
    expect(ytLayerId).toBeDefined();

    session.setLayerSpatial(ytLayerId!, 0.8, 0.6);
    const updated = session.layers.find((l) => l.kind === 'youtube');
    expect(updated?.params.pan).toBe(0);
    expect(updated?.params.volumeLinear).toBe(0.6);
  });
});

describe('Session duplicate layer & max same layer caps', () => {
  it('duplicates noise layer up to 5 same instances, and blocks 6th attempt with notice', async () => {
    const session = new Session();
    session.layers = [];
    await session.addNoiseLayer('pink');
    expect(session.layers.length).toBe(1);

    const initialId = session.layers[0].params.id;
    for (let i = 0; i < 4; i++) {
      const newId = await session.duplicateLayer(initialId);
      expect(newId).toBeTruthy();
    }
    expect(session.layers.length).toBe(5);

    // 6th instance attempt via duplicateLayer should fail
    const blockedId = await session.duplicateLayer(initialId);
    expect(blockedId).toBe('');
    expect(session.layers.length).toBe(5);
    expect(session.loadNotice).toBe('Maximum 5 layers of the same sound allowed.');

    // 6th instance attempt via addNoiseLayer should also fail
    await session.addNoiseLayer('pink');
    expect(session.layers.length).toBe(5);
    expect(session.loadNotice).toBe('Maximum 5 layers of the same sound allowed.');
  });

  it('allows adding different noise colors up to 5 each', async () => {
    const session = new Session();
    session.layers = [];
    await session.addNoiseLayer('pink');
    await session.addNoiseLayer('white');

    expect(session.getSameLayerCount(session.layers[0])).toBe(1);
    expect(session.getSameLayerCount(session.layers[1])).toBe(1);
  });

  it('enforces total mixer cap (10 layers) during duplication', async () => {
    const session = new Session();
    session.layers = [];
    for (let i = 0; i < 5; i++) {
      await session.addNoiseLayer('pink');
    }
    for (let i = 0; i < 5; i++) {
      await session.addNoiseLayer('white');
    }
    expect(session.layers.length).toBe(10);

    const idToDup = session.layers[0].params.id;
    const dupResult = await session.duplicateLayer(idToDup);
    expect(dupResult).toBe('');
    expect(session.loadNotice).toContain('Layer limit reached (10)');
  });

  it('disallows YouTube layer duplication and duplicate stream addition', async () => {
    const session = new Session();
    session.layers = [];
    const yt1 = await session.addYoutubeLayer('v1', 'https://youtube.com/watch?v=v1', 'Stream 1', '');
    expect(yt1).toBeTruthy();

    // Attempting to duplicate YouTube layer should be blocked
    const dupYt = await session.duplicateLayer(yt1);
    expect(dupYt).toBe('');
    expect(session.layers.length).toBe(1);
    expect(session.loadNotice).toBe('YouTube streams cannot be duplicated.');

    // Attempting to add the exact same YouTube stream (same videoId) should be blocked
    const sameYt = await session.addYoutubeLayer('v1', 'https://youtube.com/watch?v=v1', 'Stream 1 copy', '');
    expect(sameYt).toBe('');
    expect(session.layers.length).toBe(1);
    expect(session.loadNotice).toBe('This YouTube stream is already in your mix.');

    // Adding distinct YouTube channels up to cap (3) should succeed
    const yt2 = await session.addYoutubeLayer('v2', 'https://youtube.com/watch?v=v2', 'Stream 2', '');
    const yt3 = await session.addYoutubeLayer('v3', 'https://youtube.com/watch?v=v3', 'Stream 3', '');
    expect(yt2).toBeTruthy();
    expect(yt3).toBeTruthy();
    expect(session.layers.length).toBe(3);

    // 4th YouTube channel should fail cap limit
    const yt4 = await session.addYoutubeLayer('v4', 'https://youtube.com/watch?v=v4', 'Stream 4', '');
    expect(yt4).toBe('');
    expect(session.layers.length).toBe(3);
    expect(session.loadNotice).toBe('Maximum 3 YouTube channels allowed.');
  });
});

describe('Session mix settings defaults', () => {
  it('resets master tone, drift settings, and duplicate min offset to default values', () => {
    const session = new Session();
    session.setMasterTone({ bassDb: 6, trebleDb: -4, reverbWet: 0.3 });
    session.setDriftConfig({
      enabled: false,
      pitchDepthPct: 4,
      panSpread: 0.8,
      gainDepthDb: 5,
      speed: 'fast',
    });
    session.setDuplicateMinOffsetSec(12);

    expect(session.masterTone.bassDb).toBe(6);
    expect(session.masterTone.trebleDb).toBe(-4);
    expect(session.masterTone.reverbWet).toBe(0.3);
    expect(session.driftConfig.enabled).toBe(false);
    expect(session.driftConfig.pitchDepthPct).toBe(4);
    expect(session.driftConfig.panSpread).toBe(0.8);
    expect(session.driftConfig.gainDepthDb).toBe(5);
    expect(session.driftConfig.speed).toBe('fast');
    expect(session.duplicateMinOffsetSec).toBe(12);

    session.resetMixSettingsDefaults();

    expect(session.masterTone.bassDb).toBe(0);
    expect(session.masterTone.trebleDb).toBe(0);
    expect(session.masterTone.reverbWet).toBe(0);
    expect(session.driftConfig.enabled).toBe(true);
    expect(session.driftConfig.pitchDepthPct).toBe(3.5);
    expect(session.driftConfig.panSpread).toBe(0.25);
    expect(session.driftConfig.gainDepthDb).toBe(2.5);
    expect(session.driftConfig.speed).toBe('normal');
    expect(session.duplicateMinOffsetSec).toBe(DUPLICATE_MIN_OFFSET_DEFAULT_SEC);
  });

  it('captures and applies driftConfig in scene snapshots and presets', () => {
    const session = new Session();
    session.setDriftConfig({
      enabled: true,
      pitchDepthPct: 5.5,
      panSpread: 0.75,
      gainDepthDb: 4.2,
      speed: 'slow',
    });

    const snapshot = session.captureSceneSnapshot('Drift test');
    expect(snapshot.master.drift).toBeDefined();
    expect(snapshot.master.drift?.pitchDepthPct).toBe(5.5);
    expect(snapshot.master.drift?.panSpread).toBe(0.75);
    expect(snapshot.master.drift?.gainDepthDb).toBe(4.2);
    expect(snapshot.master.drift?.speed).toBe('slow');

    session.resetMixSettingsDefaults();
    expect(session.driftConfig.pitchDepthPct).toBe(3.5);

    // Apply snapshot data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).applyPresetData(snapshot);
    expect(session.driftConfig.pitchDepthPct).toBe(5.5);
    expect(session.driftConfig.panSpread).toBe(0.75);
    expect(session.driftConfig.gainDepthDb).toBe(4.2);
    expect(session.driftConfig.speed).toBe('slow');
  });

  it('schedules single wakeup timeouts when timer is started', async () => {
    const session = new Session();
    session.layers = [
      {
        kind: 'noise',
        params: {
          id: 'n1',
          type: 'pink',
          volumeLinear: 0.5,
          stereoWidth: 1,
          pan: 0,
          muted: false,
          solo: false,
        },
      },
    ];
    session.playing = true;

    await session.startTimer(60, 10);
    expect(session.timer.status).toBe('running');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any).fadeWakeupTimer).not.toBeNull();

    session.cancelTimer();
    expect(session.timer.status).toBe('idle');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any).fadeWakeupTimer).toBeNull();
  });

  describe('Session getLayerLiveDrift', () => {
    it('returns null for non-existent layer', () => {
      const session = new Session();
      expect(session.getLayerLiveDrift('invalid_id')).toBeNull();
    });

    it('returns zero deltas and base parameters when session is idle', () => {
      const session = new Session();
      session.layers = [
        {
          kind: 'sample',
          params: {
            id: 's1',
            assetId: 'rain',
            label: 'Rain',
            volumeLinear: 0.8,
            pan: -0.4,
            driftPan: true,
            driftGain: true,
            driftPitch: true,
            muted: false,
            solo: false,
          },
        },
      ];

      const drift = session.getLayerLiveDrift('s1');
      expect(drift).not.toBeNull();
      expect(drift?.livePan).toBe(-0.4);
      expect(drift?.liveVol).toBe(0.8);
      expect(drift?.panDelta).toBe(0);
      expect(drift?.gainDbDelta).toBe(0);
      expect(drift?.pitchPercentDelta).toBe(0);
      expect(drift?.driftPanActive).toBe(true);
      expect(drift?.driftGainActive).toBe(true);
      expect(drift?.driftPitchActive).toBe(true);
    });

    it('forces livePan to 0 for YouTube layers', () => {
      const session = new Session();
      session.layers = [
        {
          kind: 'youtube',
          params: {
            id: 'yt1',
            videoId: 'jfKfPfyJRdk',
            url: 'https://youtube.com/watch?v=jfKfPfyJRdk',
            label: 'Lofi',
            volumeLinear: 0.65,
            pan: 0.5,
            driftGain: true,
            driftPan: false,
            driftPitch: false,
            muted: false,
            solo: false,
          },
        },
      ];

      const drift = session.getLayerLiveDrift('yt1');
      expect(drift).not.toBeNull();
      expect(drift?.livePan).toBe(0);
      expect(drift?.basePan).toBe(0);
      expect(drift?.liveVol).toBe(0.65);
    });
  });
});
