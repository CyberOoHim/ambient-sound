import { describe, expect, it } from 'vitest';
import {
  deletePreset,
  parsePreset,
  parsePresetStore,
  snapshotFromSession,
  upsertPreset,
  type PresetV1,
} from './presets';

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

  it('rejects empty layers', () => {
    expect(parsePreset({ ...sample, layers: [] })).toBeNull();
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
});
