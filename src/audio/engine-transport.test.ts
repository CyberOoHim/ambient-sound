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

  it('pauses sample players on suspend and resumes them on resume', async () => {
    const pauseSpy = vi.fn();
    const resumeSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = engine as any;
    e.layers.set('s1', {
      kind: 'sample',
      player: { pause: pauseSpy, resume: resumeSpy },
    });

    await engine.suspend();
    expect(pauseSpy).toHaveBeenCalled();

    await engine.resume();
    expect(resumeSpy).toHaveBeenCalled();
  });

  it('dynamically connects convolver when reverbWet > 0 and disconnects when 0', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = engine as any;
    const trebleEq = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } };
    const bassEq = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } };
    const convolver = { connect: vi.fn(), disconnect: vi.fn() };
    const wetGain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } };
    const master = { connect: vi.fn() };
    const dryGain = { gain: { value: 1 } };

    e.trebleEq = trebleEq;
    e.bassEq = bassEq;
    e.convolver = convolver;
    e.wetGain = wetGain;
    e.master = master;
    e.dryGain = dryGain;
    e.convolverConnected = false;

    // Enable reverb
    engine.setMasterTone({ reverbWet: 0.25 });
    expect(trebleEq.connect).toHaveBeenCalledWith(convolver);
    expect(convolver.connect).toHaveBeenCalledWith(wetGain);
    expect(wetGain.connect).toHaveBeenCalledWith(master);
    expect(e.convolverConnected).toBe(true);

    // Disable reverb (0)
    engine.setMasterTone({ reverbWet: 0 });
    expect(trebleEq.disconnect).toHaveBeenCalledWith(convolver);
    expect(convolver.disconnect).toHaveBeenCalledWith(wetGain);
    expect(wetGain.disconnect).toHaveBeenCalledWith(master);
    expect(e.convolverConnected).toBe(false);
  });

  it('calculates independent left and right peak levels from stereo analysers', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = engine as any;
    e.analyserL = {
      fftSize: 4,
      getFloatTimeDomainData: (buf: Float32Array) => {
        buf[0] = 0.2;
        buf[1] = -0.65;
        buf[2] = 0.1;
        buf[3] = -0.4;
      },
    };
    e.analyserR = {
      fftSize: 4,
      getFloatTimeDomainData: (buf: Float32Array) => {
        buf[0] = 0.1;
        buf[1] = 0.35;
        buf[2] = -0.85;
        buf[3] = 0.2;
      },
    };

    const levels = engine.getPeakLevels();
    expect(levels.left).toBeCloseTo(0.65, 5);
    expect(levels.right).toBeCloseTo(0.85, 5);
  });

  it('falls back to mono getPeakLevel if stereo analysers are not present', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = engine as any;
    e.analyserL = null;
    e.analyserR = null;
    e.analyser = {
      fftSize: 4,
      getFloatTimeDomainData: (buf: Float32Array) => {
        buf[0] = 0.3;
        buf[1] = -0.5;
        buf[2] = 0.1;
        buf[3] = -0.2;
      },
    };

    const levels = engine.getPeakLevels();
    expect(levels.left).toBeCloseTo(0.5, 5);
    expect(levels.right).toBeCloseTo(0.5, 5);
  });
});
