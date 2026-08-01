import { describe, expect, it } from 'vitest';
import {
  buildEqualPowerCurves,
  clampCrossfadeSec,
  clampDuplicateMinOffsetSec,
  DUPLICATE_MIN_OFFSET_DEFAULT_SEC,
  DUPLICATE_MIN_OFFSET_MAX_SEC,
  DUPLICATE_MIN_OFFSET_MIN_SEC,
  effectiveMinOffsetSec,
  loopPeriodSec,
  pickDuplicateStartOffset,
} from './loop';

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

describe('duplicate start offset', () => {
  it('clamps user min offset to allowed range', () => {
    expect(clampDuplicateMinOffsetSec(Number.NaN)).toBe(
      DUPLICATE_MIN_OFFSET_DEFAULT_SEC,
    );
    expect(clampDuplicateMinOffsetSec(0)).toBe(DUPLICATE_MIN_OFFSET_MIN_SEC);
    expect(clampDuplicateMinOffsetSec(1000)).toBe(DUPLICATE_MIN_OFFSET_MAX_SEC);
    expect(clampDuplicateMinOffsetSec(3.5)).toBe(3.5);
  });

  it('caps effective min on short buffers', () => {
    expect(effectiveMinOffsetSec(60, 2)).toBe(2);
    expect(effectiveMinOffsetSec(4, 2)).toBeCloseTo(1.6, 5); // 0.4 * 4
    expect(effectiveMinOffsetSec(0.1, 2)).toBe(0);
  });

  it('first sibling always starts at 0', () => {
    expect(pickDuplicateStartOffset(60, 0, 1, 2, () => 0.9)).toBe(0);
    expect(pickDuplicateStartOffset(60, 0, 4, 2, () => 0.9)).toBe(0);
  });

  it('second sibling is at least the min offset into a long buffer', () => {
    const rng = () => 0.5; // no jitter
    const off = pickDuplicateStartOffset(60, 1, 2, 2, rng);
    expect(off).toBeGreaterThanOrEqual(2);
    expect(off).toBeLessThan(60);
    // Even spread for N=2 → ~half
    expect(off).toBeCloseTo(30, 5);
  });

  it('three siblings spread across thirds', () => {
    const rng = () => 0.5;
    const a = pickDuplicateStartOffset(60, 1, 3, 2, rng);
    const b = pickDuplicateStartOffset(60, 2, 3, 2, rng);
    expect(a).toBeCloseTo(20, 5);
    expect(b).toBeCloseTo(40, 5);
    expect(a).toBeGreaterThanOrEqual(2);
    expect(b).toBeGreaterThanOrEqual(2);
  });

  it('respects a larger user min when duration allows', () => {
    const rng = () => 0; // jitter pushes toward lower end of slot
    const off = pickDuplicateStartOffset(60, 1, 2, 10, rng);
    expect(off).toBeGreaterThanOrEqual(10);
  });
});
