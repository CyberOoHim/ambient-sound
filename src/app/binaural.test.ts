import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_BINAURAL_CONFIG,
  BINAURAL_STORAGE_KEY,
  BRAINWAVE_PRESETS,
  loadBinauralConfigFromStorage,
  saveBinauralConfigToStorage,
  type BinauralConfig,
} from './binaural';

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

describe('Binaural Configuration & LocalStorage', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage();
  });

  it('returns default config when LocalStorage is empty', () => {
    const config = loadBinauralConfigFromStorage();
    expect(config).toEqual(DEFAULT_BINAURAL_CONFIG);
  });

  it('saves and loads valid configuration from LocalStorage', () => {
    const customConfig: BinauralConfig = {
      enabled: true,
      mode: 'isochronic',
      preset: 'theta',
      carrierFreq: 220,
      beatFreq: 6.0,
      volumeLinear: 0.8,
      waveform: 'triangle',
    };
    saveBinauralConfigToStorage(customConfig);
    const loaded = loadBinauralConfigFromStorage();
    expect(loaded).toEqual(customConfig);
  });

  it('clamps frequency and volume values out of range', () => {
    localStorage.setItem(
      BINAURAL_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        carrierFreq: 2000, // too high, max 1000
        beatFreq: 0.1, // too low, min 0.5
        volumeLinear: 1.5, // max 1
      }),
    );
    const loaded = loadBinauralConfigFromStorage();
    expect(loaded.carrierFreq).toBe(1000);
    expect(loaded.beatFreq).toBe(0.5);
    expect(loaded.volumeLinear).toBe(1.0);
  });

  it('falls back to defaults for invalid enum values or corrupt JSON', () => {
    localStorage.setItem(
      BINAURAL_STORAGE_KEY,
      JSON.stringify({
        mode: 'invalid-mode',
        preset: 'nonexistent-preset',
        waveform: 'square',
      }),
    );
    const loaded = loadBinauralConfigFromStorage();
    expect(loaded.mode).toBe('binaural');
    expect(loaded.preset).toBe('alpha');
    expect(loaded.waveform).toBe('sine');

    localStorage.setItem(BINAURAL_STORAGE_KEY, 'corrupt-json{');
    const corruptLoaded = loadBinauralConfigFromStorage();
    expect(corruptLoaded).toEqual(DEFAULT_BINAURAL_CONFIG);
  });

  it('contains correct preset mappings', () => {
    expect(BRAINWAVE_PRESETS.delta.beatFreq).toBe(2.5);
    expect(BRAINWAVE_PRESETS.theta.beatFreq).toBe(6.0);
    expect(BRAINWAVE_PRESETS.alpha.beatFreq).toBe(10.0);
    expect(BRAINWAVE_PRESETS.beta.beatFreq).toBe(20.0);
    expect(BRAINWAVE_PRESETS.gamma.beatFreq).toBe(40.0);
  });
});
