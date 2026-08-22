import { describe, expect, it } from 'vitest';
import {
  calculateDriftGain,
  calculateDriftPan,
  calculateDriftPitch,
  calculateMixEnergy,
  calculateRandomInterval,
  GAIN_DRIFT_MAX_MULT,
  GAIN_DRIFT_MIN_MULT,
  HOLD_MAX_SEC_ECO,
  HOLD_MAX_SEC_NORMAL,
  HOLD_MIN_SEC_ECO,
  HOLD_MIN_SEC_NORMAL,
  PAN_DRIFT_MAX_OFFSET,
  PITCH_DRIFT_MAX_OFFSET,
  RAMP_MAX_SEC_ECO,
  RAMP_MAX_SEC_NORMAL,
  RAMP_MIN_SEC_ECO,
  RAMP_MIN_SEC_NORMAL,
} from './drift';

describe('drift DSP utilities', () => {
  describe('calculateRandomInterval', () => {
    it('generates normal intervals within expected bounds', () => {
      for (let i = 0; i < 50; i++) {
        const { holdSec, rampSec } = calculateRandomInterval(false);
        expect(holdSec).toBeGreaterThanOrEqual(HOLD_MIN_SEC_NORMAL);
        expect(holdSec).toBeLessThanOrEqual(HOLD_MAX_SEC_NORMAL);
        expect(rampSec).toBeGreaterThanOrEqual(RAMP_MIN_SEC_NORMAL);
        expect(rampSec).toBeLessThanOrEqual(RAMP_MAX_SEC_NORMAL);
      }
    });

    it('generates extended eco/power-saver intervals', () => {
      for (let i = 0; i < 50; i++) {
        const { holdSec, rampSec } = calculateRandomInterval(true);
        expect(holdSec).toBeGreaterThanOrEqual(HOLD_MIN_SEC_ECO);
        expect(holdSec).toBeLessThanOrEqual(HOLD_MAX_SEC_ECO);
        expect(rampSec).toBeGreaterThanOrEqual(RAMP_MIN_SEC_ECO);
        expect(rampSec).toBeLessThanOrEqual(RAMP_MAX_SEC_ECO);
      }
    });
  });

  describe('calculateDriftPitch', () => {
    it('keeps drifted pitch within ±3.5% of baseRate', () => {
      const base = 1.2;
      for (let i = 0; i < 100; i++) {
        const drifted = calculateDriftPitch(base, 1);
        expect(drifted).toBeGreaterThanOrEqual(base * (1 - PITCH_DRIFT_MAX_OFFSET - 0.0001));
        expect(drifted).toBeLessThanOrEqual(base * (1 + PITCH_DRIFT_MAX_OFFSET + 0.0001));
      }
    });

    it('returns exact base rate when depth is 0', () => {
      expect(calculateDriftPitch(1.5, 0)).toBe(1.5);
    });

    it('clamps to safe audio rate bounds [0.25, 4.0]', () => {
      expect(calculateDriftPitch(0.1, 1)).toBeGreaterThanOrEqual(0.25);
      expect(calculateDriftPitch(5.0, 1)).toBeLessThanOrEqual(4.0);
    });
  });

  describe('calculateDriftPan', () => {
    it('keeps drifted pan within safe bounds [-1, 1]', () => {
      for (let i = 0; i < 100; i++) {
        const drifted = calculateDriftPan(0, 1);
        expect(drifted).toBeGreaterThanOrEqual(-PAN_DRIFT_MAX_OFFSET);
        expect(drifted).toBeLessThanOrEqual(PAN_DRIFT_MAX_OFFSET);
      }
    });

    it('compresses drift near edges so pan never exceeds [-1, 1]', () => {
      for (let i = 0; i < 100; i++) {
        const rightPan = calculateDriftPan(0.95, 1);
        expect(rightPan).toBeGreaterThanOrEqual(-1);
        expect(rightPan).toBeLessThanOrEqual(1);

        const leftPan = calculateDriftPan(-0.95, 1);
        expect(leftPan).toBeGreaterThanOrEqual(-1);
        expect(leftPan).toBeLessThanOrEqual(1);
      }
    });

    it('returns exact base pan when depth is 0', () => {
      expect(calculateDriftPan(0.4, 0)).toBe(0.4);
    });
  });

  describe('calculateDriftGain', () => {
    it('never exceeds 1.0 (0 dBFS ceiling) even at maximum base volume', () => {
      for (let i = 0; i < 100; i++) {
        const gain = calculateDriftGain(1.0, 1.0, 1.0);
        expect(gain).toBeLessThanOrEqual(1.0);
        expect(gain).toBeGreaterThanOrEqual(GAIN_DRIFT_MIN_MULT - 0.005);
      }
    });

    it('applies subtle breathing variation at normal volume', () => {
      const base = 0.6;
      for (let i = 0; i < 100; i++) {
        const gain = calculateDriftGain(base, 1.0, 1.0);
        expect(gain).toBeGreaterThanOrEqual(base * (GAIN_DRIFT_MIN_MULT - 0.005));
        expect(gain).toBeLessThanOrEqual(base * GAIN_DRIFT_MAX_MULT + 0.001);
      }
    });

    it('attenuates upward headroom when total mix energy is high', () => {
      const base = 0.7;
      let maxHighEnergyGain = 0;
      for (let i = 0; i < 100; i++) {
        const gain = calculateDriftGain(base, 8.0, 1.0);
        if (gain > maxHighEnergyGain) maxHighEnergyGain = gain;
      }
      // With high energy, the upward boost is strongly constrained
      expect(maxHighEnergyGain).toBeLessThanOrEqual(base * (1 + (GAIN_DRIFT_MAX_MULT - 1) * 0.3));
    });

    it('returns exact base volume when depth is 0 or base is 0', () => {
      expect(calculateDriftGain(0.5, 1.0, 0)).toBe(0.5);
      expect(calculateDriftGain(0, 1.0, 1)).toBe(0);
    });
  });

  describe('calculateMixEnergy', () => {
    it('sums squared volume of unmuted layers', () => {
      const layers = [
        { volumeLinear: 0.5, muted: false },
        { volumeLinear: 0.5, muted: false },
        { volumeLinear: 0.8, muted: true },
      ];
      expect(calculateMixEnergy(layers)).toBeCloseTo(0.25 + 0.25, 4);
    });

    it('respects solo gate when any layer is soloed', () => {
      const layers = [
        { volumeLinear: 0.5, muted: false, solo: false },
        { volumeLinear: 0.6, muted: false, solo: true },
      ];
      expect(calculateMixEnergy(layers)).toBeCloseTo(0.36, 4);
    });
  });
});
