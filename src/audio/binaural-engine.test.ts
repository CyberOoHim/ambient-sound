import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BinauralEngine } from './binaural-engine';
import { DEFAULT_BINAURAL_CONFIG, type BinauralConfig } from '../app/binaural';

function createMockAudioContext() {
  const currentTime = 10;

  const createGain = () => ({
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  const createOscillator = () => ({
    type: 'sine',
    frequency: {
      value: 440,
      setValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  });

  const createStereoPanner = () => ({
    pan: {
      value: 0,
      setValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  return {
    currentTime,
    createGain,
    createOscillator,
    createStereoPanner,
  } as unknown as AudioContext;
}

describe('BinauralEngine Audio Generation', () => {
  let mockCtx: AudioContext;
  let mockMaster: GainNode;

  beforeEach(() => {
    mockCtx = createMockAudioContext();
    mockMaster = mockCtx.createGain();
  });

  it('starts inactive when disabled in config', () => {
    const engine = new BinauralEngine({ ...DEFAULT_BINAURAL_CONFIG, enabled: false });
    engine.setAudioTarget(mockCtx, mockMaster);
    engine.start();

    expect(engine.getActiveMode()).toBeNull();
  });

  it('starts binaural beats graph when enabled', () => {
    const config: BinauralConfig = {
      ...DEFAULT_BINAURAL_CONFIG,
      enabled: true,
      mode: 'binaural',
      carrierFreq: 200,
      beatFreq: 10,
    };
    const engine = new BinauralEngine(config);
    engine.setAudioTarget(mockCtx, mockMaster);
    engine.start();

    expect(engine.getActiveMode()).toBe('binaural');
  });

  it('starts isochronic tone graph when enabled', () => {
    const config: BinauralConfig = {
      ...DEFAULT_BINAURAL_CONFIG,
      enabled: true,
      mode: 'isochronic',
      carrierFreq: 200,
      beatFreq: 6,
    };
    const engine = new BinauralEngine(config);
    engine.setAudioTarget(mockCtx, mockMaster);
    engine.start();

    expect(engine.getActiveMode()).toBe('isochronic');
  });

  it('switches mode smoothly on config update', () => {
    const config: BinauralConfig = {
      ...DEFAULT_BINAURAL_CONFIG,
      enabled: true,
      mode: 'binaural',
    };
    const engine = new BinauralEngine(config);
    engine.setAudioTarget(mockCtx, mockMaster);
    engine.start();

    expect(engine.getActiveMode()).toBe('binaural');

    engine.updateConfig({ ...config, mode: 'isochronic' });
    expect(engine.getActiveMode()).toBe('isochronic');
  });

  it('tears down active nodes on stop or disable', () => {
    const config: BinauralConfig = {
      ...DEFAULT_BINAURAL_CONFIG,
      enabled: true,
      mode: 'binaural',
    };
    const engine = new BinauralEngine(config);
    engine.setAudioTarget(mockCtx, mockMaster);
    engine.start();

    expect(engine.getActiveMode()).toBe('binaural');

    engine.stop();
    expect(engine.getActiveMode()).toBeNull();
  });
});
