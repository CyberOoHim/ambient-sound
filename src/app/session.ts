import { audioEngine } from '../audio/engine';
import {
  clampHighpassHz,
  clampLowpassHz,
  clampPanLfoDepth,
  clampPanLfoRateHz,
  createDefaultNoiseLayer,
  createDefaultSampleLayer,
  FILTER_HP_OPEN_HZ,
  FILTER_LP_OPEN_HZ,
  isLocalAssetId,
  MAX_MIXER_LAYERS,
  type MixerLayer,
  type NoiseType,
  type SampleLayerParams,
} from '../audio/types';
import {
  deleteLocalAudio,
  importLocalAudioFile,
  listLocalAudio,
  type LocalAudioMeta,
} from '../audio/local-audio-store';
import { clampLinear } from '../audio/dsp/curves';
import {
  clearMediaSession,
  installMediaSessionHandlers,
  setMediaSessionPlayback,
} from '../audio/media-session';
import {
  createPresetId,
  deletePreset,
  getDefaultPresets,
  loadDuplicateMinOffsetSec,
  loadLastSession,
  loadPresetsFromStorage,
  parsePreset,
  saveDuplicateMinOffsetSec,
  saveLastSession,
  savePresetsToStorage,
  snapshotFromSession,
  upsertPreset,
  type PresetStoreFile,
  type PresetTimerConfig,
  type PresetV1,
} from './presets';
import {
  clampDuplicateMinOffsetSec,
  DUPLICATE_MIN_OFFSET_DEFAULT_SEC,
} from '../audio/dsp/loop';
import {
  assetUrl,
  findAsset,
  loadCoreCatalog,
  type CatalogAsset,
  type SoundCatalog,
} from '../assets/catalog';
import { decodeCache } from '../audio/decode-cache';
import {
  loadOneShotConfigFromStorage,
  saveOneShotConfigToStorage,
  loadCustomOneShotPacksFromStorage,
  saveCustomOneShotPacksToStorage,
  type OneShotConfig,
  type CustomOneShotPack,
} from './one-shot';
import {
  loadBinauralConfigFromStorage,
  saveBinauralConfigToStorage,
  type BinauralConfig,
} from './binaural';
import type { OneShotTriggerEvent } from '../audio/one-shot-engine';

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

export type PomodoroPhase = 'work' | 'break';

export interface PomodoroState {
  /** When true, timer cycles work → break → work… */
  enabled: boolean;
  phase: PomodoroPhase;
  workSec: number;
  breakSec: number;
  /** Completed work intervals in the current run. */
  completedWorkCycles: number;
}

const POMODORO_STORAGE_KEY = 'ambient-sound:pomodoro-defaults';
const MOBILE_TIP_KEY = 'ambient-sound:mobile-tip-dismissed';

function loadPomodoroDefaults(): Pick<PomodoroState, 'workSec' | 'breakSec'> {
  const fallback = { workSec: 25 * 60, breakSec: 5 * 60 };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(POMODORO_STORAGE_KEY);
    if (!raw) return fallback;
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      workSec: Math.max(60, Number(o.workSec) || fallback.workSec),
      breakSec: Math.max(30, Number(o.breakSec) || fallback.breakSec),
    };
  } catch {
    return fallback;
  }
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
  /**
   * Sample layer ids currently fetching/decoding their FreeSound (core pack) file.
   * Used for "Downloading…" UI; cleared when load finishes or the layer is removed.
   */
  loadingLayerIds = new Set<string>();
  /**
   * Per-layer download progress (0..1). Present only while loading.
   * `determinate` is false when Content-Length is unknown (indeterminate bar).
   */
  loadingProgress = new Map<string, { ratio: number; determinate: boolean }>();
  /**
   * Short user-facing notice (e.g. download failed and layer was removed).
   * Cleared by {@link clearLoadNotice} or the next notice.
   */
  loadNotice: string | null = null;

  /**
   * Short hint when enabling binaural/one-shot while paused (FIX-01).
   */
  enableHint: string | null = null;

  /**
   * Ephemeral toast when a one-shot event fires (ENH-10).
   */
  oneShotFireToast: string | null = null;
  private oneShotToastTimer: ReturnType<typeof setTimeout> | null = null;

  timerDefaults: PresetTimerConfig = { durationSec: 30 * 60, fadeSec: 60 };

  timer: TimerState = {
    status: 'idle',
    endAtMs: null,
    durationSec: 30 * 60,
    fadeSec: 60,
  };

  pomodoro: PomodoroState = {
    enabled: false,
    phase: 'work',
    ...loadPomodoroDefaults(),
    completedWorkCycles: 0,
  };

  presets: PresetV1[] = [];

  /**
   * Min buffer start offset (seconds) for the 2nd+ copy of the same sample.
   * Persisted in localStorage; first copy always starts at 0.
   */
  duplicateMinOffsetSec = DUPLICATE_MIN_OFFSET_DEFAULT_SEC;

  customOneShotPacks: CustomOneShotPack[] = loadCustomOneShotPacksFromStorage();
  oneShotConfig: OneShotConfig = loadOneShotConfigFromStorage(this.customOneShotPacks);
  lastOneShotTrigger: OneShotTriggerEvent | null = null;
  binauralConfig: BinauralConfig = loadBinauralConfigFromStorage();

  /** User-imported clips (ENH-13); metadata only — audio lives in IndexedDB. */
  localAudio: LocalAudioMeta[] = [];
  private localAudioReady: Promise<void> | null = null;

  /** Index into presets for media-session next/prev. */
  private mediaPresetIndex = 0;

  private pollId: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private fadeInFlight = false;
  private catalogPromise: Promise<void> | null = null;
  private mediaSessionInstalled = false;
  private pageLifecycleBound = false;
  private lastProgressNotifyMs = 0;

  constructor() {
    this.presets = loadPresetsFromStorage().presets;
    this.duplicateMinOffsetSec = loadDuplicateMinOffsetSec();
    // Load packs + side configs first so scene fields in last session can override.
    this.customOneShotPacks = loadCustomOneShotPacksFromStorage();
    this.oneShotConfig = loadOneShotConfigFromStorage(this.customOneShotPacks);
    this.binauralConfig = loadBinauralConfigFromStorage();

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
    audioEngine.oneShotEngine.setCustomPacks(this.customOneShotPacks);
    audioEngine.oneShotEngine.setConfig(this.oneShotConfig);
    audioEngine.binauralEngine.updateConfig(this.binauralConfig);

    this.ensureMediaSession();
    this.bindPageLifecycle();
    audioEngine.oneShotEngine.addListener((evt) => {
      if (evt) {
        this.lastOneShotTrigger = evt;
        this.showOneShotFireToast(evt);
        this.notify();
      }
    });
  }

  private showOneShotFireToast(evt: OneShotTriggerEvent): void {
    this.oneShotFireToast = `${evt.packLabel}: ${evt.assetLabel}`;
    if (this.oneShotToastTimer) clearTimeout(this.oneShotToastTimer);
    this.oneShotToastTimer = setTimeout(() => {
      this.oneShotFireToast = null;
      this.oneShotToastTimer = null;
      this.notify();
    }, 2200);
  }

  clearEnableHint(): void {
    if (this.enableHint == null) return;
    this.enableHint = null;
    this.notify();
  }

  private setEnableHintIfPaused(feature: string): void {
    if (this.playing) {
      this.enableHint = null;
      return;
    }
    this.enableHint = `${feature} starts with Play`;
  }

  updateBinauralConfig(partial: Partial<BinauralConfig>): void {
    this.binauralConfig = { ...this.binauralConfig, ...partial };
    saveBinauralConfigToStorage(this.binauralConfig);
    audioEngine.binauralEngine.updateConfig(this.binauralConfig);
    if (partial.enabled === true) {
      this.setEnableHintIfPaused('Tone generator');
      // If already playing, engines are running; updateConfig applies immediately.
    } else if (partial.enabled === false) {
      this.enableHint = null;
    }
    this.notify();
  }

  updateOneShotConfig(partial: Partial<OneShotConfig>): void {
    this.oneShotConfig = { ...this.oneShotConfig, ...partial };
    saveOneShotConfigToStorage(this.oneShotConfig);
    audioEngine.oneShotEngine.setConfig(this.oneShotConfig);
    if (partial.enabled === true) {
      this.setEnableHintIfPaused('One-shot events');
    } else if (partial.enabled === false) {
      this.enableHint = null;
    }
    this.notify();
  }

  createCustomOneShotPack(
    label: string,
    icon = '📦',
    description = 'User defined sound pack',
    assetIds: string[] = []
  ): CustomOneShotPack {
    const id = `custom-pack-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newPack: CustomOneShotPack = {
      id,
      label: label.trim() || 'Custom Pack',
      icon: icon || '📦',
      description,
      assetIds: [...assetIds],
      isCustom: true,
    };
    this.customOneShotPacks = [...this.customOneShotPacks, newPack];
    saveCustomOneShotPacksToStorage(this.customOneShotPacks);
    audioEngine.oneShotEngine.setCustomPacks(this.customOneShotPacks);

    if (!this.oneShotConfig.selectedPacks.includes(id)) {
      this.updateOneShotConfig({ selectedPacks: [...this.oneShotConfig.selectedPacks, id] });
    } else {
      this.notify();
    }
    return newPack;
  }

  renameCustomOneShotPack(packId: string, newLabel: string): void {
    this.customOneShotPacks = this.customOneShotPacks.map((p) =>
      p.id === packId ? { ...p, label: newLabel.trim() || p.label } : p
    );
    saveCustomOneShotPacksToStorage(this.customOneShotPacks);
    audioEngine.oneShotEngine.setCustomPacks(this.customOneShotPacks);
    this.notify();
  }

  deleteCustomOneShotPack(packId: string): void {
    this.customOneShotPacks = this.customOneShotPacks.filter((p) => p.id !== packId);
    saveCustomOneShotPacksToStorage(this.customOneShotPacks);
    audioEngine.oneShotEngine.setCustomPacks(this.customOneShotPacks);

    const updatedSelectedPacks = this.oneShotConfig.selectedPacks.filter((id) => id !== packId);
    this.updateOneShotConfig({
      selectedPacks: updatedSelectedPacks.length > 0 ? updatedSelectedPacks : ['storm'],
    });
  }

  updateCustomOneShotPackAssets(packId: string, assetIds: string[]): void {
    this.customOneShotPacks = this.customOneShotPacks.map((p) =>
      p.id === packId ? { ...p, assetIds: [...assetIds] } : p
    );
    saveCustomOneShotPacksToStorage(this.customOneShotPacks);
    audioEngine.oneShotEngine.setCustomPacks(this.customOneShotPacks);
    this.notify();
  }

  async triggerOneShotNow(specificAssetId?: string): Promise<OneShotTriggerEvent | null> {
    await this.ensureCatalogReady();
    await audioEngine.resume();
    const evt = await audioEngine.oneShotEngine.triggerRandomEvent(specificAssetId);
    if (evt) {
      this.lastOneShotTrigger = evt;
      this.notify();
    }
    return evt;
  }

  getOneShotHistory(): OneShotTriggerEvent[] {
    return audioEngine.oneShotEngine.getEventHistory();
  }

  setDuplicateMinOffsetSec(sec: number): void {
    this.duplicateMinOffsetSec = clampDuplicateMinOffsetSec(sec);
    saveDuplicateMinOffsetSec(this.duplicateMinOffsetSec);
    this.notify();
  }

  private ensureMediaSession(): void {
    if (this.mediaSessionInstalled || typeof navigator === 'undefined') return;
    this.mediaSessionInstalled = true;
    installMediaSessionHandlers({
      play: () => this.play(),
      pause: () => this.pause(),
      nexttrack: () => this.cyclePreset(1),
      previoustrack: () => this.cyclePreset(-1),
    });
  }

  /** Cycle saved presets from lock-screen next/previous (ENH-06). */
  async cyclePreset(delta: 1 | -1): Promise<void> {
    if (this.presets.length === 0) return;
    this.mediaPresetIndex =
      ((this.mediaPresetIndex + delta) % this.presets.length + this.presets.length) %
      this.presets.length;
    const p = this.presets[this.mediaPresetIndex];
    if (!p) return;
    await this.loadPreset(p.id);
  }

  /** Soft layer cap (FIX-04). */
  canAddLayer(): boolean {
    return this.layers.length < MAX_MIXER_LAYERS;
  }

  layerCapMessage(): string {
    return `Layer limit reached (${MAX_MIXER_LAYERS}). Remove a layer to add more.`;
  }

  static readonly MAX_LAYERS = MAX_MIXER_LAYERS;

  /**
   * Re-assert playback when returning to the tab / unlocking the device.
   * Does not pause on hide — we want background audio on iPad.
   */
  private bindPageLifecycle(): void {
    if (this.pageLifecycleBound || typeof document === 'undefined') return;
    this.pageLifecycleBound = true;
    document.addEventListener('visibilitychange', this.onPageVisible);
    window.addEventListener('pageshow', this.onPageVisible);
    window.addEventListener('focus', this.onPageVisible);
  }

  private onPageVisible = (): void => {
    if (!this.playing) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    void audioEngine.resume();
    setMediaSessionPlayback(true, this.mediaTitle());
  };

  private mediaTitle(): string {
    const sample = this.layers.find((l) => l.kind === 'sample');
    if (sample && sample.kind === 'sample' && sample.params.label) {
      return sample.params.label;
    }
    const noise = this.layers.find((l) => l.kind === 'noise');
    if (noise && noise.kind === 'noise') {
      return `${noise.params.type} noise`;
    }
    return 'Ambient sounds';
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

  /**
   * Lazily initialize the sound catalog.
   * Deferred so that importing session.ts (e.g. in tests) does not
   * trigger a network fetch as a side effect.
   */
  private ensureCatalogReady(): Promise<void> {
    if (!this.catalogPromise) {
      this.catalogPromise = this.initCatalog();
    }
    return this.catalogPromise;
  }

  whenCatalogReady(): Promise<void> {
    return this.ensureCatalogReady();
  }

  /** Load IndexedDB local imports (safe to call repeatedly). */
  async ensureLocalAudioReady(): Promise<void> {
    if (!this.localAudioReady) {
      this.localAudioReady = (async () => {
        try {
          this.localAudio = await listLocalAudio();
        } catch {
          this.localAudio = [];
        }
        this.notify();
      })();
    }
    await this.localAudioReady;
  }

  /**
   * Import a local audio file into IndexedDB and refresh the library list.
   */
  async importLocalAudio(file: File): Promise<LocalAudioMeta> {
    const meta = await importLocalAudioFile(file);
    this.localAudio = [meta, ...this.localAudio.filter((a) => a.id !== meta.id)];
    this.notify();
    return meta;
  }

  async removeLocalAudio(id: string): Promise<void> {
    await deleteLocalAudio(id);
    decodeCache.delete(`local-audio:${id}`);
    this.localAudio = this.localAudio.filter((a) => a.id !== id);
    // Drop mix layers that referenced this clip
    const doomed = this.layers
      .filter((l) => l.kind === 'sample' && l.params.assetId === id)
      .map((l) => l.params.id);
    for (const lid of doomed) {
      this.removeLayer(lid);
    }
    this.notify();
  }

  /** Add an imported local clip as a sample layer. */
  async addLocalSample(meta: LocalAudioMeta): Promise<string> {
    if (!this.canAddLayer()) {
      this.setLoadNotice(this.layerCapMessage());
      this.notify();
      return '';
    }
    const asset = this.localMetaToAsset(meta);
    return this.addSampleFromAsset(asset);
  }

  private localMetaToAsset(meta: LocalAudioMeta): CatalogAsset {
    return {
      id: meta.id,
      title: meta.title,
      category: 'local',
      file: meta.id,
      tags: ['local', 'imported'],
      loop: { mode: 'crossfade', crossfadeMs: 80 },
      license: {
        spdx: 'PD',
        author: 'You',
        notes: 'User-imported local file',
      },
    };
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
      binaural: this.binauralConfig,
      oneShot: this.oneShotConfig,
    });
    saveLastSession(snap);
  }

  async play(): Promise<void> {
    if (this.layers.length === 0) {
      this.playing = false;
      setMediaSessionPlayback(false);
      this.notify();
      return;
    }
    await this.ensureCatalogReady();
    await audioEngine.resume();
    audioEngine.restoreMasterGain();
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);
    this.enableHint = null;

    // Snapshot ids at start; layers may be removed while samples download.
    // Failed sample downloads auto-remove that layer and continue the rest.
    const toStart = [...this.layers];
    for (const layer of toStart) {
      if (!this.hasLayer(layer.params.id)) continue;
      await this.ensureSampleInEngine(layer);
    }

    // User cleared the mix, or every sample failed to download — do not start.
    if (this.layers.length === 0) {
      this.clearAllLoading();
      this.playing = false;
      setMediaSessionPlayback(false);
      this.notify();
      return;
    }

    audioEngine.applyMuteSolo(this.layers);
    this.playing = true;
    setMediaSessionPlayback(true, this.mediaTitle());
    this.notify();
    this.schedulePersist();
  }

  async pause(): Promise<void> {
    await audioEngine.suspend();
    this.playing = false;
    setMediaSessionPlayback(false);
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
    if (!this.canAddLayer()) {
      this.setLoadNotice(this.layerCapMessage());
      this.notify();
      return;
    }
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

  /**
   * Adds a sample layer immediately (shows in the mix), then fetches/decodes
   * the FreeSound file when playback is active.
   * @returns layer id (still valid after return only if the layer was not removed mid-download)
   */
  async addSampleFromAsset(asset: CatalogAsset): Promise<string> {
    await this.ensureCatalogReady();
    if (!this.catalog) throw new Error(this.catalogError ?? 'Catalog unavailable');
    if (!this.canAddLayer()) {
      this.setLoadNotice(this.layerCapMessage());
      this.notify();
      return '';
    }

    const layer: MixerLayer = {
      kind: 'sample',
      params: createDefaultSampleLayer(uid('sample'), asset.id, asset.title, {
        loopMode: asset.loop.mode,
        crossfadeMs: asset.loop.crossfadeMs ?? 80,
      }),
    };
    this.layers = [...this.layers, layer];
    this.notify();
    this.schedulePersist();

    if (this.playing) {
      await this.ensureSampleInEngine(layer);
      // Only apply mute/solo if the layer survived download (not deleted mid-flight).
      if (this.hasLayer(layer.params.id) && this.playing) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
    this.notify();
    return layer.params.id;
  }

  /**
   * Build a random complementary mix (ENH-04). Replaces current layers.
   */
  async surpriseMe(options?: { includeBinaural?: boolean; includeOneShot?: boolean }): Promise<void> {
    await this.ensureCatalogReady();
    if (!this.catalog || this.catalog.assets.length === 0) {
      this.setLoadNotice('Catalog not ready — try again in a moment.');
      this.notify();
      return;
    }

    const includeBinaural = options?.includeBinaural ?? false;
    const includeOneShot = options?.includeOneShot ?? false;

    // Curated complementary groups (asset ids that work well together)
    const groups: string[][] = [
      ['rain_light', 'fire_camp', 'stream_small'],
      ['ocean_shore', 'seagulls', 'wind_trees'],
      ['crickets_night', 'owls_forest', 'fire_camp'],
      ['rain_tent', 'thunder_distant', 'wind_trees'],
      ['train_ride', 'rain_roof'],
      ['bus_ride', 'rain_light'],
      ['amazon_forest', 'birds_morning', 'stream_small'],
      ['cave_drips', 'underwater'],
      ['winter_storm', 'fire_camp'],
      ['lake_shore', 'frogs_pond', 'cicadas_summer'],
    ];

    const available = new Set(this.catalog.assets.map((a) => a.id));
    const validGroups = groups
      .map((g) => g.filter((id) => available.has(id)))
      .filter((g) => g.length >= 2);

    const pick =
      validGroups.length > 0
        ? validGroups[Math.floor(Math.random() * validGroups.length)]
        : this.catalog.assets
            .slice()
            .sort(() => Math.random() - 0.5)
            .slice(0, 3)
            .map((a) => a.id);

    // 2–4 layers
    const count = Math.min(4, Math.max(2, pick.length));
    const chosen = pick.slice(0, count);

    const wasPlaying = this.playing;
    this.cancelTimer();
    audioEngine.stopAll();
    this.layers = [];

    const pans = [-0.35, 0.35, 0, -0.15, 0.2];
    const vols = [0.65, 0.55, 0.45, 0.5];

    for (let i = 0; i < chosen.length; i++) {
      const asset = findAsset(this.catalog, chosen[i]);
      if (!asset) continue;
      this.layers.push({
        kind: 'sample',
        params: createDefaultSampleLayer(uid('sample'), asset.id, asset.title, {
          loopMode: asset.loop.mode,
          crossfadeMs: asset.loop.crossfadeMs ?? 80,
          volumeLinear: vols[i % vols.length],
        }),
      });
      const layer = this.layers[this.layers.length - 1];
      if (layer.kind === 'sample') {
        layer.params.pan = pans[i % pans.length];
      }
    }

    // ~30% chance of soft pink bed
    if (this.layers.length < MAX_MIXER_LAYERS && Math.random() < 0.3) {
      const noise = createDefaultNoiseLayer(uid('noise'), 'pink');
      noise.volumeLinear = 0.28;
      this.layers.push({ kind: 'noise', params: noise });
    }

    this.masterVolumeLinear = 0.85;
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);

    if (!includeBinaural) {
      this.updateBinauralConfig({ enabled: false });
    }
    if (!includeOneShot) {
      this.updateOneShotConfig({ enabled: false });
    }

    this.playing = false;
    if (wasPlaying && this.layers.length > 0) {
      await this.play();
    }
    this.setLoadNotice(
      `Surprise mix: ${this.layers
        .map((l) => (l.kind === 'sample' ? l.params.label : `${l.params.type} noise`))
        .join(' · ')}`,
    );
    this.notify();
    this.schedulePersist();
  }

  setPomodoroDefaults(workSec: number, breakSec: number): void {
    this.pomodoro = {
      ...this.pomodoro,
      workSec: Math.max(60, workSec),
      breakSec: Math.max(30, breakSec),
    };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          POMODORO_STORAGE_KEY,
          JSON.stringify({
            workSec: this.pomodoro.workSec,
            breakSec: this.pomodoro.breakSec,
          }),
        );
      } catch {
        /* */
      }
    }
    this.notify();
  }

  /**
   * Start a pomodoro work/break cycle using the sleep-timer wall clock (ENH-03).
   */
  async startPomodoro(phase: PomodoroPhase = 'work'): Promise<void> {
    this.pomodoro = {
      ...this.pomodoro,
      enabled: true,
      phase,
      completedWorkCycles:
        phase === 'work' ? this.pomodoro.completedWorkCycles : this.pomodoro.completedWorkCycles,
    };
    const dur =
      phase === 'work' ? this.pomodoro.workSec : this.pomodoro.breakSec;
    // Short fade at end of each phase
    const fade = Math.min(15, Math.max(5, Math.floor(dur * 0.05)));
    await this.startTimer(dur, fade);
  }

  stopPomodoro(): void {
    this.pomodoro = {
      ...this.pomodoro,
      enabled: false,
      phase: 'work',
      completedWorkCycles: 0,
    };
    this.cancelTimer();
  }

  isMobileTipDismissed(): boolean {
    if (typeof localStorage === 'undefined') return true;
    try {
      return localStorage.getItem(MOBILE_TIP_KEY) === '1';
    } catch {
      return true;
    }
  }

  dismissMobileTip(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(MOBILE_TIP_KEY, '1');
    } catch {
      /* */
    }
    this.notify();
  }

  /** Merge missing default curated presets into the saved list (ENH-05). */
  restoreDefaultPresets(): number {
    const defaults = getDefaultPresets();
    const existingIds = new Set(this.presets.map((p) => p.id));
    let added = 0;
    let store: PresetStoreFile = { version: 1, presets: this.presets };
    for (const d of defaults) {
      if (existingIds.has(d.id)) continue;
      store = upsertPreset(store, d);
      existingIds.add(d.id);
      added++;
    }
    if (added > 0) {
      this.presets = store.presets;
      savePresetsToStorage(store);
      this.notify();
    }
    return added;
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.params.id !== id);
    this.clearLayerLoadState(id);
    audioEngine.removeLayer(id);
    if (this.layers.length === 0 && this.playing) {
      this.cancelTimer();
      this.playing = false;
      void audioEngine.suspend();
      setMediaSessionPlayback(false);
    } else if (this.playing) {
      audioEngine.applyMuteSolo(this.layers);
      setMediaSessionPlayback(true, this.mediaTitle());
    }
    this.notify();
    this.schedulePersist();
  }

  clearAllLayers(): void {
    audioEngine.stopAll();
    this.layers = [];
    this.clearAllLoading();
    if (this.playing) {
      this.cancelTimer();
      this.playing = false;
      void audioEngine.suspend();
      setMediaSessionPlayback(false);
    }
    this.notify();
    this.schedulePersist();
  }

  clearLoadNotice(): void {
    if (this.loadNotice == null) return;
    this.loadNotice = null;
    this.notify();
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
    patch: {
      volumeLinear?: number;
      muted?: boolean;
      solo?: boolean;
      pan?: number;
      lowpassHz?: number;
      highpassHz?: number;
      panLfoEnabled?: boolean;
      panLfoRateHz?: number;
      panLfoDepth?: number;
    },
  ): void {
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer) return;
    const normalized = { ...patch };
    if (patch.lowpassHz != null) {
      normalized.lowpassHz = clampLowpassHz(patch.lowpassHz);
    }
    if (patch.highpassHz != null) {
      normalized.highpassHz = clampHighpassHz(patch.highpassHz);
    }
    if (patch.panLfoRateHz != null) {
      normalized.panLfoRateHz = clampPanLfoRateHz(patch.panLfoRateHz);
    }
    if (patch.panLfoDepth != null) {
      normalized.panLfoDepth = clampPanLfoDepth(patch.panLfoDepth);
    }
    if (layer.kind === 'noise') this.updateNoiseLayer(id, normalized);
    else this.updateSampleLayer(id, normalized);
  }

  /**
   * Spatial canvas: X → pan (-1..1), Y → volume (top quiet, bottom loud).
   * Optional light filter coupling for “distance” (far = lower LP).
   */
  setLayerSpatial(
    id: string,
    pan: number,
    volumeLinear: number,
    opts?: { coupleFilter?: boolean },
  ): void {
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer) return;
    const p = Math.max(-1, Math.min(1, pan));
    const v = clampLinear(volumeLinear);
    const patch: {
      pan: number;
      volumeLinear: number;
      lowpassHz?: number;
    } = { pan: p, volumeLinear: v };
    if (opts?.coupleFilter) {
      // Near (v high) → open LP; far (v low) → muffled
      const t = Math.max(0, Math.min(1, v));
      const lp = 800 + t * (FILTER_LP_OPEN_HZ - 800);
      patch.lowpassHz = clampLowpassHz(lp);
    }
    this.updateLayerCommon(id, patch);
  }

  getPeakLevel(): number {
    return audioEngine.getPeakLevel();
  }

  getFrequencyData(): Uint8Array | null {
    return audioEngine.getFrequencyData();
  }

  getTimeDomainData(): Uint8Array | null {
    return audioEngine.getTimeDomainData();
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
    // NOTE: Browsers throttle setInterval to ~1/min in background tabs.
    // The visibilitychange + focus listeners below compensate by forcing
    // a tick when the user returns, and tickTimer() uses Date.now() so
    // elapsed time is always correct even if polls are missed.
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

    // Pomodoro: advance phase without fully stopping the mix when possible
    if (this.pomodoro.enabled) {
      if (this.pomodoro.phase === 'work') {
        this.pomodoro = {
          ...this.pomodoro,
          completedWorkCycles: this.pomodoro.completedWorkCycles + 1,
          phase: 'break',
        };
        audioEngine.restoreMasterGain();
        this.timer = {
          status: 'idle',
          endAtMs: null,
          durationSec: this.pomodoro.breakSec,
          fadeSec: 10,
        };
        this.notify();
        // Auto-start break
        await this.startPomodoro('break');
        return;
      }
      // Break finished → next work cycle
      this.pomodoro = { ...this.pomodoro, phase: 'work' };
      audioEngine.restoreMasterGain();
      this.timer = {
        status: 'idle',
        endAtMs: null,
        durationSec: this.pomodoro.workSec,
        fadeSec: 10,
      };
      this.notify();
      await this.startPomodoro('work');
      return;
    }

    audioEngine.stopAll();
    audioEngine.restoreMasterGain();
    await audioEngine.suspend();
    this.playing = false;
    setMediaSessionPlayback(false);
    clearMediaSession();
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
            lowpassHz: clampLowpassHz(l.params.lowpassHz ?? FILTER_LP_OPEN_HZ),
            highpassHz: clampHighpassHz(l.params.highpassHz ?? FILTER_HP_OPEN_HZ),
            panLfoEnabled: Boolean(l.params.panLfoEnabled),
            panLfoRateHz: clampPanLfoRateHz(l.params.panLfoRateHz ?? 0.08),
            panLfoDepth: clampPanLfoDepth(l.params.panLfoDepth ?? 0.35),
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
          lowpassHz: clampLowpassHz(l.params.lowpassHz ?? FILTER_LP_OPEN_HZ),
          highpassHz: clampHighpassHz(l.params.highpassHz ?? FILTER_HP_OPEN_HZ),
          panLfoEnabled: Boolean(l.params.panLfoEnabled),
          panLfoRateHz: clampPanLfoRateHz(l.params.panLfoRateHz ?? 0.08),
          panLfoDepth: clampPanLfoDepth(l.params.panLfoDepth ?? 0.35),
        },
      };
    });
    if (preset.timer) {
      this.timerDefaults = {
        durationSec: preset.timer.durationSec,
        fadeSec: preset.timer.fadeSec,
      };
    }
    // Scene fields: apply when present so older mixer-only presets leave
    // current binaural/one-shot settings alone.
    if (preset.binaural) {
      this.binauralConfig = { ...preset.binaural };
      saveBinauralConfigToStorage(this.binauralConfig);
      audioEngine.binauralEngine.updateConfig(this.binauralConfig);
    }
    if (preset.oneShot) {
      this.oneShotConfig = { ...preset.oneShot };
      saveOneShotConfigToStorage(this.oneShotConfig);
      audioEngine.oneShotEngine.setConfig(this.oneShotConfig);
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
      binaural: this.binauralConfig,
      oneShot: this.oneShotConfig,
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

  /**
   * Apply a full scene from a shared link or imported preset (layers +
   * optional binaural/one-shot). Does not add to the saved presets list.
   */
  async applySharedScene(preset: PresetV1): Promise<void> {
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

  /** Snapshot of the current mix for share links / export. */
  captureSceneSnapshot(name = 'Shared mix'): PresetV1 {
    return snapshotFromSession({
      name,
      layers: this.layers,
      masterVolumeLinear: this.masterVolumeLinear,
      timerDefaults: this.timerDefaults,
      binaural: this.binauralConfig,
      oneShot: this.oneShotConfig,
    });
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
    if (isLocalAssetId(assetId)) {
      const meta = this.localAudio.find((a) => a.id === assetId);
      if (meta) return this.localMetaToAsset(meta);
      // Fallback stub so engine can still try IndexedDB load
      return {
        id: assetId,
        title: 'Imported sound',
        category: 'local',
        file: assetId,
        tags: ['local'],
        loop: { mode: 'crossfade', crossfadeMs: 80 },
        license: { spdx: 'PD', author: 'You' },
      };
    }
    if (!this.catalog) return undefined;
    return findAsset(this.catalog, assetId);
  }

  /** True while any sample file is being fetched/decoded. */
  isAnyLayerLoading(): boolean {
    return this.loadingLayerIds.size > 0;
  }

  isLayerLoading(id: string): boolean {
    return this.loadingLayerIds.has(id);
  }

  getLayerLoadProgress(
    id: string,
  ): { ratio: number; determinate: boolean } | null {
    return this.loadingProgress.get(id) ?? null;
  }

  /**
   * Whether adding/playing this asset will need a network (or disk) fetch
   * rather than an in-memory decode-cache hit.
   */
  needsSampleFetch(asset: CatalogAsset): boolean {
    if (isLocalAssetId(asset.id)) {
      return !decodeCache.has(`local-audio:${asset.id}`);
    }
    return !decodeCache.has(assetUrl(asset.file));
  }

  private hasLayer(id: string): boolean {
    return this.layers.some((l) => l.params.id === id);
  }

  private setLayerLoading(id: string, loading: boolean): void {
    if (loading) {
      this.loadingLayerIds.add(id);
      if (!this.loadingProgress.has(id)) {
        this.loadingProgress.set(id, { ratio: 0, determinate: false });
      }
    } else {
      this.loadingLayerIds.delete(id);
      this.loadingProgress.delete(id);
    }
  }

  private clearLayerLoadState(id: string): void {
    this.loadingLayerIds.delete(id);
    this.loadingProgress.delete(id);
  }

  private clearAllLoading(): void {
    this.loadingLayerIds.clear();
    this.loadingProgress.clear();
  }

  private setLoadNotice(message: string): void {
    this.loadNotice = message;
  }

  private updateLayerProgress(
    id: string,
    ratio: number,
    determinate: boolean,
  ): void {
    this.loadingProgress.set(id, {
      ratio: Math.max(0, Math.min(1, ratio)),
      determinate,
    });
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Throttle UI updates during streaming (~12 fps).
    if (now - this.lastProgressNotifyMs >= 80 || ratio >= 1) {
      this.lastProgressNotifyMs = now;
      this.notify();
    }
  }

  /**
   * Remove a sample layer that failed to download/decode and notify the user.
   * Does not rethrow — callers continue with remaining layers.
   */
  private removeFailedSampleLayer(id: string, label: string, err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err);
    const short =
      detail.includes('Failed to fetch') || detail.includes('fetch')
        ? 'network or file missing'
        : detail.includes('decode') || detail.includes('Unable to decode')
          ? 'could not decode audio'
          : 'download failed';

    if (this.hasLayer(id)) {
      this.removeLayer(id);
    } else {
      this.clearLayerLoadState(id);
      audioEngine.removeLayer(id);
    }
    this.setLoadNotice(
      `Couldn't load “${label}” (${short}). Layer removed from the mix.`,
    );
    this.notify();
  }

  /**
   * Rank of this sample among layers sharing the same assetId (mix order).
   * Used to decorrelate start positions of duplicate sounds.
   */
  private sampleSiblingInfo(layer: MixerLayer): {
    siblingIndex: number;
    siblingCount: number;
  } {
    if (layer.kind !== 'sample') {
      return { siblingIndex: 0, siblingCount: 1 };
    }
    const same = this.layers.filter(
      (l) => l.kind === 'sample' && l.params.assetId === layer.params.assetId,
    );
    const siblingIndex = Math.max(
      0,
      same.findIndex((l) => l.params.id === layer.params.id),
    );
    return { siblingIndex, siblingCount: same.length };
  }

  /**
   * Start a sample layer in the engine if still present in the mix.
   * Discards the engine node if the user removed/cleared the layer mid-download.
   * On fetch/decode failure, auto-removes the layer and sets {@link loadNotice}.
   */
  private async ensureSampleInEngine(layer: MixerLayer): Promise<void> {
    if (layer.kind === 'noise') {
      await audioEngine.addLayer(layer);
      return;
    }
    const id = layer.params.id;
    const label = layer.params.label;
    if (!this.hasLayer(id)) return;

    const asset = this.getAsset(layer.params.assetId);
    const willFetch = asset ? this.needsSampleFetch(asset) : true;
    if (willFetch) {
      this.setLayerLoading(id, true);
      this.notify();
    }
    const { siblingIndex, siblingCount } = this.sampleSiblingInfo(layer);
    try {
      await audioEngine.addLayer(
        layer,
        (p) => {
          if (!this.hasLayer(id)) return;
          this.updateLayerProgress(id, p.ratio, p.determinate);
        },
        {
          siblingIndex,
          siblingCount,
          minOffsetSec: this.duplicateMinOffsetSec,
        },
      );
    } catch (err) {
      // Only auto-remove if the layer is still in the mix (user may have deleted it).
      if (this.hasLayer(id)) {
        this.removeFailedSampleLayer(id, label, err);
      } else {
        this.clearLayerLoadState(id);
      }
      return;
    } finally {
      const wasLoading = this.loadingLayerIds.has(id);
      this.clearLayerLoadState(id);
      if (wasLoading) this.notify();
    }

    // Layer deleted or mix cleared while FreeSound file was downloading:
    // engine also cancels in-flight loads; tear down anything that slipped through.
    if (!this.hasLayer(id)) {
      audioEngine.removeLayer(id);
    }
  }
}

export const session = new Session();
