import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_MIN_OFFSET_DEFAULT_SEC,
  DUPLICATE_MIN_OFFSET_MIN_SEC,
} from '../audio/dsp/loop';
import {
  deletePreset,
  DUPLICATE_MIN_OFFSET_KEY,
  loadDuplicateMinOffsetSec,
  parsePreset,
  parsePresetStore,
  saveDuplicateMinOffsetSec,
  snapshotFromSession,
  upsertPreset,
  type PresetV1,
} from './presets';

function memoryStorage(): Storage {
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

const sample: PresetV1 = {
  version: 1,
  id: 'p1',
  name: 'Focus',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  master: { volumeLinear: 0.8 },
  layers: [
    {
      kind: 'noise',
      params: {
        id: 'n1',
        type: 'pink',
        volumeLinear: 0.5,
        muted: false,
        solo: false,
        stereoWidth: 1,
        pan: 0,
      },
    },
    {
      kind: 'sample',
      params: {
        id: 's1',
        assetId: 'rain_light',
        label: 'Light rain',
        volumeLinear: 0.6,
        muted: false,
        solo: false,
        pan: 0,
        loopMode: 'crossfade',
        crossfadeMs: 80,
        playbackRate: 1,
      },
    },
  ],
  timer: { durationSec: 1800, fadeSec: 60 },
};

describe('presets', () => {
  it('round-trips noise + sample layers', () => {
    const parsed = parsePreset(JSON.parse(JSON.stringify(sample)) as unknown);
    expect(parsed).not.toBeNull();
    expect(parsed!.layers).toHaveLength(2);
    expect(parsed!.layers[0].kind).toBe('noise');
    expect(parsed!.layers[1].kind).toBe('sample');
    if (parsed!.layers[1].kind === 'sample') {
      expect(parsed!.layers[1].params.assetId).toBe('rain_light');
    }
  });

  it('parses empty layers', () => {
    const parsed = parsePreset({ ...sample, layers: [] });
    expect(parsed).not.toBeNull();
    expect(parsed!.layers).toHaveLength(0);
  });

  it('rejects bad version', () => {
    expect(parsePreset({ ...sample, version: 2 })).toBeNull();
  });

  it('parses store and drops invalid entries', () => {
    const store = parsePresetStore({
      version: 1,
      presets: [sample, { version: 1, name: 'bad' }, null],
    });
    expect(store.presets).toHaveLength(1);
  });

  it('upsert and delete', () => {
    let store = { version: 1 as const, presets: [] as PresetV1[] };
    store = upsertPreset(store, sample);
    expect(store.presets).toHaveLength(1);
    store = upsertPreset(store, { ...sample, name: 'Focus 2' });
    expect(store.presets).toHaveLength(1);
    expect(store.presets[0].name).toBe('Focus 2');
    store = deletePreset(store, 'p1');
    expect(store.presets).toHaveLength(0);
  });

  it('snapshotFromSession copies mixed layers', () => {
    const good = snapshotFromSession({
      name: 'Now',
      masterVolumeLinear: 1,
      layers: sample.layers,
      timerDefaults: { durationSec: 600, fadeSec: 30 },
    });
    expect(good.layers).toHaveLength(2);
    expect(good.master.volumeLinear).toBe(1);
    expect(good.timer?.fadeSec).toBe(30);
  });

  it('parses optional binaural and oneShot scene fields', () => {
    const withScene: PresetV1 = {
      ...sample,
      binaural: {
        enabled: true,
        mode: 'binaural',
        preset: 'alpha',
        carrierFreq: 200,
        beatFreq: 10,
        volumeLinear: 0.4,
        waveform: 'sine',
      },
      oneShot: {
        enabled: true,
        density: 'balanced',
        customIntervalMs: 60_000,
        selectedPacks: ['forest'],
        selectedAssets: ['birds_morning'],
        volumeLinear: 0.7,
        spatialPan: true,
        pitchJitter: true,
        distanceFilter: true,
        burstSequence: true,
        acousticTail: true,
      },
    };
    const parsed = parsePreset(JSON.parse(JSON.stringify(withScene)) as unknown);
    expect(parsed).not.toBeNull();
    expect(parsed!.binaural?.enabled).toBe(true);
    expect(parsed!.binaural?.preset).toBe('alpha');
    expect(parsed!.oneShot?.selectedPacks).toEqual(['forest']);
  });

  it('snapshotFromSession includes scene fields when provided', () => {
    const snap = snapshotFromSession({
      name: 'Scene',
      masterVolumeLinear: 0.9,
      layers: sample.layers,
      timerDefaults: { durationSec: 600, fadeSec: 30 },
      binaural: {
        enabled: true,
        mode: 'isochronic',
        preset: 'theta',
        carrierFreq: 180,
        beatFreq: 6,
        volumeLinear: 0.3,
        waveform: 'triangle',
      },
      oneShot: {
        enabled: false,
        density: 'subtle',
        customIntervalMs: 90_000,
        selectedPacks: ['storm'],
        selectedAssets: ['thunder_distant'],
        volumeLinear: 0.5,
        spatialPan: true,
        pitchJitter: false,
        distanceFilter: true,
        burstSequence: false,
        acousticTail: true,
      },
    });
    expect(snap.binaural?.mode).toBe('isochronic');
    expect(snap.oneShot?.enabled).toBe(false);
    expect(snap.oneShot?.selectedPacks).toEqual(['storm']);
  });

  it('omits scene fields when not provided (legacy presets)', () => {
    const parsed = parsePreset(JSON.parse(JSON.stringify(sample)) as unknown);
    expect(parsed).not.toBeNull();
    expect(parsed!.binaural).toBeUndefined();
    expect(parsed!.oneShot).toBeUndefined();
  });
});

describe('duplicate min offset preference', () => {
  it('defaults when storage is empty', () => {
    const st = memoryStorage();
    expect(loadDuplicateMinOffsetSec(st)).toBe(DUPLICATE_MIN_OFFSET_DEFAULT_SEC);
  });

  it('round-trips through storage', () => {
    const st = memoryStorage();
    saveDuplicateMinOffsetSec(5, st);
    expect(st.getItem(DUPLICATE_MIN_OFFSET_KEY)).toBe('5');
    expect(loadDuplicateMinOffsetSec(st)).toBe(5);
  });

  it('clamps on save and load', () => {
    const st = memoryStorage();
    saveDuplicateMinOffsetSec(0.1, st);
    expect(loadDuplicateMinOffsetSec(st)).toBe(DUPLICATE_MIN_OFFSET_MIN_SEC);
    st.setItem(DUPLICATE_MIN_OFFSET_KEY, '999');
    expect(loadDuplicateMinOffsetSec(st)).toBe(60);
  });
});
