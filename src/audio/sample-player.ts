import { buildEqualPowerCurves, clampCrossfadeSec, loopPeriodSec } from './dsp/loop';

export interface SamplePlayerOptions {
  loopMode: 'native' | 'crossfade';
  crossfadeMs: number;
  playbackRate: number;
}

/**
 * Plays a decoded AudioBuffer with native loop or dual-source equal-power crossfade.
 */
export class SamplePlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer;
  private dest: AudioNode;
  private opts: SamplePlayerOptions;
  private inputGain: GainNode;

  private nativeSource: AudioBufferSourceNode | null = null;
  private active: Array<{
    source: AudioBufferSourceNode;
    gain: GainNode;
    index: number;
  }> = [];
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private nextIndex = 0;
  private t0 = 0;
  private stopped = true;

  constructor(
    ctx: AudioContext,
    buffer: AudioBuffer,
    dest: AudioNode,
    opts: SamplePlayerOptions,
  ) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.dest = dest;
    this.opts = opts;
    this.inputGain = ctx.createGain();
    this.inputGain.gain.value = 1;
    this.inputGain.connect(dest);
  }

  start(): void {
    this.stop();
    this.stopped = false;
    if (this.opts.loopMode === 'native') {
      this.startNative();
    } else {
      this.startCrossfade();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.scheduleTimer != null) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    if (this.nativeSource) {
      try {
        this.nativeSource.stop();
      } catch {
        /* */
      }
      try {
        this.nativeSource.disconnect();
      } catch {
        /* */
      }
      this.nativeSource = null;
    }
    for (const seg of this.active) {
      try {
        seg.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        seg.source.stop();
      } catch {
        /* */
      }
      try {
        seg.source.disconnect();
        seg.gain.disconnect();
      } catch {
        /* */
      }
    }
    this.active = [];
    this.nextIndex = 0;
  }

  private startNative(): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.playbackRate.value = this.opts.playbackRate;
    src.connect(this.inputGain);
    src.start();
    this.nativeSource = src;
  }

  private startCrossfade(): void {
    this.t0 = this.ctx.currentTime + 0.02;
    this.nextIndex = 0;
    this.scheduleSegment(0);
    this.scheduleSegment(1);
    this.pump();
  }

  private period(): number {
    const D = this.buffer.duration;
    const overlap = clampCrossfadeSec(this.opts.crossfadeMs, D);
    return loopPeriodSec(D, overlap, this.opts.playbackRate);
  }

  private pump(): void {
    if (this.stopped) return;
    const period = this.period();
    const now = this.ctx.currentTime;
    // Schedule until we have ~0.35s+ lookahead beyond next needed start
    while (this.t0 + this.nextIndex * period < now + 0.4 + period) {
      this.scheduleSegment(this.nextIndex);
    }
    // Prune old nodes
    if (this.active.length > 5) {
      const drop = this.active.splice(0, this.active.length - 4);
      for (const seg of drop) {
        try {
          seg.source.disconnect();
          seg.gain.disconnect();
        } catch {
          /* */
        }
      }
    }
    this.scheduleTimer = setTimeout(() => this.pump(), 80);
  }

  private scheduleSegment(n: number): void {
    if (this.stopped) return;
    if (n !== this.nextIndex) return;

    const D = this.buffer.duration;
    const rate = Math.max(0.01, this.opts.playbackRate);
    const overlap = clampCrossfadeSec(this.opts.crossfadeMs, D);
    const period = loopPeriodSec(D, overlap, rate);
    const startAt = this.t0 + n * period;
    const overlapDur = Math.max(0.01, overlap / rate);

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = rate;

    const gain = this.ctx.createGain();
    source.connect(gain);
    gain.connect(this.inputGain);

    const curveN = Math.max(2, Math.floor(overlapDur * this.ctx.sampleRate));
    const { fadeIn, fadeOut } = buildEqualPowerCurves(curveN);

    if (n === 0) {
      gain.gain.setValueAtTime(1, startAt);
    } else {
      gain.gain.setValueAtTime(0, startAt);
      try {
        gain.gain.setValueCurveAtTime(fadeIn, startAt, overlapDur);
      } catch {
        gain.gain.linearRampToValueAtTime(1, startAt + overlapDur);
      }
    }

    // Crossfade previous out
    const prev = this.active.find((s) => s.index === n - 1);
    if (prev) {
      try {
        prev.gain.gain.cancelScheduledValues(startAt);
        prev.gain.gain.setValueAtTime(
          prev.gain.gain.value > 0 ? 1 : prev.gain.gain.value,
          startAt,
        );
        prev.gain.gain.setValueAtTime(1, startAt);
        prev.gain.gain.setValueCurveAtTime(fadeOut, startAt, overlapDur);
      } catch {
        prev.gain.gain.linearRampToValueAtTime(0, startAt + overlapDur);
      }
      try {
        prev.source.stop(startAt + overlapDur + 0.03);
      } catch {
        /* */
      }
    }

    try {
      source.start(startAt);
    } catch {
      try {
        source.start();
      } catch {
        /* */
      }
    }

    this.active.push({ source, gain, index: n });
    this.nextIndex = n + 1;
  }
}
