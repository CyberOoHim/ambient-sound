import { describe, expect, it } from 'vitest';
import { createDefaultNoiseLayer, createDefaultSampleLayer } from '../audio/types';
import { detectMood } from './mood-theme';
import type { SoundCatalog } from '../assets/catalog';

const catalog: SoundCatalog = {
  version: 1,
  packId: 'test',
  title: 'Test',
  assets: [
    {
      id: 'rain_light',
      title: 'Light rain',
      category: 'rain',
      file: 'core/rain_light.ogg',
      loop: { mode: 'crossfade', crossfadeMs: 80 },
      license: { spdx: 'CC0-1.0', author: 'test' },
    },
    {
      id: 'fire_camp',
      title: 'Campfire',
      category: 'fire',
      file: 'core/fire_camp.ogg',
      loop: { mode: 'crossfade', crossfadeMs: 80 },
      license: { spdx: 'CC0-1.0', author: 'test' },
    },
    {
      id: 'ocean_shore',
      title: 'Ocean shore',
      category: 'ocean',
      file: 'core/ocean_shore.ogg',
      loop: { mode: 'crossfade', crossfadeMs: 80 },
      license: { spdx: 'CC0-1.0', author: 'test' },
    },
  ],
};

describe('detectMood', () => {
  it('returns default for empty mix', () => {
    expect(detectMood([])).toBe('default');
  });

  it('detects rain from sample category', () => {
    const layers = [
      {
        kind: 'sample' as const,
        params: createDefaultSampleLayer('s1', 'rain_light', 'Light rain'),
      },
    ];
    expect(detectMood(layers, catalog)).toBe('rain');
  });

  it('detects fire', () => {
    const layers = [
      {
        kind: 'sample' as const,
        params: createDefaultSampleLayer('s1', 'fire_camp', 'Campfire'),
      },
    ];
    expect(detectMood(layers, catalog)).toBe('fire');
  });

  it('detects ocean', () => {
    const layers = [
      {
        kind: 'sample' as const,
        params: createDefaultSampleLayer('s1', 'ocean_shore', 'Ocean shore'),
      },
    ];
    expect(detectMood(layers, catalog)).toBe('ocean');
  });

  it('maps indoor cafe/library to night mood', () => {
    const layers = [
      {
        kind: 'sample' as const,
        params: createDefaultSampleLayer('s1', 'cafe_murmur', 'Cafe murmur'),
      },
    ];
    expect(detectMood(layers, catalog)).toBe('night');
  });

  it('maps soft city to train mood', () => {
    const layers = [
      {
        kind: 'sample' as const,
        params: createDefaultSampleLayer('s1', 'city_soft', 'Soft city evening'),
      },
    ];
    expect(detectMood(layers, catalog)).toBe('train');
  });

  it('detects rain from noise type', () => {
    const layers = [
      {
        kind: 'noise' as const,
        params: createDefaultNoiseLayer('n1', 'rain'),
      },
    ];
    expect(detectMood(layers, catalog)).toBe('rain');
  });

  it('ignores muted layers', () => {
    const params = createDefaultSampleLayer('s1', 'rain_light', 'Light rain');
    params.muted = true;
    expect(detectMood([{ kind: 'sample', params }], catalog)).toBe('default');
  });
});
