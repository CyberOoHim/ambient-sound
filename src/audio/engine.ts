import workletUrl from './worklets/noise-processor.js?url';
import { clampLinear } from './dsp/curves';
import type { NoiseType } from './dsp/colored-noise';
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
  defaultMasterTone,
  effectiveMuteSolo,
  FILTER_HP_OPEN_HZ,
  FILTER_LP_OPEN_HZ,
  isLocalAssetId,
  layerId,
  layerMuted,
  layerSolo,
  type MasterToneParams,
  type MixerLayer,
  type NoiseLayerParams,
  type SampleLayerParams,
  type YoutubeLayerParams,
} from './types';
import { SamplePlayer } from './sample-player';
import {
  decodeCache,
  type DecodeProgressCallback,
} from './decode-cache';
import { assetUrl, findAsset, type SoundCatalog } from '../assets/catalog';
import { MediaOutput } from './media-output';
import { OneShotEngine } from './one-shot-engine';
import { loadOneShotConfigFromStorage } from '../app/one-shot';
import { BinauralEngine } from './binaural-engine';
import { loadBinauralConfigFromStorage } from '../app/binaural';
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

interface NoiseNodes {
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

interface SampleNodes {
  kind: 'sample';
  player: SamplePlayer;
  volume: GainNode;
  pan: StereoPannerNode;
  muteSolo: GainNode;
  userLp: BiquadFilterNode;
  userHp: BiquadFilterNode;
  panLfo: PanLfoNodes | null;
}

type LayerNodes = NoiseNodes | SampleNodes;

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
 * Graph: layers → mixBus → bass → treble → dry/wet reverb → masterGain → analyser → out
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  /** Sum of all layers / tones / one-shots (unity gain). */
  private mixBus: GainNode | null = null;
  private bassEq: BiquadFilterNode | null = null;
  private trebleEq: BiquadFilterNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  /** Final volume control (sleep timer fade, preset crossfade). */
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private workletReady = false;
  private layers = new Map<string, LayerNodes>();
  private masterVolumeLinear = 1;
  private masterTone: MasterToneParams = defaultMasterTone();
  private fadeToken = 0;
  private fading = false;
  private catalog: SoundCatalog | null = null;
  private mediaOutput = new MediaOutput();
  private peakBuf: Float32Array<ArrayBuffer> | null = null;
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;
  private timeBuf: Uint8Array<ArrayBuffer> | null = null;
  /** User wants audio running (used to re-resume after iOS interrupt). */
  private wantRunning = false;
  private stateChangeBound = false;
  /**
   * Layer ids whose in-flight sample fetch/decode should be discarded.
   * Set by removeLayer / stopAll so a late download cannot start audio
   * after the mix layer was cleared or deleted.
   */
  private cancelledLoads = new Set<string>();
  /** Sample layer ids currently awaiting fetch/decode. */
  private inflightLoads = new Set<string>();
  private youtubeHostElement: HTMLElement | null = null;

  public oneShotEngine: OneShotEngine;
  public binauralEngine: BinauralEngine;

  constructor() {
    this.oneShotEngine = new OneShotEngine(loadOneShotConfigFromStorage());
    this.binauralEngine = new BinauralEngine(loadBinauralConfigFromStorage());
  }

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
    if (this.ctx && this.mixBus) {
      this.oneShotEngine.setAudioTarget(this.ctx, this.mixBus, catalog);
    }
  }

  async ensureContext(): Promise<AudioContext> {
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

      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolumeLinear;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;

      // mixBus → EQ → dry + wet reverb → master → analyser → out
      this.mixBus.connect(this.bassEq);
      this.bassEq.connect(this.trebleEq);
      this.trebleEq.connect(this.dryGain);
      this.trebleEq.connect(this.convolver);
      this.convolver.connect(this.wetGain);
      this.dryGain.connect(this.master);
      this.wetGain.connect(this.master);
      this.master.connect(this.analyser);

      // Mobile (iOS + Android): route via HTMLAudioElement for background
      // playback / media controls. Desktop: analyser → destination.
      this.mediaOutput.attach(this.ctx, this.analyser);
      this.mediaOutput.connectDestination(this.ctx, this.analyser);
      this.bindStateChange(this.ctx);
      this.oneShotEngine.setAudioTarget(this.ctx, this.mixBus, this.catalog);
      this.binauralEngine.setAudioTarget(this.ctx, this.mixBus);
    }
    if (!this.workletReady) {
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.workletReady = true;
    }
    return this.ctx;
  }

  private applyReverbMix(wet: number): void {
    const w = clampReverbWet(wet);
    if (this.dryGain) this.dryGain.gain.value = 1 - w * 0.9;
    if (this.wetGain) this.wetGain.gain.value = w;
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
          // Restart sub-engines that were torn down during the interruption
          this.oneShotEngine.start();
          this.binauralEngine.start();
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
    this.oneShotEngine.start();
    this.binauralEngine.start();
    youtubePlayerManager.setGlobalPlaying(true);
    // Unmute Web Audio after transport pause. Session.play may immediately
    // re-zero for holdSilent crossfades; visibility/onstatechange need this.
    if (!this.fading) {
      this.restoreMasterGain();
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
    this.oneShotEngine.stop();
    this.binauralEngine.stop();
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
    const host = this.youtubeHostElement ?? document.body;
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
    };
    this.syncPanLfo(nodes, params);
    this.layers.set(params.id, nodes);
  }

  updateNoiseLayer(params: NoiseLayerParams): void {
    const nodes = this.layers.get(params.id);
    if (!nodes || nodes.kind !== 'noise' || !this.ctx) return;
    const t = this.ctx.currentTime;

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
    nodes.volume.gain.setTargetAtTime(clampLinear(params.volumeLinear), t, 0.015);
    this.syncPanLfo(nodes, params);
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
      };
      this.syncPanLfo(nodes, params);
      this.layers.set(params.id, nodes);
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
    nodes.volume.gain.setTargetAtTime(clampLinear(params.volumeLinear), t, 0.015);
    this.applyUserFilters(nodes.userHp, nodes.userLp, params.highpassHz, params.lowpassHz);
    this.syncPanLfo(nodes, params);
    // Rate / loop mode: apply only on restart (v1 simplification)
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
      this.disposePanLfo(nodes);
      if (nodes.kind === 'noise') {
        nodes.worklet.disconnect();
        nodes.filter.disconnect();
        nodes.userHp.disconnect();
        nodes.userLp.disconnect();
        nodes.worklet.port.close();
      } else {
        nodes.player.stop();
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
      } else {
        const nodes = this.layers.get(layerId(layer));
        if (!nodes || !this.ctx) continue;
        nodes.muteSolo.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
      }
    }
  }

  getPeakLevel(): number {
    if (!this.analyser) return 0;
    if (!this.peakBuf || this.peakBuf.length !== this.analyser.fftSize) {
      this.peakBuf = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.peakBuf);
    let peak = 0;
    for (let i = 0; i < this.peakBuf.length; i++) {
      const a = Math.abs(this.peakBuf[i]);
      if (a > peak) peak = a;
    }
    return peak;
  }

  /** Frequency bins 0..255 for visualizer. Returns null if analyser not ready. */
  getFrequencyData(): Uint8Array | null {
    if (!this.analyser) return null;
    const n = this.analyser.frequencyBinCount;
    if (!this.freqBuf || this.freqBuf.length !== n) {
      this.freqBuf = new Uint8Array(n);
    }
    this.analyser.getByteFrequencyData(this.freqBuf);
    return this.freqBuf;
  }

  /** Time-domain waveform 0..255 for visualizer. */
  getTimeDomainData(): Uint8Array | null {
    if (!this.analyser) return null;
    const n = this.analyser.fftSize;
    if (!this.timeBuf || this.timeBuf.length !== n) {
      this.timeBuf = new Uint8Array(n);
    }
    this.analyser.getByteTimeDomainData(this.timeBuf);
    return this.timeBuf;
  }

  stopAll(): void {
    this.oneShotEngine.stop();
    this.binauralEngine.stop();
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
    this.oneShotEngine.stop();
    this.binauralEngine.stop();
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
      this.master = null;
      this.analyser = null;
      this.workletReady = false;
      this.stateChangeBound = false;
    }
  }
}

export const audioEngine = new AudioEngine();
