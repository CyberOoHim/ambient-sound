import { audioEngine } from '../audio/engine';
import {
  createDefaultNoiseLayer,
  createDefaultSampleLayer,
  type MixerLayer,
  type NoiseType,
  type SampleLayerParams,
} from '../audio/types';
import { clampLinear } from '../audio/dsp/curves';
import {
  createPresetId,
  deletePreset,
  loadLastSession,
  loadPresetsFromStorage,
  parsePreset,
  saveLastSession,
  savePresetsToStorage,
  snapshotFromSession,
  upsertPreset,
  type PresetStoreFile,
  type PresetTimerConfig,
  type PresetV1,
} from './presets';
import {
  findAsset,
  loadCoreCatalog,
  type CatalogAsset,
  type SoundCatalog,
} from '../assets/catalog';

let nextId = 1;

function uid(prefix = 'layer'): string {
  return `${prefix}-${nextId++}`;
}

export type TimerStatus = 'idle' | 'running' | 'fading' | 'done';

export interface TimerState {
  status: TimerStatus;
  endAtMs: number | null;
  durationSec: number;
  fadeSec: number;
}

/**
 * Session owns layers (noise + sample), mute/solo, sleep timer, presets, catalog.
 */
export class Session {
  layers: MixerLayer[] = [];
  playing = false;
  masterVolumeLinear = 1;
  catalog: SoundCatalog | null = null;
  catalogError: string | null = null;

  timerDefaults: PresetTimerConfig = { durationSec: 30 * 60, fadeSec: 60 };

  timer: TimerState = {
    status: 'idle',
    endAtMs: null,
    durationSec: 30 * 60,
    fadeSec: 60,
  };

  presets: PresetV1[] = [];

  private pollId: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private fadeInFlight = false;
  private catalogReady: Promise<void>;

  constructor() {
    this.presets = loadPresetsFromStorage().presets;
    const last = loadLastSession();
    if (last) {
      this.applyPresetData(last);
    } else if (this.presets.length > 0) {
      this.applyPresetData(this.presets[0]);
    } else {
      this.layers = [
        { kind: 'noise', params: createDefaultNoiseLayer(uid('noise'), 'pink') },
      ];
    }
    this.catalogReady = this.initCatalog();
  }

  private async initCatalog(): Promise<void> {
    try {
      this.catalog = await loadCoreCatalog();
      audioEngine.setCatalog(this.catalog);
      this.catalogError = null;
    } catch (e) {
      this.catalogError = e instanceof Error ? e.message : String(e);
      this.catalog = null;
    }
    this.notify();
  }

  whenCatalogReady(): Promise<void> {
    return this.catalogReady;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private schedulePersist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.persistLastSession();
    }, 400);
  }

  persistLastSession(): void {
    const snap = snapshotFromSession({
      id: 'last-session',
      name: 'Last session',
      layers: this.layers,
      masterVolumeLinear: this.masterVolumeLinear,
      timerDefaults: this.timerDefaults,
    });
    saveLastSession(snap);
  }

  async play(): Promise<void> {
    if (this.layers.length === 0) {
      this.playing = false;
      this.notify();
      return;
    }
    await this.catalogReady;
    await audioEngine.resume();
    audioEngine.restoreMasterGain();
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);
    for (const layer of this.layers) {
      await audioEngine.addLayer(layer);
    }
    audioEngine.applyMuteSolo(this.layers);
    this.playing = true;
    this.notify();
    this.schedulePersist();
  }

  async pause(): Promise<void> {
    await audioEngine.suspend();
    this.playing = false;
    this.notify();
    this.schedulePersist();
  }

  async togglePlay(): Promise<void> {
    if (this.playing && audioEngine.isRunning) {
      await this.pause();
    } else {
      await this.play();
    }
  }

  setMasterVolumeLinear(linear: number): void {
    this.masterVolumeLinear = clampLinear(linear);
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);
    this.notify();
    this.schedulePersist();
  }

  async addNoiseLayer(type: NoiseType = 'white'): Promise<void> {
    const layer: MixerLayer = {
      kind: 'noise',
      params: createDefaultNoiseLayer(uid('noise'), type),
    };
    this.layers = [...this.layers, layer];
    if (this.playing) {
      await audioEngine.addLayer(layer);
      audioEngine.applyMuteSolo(this.layers);
    }
    this.notify();
    this.schedulePersist();
  }

  /** @deprecated use addNoiseLayer */
  async addLayer(type: NoiseType = 'white'): Promise<void> {
    await this.addNoiseLayer(type);
  }

  async addSampleFromAsset(asset: CatalogAsset): Promise<void> {
    await this.catalogReady;
    if (!this.catalog) throw new Error(this.catalogError ?? 'Catalog unavailable');

    const layer: MixerLayer = {
      kind: 'sample',
      params: createDefaultSampleLayer(uid('sample'), asset.id, asset.title, {
        loopMode: asset.loop.mode,
        crossfadeMs: asset.loop.crossfadeMs ?? 80,
      }),
    };
    this.layers = [...this.layers, layer];
    if (this.playing) {
      await audioEngine.addLayer(layer);
      audioEngine.applyMuteSolo(this.layers);
    }
    this.notify();
    this.schedulePersist();
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.params.id !== id);
    audioEngine.removeLayer(id);
    if (this.layers.length === 0 && this.playing) {
      this.cancelTimer();
      this.playing = false;
      void audioEngine.suspend();
    } else if (this.playing) {
      audioEngine.applyMuteSolo(this.layers);
    }
    this.notify();
    this.schedulePersist();
  }

  clearAllLayers(): void {
    audioEngine.stopAll();
    this.layers = [];
    if (this.playing) {
      this.cancelTimer();
      this.playing = false;
      void audioEngine.suspend();
    }
    this.notify();
    this.schedulePersist();
  }

  updateNoiseLayer(
    id: string,
    patch: Partial<Omit<import('../audio/types').NoiseLayerParams, 'id'>>,
  ): void {
    this.layers = this.layers.map((l) => {
      if (l.kind !== 'noise' || l.params.id !== id) return l;
      return { kind: 'noise', params: { ...l.params, ...patch } };
    });
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer || layer.kind !== 'noise') return;

    if (this.playing) {
      audioEngine.updateNoiseLayer(layer.params);
      if ('muted' in patch || 'solo' in patch) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
    this.notify();
    this.schedulePersist();
  }

  updateSampleLayer(
    id: string,
    patch: Partial<Omit<SampleLayerParams, 'id' | 'assetId'>>,
  ): void {
    this.layers = this.layers.map((l) => {
      if (l.kind !== 'sample' || l.params.id !== id) return l;
      return { kind: 'sample', params: { ...l.params, ...patch } };
    });
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer || layer.kind !== 'sample') return;

    if (this.playing) {
      audioEngine.updateSampleLayer(layer.params);
      if ('muted' in patch || 'solo' in patch) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
    this.notify();
    this.schedulePersist();
  }

  /** Generic mute/solo/volume helpers for UI */
  updateLayerCommon(
    id: string,
    patch: { volumeLinear?: number; muted?: boolean; solo?: boolean; pan?: number },
  ): void {
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer) return;
    if (layer.kind === 'noise') this.updateNoiseLayer(id, patch);
    else this.updateSampleLayer(id, patch);
  }

  getPeakLevel(): number {
    return audioEngine.getPeakLevel();
  }

  remainingMs(): number | null {
    if (this.timer.status === 'idle' || this.timer.status === 'done') return null;
    if (this.timer.endAtMs == null) return null;
    return Math.max(0, this.timer.endAtMs - Date.now());
  }

  setTimerDefaults(durationSec: number, fadeSec: number): void {
    this.timerDefaults = {
      durationSec: Math.max(1, durationSec),
      fadeSec: Math.max(0, fadeSec),
    };
    this.notify();
    this.schedulePersist();
  }

  async startTimer(durationSec?: number, fadeSec?: number): Promise<void> {
    const dur = durationSec ?? this.timerDefaults.durationSec;
    const fade = Math.min(
      fadeSec ?? this.timerDefaults.fadeSec,
      Math.max(0, dur - 0.05),
    );
    this.timerDefaults = { durationSec: dur, fadeSec: fade };
    this.fadeInFlight = false;

    if (!this.playing) {
      await this.play();
    }

    this.timer = {
      status: 'running',
      endAtMs: Date.now() + dur * 1000,
      durationSec: dur,
      fadeSec: fade,
    };
    this.ensurePoll();
    this.notify();
    await this.tickTimer();
  }

  cancelTimer(): void {
    if (this.timer.status === 'fading') {
      audioEngine.cancelFadeOut();
    }
    this.fadeInFlight = false;
    this.clearPoll();
    this.timer = {
      status: 'idle',
      endAtMs: null,
      durationSec: this.timerDefaults.durationSec,
      fadeSec: this.timerDefaults.fadeSec,
    };
    this.notify();
  }

  private ensurePoll(): void {
    if (this.pollId != null) return;
    this.pollId = setInterval(() => {
      void this.tickTimer();
    }, 1000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.onVisibility);
    }
  }

  private clearPoll(): void {
    if (this.pollId != null) {
      clearInterval(this.pollId);
      this.pollId = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.onVisibility);
    }
  }

  private onVisibility = (): void => {
    void this.tickTimer();
  };

  async tickTimer(): Promise<void> {
    if (this.timer.status !== 'running' && this.timer.status !== 'fading') {
      return;
    }
    const remaining = this.remainingMs();
    if (remaining == null) return;

    if (remaining <= 0) {
      await this.finishTimer();
      return;
    }

    const fadeMs = this.timer.fadeSec * 1000;
    if (
      this.timer.status === 'running' &&
      remaining <= fadeMs &&
      !this.fadeInFlight
    ) {
      this.fadeInFlight = true;
      this.timer = { ...this.timer, status: 'fading' };
      this.notify();
      const fadeSec = Math.max(remaining, 50) / 1000;
      const completed = await audioEngine.startFadeOut(fadeSec);
      if (completed && this.timer.status === 'fading') {
        await this.finishTimer();
      }
      return;
    }

    this.notify();
  }

  private async finishTimer(): Promise<void> {
    this.clearPoll();
    this.fadeInFlight = false;
    audioEngine.stopAll();
    audioEngine.restoreMasterGain();
    await audioEngine.suspend();
    this.playing = false;
    this.timer = {
      status: 'done',
      endAtMs: null,
      durationSec: this.timerDefaults.durationSec,
      fadeSec: this.timerDefaults.fadeSec,
    };
    this.notify();
    this.schedulePersist();
  }

  private applyPresetData(preset: PresetV1): void {
    this.masterVolumeLinear = clampLinear(preset.master.volumeLinear);
    this.layers = preset.layers.map((l) => {
      if (l.kind === 'noise') {
        return {
          kind: 'noise' as const,
          params: {
            ...l.params,
            id: uid('noise'),
            volumeLinear: clampLinear(l.params.volumeLinear),
            stereoWidth: Math.max(0, Math.min(1, l.params.stereoWidth)),
            pan: Math.max(-1, Math.min(1, l.params.pan)),
          },
        };
      }
      return {
        kind: 'sample' as const,
        params: {
          ...l.params,
          id: uid('sample'),
          volumeLinear: clampLinear(l.params.volumeLinear),
          pan: Math.max(-1, Math.min(1, l.params.pan)),
        },
      };
    });
    if (preset.timer) {
      this.timerDefaults = {
        durationSec: preset.timer.durationSec,
        fadeSec: preset.timer.fadeSec,
      };
    }
  }

  async loadPreset(id: string): Promise<void> {
    const preset = this.presets.find((p) => p.id === id);
    if (!preset) return;

    const wasPlaying = this.playing;
    this.cancelTimer();
    audioEngine.stopAll();
    this.applyPresetData(preset);
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);
    this.playing = false;

    if (wasPlaying && this.layers.length > 0) {
      await this.play();
    }
    this.notify();
    this.schedulePersist();
  }

  savePreset(name: string, existingId?: string): PresetV1 {
    const now = new Date().toISOString();
    const existing = existingId
      ? this.presets.find((p) => p.id === existingId)
      : undefined;
    const preset = snapshotFromSession({
      id: existing?.id ?? createPresetId(),
      name: name.trim() || 'Untitled',
      layers: this.layers,
      masterVolumeLinear: this.masterVolumeLinear,
      timerDefaults: this.timerDefaults,
    });
    if (existing) {
      preset.createdAt = existing.createdAt;
      preset.updatedAt = now;
    }

    const store: PresetStoreFile = upsertPreset(
      { version: 1, presets: this.presets },
      preset,
    );
    this.presets = store.presets;
    savePresetsToStorage(store);
    this.notify();
    return preset;
  }

  removePreset(id: string): void {
    const store = deletePreset({ version: 1, presets: this.presets }, id);
    this.presets = store.presets;
    savePresetsToStorage(store);
    this.notify();
  }

  exportPresetJson(id: string): string | null {
    const p = this.presets.find((x) => x.id === id);
    if (!p) return null;
    return JSON.stringify(p, null, 2);
  }

  importPresetJson(text: string): PresetV1 | null {
    try {
      const raw = JSON.parse(text) as unknown;
      const parsed = parsePreset(raw);
      if (!parsed) return null;
      const preset: PresetV1 = {
        ...parsed,
        id: createPresetId(),
        updatedAt: new Date().toISOString(),
      };
      const store = upsertPreset({ version: 1, presets: this.presets }, preset);
      this.presets = store.presets;
      savePresetsToStorage(store);
      this.notify();
      return preset;
    } catch {
      return null;
    }
  }

  getAsset(assetId: string): CatalogAsset | undefined {
    if (!this.catalog) return undefined;
    return findAsset(this.catalog, assetId);
  }
}

export const session = new Session();
