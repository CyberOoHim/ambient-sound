import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from './engine';

/**
 * Transport pause must silence Web Audio (core loops / noise) even when
 * AudioContext stays running (iOS) or analyser is dual-routed to destination
 * for YouTube coexistence.
 */
describe('AudioEngine transport pause / play gate', () => {
  let engine: AudioEngine;
  let gain: {
    value: number;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
    setValueAtTime: ReturnType<typeof vi.fn>;
    setTargetAtTime: ReturnType<typeof vi.fn>;
  };
  let ctx: {
    state: string;
    currentTime: number;
    suspend: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    engine = new AudioEngine();
    gain = {
      value: 1,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn((v: number) => {
        gain.value = v;
      }),
      setTargetAtTime: vi.fn((v: number) => {
        gain.value = v;
      }),
    };
    ctx = {
      state: 'running',
      currentTime: 0,
      suspend: vi.fn(async () => {
        ctx.state = 'suspended';
      }),
      resume: vi.fn(async () => {
        ctx.state = 'running';
      }),
    };
    // Inject a minimal graph so suspend/resume can gate master without real WA.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = engine as any;
    e.master = { gain };
    e.ctx = ctx;
    e.workletReady = true;
    e.wantRunning = true;
    e.masterVolumeLinear = 0.75;
    e.oneShotEngine.stop = vi.fn();
    e.oneShotEngine.start = vi.fn();
    e.binauralEngine.stop = vi.fn();
    e.binauralEngine.start = vi.fn();
    e.mediaOutput.pause = vi.fn();
    e.mediaOutput.play = vi.fn(async () => {});
  });

  afterEach(async () => {
    // Avoid real close paths
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = engine as any;
    e.ctx = null;
    e.master = null;
  });

  it('suspend zeros master gain so loops cannot stay audible after pause', async () => {
    await engine.suspend();

    expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(gain.value).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((engine as any).wantRunning).toBe(false);
  });

  it('resume restores stored master volume', async () => {
    await engine.suspend();
    expect(gain.value).toBe(0);

    await engine.resume();

    expect(gain.setValueAtTime).toHaveBeenCalledWith(0.75, 0);
    expect(gain.value).toBe(0.75);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((engine as any).wantRunning).toBe(true);
  });

  it('volume changes while paused do not reopen the master gate', async () => {
    await engine.suspend();
    gain.setValueAtTime.mockClear();

    engine.setMasterVolumeLinear(1);

    expect(engine.getMasterVolumeLinear()).toBe(1);
    expect(gain.setValueAtTime).not.toHaveBeenCalled();
    expect(gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(gain.value).toBe(0);
  });

  it('restoreMasterGain stays silent while transport is paused', async () => {
    await engine.suspend();
    gain.setValueAtTime.mockClear();

    engine.restoreMasterGain();

    expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(gain.value).toBe(0);
  });

  it('setMasterGainImmediate(holdSilent) works while playing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).wantRunning = true;
    engine.setMasterGainImmediate(0);
    expect(gain.value).toBe(0);

    engine.restoreMasterGain();
    expect(gain.value).toBe(0.75);
  });
});
