import { describe, expect, it } from 'vitest';
import {
  getMaxYoutubeLayers,
  isIosDevice,
  MAX_SAME_LAYERS,
  MAX_YOUTUBE_LAYERS,
  MAX_YOUTUBE_LAYERS_IOS,
} from './types';

describe('Layer Constants & iOS Cap', () => {
  it('defines MAX_SAME_LAYERS as 5', () => {
    expect(MAX_SAME_LAYERS).toBe(5);
  });

  it('returns MAX_YOUTUBE_LAYERS (3) for standard desktop/Android user agents', () => {
    const desktopUa =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(isIosDevice(desktopUa, 'MacIntel', 0)).toBe(false);
    expect(getMaxYoutubeLayers(desktopUa, 'MacIntel', 0)).toBe(MAX_YOUTUBE_LAYERS);

    const androidUa =
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    expect(isIosDevice(androidUa, 'Linux armv8l', 5)).toBe(false);
    expect(getMaxYoutubeLayers(androidUa, 'Linux armv8l', 5)).toBe(MAX_YOUTUBE_LAYERS);
  });

  it('returns MAX_YOUTUBE_LAYERS_IOS (1) for iOS devices (iPhone, iPad, iPadOS)', () => {
    const iphoneUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(isIosDevice(iphoneUa, 'iPhone', 5)).toBe(true);
    expect(getMaxYoutubeLayers(iphoneUa, 'iPhone', 5)).toBe(MAX_YOUTUBE_LAYERS_IOS);

    const ipadUa =
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(isIosDevice(ipadUa, 'iPad', 5)).toBe(true);
    expect(getMaxYoutubeLayers(ipadUa, 'iPad', 5)).toBe(MAX_YOUTUBE_LAYERS_IOS);

    // iPadOS desktop-mode UA with touch points
    const ipadosDesktopUa =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(isIosDevice(ipadosDesktopUa, 'MacIntel', 5)).toBe(true);
    expect(getMaxYoutubeLayers(ipadosDesktopUa, 'MacIntel', 5)).toBe(MAX_YOUTUBE_LAYERS_IOS);
  });
});
