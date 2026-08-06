// src/audio/binaural-engine.ts (Line 1)
import type { BinauralConfig, BinauralMode } from '../app/binaural';
import { clampLinear } from './dsp/curves';

interface BinauralNodes {
  mode: 'binaural';
  leftOsc: OscillatorNode;
  leftPan: StereoPannerNode;
  rightOsc: OscillatorNode;
  rightPan: StereoPannerNode;
  volumeGain: GainNode;
}

interface IsochronicNodes {
  mode: 'isochronic';
  carrierOsc: OscillatorNode;
  pulseGain: GainNode;
  lfoOsc: OscillatorNode;
  lfoGain: GainNode;
  volumeGain: GainNode;
}

type ActiveNodes = BinauralNodes | IsochronicNodes;

export class BinauralEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private config: BinauralConfig;
  private activeNodes: ActiveNodes | null = null;
  private running = false;

  constructor(config: BinauralConfig) {
    this.config = { ...config };
  }

  setAudioTarget(ctx: AudioContext, master: GainNode): void {
    this.ctx = ctx;
    this.master = master;
    if (this.running && this.config.enabled) {
      this.restart();
    }
  }

  start(): void {
    this.running = true;
    if (this.config.enabled) {
      this.restart();
    }
  }

  stop(): void {
    this.running = false;
    this.teardown();
  }

  updateConfig(config: BinauralConfig): void {
    const prevConfig = this.config;
    this.config = { ...config };

    if (!this.running || !this.ctx || !this.master) return;

    if (!this.config.enabled) {
      this.teardown();
      return;
    }

    // Rebuild graph if mode or waveform changed or if inactive
    if (
      !this.activeNodes ||
      prevConfig.mode !== this.config.mode ||
      prevConfig.waveform !== this.config.waveform ||
      !prevConfig.enabled
    ) {
      this.restart();
      return;
    }

    // Smoothly update running parameters without stopping oscillators
    const t = this.ctx.currentTime;
    const timeConstant = 0.015;

    if (this.activeNodes.mode === 'binaural') {
      const fL = Math.max(10, this.config.carrierFreq - this.config.beatFreq / 2);
      const fR = this.config.carrierFreq + this.config.beatFreq / 2;

      this.activeNodes.leftOsc.frequency.setTargetAtTime(fL, t, timeConstant);
      this.activeNodes.rightOsc.frequency.setTargetAtTime(fR, t, timeConstant);
      this.activeNodes.volumeGain.gain.setTargetAtTime(
        clampLinear(this.config.volumeLinear),
        t,
        timeConstant,
      );
    } else if (this.activeNodes.mode === 'isochronic') {
      this.activeNodes.carrierOsc.frequency.setTargetAtTime(
        this.config.carrierFreq,
        t,
        timeConstant,
      );
      this.activeNodes.lfoOsc.frequency.setTargetAtTime(
        this.config.beatFreq,
        t,
        timeConstant,
      );
      this.activeNodes.volumeGain.gain.setTargetAtTime(
        clampLinear(this.config.volumeLinear),
        t,
        timeConstant,
      );
    }
  }

  private restart(): void {
    this.teardown();
    if (!this.ctx || !this.master || !this.config.enabled || !this.running) return;

    const t = this.ctx.currentTime;
    const volLinear = clampLinear(this.config.volumeLinear);

    if (this.config.mode === 'binaural') {
      const fL = Math.max(10, this.config.carrierFreq - this.config.beatFreq / 2);
      const fR = this.config.carrierFreq + this.config.beatFreq / 2;

      const leftOsc = this.ctx.createOscillator();
      leftOsc.type = this.config.waveform;
      leftOsc.frequency.setValueAtTime(fL, t);

      const leftPan = this.ctx.createStereoPanner();
      leftPan.pan.setValueAtTime(-1, t);

      const rightOsc = this.ctx.createOscillator();
      rightOsc.type = this.config.waveform;
      rightOsc.frequency.setValueAtTime(fR, t);

      const rightPan = this.ctx.createStereoPanner();
      rightPan.pan.setValueAtTime(1, t);

      const volumeGain = this.ctx.createGain();
      volumeGain.gain.setValueAtTime(volLinear, t);

      leftOsc.connect(leftPan);
      leftPan.connect(volumeGain);

      rightOsc.connect(rightPan);
      rightPan.connect(volumeGain);

      volumeGain.connect(this.master);

      leftOsc.start(t);
      rightOsc.start(t);

      this.activeNodes = {
        mode: 'binaural',
        leftOsc,
        leftPan,
        rightOsc,
        rightPan,
        volumeGain,
      };
    } else {
      const carrierOsc = this.ctx.createOscillator();
      carrierOsc.type = this.config.waveform;
      carrierOsc.frequency.setValueAtTime(this.config.carrierFreq, t);

      const pulseGain = this.ctx.createGain();
      pulseGain.gain.setValueAtTime(0.5, t);

      const lfoOsc = this.ctx.createOscillator();
      lfoOsc.type = 'sine';
      lfoOsc.frequency.setValueAtTime(this.config.beatFreq, t);

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(0.5, t);

      const volumeGain = this.ctx.createGain();
      volumeGain.gain.setValueAtTime(volLinear, t);

      lfoOsc.connect(lfoGain);
      lfoGain.connect(pulseGain.gain);

      carrierOsc.connect(pulseGain);
      pulseGain.connect(volumeGain);
      volumeGain.connect(this.master);

      carrierOsc.start(t);
      lfoOsc.start(t);

      this.activeNodes = {
        mode: 'isochronic',
        carrierOsc,
        pulseGain,
        lfoOsc,
        lfoGain,
        volumeGain,
      };
    }
  }

  private teardown(): void {
    if (!this.activeNodes) return;
    try {
      if (this.activeNodes.mode === 'binaural') {
        this.activeNodes.leftOsc.stop();
        this.activeNodes.rightOsc.stop();
        this.activeNodes.leftOsc.disconnect();
        this.activeNodes.rightOsc.disconnect();
        this.activeNodes.leftPan.disconnect();
        this.activeNodes.rightPan.disconnect();
        this.activeNodes.volumeGain.disconnect();
      } else {
        this.activeNodes.carrierOsc.stop();
        this.activeNodes.lfoOsc.stop();
        this.activeNodes.carrierOsc.disconnect();
        this.activeNodes.lfoOsc.disconnect();
        this.activeNodes.lfoGain.disconnect();
        this.activeNodes.pulseGain.disconnect();
        this.activeNodes.volumeGain.disconnect();
      }
    } catch {
      /* ignore audio teardown errors */
    }
    this.activeNodes = null;
  }

  getActiveMode(): BinauralMode | null {
    return this.activeNodes?.mode ?? null;
  }
}
