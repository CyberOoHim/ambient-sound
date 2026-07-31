import workletUrl from './worklets/noise-processor.js?url';
import { clampLinear } from './dsp/curves';
import type { NoiseType } from './dsp/colored-noise';
import {
  effectiveMuteSolo,
  layerId,
  layerMuted,
  layerSolo,
  type MixerLayer,
  type NoiseLayerParams,
  type SampleLayerParams,
} from './types';
import { SamplePlayer } from './sample-player';
import { decodeCache } from './decode-cache';
import { assetUrl, findAsset, type SoundCatalog } from '../assets/catalog';

interface NoiseNodes {
  kind: 'noise';
  worklet: AudioWorkletNode;
  volume: GainNode;
  pan: StereoPannerNode;
  muteSolo: GainNode;
  filter: BiquadFilterNode;
}

interface SampleNodes {
  kind: 'sample';
  player: SamplePlayer;
  volume: GainNode;
  pan: StereoPannerNode;
  muteSolo: GainNode;
}

type LayerNodes = NoiseNodes | SampleNodes;

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

  get context(): AudioContext | null {
    return this.ctx;
  }

  get isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  get isFading(): boolean {
    return this.fading;
  }

  setCatalog(catalog: SoundCatalog): void {
    this.catalog = catalog;
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolumeLinear;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (!this.workletReady) {
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.workletReady = true;
    }
    return this.ctx;
  }

  async resume(): Promise<void> {
    const ctx = await this.ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
  }

  async suspend(): Promise<void> {
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

  async addLayer(layer: MixerLayer): Promise<void> {
    if (layer.kind === 'noise') {
      await this.addNoiseLayer(layer.params);
    } else {
      await this.addSampleLayer(layer.params);
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

    const volume = ctx.createGain();
    volume.gain.value = clampLinear(params.volumeLinear);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, params.pan));

    const muteSolo = ctx.createGain();
    muteSolo.gain.value = 1;

    worklet.connect(filter);
    filter.connect(volume);
    volume.connect(pan);
    pan.connect(muteSolo);
    muteSolo.connect(this.master);

    this.layers.set(params.id, { kind: 'noise', worklet, volume, pan, muteSolo, filter });
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
    nodes.volume.gain.setTargetAtTime(clampLinear(params.volumeLinear), t, 0.015);
    nodes.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, params.pan)), t, 0.015);
  }

  async addSampleLayer(params: SampleLayerParams): Promise<void> {
    const ctx = await this.ensureContext();
    if (!this.master) throw new Error('Master bus missing');
    if (this.layers.has(params.id)) {
      this.updateSampleLayer(params);
      return;
    }
    if (!this.catalog) throw new Error('Catalog not loaded');
    const asset = findAsset(this.catalog, params.assetId);
    if (!asset) throw new Error(`Unknown asset: ${params.assetId}`);

    const url = assetUrl(asset.file);
    const buffer = await decodeCache.get(ctx, url);

    const volume = ctx.createGain();
    volume.gain.value = clampLinear(params.volumeLinear);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, params.pan));

    const muteSolo = ctx.createGain();
    muteSolo.gain.value = 1;

    volume.connect(pan);
    pan.connect(muteSolo);
    muteSolo.connect(this.master);

    const player = new SamplePlayer(ctx, buffer, volume, {
      loopMode: params.loopMode,
      crossfadeMs: params.crossfadeMs,
      playbackRate: params.playbackRate,
    });
    player.start();

    this.layers.set(params.id, { kind: 'sample', player, volume, pan, muteSolo });
  }

  updateSampleLayer(params: SampleLayerParams): void {
    const nodes = this.layers.get(params.id);
    if (!nodes || nodes.kind !== 'sample' || !this.ctx) return;
    const t = this.ctx.currentTime;
    nodes.volume.gain.setTargetAtTime(clampLinear(params.volumeLinear), t, 0.015);
    nodes.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, params.pan)), t, 0.015);
    // Rate / loop mode: apply only on restart (v1 simplification)
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
        filter.type = 'highpass';
        filter.frequency.value = 200;
        filter.Q.value = 0.5;
        break;
      default:
        filter.type = 'allpass';
        filter.frequency.value = 1000;
        filter.Q.value = 0.707;
        break;
    }
  }

  removeLayer(id: string): void {
    const nodes = this.layers.get(id);
    if (!nodes) return;
    try {
      if (nodes.kind === 'noise') {
        nodes.worklet.disconnect();
        nodes.filter.disconnect();
        nodes.worklet.port.close();
      } else {
        nodes.player.stop();
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
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    return peak;
  }

  stopAll(): void {
    for (const id of [...this.layers.keys()]) {
      this.removeLayer(id);
    }
  }

  async dispose(): Promise<void> {
    this.stopAll();
    decodeCache.clear();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.analyser = null;
      this.workletReady = false;
    }
  }
}

export const audioEngine = new AudioEngine();
