import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_ONE_SHOT_CONFIG,
  loadOneShotConfigFromStorage,
  ONE_SHOT_PACKS,
  ONE_SHOT_STORAGE_KEY,
  saveOneShotConfigToStorage,
  type OneShotConfig,
} from '../app/one-shot';
import {
  calculateNextDelayMs,
  DENSITY_RANGES,
  OneShotEngine,
} from './one-shot-engine';

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
      selectedPacks: ['storm', 'forest'],
      volumeLinear: 0.85,
      spatialPan: false,
      pitchJitter: true,
      distanceFilter: false,
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
    expect(ONE_SHOT_PACKS.length).toBeGreaterThanOrEqual(4);
    const stormPack = ONE_SHOT_PACKS.find((p) => p.id === 'storm');
    expect(stormPack).toBeDefined();
    expect(stormPack?.assetIds).toContain('thunder_distant');
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

  it('updates configuration dynamically', () => {
    const engine = new OneShotEngine({ ...DEFAULT_ONE_SHOT_CONFIG });
    expect(engine.getConfig().enabled).toBe(false);

    engine.setConfig({ ...DEFAULT_ONE_SHOT_CONFIG, enabled: true, density: 'lively' });
    expect(engine.getConfig().enabled).toBe(true);
    expect(engine.getConfig().density).toBe('lively');
  });
});
