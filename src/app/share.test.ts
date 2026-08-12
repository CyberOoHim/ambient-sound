import { describe, expect, it } from 'vitest';
import type { PresetV1 } from './presets';
import {
  buildShareUrl,
  decodeSharePayload,
  encodeMixHash,
  encodeSharePayload,
  parseLocationHash,
  presetToSharePayload,
} from './share';

const sample: PresetV1 = {
  version: 1,
  id: 'p1',
  name: 'Forest Focus',
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
        lowpassHz: 20000,
        highpassHz: 20,
        panLfoEnabled: false,
        panLfoRateHz: 0.08,
        panLfoDepth: 0.35,
      },
    },
  ],
  timer: { durationSec: 1800, fadeSec: 60 },
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
    density: 'subtle',
    customIntervalMs: 60_000,
    selectedPacks: ['forest'],
    selectedAssets: ['birds_morning', 'owls_forest'],
    volumeLinear: 0.6,
    spatialPan: true,
    pitchJitter: true,
    distanceFilter: true,
    burstSequence: true,
    acousticTail: false,
    earlyReflections: true,
    dopplerShift: true,
  },
};

describe('share codec', () => {
  it('round-trips scene fields through base64url', () => {
    const encoded = encodeSharePayload(presetToSharePayload(sample));
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = decodeSharePayload(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe('Forest Focus');
    expect(decoded!.layers).toHaveLength(1);
    expect(decoded!.binaural?.enabled).toBe(true);
    expect(decoded!.binaural?.preset).toBe('alpha');
    expect(decoded!.oneShot?.enabled).toBe(true);
    expect(decoded!.oneShot?.selectedPacks).toEqual(['forest']);
    expect(decoded!.timer?.durationSec).toBe(1800);
  });

  it('encodeMixHash uses #mix= prefix', () => {
    const hash = encodeMixHash(sample);
    expect(hash.startsWith('#mix=')).toBe(true);
    const intent = parseLocationHash(hash);
    expect(intent?.kind).toBe('mix');
    if (intent?.kind === 'mix') {
      expect(intent.preset.layers[0].kind).toBe('noise');
    }
  });

  it('parseLocationHash recognizes attributions', () => {
    expect(parseLocationHash('#attributions')?.kind).toBe('attributions');
    expect(parseLocationHash('#/attributions')?.kind).toBe('attributions');
  });

  it('rejects garbage mix payload', () => {
    expect(decodeSharePayload('not-valid!!!')).toBeNull();
    expect(parseLocationHash('#mix=%%%')).toBeNull();
  });

  it('buildShareUrl preserves path and search', () => {
    const url = buildShareUrl(sample, {
      origin: 'https://example.com',
      pathname: '/ambient-sound/',
      search: '?x=1',
    });
    expect(url.startsWith('https://example.com/ambient-sound/?x=1#mix=')).toBe(
      true,
    );
  });

  it('compact encode still restores default filter / LFO fields', () => {
    const decoded = decodeSharePayload(
      encodeSharePayload(presetToSharePayload(sample)),
    );
    expect(decoded).not.toBeNull();
    const layer = decoded!.layers[0];
    expect(layer.kind).toBe('noise');
    if (layer.kind === 'noise') {
      expect(layer.params.lowpassHz).toBe(20000);
      expect(layer.params.highpassHz).toBe(20);
      expect(layer.params.panLfoEnabled).toBe(false);
    }
  });

  it('round-trips master tone fields', () => {
    const withTone: PresetV1 = {
      ...sample,
      master: {
        volumeLinear: 0.75,
        bassDb: 3,
        trebleDb: -2,
        reverbWet: 0.2,
      },
    };
    const decoded = decodeSharePayload(
      encodeSharePayload(presetToSharePayload(withTone)),
    );
    expect(decoded!.master.bassDb).toBe(3);
    expect(decoded!.master.trebleDb).toBe(-2);
    expect(decoded!.master.reverbWet).toBe(0.2);
  });
});
