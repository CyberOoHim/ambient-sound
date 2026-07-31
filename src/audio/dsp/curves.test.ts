import { describe, expect, it } from 'vitest';
import {
  dbToLinear,
  equalPowerFadeIn,
  equalPowerFadeOut,
  linearToDb,
  DB_MIN,
} from './curves';

describe('curves', () => {
  it('maps 0 dB to 1 linear', () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 5);
  });

  it('maps -6 dB to ~0.5 linear', () => {
    expect(dbToLinear(-6)).toBeCloseTo(0.501187, 3);
  });

  it('maps DB_MIN to 0 linear', () => {
    expect(dbToLinear(DB_MIN)).toBe(0);
    expect(dbToLinear(DB_MIN - 10)).toBe(0);
  });

  it('round-trips dB → linear → dB for mid range', () => {
    for (const db of [-40, -20, -12, -6, -3, 0]) {
      expect(linearToDb(dbToLinear(db))).toBeCloseTo(db, 4);
    }
  });

  it('linear 0 displays as DB_MIN', () => {
    expect(linearToDb(0)).toBe(DB_MIN);
  });

  it('equal-power fades conserve power', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const a = equalPowerFadeIn(t);
      const b = equalPowerFadeOut(t);
      expect(a * a + b * b).toBeCloseTo(1, 5);
    }
  });
});
