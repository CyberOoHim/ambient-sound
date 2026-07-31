import { describe, expect, it } from 'vitest';
import {
  assetUrl,
  buildAttributionsMarkdown,
  isAllowedCoreLicense,
  parseCatalog,
} from './catalog';

const valid = {
  version: 1 as const,
  packId: 'core',
  title: 'Core',
  assets: [
    {
      id: 'rain_light',
      title: 'Light rain',
      category: 'rain',
      file: 'core/rain_light.ogg',
      loop: { mode: 'crossfade' as const, crossfadeMs: 80 },
      license: {
        spdx: 'CC0-1.0',
        author: 'test',
      },
    },
  ],
};

describe('catalog', () => {
  it('parses valid catalog', () => {
    const c = parseCatalog(valid);
    expect(c).not.toBeNull();
    expect(c!.assets).toHaveLength(1);
  });

  it('rejects bad version', () => {
    expect(parseCatalog({ ...valid, version: 2 })).toBeNull();
  });

  it('builds asset urls', () => {
    expect(assetUrl('core/rain.ogg')).toBe('/sounds/core/rain.ogg');
  });

  it('allows core licenses', () => {
    expect(isAllowedCoreLicense('CC0-1.0')).toBe(true);
    expect(isAllowedCoreLicense('Pixabay')).toBe(false);
  });

  it('builds attributions markdown', () => {
    const md = buildAttributionsMarkdown(parseCatalog(valid)!);
    expect(md).toContain('Light rain');
    expect(md).toContain('CC0-1.0');
  });
});
