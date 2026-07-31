import { describe, expect, it } from 'vitest';
import { buildEqualPowerCurves, clampCrossfadeSec, loopPeriodSec } from './loop';

describe('loop helpers', () => {
  it('clamps crossfade to 25% of duration', () => {
    expect(clampCrossfadeSec(5000, 1)).toBeCloseTo(0.25, 5);
    expect(clampCrossfadeSec(50, 10)).toBeCloseTo(0.05, 5);
  });

  it('computes period', () => {
    expect(loopPeriodSec(10, 0.1, 1)).toBeCloseTo(9.9, 5);
    expect(loopPeriodSec(10, 0.1, 2)).toBeCloseTo(4.95, 5);
  });

  it('equal-power curves conserve power', () => {
    const { fadeIn, fadeOut } = buildEqualPowerCurves(64);
    for (let i = 0; i < fadeIn.length; i++) {
      expect(fadeIn[i] ** 2 + fadeOut[i] ** 2).toBeCloseTo(1, 4);
    }
  });
});
