import { describe, expect, it } from 'vitest';
import {
  bufferRms,
  createNoiseState,
  processBlock,
  type NoiseType,
} from './colored-noise';
import { effectiveMuteSolo } from '../types';

/** Deterministic LCG for reproducible buffers. */
function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('colored-noise processBlock', () => {
  const types: NoiseType[] = [
    'white',
    'pink',
    'brown',
    'blue',
    'violet',
    'rain',
    'fan',
    'static',
  ];

  it.each(types)('%s produces finite non-silent output', (type) => {
    const state = createNoiseState(type);
    const n = 4800; // 0.1 s @ 48k
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    processBlock(type, state, outL, outR, 1, makeRng(42), 48000);
    expect(bufferRms(outL)).toBeGreaterThan(0.001);
    expect(Number.isFinite(bufferRms(outL))).toBe(true);
  });

  it('width 0 collapses L/R to mono', () => {
    const state = createNoiseState('white');
    const n = 512;
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    processBlock('white', state, outL, outR, 0, makeRng(7), 48000);
    for (let i = 0; i < n; i++) {
      expect(outL[i]).toBeCloseTo(outR[i], 5);
    }
  });

  it('blue has more high-band energy relative to low than pink (band proxy)', () => {
    // Simple spectral proxy: high-pass residual energy vs low-pass residual
    function bandEnergy(type: NoiseType) {
      const state = createNoiseState(type);
      const n = 48000;
      const buf = new Float32Array(n);
      const r = new Float32Array(n);
      processBlock(type, state, buf, r, 0, makeRng(99), 48000);

      let low = 0;
      let high = 0;
      let prev = 0;
      let lp = 0;
      const a = 0.05; // crude one-pole
      for (let i = 0; i < n; i++) {
        const x = buf[i];
        lp = lp + a * (x - lp);
        const hp = x - prev; // rough differentiator for high proxy
        prev = x;
        low += lp * lp;
        high += hp * hp;
      }
      return { low, high, ratio: high / (low + 1e-12) };
    }

    const pink = bandEnergy('pink');
    const blue = bandEnergy('blue');
    expect(blue.ratio).toBeGreaterThan(pink.ratio);
  });

  it('static differs from white: longer sample runs (sample-hold) and discrete levels', () => {
    function analyze(type: NoiseType) {
      const state = createNoiseState(type);
      const n = 24000;
      const buf = new Float32Array(n);
      const r = new Float32Array(n);
      processBlock(type, state, buf, r, 0, makeRng(123), 48000);

      // Mean run length of nearly-equal consecutive samples (sample-hold proxy)
      let runs = 0;
      let runLen = 1;
      let totalRun = 0;
      // Count unique quantized bins (bitcrush proxy)
      const bins = new Set<number>();
      for (let i = 0; i < n; i++) {
        bins.add(Math.round(buf[i] * 1e4));
        if (i > 0) {
          if (Math.abs(buf[i] - buf[i - 1]) < 1e-9) {
            runLen += 1;
          } else {
            totalRun += runLen;
            runs += 1;
            runLen = 1;
          }
        }
      }
      totalRun += runLen;
      runs += 1;
      return { meanRun: totalRun / runs, uniqueBins: bins.size };
    }

    const white = analyze('white');
    const staticNoise = analyze('static');
    // Sample-hold: static holds values across multiple samples
    expect(staticNoise.meanRun).toBeGreaterThan(white.meanRun * 2);
    // Bitcrush: fewer distinct amplitude levels than continuous Gaussian white
    expect(staticNoise.uniqueBins).toBeLessThan(white.uniqueBins * 0.5);
  });
});

describe('effectiveMuteSolo', () => {
  it('mutes when muted', () => {
    expect(effectiveMuteSolo(true, false, false)).toBe(0);
  });

  it('passes when not muted and no solo', () => {
    expect(effectiveMuteSolo(false, false, false)).toBe(1);
  });

  it('silences non-solo when any solo active', () => {
    expect(effectiveMuteSolo(false, false, true)).toBe(0);
    expect(effectiveMuteSolo(false, true, true)).toBe(1);
  });
});

describe('worklet sync', () => {
  it('noise-processor.js CALIBRATION matches CALIBRATION_GAIN exactly', async () => {
    const workletModule = await import('../worklets/noise-processor.js?raw');
    const content = workletModule.default;
    const { CALIBRATION_GAIN } = await import('./colored-noise');

    const match = content.match(/const CALIBRATION = (\{[\s\S]*?\});/);
    expect(match).not.toBeNull();

    const jsCalibration = eval(`(${match![1]})`);
    expect(jsCalibration).toEqual(CALIBRATION_GAIN);
  });
});

describe('createXorshiftRng', () => {
  it('generates uniform numbers in [0, 1) without repeats in small window', async () => {
    const { createXorshiftRng } = await import('./colored-noise');
    const rng = createXorshiftRng(12345);
    const set = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      set.add(v);
    }
    expect(set.size).toBe(1000);
  });
});
