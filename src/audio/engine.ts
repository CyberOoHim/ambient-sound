import workletUrl from './worklets/noise-processor.js?url';
import { clampLinear, linearToDb } from './dsp/curves';
import type { NoiseType } from './dsp/colored-noise';
import {
  calculateDriftGain,
  calculateDriftPan,
  calculateDriftPitch,
  calculateRandomInterval,
} from './dsp/drift';
import {
  DUPLICATE_MIN_OFFSET_DEFAULT_SEC,
  pickDuplicateStartOffset,
} from './dsp/loop';
import {
  clampHighpassHz,
  clampLowpassHz,
  clampMasterEqDb,
  clampPanLfoDepth,
  clampPanLfoRateHz,
  clampReverbWet,
  defaultDriftConfig,
  defaultMasterTone,
  effectiveMuteSolo,
  FILTER_HP_OPEN_HZ,
  FILTER_LP_OPEN_HZ,
  isLocalAssetId,
  layerId,
  layerMuted,
  layerSolo,
  type DriftConfig,
  type LayerDriftParams,
  type LayerLiveDrift,
  type MasterToneParams,
  type MixerLayer,
  type NoiseLayerParams,
  type PlaylistLayerParams,
  type SampleLayerParams,
  type YoutubeLayerParams,
} from './types';
import type { PlaylistItem } from '../app/playlist';
import { powerSaver } from '../app/power-saver';
import { SamplePlayer } from './sample-player';
import {
  decodeCache,
  type DecodeProgressCallback,
} from './decode-cache';
import { assetUrl, findAsset, type SoundCatalog } from '../assets/catalog';
import { MediaOutput } from './media-output';
import { getLocalAudioData } from './local-audio-store';
import { youtubePlayerManager } from './youtube-player';

/** Synthetic stereo impulse for a light ambient reverb (no asset file). */
function createReverbImpulse(
  ctx: BaseAudioContext,
  durationSec = 1.6,
  decay = 2.4,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * durationSec));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * t ** decay;
    }
  }
  return impulse;
}

interface PanLfoNodes {
  osc: OscillatorNode;
  depthGain: GainNode;
}

export interface LayerDriftTransition {
  startPan: number;
  targetPan: number;
  startGain: number;
  targetGain: number;
  startRate: number;
  targetRate: number;
  startTime: number;
  rampSec: number;
}

interface BaseLayerState {
  baseVolumeLinear: number;
  basePan: number;
  driftParams: LayerDriftParams;
  driftTimer: ReturnType<typeof setTimeout> | null;
  driftState?: LayerDriftTransition;
}

interface NoiseNodes extends BaseLayerState {
  kind: 'noise';
  worklet: AudioWorkletNode;
  volume: GainNode;
  pan: StereoPannerNode;
  muteSolo: GainNode;
  /** Type-specific color filter (rain/fan/static). */
  filter: BiquadFilterNode;
  /** User low-pass (muffled / indoor). */
  userLp: BiquadFilterNode;
  /** User high-pass. */
  userHp: BiquadFilterNode;
  panLfo: PanLfoNodes | null;
}

interface SampleNodes extends BaseLayerState {
  kind: 'sample';
  player: SamplePlayer;
  basePlaybackRate: number;
  volume: GainNode;
  pan: StereoPannerNode;
  muteSolo: GainNode;
  userLp: BiquadFilterNode;
  userHp: BiquadFilterNode;
  panLfo: PanLfoNodes | null;
}

interface PlaylistNodes extends BaseLayerState {
  kind: 'playlist';
  player: SamplePlayer | null;
  basePlaybackRate: number;
  volume: GainNode;
  pan: StereoPannerNode;
  muteSolo: GainNode;
  userLp: BiquadFilterNode;
  userHp: BiquadFilterNode;
  panLfo: PanLfoNodes | null;
  activeType: 'local' | 'youtube' | null;
}

type LayerNodes = NoiseNodes | SampleNodes | PlaylistNodes;

/** Options for decorrelating duplicate sample layers of the same asset. */
export interface SampleStartOptions {
  /** 0-based index among layers sharing the same assetId in the mix. */
  siblingIndex?: number;
  /** Total number of layers with that assetId. */
  siblingCount?: number;
  /** User min offset (seconds) for 2nd+ copies. */
  minOffsetSec?: number;
}

/**
 * Web Audio engine: mix bus + master tone (EQ/reverb) + noise/sample layers.
 *
 * Graph: layers → mixBus → bass → treble → dry/wet reverb → limiter → masterGain → analyser → out
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  /** Sum of all layers (unity gain). */
  private mixBus: GainNode | null = null;
  private bassEq: BiquadFilterNode | null = null;
  private trebleEq: BiquadFilterNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private convolverConnected = false;
  /** Tier 3 brickwall safety limiter before master gain. */
  private limiter: DynamicsCompressorNode | null = null;
  /** Final volume control (sleep timer fade, preset crossfade). */
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private workletReady = false;
  private layers = new Map<string, LayerNodes>();
  private masterVolumeLinear = 1;
  private masterTone: MasterToneParams = defaultMasterTone();
  private driftConfig: DriftConfig = defaultDriftConfig();
  private fadeToken = 0;
  private fading = false;
  private catalog: SoundCatalog | null = null;
  private mediaOutput = new MediaOutput();
  private peakBuf: Float32Array<ArrayBuffer> | null = null;
  private peakBufL: Float32Array<ArrayBuffer> | null = null;
  private peakBufR: Float32Array<ArrayBuffer> | null = null;
  /** User wants audio running (used to re-resume after iOS interrupt). */
  private wantRunning = false;
  private stateChangeBound = false;
  private powerSaverUnsub: (() => void) | null = null;

  constructor() {
    this.powerSaverUnsub = powerSaver.subscribe(() => this.onPowerSaverChange());
  }

  private onPowerSaverChange(): void {
    if (!this.wantRunning || !this.ctx) return;
    for (const [id, nodes] of this.layers.entries()) {
      this.scheduleLayerDrift(id, nodes);
    }
  }
  /**
   * Layer ids whose in-flight sample fetch/decode should be discarded.
   * Set by removeLayer / stopAll so a late download cannot start audio
   * after the mix layer was cleared or deleted.
   */
  private cancelledLoads = new Set<string>();
  /** Sample layer ids currently awaiting fetch/decode. */
  private inflightLoads = new Set<string>();
  private youtubeHostElement: HTMLElement | null = null;

  setYoutubeHostElement(el: HTMLElement | null): void {
    this.youtubeHostElement = el;
  }

  /**
   * Pause the mobile background <audio> element when YouTube layers will play,
   * before resume() so MediaStream output cannot steal exclusive media focus.
   */
  prepareYoutubeCoexistence(hasYoutubeLayers: boolean): void {
    this.mediaOutput.setHasYoutubeLayers(
      hasYoutubeLayers || youtubePlayerManager.hasActivePlayers(),
    );
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  get isFading(): boolean {
    return this.fading;
  }

  /** Master-bus analyser for visualizer (ENH-11). */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getMasterTone(): MasterToneParams {
    return { ...this.masterTone };
  }

  setCatalog(catalog: SoundCatalog): void {
    this.catalog = catalog;
  }

  private initPromise: Promise<AudioContext> | null = null;

  async ensureContext(): Promise<AudioContext> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();

        this.mixBus = this.ctx.createGain();
        this.mixBus.gain.value = 1;

        this.bassEq = this.ctx.createBiquadFilter();
        this.bassEq.type = 'lowshelf';
        this.bassEq.frequency.value = 220;
        this.bassEq.gain.value = this.masterTone.bassDb;

        this.trebleEq = this.ctx.createBiquadFilter();
        this.trebleEq.type = 'highshelf';
        this.trebleEq.frequency.value = 3200;
        this.trebleEq.gain.value = this.masterTone.trebleDb;

        this.dryGain = this.ctx.createGain();
        this.wetGain = this.ctx.createGain();
        this.applyReverbMix(this.masterTone.reverbWet);

        this.convolver = this.ctx.createConvolver();
        this.convolver.buffer = createReverbImpulse(this.ctx);

        // Tier 3 brickwall safety limiter before master gain
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -1.0;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.002;
        this.limiter.release.value = 0.1;

        this.master = this.ctx.createGain();
        this.master.gain.value = this.masterVolumeLinear;

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.82;

        this.splitter = this.ctx.createChannelSplitter(2);
        this.analyserL = this.ctx.createAnalyser();
        this.analyserL.fftSize = 1024;
        this.analyserL.smoothingTimeConstant = 0.82;
        this.analyserR = this.ctx.createAnalyser();
        this.analyserR.fftSize = 1024;
        this.analyserR.smoothingTimeConstant = 0.82;

        // mixBus → EQ → dryGain (+ dynamic convolver → wetGain) → limiter → master → analyser / splitter → out
        this.mixBus.connect(this.bassEq);
        this.bassEq.connect(this.trebleEq);
        this.trebleEq.connect(this.dryGain);
        this.dryGain.connect(this.limiter);
        this.limiter.connect(this.master);
        this.master.connect(this.analyser);
        this.master.connect(this.splitter);
        this.splitter.connect(this.analyserL, 0);
        this.splitter.connect(this.analyserR, 1);
        this.applyReverbMix(this.masterTone.reverbWet);

        // Mobile (iOS + Android): route via HTMLAudioElement for background
        // playback / media controls. Desktop: analyser → destination.
        this.mediaOutput.attach(this.ctx, this.analyser);
        this.mediaOutput.connectDestination(this.ctx, this.analyser);
        this.bindStateChange(this.ctx);
      }
      if (!this.workletReady) {
        await this.ctx.audioWorklet.addModule(workletUrl);
        this.workletReady = true;
      }
      return this.ctx;
    })();
    return this.initPromise;
  }

  private applyReverbMix(wet: number): void {
    const w = clampReverbWet(wet);
    if (this.dryGain) this.dryGain.gain.value = 1 - w * 0.9;
    if (this.wetGain) this.wetGain.gain.value = w;

    const targetNode = this.limiter ?? this.master;
    if (!this.trebleEq || !this.convolver || !this.wetGain || !targetNode) return;

    if (w > 0.001) {
      if (!this.convolverConnected) {
        try {
          this.trebleEq.connect(this.convolver);
          this.convolver.connect(this.wetGain);
          this.wetGain.connect(targetNode);
          this.convolverConnected = true;
        } catch {
          /* already connected */
        }
      }
    } else {
      if (this.convolverConnected) {
        try {
          this.trebleEq.disconnect(this.convolver);
          this.convolver.disconnect(this.wetGain);
          this.wetGain.disconnect(targetNode);
        } catch {
          /* already disconnected */
        }
        this.convolverConnected = false;
      }
    }
  }

  /** Bass / treble / reverb on the master chain (ENH-17). */
  setMasterTone(tone: Partial<MasterToneParams>): void {
    if (tone.bassDb != null) {
      this.masterTone.bassDb = clampMasterEqDb(tone.bassDb);
    }
    if (tone.trebleDb != null) {
      this.masterTone.trebleDb = clampMasterEqDb(tone.trebleDb);
    }
    if (tone.reverbWet != null) {
      this.masterTone.reverbWet = clampReverbWet(tone.reverbWet);
    }
    if (this.bassEq) this.bassEq.gain.value = this.masterTone.bassDb;
    if (this.trebleEq) this.trebleEq.gain.value = this.masterTone.trebleDb;
    this.applyReverbMix(this.masterTone.reverbWet);
  }

  /** Update Organic Drift configuration and re-schedule active drifts */
  setDriftConfig(config: Partial<DriftConfig>): void {
    this.driftConfig = {
      ...this.driftConfig,
      ...config,
    };
    if (!this.wantRunning || !this.ctx) return;
    for (const [id, nodes] of this.layers.entries()) {
      this.scheduleLayerDrift(id, nodes);
    }
  }

  private bindStateChange(ctx: AudioContext): void {
    if (this.stateChangeBound) return;
    this.stateChangeBound = true;
    ctx.onstatechange = () => {
      // iOS often moves the context to "interrupted" when backgrounding /
      // locking; if the user still wants audio, try to resume without a
      // new gesture (allowed after a prior user-started session).
      // "interrupted" is WebKit-specific (not in the standard union type).
      const state = ctx.state as string;
      if (this.wantRunning && (state === 'interrupted' || state === 'suspended')) {
        void ctx.resume().then(() => {
          this.mediaOutput.play();
          youtubePlayerManager.setGlobalPlaying(true);
          if (!this.fading) {
            this.restoreMasterGain();
          }
        });
      }
    };
  }

  async resume(): Promise<void> {
    this.wantRunning = true;
    const ctx = await this.ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
    await this.mediaOutput.play();
    youtubePlayerManager.setGlobalPlaying(true);
    for (const [id, layer] of this.layers.entries()) {
      if (layer.kind === 'sample') {
        layer.player.resume();
      } else if (layer.kind === 'playlist' && layer.player) {
        layer.player.resume();
      }
      this.scheduleLayerDrift(id, layer);
    }
    // Unmute Web Audio after transport pause. Session.play may immediately
    // re-zero for holdSilent crossfades; visibility/onstatechange need this.
    if (!this.fading) {
      this.restoreMasterGain();
    }
  }

  /**
   * Wake AudioContext after a user gesture without starting mix transport.
   * Does not unmute master, play media output, or touch YT.
   */
  async resumeContextOnly(): Promise<void> {
    const ctx = await this.ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
  }

  private isAppleTouch(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  /**
   * Silence or restore the master bus for transport pause/play.
   *
   * Required because:
   * - MediaOutput always keeps analyser → destination connected (YouTube
   *   coexistence / dual-route), so pausing the background <audio> element
   *   alone does not stop sample/noise loops.
   * - On iOS/iPadOS we skip AudioContext.suspend() (hard to resume without a
   *   new gesture), so the graph keeps rendering unless gain is gated.
   */
  private setTransportAudible(audible: boolean, immediate = true): void {
    if (!this.master || !this.ctx) return;
    this.fadeToken++;
    this.fading = false;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    const target = audible ? this.masterVolumeLinear : 0;
    if (immediate) {
      g.setValueAtTime(target, t);
    } else {
      g.setTargetAtTime(target, t, 0.015);
    }
    youtubePlayerManager.setMasterVolumeLinear(audible ? this.masterVolumeLinear : 0);
  }

  async suspend(): Promise<void> {
    this.wantRunning = false;
    for (const layer of this.layers.values()) {
      if (layer.driftTimer != null) {
        clearTimeout(layer.driftTimer);
        layer.driftTimer = null;
      }
      if (layer.kind === 'sample') {
        layer.player.pause();
      } else if (layer.kind === 'playlist' && layer.player) {
        layer.player.pause();
      }
    }
    // Pause every external + internal source together with the transport.
    youtubePlayerManager.setGlobalPlaying(false);
    this.mediaOutput.pause();
    // Gate the Web Audio master bus so core loops / noise stop being audible
    // even when the context stays running (iOS) or destination is dual-routed.
    this.setTransportAudible(false, true);
    if (this.ctx && this.ctx.state === 'running') {
      // On iOS/iPadOS, fully suspending the AudioContext makes it very
      // difficult to resume without a new user gesture. Master-gain gate
      // above is the real silence; desktop/Android still suspend for CPU.
      if (!this.isAppleTouch()) {
        await this.ctx.suspend();
      }
    }
  }

  setMasterVolumeLinear(linear: number): void {
    this.masterVolumeLinear = clampLinear(linear);
    // While transport is paused, only store the target — do not un-silence.
    if (!this.wantRunning) {
      if (!this.fading) {
        youtubePlayerManager.setMasterVolumeLinear(0);
      }
      return;
    }
    if (!this.fading) {
      youtubePlayerManager.setMasterVolumeLinear(this.masterVolumeLinear);
    }
    if (this.master && this.ctx) {
      const g = this.master.gain;
      const t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(this.masterVolumeLinear, t, 0.015);
    }
  }

  getMasterVolumeLinear(): number {
    return this.masterVolumeLinear;
  }

  startFadeOut(seconds: number): Promise<boolean> {
    if (!this.master || !this.ctx) return Promise.resolve(false);
    const sec = Math.max(0.05, seconds);
    const token = ++this.fadeToken;
    this.fading = true;

    const g = this.master.gain;
    const t0 = this.ctx.currentTime;
    const from = g.value;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(from, t0);
    g.linearRampToValueAtTime(0, t0 + sec);

    if (youtubePlayerManager.hasActivePlayers()) {
      const startMs = Date.now();
      const interval = setInterval(() => {
        const elapsedSec = (Date.now() - startMs) / 1000;
        const ratio = Math.max(0, 1 - elapsedSec / sec);
        youtubePlayerManager.setMasterVolumeLinear(from * ratio);
        if (elapsedSec >= sec || token !== this.fadeToken) {
          clearInterval(interval);
          if (token === this.fadeToken) {
            youtubePlayerManager.setMasterVolumeLinear(0);
          }
        }
      }, 50);
    } else {
      youtubePlayerManager.setMasterVolumeLinear(0);
    }

    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (token !== this.fadeToken) {
          resolve(false);
          return;
        }
        this.fading = false;
        resolve(true);
      }, sec * 1000 + 20);
    });
  }

  cancelFadeOut(): void {
    this.fadeToken++;
    this.fading = false;
    youtubePlayerManager.setMasterVolumeLinear(this.masterVolumeLinear);
    if (!this.master || !this.ctx) return;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    if (typeof g.cancelAndHoldAtTime === 'function') {
      try {
        g.cancelAndHoldAtTime(t);
      } catch {
        /* */
      }
    }
    g.setValueAtTime(this.masterVolumeLinear, t);
  }

  restoreMasterGain(): void {
    this.fading = false;
    // Transport pause owns silence; do not un-mute while paused.
    if (!this.wantRunning) {
      youtubePlayerManager.setMasterVolumeLinear(0);
      if (this.master && this.ctx) {
        const g = this.master.gain;
        const t = this.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0, t);
      }
      return;
    }
    youtubePlayerManager.setMasterVolumeLinear(this.masterVolumeLinear);
    if (!this.master || !this.ctx) return;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(this.masterVolumeLinear, t);
  }

  /** Set absolute master gain immediately (cancels any in-flight fade). */
  setMasterGainImmediate(linear: number): void {
    this.fadeToken++;
    this.fading = false;
    // holdSilent crossfades intentionally zero while playing; otherwise
    // respect transport pause so volume UI cannot re-open the gate.
    const value = this.wantRunning ? clampLinear(linear) : 0;
    youtubePlayerManager.setMasterVolumeLinear(value);
    if (!this.master || !this.ctx) return;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(value, t);
  }

  /**
   * Ramp master gain from silence to the current master volume (ENH-18).
   * Resolves when the ramp finishes (or is superseded).
   */
  startFadeIn(seconds: number): Promise<boolean> {
    if (!this.master || !this.ctx) return Promise.resolve(false);
    const sec = Math.max(0.05, seconds);
    const token = ++this.fadeToken;
    this.fading = true;

    const g = this.master.gain;
    const t0 = this.ctx.currentTime;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(this.masterVolumeLinear, t0 + sec);

    if (youtubePlayerManager.hasActivePlayers()) {
      const startMs = Date.now();
      const targetVol = this.masterVolumeLinear;
      const interval = setInterval(() => {
        const elapsedSec = (Date.now() - startMs) / 1000;
        const ratio = Math.min(1, elapsedSec / sec);
        youtubePlayerManager.setMasterVolumeLinear(targetVol * ratio);
        if (elapsedSec >= sec || token !== this.fadeToken) {
          clearInterval(interval);
          if (token === this.fadeToken) {
            youtubePlayerManager.setMasterVolumeLinear(targetVol);
          }
        }
      }, 50);
    }

    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (token !== this.fadeToken) {
          resolve(false);
          return;
        }
        this.fading = false;
        resolve(true);
      }, sec * 1000 + 20);
    });
  }

  async addLayer(
    layer: MixerLayer,
    onProgress?: DecodeProgressCallback,
    startOpts?: SampleStartOptions,
  ): Promise<void> {
    if (layer.kind === 'noise') {
      await this.addNoiseLayer(layer.params);
    } else if (layer.kind === 'sample') {
      await this.addSampleLayer(layer.params, onProgress, startOpts);
    } else if (layer.kind === 'youtube') {
      await this.addYoutubeLayer(layer.params);
    }
  }

  /**
   * Ensure a YouTube iframe exists for the layer (reuses when videoId matches).
   * @param opts.wantPlay — override transport; defaults to engine wantRunning
   * @param opts.preloadOnly — create/reuse without forcing global play
   */
  async addYoutubeLayer(
    params: YoutubeLayerParams,
    opts?: { wantPlay?: boolean; preloadOnly?: boolean },
  ): Promise<void> {
    const host =
      this.youtubeHostElement ??
      (typeof document !== 'undefined' ? document.body : (null as unknown as HTMLElement));
    const wantPlay =
      opts?.preloadOnly === true
        ? false
        : (opts?.wantPlay ?? this.wantRunning);
    try {
      // Mark media-output coexistence before iframe starts so the background
      // <audio> element cannot steal exclusive focus on mobile.
      this.mediaOutput.setHasYoutubeLayers(true);
      await youtubePlayerManager.ensurePlayer(
        params.id,
        params.videoId,
        host,
        params.volumeLinear,
        params.muted,
        wantPlay,
      );
      this.mediaOutput.setHasYoutubeLayers(
        youtubePlayerManager.hasActivePlayers(),
      );
    } catch (err) {
      console.warn('YouTube player creation failed:', err);
      this.mediaOutput.setHasYoutubeLayers(
        youtubePlayerManager.hasActivePlayers(),
      );
    }
  }

  updateYoutubeLayer(params: YoutubeLayerParams): void {
    youtubePlayerManager.setVolume(params.id, params.volumeLinear);
  }

  async addNoiseLayer(params: NoiseLayerParams): Promise<void> {
    const ctx = await this.ensureContext();
    if (!this.mixBus) throw new Error('Mix bus missing');
    if (this.layers.has(params.id)) {
      this.updateNoiseLayer(params);
      return;
    }

    const worklet = new AudioWorkletNode(ctx, 'noise-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { width: params.stereoWidth },
    });
    worklet.port.postMessage({
      type: 'setNoiseType',
      noiseType: params.type,
    });

    const filter = ctx.createBiquadFilter();
    this.configureFilter(filter, params.type);

    const userHp = ctx.createBiquadFilter();
    const userLp = ctx.createBiquadFilter();
    this.applyUserFilters(userHp, userLp, params.highpassHz, params.lowpassHz);

    const volume = ctx.createGain();
    volume.gain.value = clampLinear(params.volumeLinear);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, params.pan));

    const muteSolo = ctx.createGain();
    muteSolo.gain.value = 1;

    // worklet → type filter → user HP → user LP → volume → pan → muteSolo → mixBus
    worklet.connect(filter);
    filter.connect(userHp);
    userHp.connect(userLp);
    userLp.connect(volume);
    volume.connect(pan);
    pan.connect(muteSolo);
    muteSolo.connect(this.mixBus);

    const nodes: NoiseNodes = {
      kind: 'noise',
      worklet,
      volume,
      pan,
      muteSolo,
      filter,
      userLp,
      userHp,
      panLfo: null,
      baseVolumeLinear: params.volumeLinear,
      basePan: params.pan,
      driftParams: {
        driftPitch: false,
        driftPan: params.driftPan ?? false,
        driftGain: params.driftGain ?? false,
      },
      driftTimer: null,
    };
    this.syncPanLfo(nodes, params);
    this.layers.set(params.id, nodes);
    this.scheduleLayerDrift(params.id, nodes);
  }

  updateNoiseLayer(params: NoiseLayerParams): void {
    const nodes = this.layers.get(params.id);
    if (!nodes || nodes.kind !== 'noise' || !this.ctx) return;
    const t = this.ctx.currentTime;

    nodes.baseVolumeLinear = params.volumeLinear;
    nodes.basePan = params.pan;
    nodes.driftParams = {
      driftPitch: false,
      driftPan: params.driftPan ?? false,
      driftGain: params.driftGain ?? false,
    };

    nodes.worklet.port.postMessage({
      type: 'setNoiseType',
      noiseType: params.type,
    });
    const widthParam = nodes.worklet.parameters.get('width');
    if (widthParam) {
      widthParam.setTargetAtTime(
        Math.max(0, Math.min(1, params.stereoWidth)),
        t,
        0.01,
      );
    }

    this.configureFilter(nodes.filter, params.type);
    this.applyUserFilters(nodes.userHp, nodes.userLp, params.highpassHz, params.lowpassHz);
    if (!nodes.driftParams.driftGain) {
      nodes.volume.gain.setTargetAtTime(clampLinear(params.volumeLinear), t, 0.015);
    }
    this.syncPanLfo(nodes, params);
    this.scheduleLayerDrift(params.id, nodes);
  }

  async addSampleLayer(
    params: SampleLayerParams,
    onProgress?: DecodeProgressCallback,
    startOpts?: SampleStartOptions,
  ): Promise<void> {
    const ctx = await this.ensureContext();
    if (!this.mixBus) throw new Error('Mix bus missing');
    if (this.layers.has(params.id)) {
      this.updateSampleLayer(params);
      return;
    }

    // Fresh load for this id — clear any prior cancel from a previous attempt.
    this.cancelledLoads.delete(params.id);
    this.inflightLoads.add(params.id);

    try {
      const buffer = await this.decodeSampleBuffer(ctx, params, onProgress);

      // Layer removed / mix cleared while the FreeSound file was downloading.
      if (this.cancelledLoads.has(params.id)) {
        return;
      }
      if (this.layers.has(params.id)) {
        this.updateSampleLayer(params);
        return;
      }

      const userHp = ctx.createBiquadFilter();
      const userLp = ctx.createBiquadFilter();
      this.applyUserFilters(userHp, userLp, params.highpassHz, params.lowpassHz);

      const volume = ctx.createGain();
      volume.gain.value = clampLinear(params.volumeLinear);

      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, params.pan));

      const muteSolo = ctx.createGain();
      muteSolo.gain.value = 1;

      // player → user HP → user LP → volume → pan → muteSolo → mixBus
      userHp.connect(userLp);
      userLp.connect(volume);
      volume.connect(pan);
      pan.connect(muteSolo);
      muteSolo.connect(this.mixBus);

      const player = new SamplePlayer(ctx, buffer, userHp, {
        loopMode: params.loopMode,
        crossfadeMs: params.crossfadeMs,
        playbackRate: params.playbackRate,
      });
      const offsetSec = pickDuplicateStartOffset(
        buffer.duration,
        startOpts?.siblingIndex ?? 0,
        startOpts?.siblingCount ?? 1,
        startOpts?.minOffsetSec ?? DUPLICATE_MIN_OFFSET_DEFAULT_SEC,
      );
      player.start(offsetSec);

      const nodes: SampleNodes = {
        kind: 'sample',
        player,
        volume,
        pan,
        muteSolo,
        userLp,
        userHp,
        panLfo: null,
        baseVolumeLinear: params.volumeLinear,
        basePan: params.pan,
        basePlaybackRate: params.playbackRate,
        driftParams: {
          driftPitch: params.driftPitch ?? false,
          driftPan: params.driftPan ?? false,
          driftGain: params.driftGain ?? false,
        },
        driftTimer: null,
      };
      this.syncPanLfo(nodes, params);
      this.layers.set(params.id, nodes);
      this.scheduleLayerDrift(params.id, nodes);
    } finally {
      this.inflightLoads.delete(params.id);
      this.cancelledLoads.delete(params.id);
    }
  }

  /**
   * Decode a sample from the core catalog URL or IndexedDB local import.
   */
  private async decodeSampleBuffer(
    ctx: AudioContext,
    params: SampleLayerParams,
    onProgress?: DecodeProgressCallback,
  ): Promise<AudioBuffer> {
    if (isLocalAssetId(params.assetId)) {
      const cacheKey = `local-audio:${params.assetId}`;
      if (decodeCache.has(cacheKey)) {
        return decodeCache.get(ctx, cacheKey, { onProgress });
      }
      onProgress?.({
        loaded: 0,
        total: null,
        phase: 'fetch',
        ratio: 0.1,
        determinate: false,
      });
      const ab = await getLocalAudioData(params.assetId);
      if (!ab) {
        throw new Error(`Local audio missing: ${params.assetId}`);
      }
      onProgress?.({
        loaded: ab.byteLength,
        total: ab.byteLength,
        phase: 'decode',
        ratio: 0.9,
        determinate: true,
      });
      const buffer = await ctx.decodeAudioData(ab.slice(0));
      decodeCache.put(cacheKey, buffer);
      onProgress?.({
        loaded: ab.byteLength,
        total: ab.byteLength,
        phase: 'decode',
        ratio: 1,
        determinate: true,
      });
      return buffer;
    }

    if (!this.catalog) throw new Error('Catalog not loaded');
    const asset = findAsset(this.catalog, params.assetId);
    if (!asset) throw new Error(`Unknown asset: ${params.assetId}`);
    const url = assetUrl(asset.file);
    return decodeCache.get(ctx, url, { onProgress });
  }

  updateSampleLayer(params: SampleLayerParams): void {
    const nodes = this.layers.get(params.id);
    if (!nodes || nodes.kind !== 'sample' || !this.ctx) return;
    const t = this.ctx.currentTime;
    nodes.baseVolumeLinear = params.volumeLinear;
    nodes.basePan = params.pan;
    nodes.basePlaybackRate = params.playbackRate;
    nodes.driftParams = {
      driftPitch: params.driftPitch ?? false,
      driftPan: params.driftPan ?? false,
      driftGain: params.driftGain ?? false,
    };
    if (!nodes.driftParams.driftGain) {
      nodes.volume.gain.setTargetAtTime(clampLinear(params.volumeLinear), t, 0.015);
    }
    this.applyUserFilters(nodes.userHp, nodes.userLp, params.highpassHz, params.lowpassHz);
    this.syncPanLfo(nodes, params);
    this.scheduleLayerDrift(params.id, nodes);
  }

  async addPlaylistLayer(
    params: PlaylistLayerParams,
    item?: PlaylistItem,
    onTrackEnded?: () => void,
    opts?: { wantPlay?: boolean; preloadOnly?: boolean },
  ): Promise<void> {
    if (!item) {
      this.removeLayer(params.id);
      return;
    }

    if (item.type === 'youtube' && item.videoId) {
      // Teardown any sample player nodes for this layer id
      const existing = this.layers.get(params.id);
      if (existing) {
        this.disposePanLfo(existing);
        if (existing.kind === 'playlist' && existing.player) {
          existing.player.stop();
          existing.player.dispose();
        }
        try {
          existing.userHp.disconnect();
          existing.userLp.disconnect();
          existing.volume.disconnect();
          existing.pan.disconnect();
          existing.muteSolo.disconnect();
        } catch {
          /* ignore */
        }
        this.layers.delete(params.id);
      }

      await this.addYoutubeLayer({
        id: params.id,
        videoId: item.videoId,
        url: item.url || `https://www.youtube.com/watch?v=${item.videoId}`,
        label: item.title,
        thumbnailUrl:
          item.thumbnailUrl ||
          `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`,
        volumeLinear: params.volumeLinear,
        muted: params.muted,
        solo: params.solo,
        pan: params.pan,
        lowpassHz: params.lowpassHz,
        highpassHz: params.highpassHz,
        panLfoEnabled: params.panLfoEnabled,
        panLfoRateHz: params.panLfoRateHz,
        panLfoDepth: params.panLfoDepth,
        driftPitch: false,
        driftPan: false,
        driftGain: params.driftGain ?? false,
      }, opts);

      if (onTrackEnded) {
        youtubePlayerManager.onTrackEnded((endedLayerId) => {
          if (endedLayerId === params.id && this.wantRunning) {
            onTrackEnded();
          }
        });
      }
      return;
    }

    if (item.type === 'local' && item.assetId) {
      youtubePlayerManager.pausePlayer(params.id);
      this.mediaOutput.setHasYoutubeLayers(
        youtubePlayerManager.hasActivePlayers(),
      );

      const ctx = await this.ensureContext();
      this.inflightLoads.add(params.id);
      try {
        const buffer = await this.decodeSampleBuffer(ctx, {
          id: params.id,
          assetId: item.assetId,
          label: item.title,
          volumeLinear: params.volumeLinear,
          muted: params.muted,
          solo: params.solo,
          pan: params.pan,
          loopMode: 'native',
          crossfadeMs: 0,
          playbackRate: 1,
          lowpassHz: params.lowpassHz,
          highpassHz: params.highpassHz,
          panLfoEnabled: params.panLfoEnabled,
          panLfoRateHz: params.panLfoRateHz,
          panLfoDepth: params.panLfoDepth,
          driftPitch: params.driftPitch ?? false,
          driftPan: params.driftPan ?? false,
          driftGain: params.driftGain ?? false,
        });

        if (this.cancelledLoads.has(params.id)) return;

        this.removeLayer(params.id);

        const userHp = ctx.createBiquadFilter();
        const userLp = ctx.createBiquadFilter();
        this.applyUserFilters(
          userHp,
          userLp,
          params.highpassHz,
          params.lowpassHz,
        );

        const volume = ctx.createGain();
        volume.gain.value = clampLinear(params.volumeLinear);

        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, params.pan));

        const muteSolo = ctx.createGain();
        muteSolo.gain.value = 1;

        userHp.connect(userLp);
        userLp.connect(volume);
        volume.connect(pan);
        pan.connect(muteSolo);
        muteSolo.connect(this.mixBus!);

        const player = new SamplePlayer(ctx, buffer, userHp, {
          loopMode: 'once',
          crossfadeMs: 0,
          playbackRate: 1,
          onEnded: () => {
            if (this.wantRunning) {
              onTrackEnded?.();
            }
          },
        });

        const shouldPlay =
          opts?.preloadOnly !== true &&
          (opts?.wantPlay ?? this.wantRunning);
        if (shouldPlay) {
          player.start();
        }

        const nodes: PlaylistNodes = {
          kind: 'playlist',
          player,
          volume,
          pan,
          muteSolo,
          userLp,
          userHp,
          panLfo: null,
          activeType: 'local',
          baseVolumeLinear: params.volumeLinear,
          basePan: params.pan,
          basePlaybackRate: 1,
          driftParams: {
            driftPitch: params.driftPitch ?? false,
            driftPan: params.driftPan ?? false,
            driftGain: params.driftGain ?? false,
          },
          driftTimer: null,
        };
        this.syncPanLfo(nodes, params);
        this.layers.set(params.id, nodes);
        this.scheduleLayerDrift(params.id, nodes);
      } finally {
        this.inflightLoads.delete(params.id);
        this.cancelledLoads.delete(params.id);
      }
    }
  }

  updatePlaylistLayer(params: PlaylistLayerParams): void {
    if (youtubePlayerManager.hasPlayer(params.id)) {
      this.updateYoutubeLayer({
        id: params.id,
        videoId: '',
        url: '',
        label: params.currentTrackTitle || params.playlistName,
        thumbnailUrl: '',
        volumeLinear: params.volumeLinear,
        muted: params.muted,
        solo: params.solo,
        pan: params.pan,
        lowpassHz: params.lowpassHz,
        highpassHz: params.highpassHz,
        panLfoEnabled: params.panLfoEnabled,
        panLfoRateHz: params.panLfoRateHz,
        panLfoDepth: params.panLfoDepth,
        driftPitch: params.driftPitch,
        driftPan: params.driftPan,
        driftGain: params.driftGain,
      });
      return;
    }

    const nodes = this.layers.get(params.id);
    if (!nodes || nodes.kind !== 'playlist' || !this.ctx) return;
    const t = this.ctx.currentTime;
    nodes.baseVolumeLinear = params.volumeLinear;
    nodes.basePan = params.pan;
    nodes.driftParams = {
      driftPitch: params.driftPitch ?? false,
      driftPan: params.driftPan ?? false,
      driftGain: params.driftGain ?? false,
    };
    if (!nodes.driftParams.driftGain) {
      nodes.volume.gain.setTargetAtTime(
        clampLinear(params.volumeLinear),
        t,
        0.015,
      );
    }
    this.applyUserFilters(
      nodes.userHp,
      nodes.userLp,
      params.highpassHz,
      params.lowpassHz,
    );
    this.syncPanLfo(nodes, params);
    this.scheduleLayerDrift(params.id, nodes);
  }

  /**
   * Total mix energy sum for multi-layer drift headroom scaling.
   */
  getMixEnergy(): number {
    let energy = 0;
    for (const nodes of this.layers.values()) {
      const v = Math.max(0, Math.min(1, nodes.baseVolumeLinear ?? 0));
      if (v > 0) energy += v * v;
    }
    return energy;
  }

  /**
   * Returns the current live drifting spatial parameters and applied deltas for a layer.
   */
  getLayerLiveDrift(id: string): LayerLiveDrift | null {
    const nodes = this.layers.get(id);
    if (!nodes) return null;

    const basePan = nodes.basePan ?? 0;
    const baseVol = nodes.baseVolumeLinear ?? 0.7;
    const baseRate = 'basePlaybackRate' in nodes ? (nodes.basePlaybackRate ?? 1) : 1;
    const driftParams = nodes.driftParams ?? { driftPitch: false, driftPan: false, driftGain: false };
    const ctx = this.ctx;
    const isPlaying = Boolean(this.wantRunning && ctx && ctx.state === 'running');

    if (!isPlaying || !ctx || !nodes.driftState) {
      return {
        livePan: basePan,
        liveVol: baseVol,
        liveRate: baseRate,
        targetPan: basePan,
        targetVol: baseVol,
        targetRate: baseRate,
        basePan,
        baseVol,
        baseRate,
        panDelta: 0,
        gainDbDelta: 0,
        pitchPercentDelta: 0,
        driftPanActive: driftParams.driftPan,
        driftGainActive: driftParams.driftGain,
        driftPitchActive: driftParams.driftPitch,
      };
    }

    const { startPan, targetPan, startGain, targetGain, startRate, targetRate, startTime, rampSec } =
      nodes.driftState;
    const t = ctx.currentTime;
    const elapsed = Math.max(0, t - startTime);
    const alpha = rampSec > 0 ? Math.max(0, Math.min(1, elapsed / rampSec)) : 1;
    const ease = alpha * alpha * (3 - 2 * alpha);

    const livePan = driftParams.driftPan ? startPan + (targetPan - startPan) * ease : basePan;
    const liveVol = driftParams.driftGain ? startGain + (targetGain - startGain) * ease : baseVol;
    const liveRate = driftParams.driftPitch ? startRate + (targetRate - startRate) * ease : baseRate;

    const effectiveTargetPan = driftParams.driftPan ? targetPan : basePan;
    const effectiveTargetVol = driftParams.driftGain ? targetGain : baseVol;
    const effectiveTargetRate = driftParams.driftPitch ? targetRate : baseRate;

    const panDelta = effectiveTargetPan - basePan;
    const gainDbDelta = linearToDb(Math.max(0.0001, effectiveTargetVol)) - linearToDb(Math.max(0.0001, baseVol));
    const pitchPercentDelta = baseRate > 0 && driftParams.driftPitch ? ((effectiveTargetRate / baseRate) - 1) * 100 : 0;

    return {
      livePan: Math.max(-1, Math.min(1, livePan)),
      liveVol: Math.max(0, Math.min(1, liveVol)),
      liveRate,
      targetPan: Math.max(-1, Math.min(1, effectiveTargetPan)),
      targetVol: Math.max(0, Math.min(1, effectiveTargetVol)),
      targetRate: effectiveTargetRate,
      basePan,
      baseVol,
      baseRate,
      panDelta,
      gainDbDelta,
      pitchPercentDelta,
      driftPanActive: driftParams.driftPan,
      driftGainActive: driftParams.driftGain,
      driftPitchActive: driftParams.driftPitch,
    };
  }

  /**
   * Sparse discrete-hold random variation scheduler for pitch, pan, and gain.
   */
  private scheduleLayerDrift(id: string, nodes: LayerNodes): void {
    if (nodes.driftTimer != null) {
      clearTimeout(nodes.driftTimer);
      nodes.driftTimer = null;
    }

    if (!this.ctx || !this.wantRunning || this.ctx.state !== 'running' || !nodes.driftParams) {
      return;
    }

    const { enabled, pitchDepthPct, panSpread, gainDepthDb, speed } = this.driftConfig;
    const { driftPitch, driftPan, driftGain } = nodes.driftParams;
    const hasAnyDrift = enabled && (driftPitch || driftPan || driftGain);
    const t = this.ctx.currentTime;

    const prevLive = this.getLayerLiveDrift(id);
    const startPan = prevLive?.livePan ?? nodes.basePan ?? 0;
    const startGain = prevLive?.liveVol ?? nodes.baseVolumeLinear ?? 0.7;
    const startRate = prevLive?.liveRate ?? ('basePlaybackRate' in nodes ? (nodes.basePlaybackRate ?? 1) : 1);

    if (!hasAnyDrift) {
      // Restore exact base parameters
      if (nodes.volume) {
        nodes.volume.gain.setTargetAtTime(clampLinear(nodes.baseVolumeLinear ?? 0.7), t, 0.1);
      }
      if (nodes.pan) {
        nodes.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, nodes.basePan ?? 0)), t, 0.1);
      }
      if (nodes.kind === 'sample' && nodes.player) {
        nodes.player.setPlaybackRate(nodes.basePlaybackRate ?? 1, 0.5);
      } else if (nodes.kind === 'playlist' && nodes.player) {
        nodes.player.setPlaybackRate(nodes.basePlaybackRate ?? 1, 0.5);
      }
      nodes.driftState = {
        startPan: nodes.basePan ?? 0,
        targetPan: nodes.basePan ?? 0,
        startGain: nodes.baseVolumeLinear ?? 0.7,
        targetGain: nodes.baseVolumeLinear ?? 0.7,
        startRate: 'basePlaybackRate' in nodes ? (nodes.basePlaybackRate ?? 1) : 1,
        targetRate: 'basePlaybackRate' in nodes ? (nodes.basePlaybackRate ?? 1) : 1,
        startTime: t,
        rampSec: 0.1,
      };
      return;
    }

    const eco = powerSaver.isPowerSaverActive();
    const { holdSec, rampSec } = calculateRandomInterval(eco, speed);
    const tc = Math.max(0.1, rampSec / 3);

    let targetRate = 'basePlaybackRate' in nodes ? (nodes.basePlaybackRate ?? 1) : 1;
    let targetPan = nodes.basePan ?? 0;
    let targetGain = nodes.baseVolumeLinear ?? 0.7;

    // 1. Pitch Drift (disabled in eco mode to avoid resampling compute)
    const pitchRatio = Math.max(0.005, Math.min(0.25, pitchDepthPct / 100));
    if (nodes.kind === 'sample' && nodes.player) {
      if (driftPitch && !eco) {
        targetRate = calculateDriftPitch(nodes.basePlaybackRate ?? 1, 1, pitchRatio);
        nodes.player.setPlaybackRate(targetRate, rampSec);
      } else {
        targetRate = nodes.basePlaybackRate ?? 1;
        nodes.player.setPlaybackRate(targetRate, 0.5);
      }
    } else if (nodes.kind === 'playlist' && nodes.player) {
      if (driftPitch && !eco) {
        targetRate = calculateDriftPitch(nodes.basePlaybackRate ?? 1, 1, pitchRatio);
        nodes.player.setPlaybackRate(targetRate, rampSec);
      } else {
        targetRate = nodes.basePlaybackRate ?? 1;
        nodes.player.setPlaybackRate(targetRate, 0.5);
      }
    }

    // 2. Pan Drift
    if (nodes.pan) {
      if (driftPan) {
        targetPan = calculateDriftPan(nodes.basePan ?? 0, 1, panSpread);
        nodes.pan.pan.setTargetAtTime(targetPan, t, tc);
      } else {
        targetPan = Math.max(-1, Math.min(1, nodes.basePan ?? 0));
        nodes.pan.pan.setTargetAtTime(targetPan, t, 0.1);
      }
    }

    // 3. Gain Drift with Multi-Tier Saturation Prevention
    if (nodes.volume) {
      if (driftGain) {
        const energy = this.getMixEnergy();
        targetGain = calculateDriftGain(nodes.baseVolumeLinear ?? 0.7, energy, 1, gainDepthDb);
        nodes.volume.gain.setTargetAtTime(clampLinear(targetGain), t, tc);
      } else {
        targetGain = clampLinear(nodes.baseVolumeLinear ?? 0.7);
        nodes.volume.gain.setTargetAtTime(targetGain, t, 0.1);
      }
    }

    nodes.driftState = {
      startPan,
      targetPan,
      startGain,
      targetGain,
      startRate,
      targetRate,
      startTime: t,
      rampSec,
    };

    const nextDelayMs = Math.max(500, Math.round((holdSec + rampSec) * 1000));
    nodes.driftTimer = setTimeout(() => {
      if (this.layers.get(id) === nodes) {
        this.scheduleLayerDrift(id, nodes);
      }
    }, nextDelayMs);
  }

  /**
   * Base pan on StereoPanner + optional sine LFO summed into pan.pan (ENH-15).
   */
  private syncPanLfo(
    nodes: LayerNodes,
    params: {
      pan: number;
      panLfoEnabled?: boolean;
      panLfoRateHz?: number;
      panLfoDepth?: number;
    },
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const basePan = Math.max(-1, Math.min(1, params.pan));
    const enabled = Boolean(params.panLfoEnabled);
    const depth = clampPanLfoDepth(params.panLfoDepth ?? 0);
    const rate = clampPanLfoRateHz(params.panLfoRateHz ?? 0.08);

    nodes.pan.pan.setTargetAtTime(basePan, t, 0.015);

    if (!enabled || depth < 0.01) {
      this.disposePanLfo(nodes);
      return;
    }

    // Soften depth near hard-pan edges so LFO stays in range
    const edge = 1 - Math.abs(basePan) * 0.55;
    const safeDepth = depth * Math.max(0.15, edge);

    if (!nodes.panLfo) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = rate;
      const depthGain = this.ctx.createGain();
      depthGain.gain.value = safeDepth;
      osc.connect(depthGain);
      depthGain.connect(nodes.pan.pan);
      osc.start();
      nodes.panLfo = { osc, depthGain };
    } else {
      nodes.panLfo.osc.frequency.setTargetAtTime(rate, t, 0.05);
      nodes.panLfo.depthGain.gain.setTargetAtTime(safeDepth, t, 0.05);
    }
  }

  private disposePanLfo(nodes: LayerNodes): void {
    if (!nodes.panLfo) return;
    try {
      nodes.panLfo.osc.stop();
      nodes.panLfo.osc.disconnect();
      nodes.panLfo.depthGain.disconnect();
    } catch {
      /* already stopped */
    }
    nodes.panLfo = null;
  }

  private configureFilter(filter: BiquadFilterNode, type: NoiseType): void {
    switch (type) {
      case 'rain':
        filter.type = 'bandpass';
        filter.frequency.value = 2200;
        filter.Q.value = 0.7;
        break;
      case 'fan':
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        filter.Q.value = 0.5;
        break;
      case 'static':
        // Cut low rumble so sample-hold grit reads as brighter TV/radio static
        filter.type = 'highpass';
        filter.frequency.value = 450;
        filter.Q.value = 0.6;
        break;
      default:
        filter.type = 'allpass';
        filter.frequency.value = 1000;
        filter.Q.value = 0.707;
        break;
    }
  }

  /** Apply user HP/LP; near-open values act as transparent. */
  private applyUserFilters(
    hp: BiquadFilterNode,
    lp: BiquadFilterNode,
    highpassHz: number | undefined,
    lowpassHz: number | undefined,
  ): void {
    const hpHz = clampHighpassHz(highpassHz ?? FILTER_HP_OPEN_HZ);
    const lpHz = clampLowpassHz(lowpassHz ?? FILTER_LP_OPEN_HZ);

    hp.type = 'highpass';
    hp.Q.value = 0.707;
    // Below ~25 Hz highpass is essentially transparent for ambient content
    hp.frequency.value = hpHz <= FILTER_HP_OPEN_HZ + 5 ? 10 : hpHz;

    lp.type = 'lowpass';
    lp.Q.value = 0.707;
    lp.frequency.value = lpHz >= FILTER_LP_OPEN_HZ - 100 ? 22_000 : lpHz;
  }

  removeLayer(id: string): void {
    // Always mark cancel so an in-flight fetch for this id is discarded,
    // even when engine nodes do not exist yet (download still in progress).
    this.cancelledLoads.add(id);
    youtubePlayerManager.destroyPlayer(id);
    this.mediaOutput.setHasYoutubeLayers(youtubePlayerManager.hasActivePlayers());
    const nodes = this.layers.get(id);
    if (!nodes) return;
    try {
      if (nodes.driftTimer != null) {
        clearTimeout(nodes.driftTimer);
        nodes.driftTimer = null;
      }
      this.disposePanLfo(nodes);
      if (nodes.kind === 'noise') {
        nodes.worklet.disconnect();
        nodes.filter.disconnect();
        nodes.userHp.disconnect();
        nodes.userLp.disconnect();
        nodes.worklet.port.close();
      } else if (nodes.kind === 'playlist') {
        if (nodes.player) {
          nodes.player.stop();
          nodes.player.dispose();
        }
        nodes.userHp.disconnect();
        nodes.userLp.disconnect();
      } else {
        nodes.player.stop();
        nodes.player.dispose();
        nodes.userHp.disconnect();
        nodes.userLp.disconnect();
      }
      nodes.volume.disconnect();
      nodes.pan.disconnect();
      nodes.muteSolo.disconnect();
    } catch {
      /* */
    }
    this.layers.delete(id);
  }

  applyMuteSolo(layers: MixerLayer[]): void {
    const anySolo = layers.some((l) => layerSolo(l));
    for (const layer of layers) {
      const g = effectiveMuteSolo(layerMuted(layer), layerSolo(layer), anySolo);
      if (layer.kind === 'youtube') {
        youtubePlayerManager.setMute(layer.params.id, g === 0);
      } else if (layer.kind === 'playlist') {
        if (youtubePlayerManager.hasPlayer(layer.params.id)) {
          youtubePlayerManager.setMute(layer.params.id, g === 0);
        }
        const nodes = this.layers.get(layerId(layer));
        if (nodes && this.ctx) {
          nodes.muteSolo.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
        }
      } else {
        const nodes = this.layers.get(layerId(layer));
        if (!nodes || !this.ctx) continue;
        nodes.muteSolo.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
      }
    }
  }

  getPeakLevels(): { left: number; right: number } {
    let left = 0;
    let right = 0;

    if (this.analyserL) {
      if (!this.peakBufL || this.peakBufL.length !== this.analyserL.fftSize) {
        this.peakBufL = new Float32Array(this.analyserL.fftSize);
      }
      this.analyserL.getFloatTimeDomainData(this.peakBufL);
      for (let i = 0; i < this.peakBufL.length; i++) {
        const a = Math.abs(this.peakBufL[i]!);
        if (a > left) left = a;
      }
    }

    if (this.analyserR) {
      if (!this.peakBufR || this.peakBufR.length !== this.analyserR.fftSize) {
        this.peakBufR = new Float32Array(this.analyserR.fftSize);
      }
      this.analyserR.getFloatTimeDomainData(this.peakBufR);
      for (let i = 0; i < this.peakBufR.length; i++) {
        const a = Math.abs(this.peakBufR[i]!);
        if (a > right) right = a;
      }
    }

    if (!this.analyserL && !this.analyserR) {
      const peak = this.getPeakLevel();
      left = peak;
      right = peak;
    }

    return { left, right };
  }

  getPeakLevel(): number {
    if (!this.analyser) return 0;
    if (!this.peakBuf || this.peakBuf.length !== this.analyser.fftSize) {
      this.peakBuf = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.peakBuf);
    let peak = 0;
    for (let i = 0; i < this.peakBuf.length; i++) {
      const a = Math.abs(this.peakBuf[i]!);
      if (a > peak) peak = a;
    }
    return peak;
  }

  stopAll(): void {
    youtubePlayerManager.destroyAll();
    this.mediaOutput.setHasYoutubeLayers(false);
    // Cancel every sample still downloading, not only layers already wired.
    for (const id of this.inflightLoads) {
      this.cancelledLoads.add(id);
    }
    for (const id of [...this.layers.keys()]) {
      this.removeLayer(id);
    }
  }

  async dispose(): Promise<void> {
    this.wantRunning = false;
    this.powerSaverUnsub?.();
    this.powerSaverUnsub = null;
    this.stopAll();
    this.mediaOutput.dispose();
    decodeCache.clear();
    if (this.ctx) {
      this.ctx.onstatechange = null;
      await this.ctx.close();
      this.ctx = null;
      this.mixBus = null;
      this.bassEq = null;
      this.trebleEq = null;
      this.dryGain = null;
      this.wetGain = null;
      this.convolver = null;
      if (this.limiter) {
        try {
          this.limiter.disconnect();
        } catch {
          /* */
        }
        this.limiter = null;
      }
      this.master = null;
      this.analyser = null;
      this.splitter = null;
      this.analyserL = null;
      this.analyserR = null;
      this.peakBuf = null;
      this.peakBufL = null;
      this.peakBufR = null;
      this.workletReady = false;
      this.stateChangeBound = false;
    }
  }
}

export const audioEngine = new AudioEngine();
