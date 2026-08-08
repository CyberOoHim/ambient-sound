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
  clampPanLfoDepth,
  clampPanLfoRateHz,
  effectiveMuteSolo,
  FILTER_HP_OPEN_HZ,
  FILTER_LP_OPEN_HZ,
  isLocalAssetId,
  layerId,
  layerMuted,
  layerSolo,
  type MixerLayer,
  type NoiseLayerParams,
  type SampleLayerParams,
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
 * Web Audio engine: master bus + noise and sample layers.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private workletReady = false;
  private layers = new Map<string, LayerNodes>();
  private masterVolumeLinear = 1;
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

  public oneShotEngine: OneShotEngine;
  public binauralEngine: BinauralEngine;

  constructor() {
    this.oneShotEngine = new OneShotEngine(loadOneShotConfigFromStorage());
    this.binauralEngine = new BinauralEngine(loadBinauralConfigFromStorage());
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

  setCatalog(catalog: SoundCatalog): void {
    this.catalog = catalog;
    if (this.ctx && this.master) {
      this.oneShotEngine.setAudioTarget(this.ctx, this.master, catalog);
    }
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolumeLinear;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;
      this.master.connect(this.analyser);
      // Mobile (iOS + Android): route via HTMLAudioElement for background
      // playback / media controls. Desktop: analyser → destination.
      this.mediaOutput.attach(this.ctx, this.analyser);
      this.mediaOutput.connectDestination(this.ctx, this.analyser);
      this.bindStateChange(this.ctx);
      this.oneShotEngine.setAudioTarget(this.ctx, this.master, this.catalog);
      this.binauralEngine.setAudioTarget(this.ctx, this.master);
    }
    if (!this.workletReady) {
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.workletReady = true;
    }
    return this.ctx;
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
        void ctx.resume().then(() => this.mediaOutput.play());
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
  }

  async suspend(): Promise<void> {
    this.wantRunning = false;
    this.oneShotEngine.stop();
    this.binauralEngine.stop();
    this.mediaOutput.pause();
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  setMasterVolumeLinear(linear: number): void {
    this.masterVolumeLinear = clampLinear(linear);
    if (this.fading) return;
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
    if (!this.master || !this.ctx) return;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(this.masterVolumeLinear, t);
  }

  async addLayer(
    layer: MixerLayer,
    onProgress?: DecodeProgressCallback,
    startOpts?: SampleStartOptions,
  ): Promise<void> {
    if (layer.kind === 'noise') {
      await this.addNoiseLayer(layer.params);
    } else {
      await this.addSampleLayer(layer.params, onProgress, startOpts);
    }
  }

  async addNoiseLayer(params: NoiseLayerParams): Promise<void> {
    const ctx = await this.ensureContext();
    if (!this.master) throw new Error('Master bus missing');
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

    // worklet → type filter → user HP → user LP → volume → pan → muteSolo → master
    worklet.connect(filter);
    filter.connect(userHp);
    userHp.connect(userLp);
    userLp.connect(volume);
    volume.connect(pan);
    pan.connect(muteSolo);
    muteSolo.connect(this.master);

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
    if (!this.master) throw new Error('Master bus missing');
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

      // player → user HP → user LP → volume → pan → muteSolo → master
      userHp.connect(userLp);
      userLp.connect(volume);
      volume.connect(pan);
      pan.connect(muteSolo);
      muteSolo.connect(this.master);

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
      const nodes = this.layers.get(layerId(layer));
      if (!nodes || !this.ctx) continue;
      const g = effectiveMuteSolo(layerMuted(layer), layerSolo(layer), anySolo);
      nodes.muteSolo.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
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
      this.master = null;
      this.analyser = null;
      this.workletReady = false;
      this.stateChangeBound = false;
    }
  }
}

export const audioEngine = new AudioEngine();
