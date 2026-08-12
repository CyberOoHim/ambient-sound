import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  DEFAULT_ONE_SHOT_CONFIG,
  loadOneShotConfigFromStorage,
  loadCustomOneShotPacksFromStorage,
  saveCustomOneShotPacksToStorage,
  getAllOneShotPacks,
  ONE_SHOT_PACKS,
  ONE_SHOT_STORAGE_KEY,
  CUSTOM_ONE_SHOT_PACKS_STORAGE_KEY,
  saveOneShotConfigToStorage,
  type OneShotConfig,
  type CustomOneShotPack,
} from '../app/one-shot';
import {
  calculateNextDelayMs,
  DENSITY_RANGES,
  OneShotEngine,
} from './one-shot-engine';
import { Session } from '../app/session';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('One-Shot Configuration & LocalStorage', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage();
  });

  it('loads default configuration when localStorage is empty', () => {
    const config = loadOneShotConfigFromStorage();
    expect(config).toEqual(DEFAULT_ONE_SHOT_CONFIG);
  });

  it('saves and loads configuration to/from localStorage', () => {
    const customConfig: OneShotConfig = {
      enabled: true,
      density: 'lively',
      customIntervalMs: 45_000,
      selectedPacks: ['storm', 'forest'],
      selectedAssets: ['thunder_distant', 'birds_morning'],
      volumeLinear: 0.85,
      spatialPan: false,
      pitchJitter: true,
      distanceFilter: false,
      burstSequence: true,
      acousticTail: false,
      earlyReflections: true,
      dopplerShift: true,
    };

    saveOneShotConfigToStorage(customConfig);
    const loaded = loadOneShotConfigFromStorage();

    expect(loaded).toEqual(customConfig);
    expect(localStorage.getItem(ONE_SHOT_STORAGE_KEY)).toContain('"density":"lively"');
  });

  it('falls back to default values for invalid JSON or corrupt attributes', () => {
    localStorage.setItem(ONE_SHOT_STORAGE_KEY, 'invalid-json{');
    const loaded = loadOneShotConfigFromStorage();
    expect(loaded).toEqual(DEFAULT_ONE_SHOT_CONFIG);

    localStorage.setItem(
      ONE_SHOT_STORAGE_KEY,
      JSON.stringify({ density: 'invalid-density', volumeLinear: 5 }),
    );
    const sanitized = loadOneShotConfigFromStorage();
    expect(sanitized.density).toBe('balanced');
    expect(sanitized.volumeLinear).toBe(1);
  });

  it('contains valid default sound packs', () => {
    expect(ONE_SHOT_PACKS.length).toBe(8);
    const stormPack = ONE_SHOT_PACKS.find((p) => p.id === 'storm');
    expect(stormPack).toBeDefined();
    expect(stormPack?.assetIds).toContain('thunder_distant');

    const urbanPack = ONE_SHOT_PACKS.find((p) => p.id === 'urban');
    expect(urbanPack).toBeDefined();
    expect(urbanPack?.assetIds).toContain('event_cup_clink');

    const wildlifePack = ONE_SHOT_PACKS.find((p) => p.id === 'wildlife');
    expect(wildlifePack).toBeDefined();
    expect(wildlifePack?.assetIds).toContain('event_cricket_chirp');
  });
});

describe('Custom One-Shot Sound Packs & Pack Manager', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage();
  });

  it('saves and loads custom packs from localStorage', () => {
    const packs: CustomOneShotPack[] = [
      {
        id: 'custom-night',
        label: 'Night Canopy',
        icon: '🦉',
        description: 'Owls and cave drips',
        assetIds: ['owls_forest', 'cave_drips'],
        isCustom: true,
      },
    ];

    saveCustomOneShotPacksToStorage(packs);
    const loaded = loadCustomOneShotPacksFromStorage();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].label).toBe('Night Canopy');
    expect(loaded[0].isCustom).toBe(true);
  });

  it('merges built-in packs with custom packs', () => {
    const customPack: CustomOneShotPack = {
      id: 'custom-ocean',
      label: 'Ocean Waves',
      icon: '🌊',
      description: 'Surf and seagulls',
      assetIds: ['seagulls_surf'],
      isCustom: true,
    };
    const all = getAllOneShotPacks([customPack]);
    expect(all).toHaveLength(ONE_SHOT_PACKS.length + 1);
    expect(all.some((p) => p.id === 'custom-ocean')).toBe(true);
  });

  it('manages custom packs via Session (create, rename, updateAssets, delete)', () => {
    const session = new Session();
    const created = session.createCustomOneShotPack(
      'Deep Forest',
      '🌲',
      'Quiet woodland sounds',
      ['wind_trees', 'leaves_rustle']
    );

    expect(created.label).toBe('Deep Forest');
    expect(session.customOneShotPacks).toHaveLength(1);
    expect(session.oneShotConfig.selectedPacks).toContain(created.id);

    // Rename
    session.renameCustomOneShotPack(created.id, 'Enchanted Forest');
    expect(session.customOneShotPacks[0].label).toBe('Enchanted Forest');

    // Update assets
    session.updateCustomOneShotPackAssets(created.id, ['birds_morning']);
    expect(session.customOneShotPacks[0].assetIds).toEqual(['birds_morning']);

    // Delete
    session.deleteCustomOneShotPack(created.id);
    expect(session.customOneShotPacks).toHaveLength(0);
    expect(session.oneShotConfig.selectedPacks).not.toContain(created.id);
  });
});

describe('One-Shot Engine Stochastic Scheduler', () => {
  it('calculates bounded delay ranges for all density settings', () => {
    const densities = ['subtle', 'balanced', 'lively'] as const;

    for (const density of densities) {
      const range = DENSITY_RANGES[density];
      for (let i = 0; i < 50; i++) {
        const delay = calculateNextDelayMs(density);
        expect(delay).toBeGreaterThanOrEqual(range.minMs);
        expect(delay).toBeLessThanOrEqual(range.maxMs);
      }
    }
  });

  it('calculates bounded custom Poisson delay ranges when custom density is active', () => {
    const customMs = 30_000;
    for (let i = 0; i < 50; i++) {
      const delay = calculateNextDelayMs('custom', customMs);
      expect(delay).toBeGreaterThanOrEqual(12_000); // min 40% of mean
      expect(delay).toBeLessThanOrEqual(66_000);   // max 220% of mean
    }
  });

  it('updates configuration dynamically and tracks event history', () => {
    const engine = new OneShotEngine({ ...DEFAULT_ONE_SHOT_CONFIG });
    expect(engine.getConfig().enabled).toBe(false);
    expect(engine.getEventHistory()).toEqual([]);

    engine.setConfig({
      ...DEFAULT_ONE_SHOT_CONFIG,
      enabled: true,
      density: 'custom',
      customIntervalMs: 15_000,
      burstSequence: true,
      acousticTail: true,
    });
    expect(engine.getConfig().enabled).toBe(true);
    expect(engine.getConfig().density).toBe('custom');
    expect(engine.getConfig().customIntervalMs).toBe(15_000);
    expect(engine.getConfig().burstSequence).toBe(true);
    expect(engine.getConfig().acousticTail).toBe(true);
  });

  it('triggers random event with unified physical distance model, Doppler motion, Haas delay, and shared reverb', async () => {
    const engine = new OneShotEngine({
      ...DEFAULT_ONE_SHOT_CONFIG,
      enabled: true,
      pitchJitter: true,
      spatialPan: true,
      distanceFilter: true,
      acousticTail: true,
    });

    const mockGain = {
      gain: {
        value: 1,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        cancelScheduledValues: () => {},
      },
      connect: () => {},
      disconnect: () => {},
    };

    const mockBuffer = {
      duration: 10,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(44100),
    } as unknown as AudioBuffer;

    const mockCtx = {
      currentTime: 10,
      sampleRate: 44100,
      createGain: () => ({ ...mockGain }),
      createBufferSource: () => ({
        playbackRate: {
          value: 1,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
        },
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: { value: 14000 },
        Q: { value: 0.7 },
        connect: () => {},
      }),
      createStereoPanner: () => ({
        pan: {
          value: 0,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
        },
        connect: () => {},
      }),
      createConvolver: () => ({
        buffer: null,
        context: null,
        connect: () => {},
        disconnect: () => {},
      }),
      createDelay: () => ({
        delayTime: { value: 0 },
        connect: () => {},
        disconnect: () => {},
      }),
      createBuffer: () => mockBuffer,
    } as unknown as AudioContext;

    const mockCatalog = {
      version: 1,
      packId: 'test',
      title: 'Test Catalog',
      assets: [
        {
          id: 'event_bird_chirp',
          title: 'Bird Chirp',
          category: 'birds',
          file: 'events/bird.ogg',
          loop: { mode: 'native' },
          license: { spdx: 'CC0-1.0', author: 'test' },
        },
      ],
    } as unknown as import('../assets/catalog').SoundCatalog;

    engine.setAudioTarget(mockCtx, mockGain as unknown as AudioNode, mockCatalog);

    // Mock decode cache to return our mockBuffer
    const { decodeCache } = await import('./decode-cache');
    const getSpy = vi.spyOn(decodeCache, 'get').mockResolvedValue(mockBuffer);

    const event = await engine.triggerRandomEvent('event_bird_chirp');
    expect(event).not.toBeNull();
    if (event) {
      expect(event.assetId).toBe('event_bird_chirp');
      expect(event.pitch).toBeGreaterThanOrEqual(0.92);
      expect(event.pitch).toBeLessThanOrEqual(1.08);
      expect(event.pan).toBeGreaterThanOrEqual(-1.0);
      expect(event.pan).toBeLessThanOrEqual(1.0);
      expect(event.distanceFilterCutoff).toBeGreaterThanOrEqual(1200);
      expect(event.distanceFilterCutoff).toBeLessThanOrEqual(14000);
    }

    getSpy.mockRestore();
  });
});


