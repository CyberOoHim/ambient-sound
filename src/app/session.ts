import { audioEngine } from '../audio/engine';
import {
  clampDriftGainDb,
  clampDriftPanSpread,
  clampDriftPitchPct,
  clampDriftSpeed,
  clampHighpassHz,
  clampLowpassHz,
  clampMasterEqDb,
  clampPanLfoDepth,
  clampPanLfoRateHz,
  clampReverbWet,
  createDefaultNoiseLayer,
  createDefaultPlaylistLayer,
  createDefaultSampleLayer,
  createDefaultYoutubeLayer,
  defaultDriftConfig,
  defaultMasterTone,
  FILTER_HP_OPEN_HZ,
  FILTER_LP_OPEN_HZ,
  isLocalAssetId,
  MAX_MIXER_LAYERS,
  MAX_SAME_LAYERS,
  MAX_YOUTUBE_LAYERS,
  getMaxYoutubeLayers,
  PRESET_CROSSFADE_SEC,
  type DriftConfig,
  type DriftSpeed,
  type LayerLiveDrift,
  type MasterToneParams,
  type MixerLayer,
  type NoiseType,
  type PlaylistLayerParams,
  type SampleLayerParams,
} from '../audio/types';
import {
  loadPlaylistsFromStorage,
  savePlaylistsToStorage,
  createPlaylist,
  getNextTrackIndex,
  getPreviousTrackIndex,
  uid as plUid,
  type Playlist,
  type PlaylistItem,
  type PlaylistItemType,
} from './playlist';
import {
  deleteLocalAudio,
  deleteLocalAudioMany,
  exportLocalAudioBackup,
  getStorageQuotaInfo,
  importLocalAudioBackup,
  importLocalAudioFile,
  listLocalAudio,
  parseLocalAudioBackup,
  type ImportBackupResult,
  type LocalAudioBackup,
  type LocalAudioMeta,
  type StorageQuotaInfo,
} from '../audio/local-audio-store';
import { clampLinear } from '../audio/dsp/curves';
import {
  clearMediaSession,
  installMediaSessionHandlers,
  setMediaSessionPlayback,
} from '../audio/media-session';
import {
  loadYouTubeApi,
  youtubePlayerManager,
  type YoutubePlayerStatus,
} from '../audio/youtube-player';
import { playbackOwner } from './playback-owner';
import {
  createPresetId,
  deletePreset,
  driftConfigFromPreset,
  getDefaultPresets,
  loadDuplicateMinOffsetSec,
  loadLastSession,
  loadPresetsFromStorage,
  masterToneFromPreset,
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
  /** Master EQ + reverb (ENH-17). */
  masterTone: MasterToneParams = defaultMasterTone();
  /** Global organic drift configuration (ENH-Drift-Control). */
  driftConfig: DriftConfig = defaultDriftConfig();
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
   * Per YouTube layer player status for mix UI (loading / playing / blocked…).
   */
  youtubeStatus = new Map<string, YoutubePlayerStatus>();
  /**
   * Short user-facing notice (e.g. download failed and layer was removed).
   * Cleared by {@link clearLoadNotice} or the next notice.
   */
  loadNotice: string | null = null;

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

  playlists: Playlist[] = loadPlaylistsFromStorage();

  /** User-imported clips (ENH-13); metadata only — audio lives in IndexedDB. */
  localAudio: LocalAudioMeta[] = [];
  private localAudioReady: Promise<void> | null = null;

  /** Index into presets for media-session next/prev. */
  private mediaPresetIndex = 0;

  private pollId: ReturnType<typeof setInterval> | null = null;
  private fadeWakeupTimer: ReturnType<typeof setTimeout> | null = null;
  private finishWakeupTimer: ReturnType<typeof setTimeout> | null = null;
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

    const last = loadLastSession();
    const defaultPreset = this.presets[0];
    if (last) {
      this.applyPresetData(last);
    } else if (defaultPreset) {
      this.applyPresetData(defaultPreset);
    } else {
      this.layers = [
        { kind: 'noise', params: createDefaultNoiseLayer(uid('noise'), 'pink') },
      ];
    }
    audioEngine.setMasterTone(this.masterTone);
    audioEngine.setDriftConfig(this.driftConfig);

    // Eagerly pre-create YouTube iframes (no autoplay) so they reach
    // isReady before the user clicks Play. This lets playVideo() fire
    // synchronously inside the gesture and avoids autoplay-blocked.
    for (const layer of this.layers) {
      if (layer.kind === 'youtube') {
        void this.ensureYoutubeInEngine(layer, false);
      }
    }

    this.ensureMediaSession();
    this.bindPageLifecycle();
    youtubePlayerManager.onError((layerId, errorCode) => {
      const layer = this.layers.find((l) => l.params.id === layerId);
      const label =
        layer && layer.kind === 'youtube'
          ? layer.params.label
          : 'YouTube stream';
      // Soft timeouts (-3) and API failures (-2): keep layer so user can retry Play.
      if (errorCode === -2 || errorCode === -3) {
        this.youtubeStatus.set(layerId, 'error');
        this.setLoadNotice(
          `YouTube stream “${label}” is slow to load. Tap Play again to retry.`,
        );
        this.notify();
        return;
      }
      this.youtubeStatus.delete(layerId);
      this.removeLayer(layerId);
      this.setLoadNotice(
        `Couldn't play “${label}” (video unavailable or embedding restricted). Layer removed.`,
      );
      this.notify();
    });
    youtubePlayerManager.onStatusChange((layerId, status) => {
      this.youtubeStatus.set(layerId, status);
      if (status === 'blocked' && this.playing) {
        this.setLoadNotice(
          'Browser blocked YouTube autoplay — tap Play again to start the stream.',
        );
      }
      this.notify();
    });
    playbackOwner.subscribe((otherActive) => {
      if (otherActive && !this.playing) {
        this.setLoadNotice(
          'Another window is already playing this app. YouTube may only play in one place at a time.',
        );
        this.notify();
      }
    });
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

  sameLayerCapMessage(): string {
    return `Maximum ${MAX_SAME_LAYERS} layers of the same sound allowed.`;
  }

  getSameLayerCount(target: MixerLayer): number {
    if (target.kind === 'sample') {
      return this.layers.filter((l) => l.kind === 'sample' && l.params.assetId === target.params.assetId).length;
    }
    if (target.kind === 'noise') {
      return this.layers.filter((l) => l.kind === 'noise' && l.params.type === target.params.type).length;
    }
    if (target.kind === 'youtube') {
      return this.layers.filter((l) => l.kind === 'youtube' && l.params.videoId === target.params.videoId).length;
    }
    return 0;
  }

  static readonly MAX_LAYERS = MAX_MIXER_LAYERS;
  static readonly MAX_SAME_LAYERS = MAX_SAME_LAYERS;


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
   * Surfaces clearer quota / size errors (ENH-16).
   */
  async importLocalAudio(file: File): Promise<LocalAudioMeta> {
    try {
      const meta = await importLocalAudioFile(file);
      this.localAudio = [meta, ...this.localAudio.filter((a) => a.id !== meta.id)];
      this.notify();
      return meta;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (
        lower.includes('quota') ||
        lower.includes('storage') ||
        lower.includes('exceeded') ||
        (e instanceof DOMException && e.name === 'QuotaExceededError')
      ) {
        throw new Error(
          'Storage full — free space or export/remove unused imports (max ~25 MB per file)',
        );
      }
      throw e instanceof Error ? e : new Error(msg);
    }
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

  /** Export all local clips as a portable backup object. */
  async exportLocalAudioBackup(): Promise<LocalAudioBackup> {
    await this.ensureLocalAudioReady();
    return exportLocalAudioBackup();
  }

  /** Import clips from a backup JSON object. */
  async importLocalAudioBackupData(
    raw: unknown,
    opts?: { overwrite?: boolean },
  ): Promise<ImportBackupResult> {
    const backup = parseLocalAudioBackup(raw);
    if (!backup) {
      return {
        imported: 0,
        skipped: 0,
        errors: ['Not a valid Ambient Sound local backup'],
      };
    }
    const result = await importLocalAudioBackup(backup, opts);
    this.localAudio = await listLocalAudio();
    this.notify();
    return result;
  }

  async getLocalStorageQuotaInfo(): Promise<StorageQuotaInfo> {
    await this.ensureLocalAudioReady();
    return getStorageQuotaInfo();
  }

  /**
   * Delete local imports that are not used by any current mix layer.
   * @returns number of clips removed
   */
  async removeUnusedLocalAudio(): Promise<number> {
    await this.ensureLocalAudioReady();
    const used = new Set<string>();

    for (const l of this.layers) {
      if (l.kind === 'sample' && isLocalAssetId(l.params.assetId)) {
        used.add(l.params.assetId);
      }
    }

    for (const p of this.presets) {
      if (Array.isArray(p.layers)) {
        for (const l of p.layers) {
          if (l.kind === 'sample' && isLocalAssetId(l.params.assetId)) {
            used.add(l.params.assetId);
          }
        }
      }
    }

    const unused = this.localAudio.filter((c) => !used.has(c.id)).map((c) => c.id);
    if (unused.length === 0) return 0;
    await deleteLocalAudioMany(unused);
    for (const id of unused) {
      decodeCache.delete(`local-audio:${id}`);
    }
    this.localAudio = this.localAudio.filter((c) => used.has(c.id));
    this.notify();
    return unused.length;
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
      masterTone: this.masterTone,
      masterDrift: this.driftConfig,
      timerDefaults: this.timerDefaults,
    });
    saveLastSession(snap);
  }

  /**
   * @param opts.holdSilent — leave master at 0 after start (caller runs fade-in).
   */
  async play(opts?: { holdSilent?: boolean }): Promise<void> {
    if (this.layers.length === 0) {
      this.playing = false;
      setMediaSessionPlayback(false);
      playbackOwner.release();
      this.notify();
      return;
    }

    // ── Synchronous YouTube play (MUST run before any await) ──
    // Calling playVideo() here preserves the browser's user-activation
    // context so the iframe can start unmuted playback without being
    // blocked by autoplay policy. This eliminates the double-tap problem.
    const hasYt = this.layers.some(
      (l) =>
        l.kind === 'youtube' ||
        (l.kind === 'playlist' && l.params.currentTrackType === 'youtube'),
    );
    if (hasYt) {
      audioEngine.prepareYoutubeCoexistence(true);
      youtubePlayerManager.playAllReadyForGesture();
    }

    if (playbackOwner.isOtherOwnerActive()) {
      this.setLoadNotice(
        'Another window is already playing this app. YouTube may only play in one place at a time.',
      );
    }

    await this.ensureCatalogReady();
    await audioEngine.resume();
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);
    audioEngine.setMasterTone(this.masterTone);
    audioEngine.setDriftConfig(this.driftConfig);
    if (opts?.holdSilent) {
      // Keep muted until startFadeIn; target volume remains in masterVolumeLinear.
      audioEngine.setMasterGainImmediate(0);
    } else {
      audioEngine.restoreMasterGain();
    }

    // Snapshot ids at start; layers may be removed while samples download.
    // Failed sample downloads auto-remove that layer and continue the rest.
    // YouTube starts in parallel and must NOT block the transport UI / busy flag.
    const toStart = [...this.layers];
    const youtubeLayers = toStart.filter((l) => l.kind === 'youtube');
    const playlistYtLayers = toStart.filter(
      (l) => l.kind === 'playlist' && l.params.currentTrackType === 'youtube',
    );
    const otherLayers = toStart.filter(
      (l) =>
        l.kind !== 'youtube' &&
        !(l.kind === 'playlist' && l.params.currentTrackType === 'youtube'),
    );

    // Handle YT players that weren't isReady during the sync gesture call above.
    for (const layer of youtubeLayers) {
      if (!this.hasLayer(layer.params.id)) continue;
      if (!youtubePlayerManager.isPlayerReady(layer.params.id)) {
        void this.ensureYoutubeInEngine(layer, true);
      }
    }
    for (const layer of playlistYtLayers) {
      if (!this.hasLayer(layer.params.id)) continue;
      if (!youtubePlayerManager.isPlayerReady(layer.params.id)) {
        void this.ensurePlaylistInEngine(layer, true);
      }
    }

    await Promise.all(
      otherLayers.map(async (layer) => {
        if (!this.hasLayer(layer.params.id)) return;
        await this.ensureSampleInEngine(layer);
      }),
    );

    // User cleared the mix, or every sample failed to download — do not start.
    if (this.layers.length === 0) {
      this.clearAllLoading();
      this.playing = false;
      setMediaSessionPlayback(false);
      playbackOwner.release();
      this.notify();
      return;
    }

    audioEngine.applyMuteSolo(this.layers);
    // Re-assert YT play after mute/solo (and after any async sample work).
    youtubePlayerManager.setGlobalPlaying(true);
    this.playing = true;
    playbackOwner.claim();
    setMediaSessionPlayback(true, this.mediaTitle());
    this.notify();
    this.schedulePersist();
  }

  async pause(): Promise<void> {
    await audioEngine.suspend();
    this.playing = false;
    playbackOwner.release();
    setMediaSessionPlayback(false);
    this.notify();
    this.schedulePersist();
  }

  async togglePlay(): Promise<void> {
    if (this.playing) {
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

  setMasterTone(partial: Partial<MasterToneParams>): void {
    if (partial.bassDb != null) {
      this.masterTone.bassDb = clampMasterEqDb(partial.bassDb);
    }
    if (partial.trebleDb != null) {
      this.masterTone.trebleDb = clampMasterEqDb(partial.trebleDb);
    }
    if (partial.reverbWet != null) {
      this.masterTone.reverbWet = clampReverbWet(partial.reverbWet);
    }
    audioEngine.setMasterTone(this.masterTone);
    this.notify();
    this.schedulePersist();
  }

  setDriftConfig(partial: Partial<DriftConfig>): void {
    if (partial.enabled !== undefined) {
      this.driftConfig.enabled = Boolean(partial.enabled);
    }
    if (partial.pitchDepthPct !== undefined) {
      this.driftConfig.pitchDepthPct = clampDriftPitchPct(partial.pitchDepthPct);
    }
    if (partial.panSpread !== undefined) {
      this.driftConfig.panSpread = clampDriftPanSpread(partial.panSpread);
    }
    if (partial.gainDepthDb !== undefined) {
      this.driftConfig.gainDepthDb = clampDriftGainDb(partial.gainDepthDb);
    }
    if (partial.speed !== undefined) {
      this.driftConfig.speed = clampDriftSpeed(partial.speed);
    }
    audioEngine.setDriftConfig(this.driftConfig);
    this.notify();
    this.schedulePersist();
  }

  resetMixSettingsDefaults(): void {
    this.setMasterTone(defaultMasterTone());
    this.setDriftConfig(defaultDriftConfig());
    this.setDuplicateMinOffsetSec(DUPLICATE_MIN_OFFSET_DEFAULT_SEC);
  }

  async addNoiseLayer(type: NoiseType = 'white'): Promise<void> {
    if (!this.canAddLayer()) {
      this.setLoadNotice(this.layerCapMessage());
      this.notify();
      return;
    }
    const sameCount = this.layers.filter((l) => l.kind === 'noise' && l.params.type === type).length;
    if (sameCount >= MAX_SAME_LAYERS) {
      this.setLoadNotice(this.sameLayerCapMessage());
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

  async addYoutubeLayer(
    videoId: string,
    url: string,
    label: string,
    thumbnailUrl: string,
  ): Promise<string> {
    if (!this.canAddLayer()) {
      this.setLoadNotice(this.layerCapMessage());
      this.notify();
      return '';
    }

    const maxYt = getMaxYoutubeLayers();
    const youtubeCount = this.layers.filter((l) => l.kind === 'youtube').length;
    if (youtubeCount >= maxYt) {
      const msg =
        maxYt === 1
          ? 'iOS only supports 1 active YouTube stream at a time.'
          : `Maximum ${maxYt} YouTube channels allowed.`;
      this.setLoadNotice(msg);
      this.notify();
      return '';
    }

    const alreadyExists = this.layers.some(
      (l) => l.kind === 'youtube' && l.params.videoId === videoId,
    );
    if (alreadyExists) {
      this.setLoadNotice('This YouTube stream is already in your mix.');
      this.notify();
      return '';
    }

    const id = uid('yt');
    const layer: MixerLayer = {
      kind: 'youtube',
      params: createDefaultYoutubeLayer(id, videoId, url, label, thumbnailUrl),
    };

    this.layers = [...this.layers, layer];
    this.youtubeStatus.set(id, 'loading');

    // Warm the iframe API immediately so the next Play can call playVideo
    // closer to the user gesture (and while paused, pre-create the player).
    void loadYouTubeApi().catch(() => {
      /* non-fatal; ensureYoutubeInEngine will surface errors */
    });

    if (this.playing) {
      void this.ensureYoutubeInEngine(layer, true).then(() => {
        audioEngine.applyMuteSolo(this.layers);
      });
    } else {
      // Preload iframe while paused so Play can reuse a ready player.
      void this.ensureYoutubeInEngine(layer, false);
    }
    this.notify();
    this.schedulePersist();
    return id;
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

    const sameCount = this.layers.filter((l) => l.kind === 'sample' && l.params.assetId === asset.id).length;
    if (sameCount >= MAX_SAME_LAYERS) {
      this.setLoadNotice(this.sameLayerCapMessage());
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
   * Duplicates an existing layer in the mixer.
   * Enforces total layer cap (10), same layer cap (5), and YouTube cap (3 desktop / 1 iOS).
   */
  async duplicateLayer(id: string): Promise<string> {
    const targetLayer = this.layers.find((l) => l.params.id === id);
    if (!targetLayer) return '';

    if (!this.canAddLayer()) {
      this.setLoadNotice(this.layerCapMessage());
      this.notify();
      return '';
    }

    if (this.getSameLayerCount(targetLayer) >= MAX_SAME_LAYERS) {
      this.setLoadNotice(this.sameLayerCapMessage());
      this.notify();
      return '';
    }

    if (targetLayer.kind === 'youtube') {
      this.setLoadNotice('YouTube streams cannot be duplicated.');
      this.notify();
      return '';
    }

    if (targetLayer.kind === 'noise') {
      const newId = uid('noise');
      const duplicated: MixerLayer = {
        kind: 'noise',
        params: {
          ...targetLayer.params,
          id: newId,
          solo: false,
        },
      };
      this.layers = [...this.layers, duplicated];
      if (this.playing) {
        await audioEngine.addLayer(duplicated);
        audioEngine.applyMuteSolo(this.layers);
      }
      this.notify();
      this.schedulePersist();
      return newId;
    }

    if (targetLayer.kind === 'sample') {
      const newId = uid('sample');
      const duplicated: MixerLayer = {
        kind: 'sample',
        params: {
          ...targetLayer.params,
          id: newId,
          solo: false,
        },
      };
      this.layers = [...this.layers, duplicated];
      this.notify();
      this.schedulePersist();

      if (this.playing) {
        await this.ensureSampleInEngine(duplicated);
        if (this.hasLayer(newId) && this.playing) {
          audioEngine.applyMuteSolo(this.layers);
        }
      }
      this.notify();
      return newId;
    }

    if (targetLayer.kind === 'playlist') {
      const newId = uid('pl-layer');
      const duplicated: MixerLayer = {
        kind: 'playlist',
        params: {
          ...targetLayer.params,
          id: newId,
          solo: false,
        },
      };
      this.layers = [...this.layers, duplicated];
      this.notify();
      this.schedulePersist();

      if (this.playing) {
        await this.ensurePlaylistInEngine(duplicated, true);
        if (this.hasLayer(newId) && this.playing) {
          audioEngine.applyMuteSolo(this.layers);
        }
      }
      this.notify();
      return newId;
    }

    return '';
  }


  /**
   * Build a random complementary mix (ENH-04). Replaces current layers.
   */
  async surpriseMe(): Promise<void> {
    await this.ensureCatalogReady();
    if (!this.catalog || this.catalog.assets.length === 0) {
      this.setLoadNotice('Catalog not ready — try again in a moment.');
      this.notify();
      return;
    }

    // Curated complementary groups (asset ids that work well together across all core loop categories)
    const groups: string[][] = [
      // Cozy Indoor & Study
      ['cafe_murmur', 'rain_window'],
      ['library_quiet', 'ac_room', 'rain_window'],
      ['fireplace_indoor', 'rain_roof', 'ac_room'],
      ['temple_soft', 'rain_light', 'ac_room'],
      ['cafe_murmur', 'rain_roof', 'fireplace_indoor'],

      // Urban & City Environments
      ['city_soft', 'rain_roof', 'ac_room'],
      ['metro_cabin', 'city_soft'],
      ['bus_ride', 'rain_window'],
      ['park_city', 'birds_morning', 'leaves_rustle'],
      ['city_soft', 'rain_heavy', 'ac_room'],

      // Rain & Atmospheric Storms
      ['rain_heavy', 'thunder_distant', 'wind_trees'],
      ['rain_window', 'fireplace_indoor'],
      ['rain_tent', 'thunder_storm', 'leaves_rustle'],
      ['rain_leaves', 'creek_rocks', 'wind_trees'],
      ['rain_light', 'fire_camp', 'stream_small'],

      // Coastal & Oceans
      ['ocean_shore', 'seagulls_surf', 'wind_trees'],
      ['harbor_night', 'pebble_beach'],
      ['boat_sailboat', 'ocean_shore', 'seagulls'],
      ['sea_stormy', 'wind_trees'],
      ['pebble_beach', 'wind_trees', 'harbor_night'],

      // Forest & Wilderness
      ['meadow_day', 'stream_small', 'birds_morning'],
      ['amazon_forest', 'river_wide', 'jungle_amazon'],
      ['bamboo_forest', 'wind_trees', 'birds_morning'],
      ['crickets_night', 'owls_forest', 'fireplace_indoor'],
      ['summer_night_insects', 'frogs_pond', 'fire_camp'],
      ['cicadas_summer', 'desert_wind', 'fire_camp'],

      // Rivers, Streams & Waters
      ['river_wide', 'meadow_day', 'birds_morning'],
      ['creek_rocks', 'leaves_rustle', 'birds_morning'],
      ['fountain_plaza', 'city_soft'],
      ['lake_shore', 'frogs_pond', 'cicadas_summer'],
      ['cave_drips', 'underwater'],
      ['waterfall', 'wind_trees'],

      // Transport & Journeys
      ['train_ride', 'rain_roof'],
      ['train_steam_clickety', 'rain_light', 'wind_trees'],
      ['train_romanian', 'wind_trees'],
      ['jet_airliner', 'ac_room'],
      ['bus_ride', 'rain_light'],

      // Winter & Mountain Shelter
      ['winter_storm', 'fireplace_indoor'],
      ['snow_wind', 'fireplace_indoor', 'rain_window'],
      ['winter_storm', 'fire_camp', 'desert_wind'],
    ];

    const available = new Set(this.catalog.assets.map((a) => a.id));
    const validGroups = groups
      .map((g) => g.filter((id) => available.has(id)))
      .filter((g) => g.length >= 2);

    const pick =
      (validGroups.length > 0
        ? validGroups[Math.floor(Math.random() * validGroups.length)]
        : undefined) ??
      this.catalog.assets
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
    this.youtubeStatus.clear();
    this.layers = [];

    const pans = [-0.35, 0.35, 0, -0.15, 0.2];
    const vols = [0.65, 0.55, 0.45, 0.5];

    for (let i = 0; i < chosen.length; i++) {
      const assetId = chosen[i];
      if (!assetId) continue;
      const asset = findAsset(this.catalog, assetId);
      if (!asset) continue;
      this.layers.push({
        kind: 'sample',
        params: createDefaultSampleLayer(uid('sample'), asset.id, asset.title, {
          loopMode: asset.loop.mode,
          crossfadeMs: asset.loop.crossfadeMs ?? 80,
          volumeLinear: vols[i % vols.length] ?? 0.5,
        }),
      });
      const layer = this.layers[this.layers.length - 1];
      if (layer && layer.kind === 'sample') {
        layer.params.pan = pans[i % pans.length] ?? 0;
      }
    }

    // ~30% chance of soft noise bed (pink or brown)
    if (this.layers.length < MAX_MIXER_LAYERS && Math.random() < 0.3) {
      const noiseType = Math.random() < 0.5 ? 'pink' : 'brown';
      const noise = createDefaultNoiseLayer(uid('noise'), noiseType);
      noise.volumeLinear = noiseType === 'brown' ? 0.22 : 0.28;
      this.layers.push({ kind: 'noise', params: noise });
    }

    this.masterVolumeLinear = 0.85;
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);

    this.playing = false;
    if (wasPlaying && this.layers.length > 0) {
      await this.play();
    }
    this.setLoadNotice(
      `Surprise mix: ${this.layers
        .map((l) =>
          l.kind === 'noise'
            ? `${l.params.type} noise`
            : l.kind === 'youtube'
              ? l.params.label
              : l.kind === 'playlist'
                ? l.params.playlistName
                : l.params.label,
        )
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
    this.youtubeStatus.delete(id);
    audioEngine.removeLayer(id);
    if (this.layers.length === 0 && this.playing) {
      this.cancelTimer();
      this.playing = false;
      playbackOwner.release();
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
    this.youtubeStatus.clear();
    if (this.playing) {
      this.cancelTimer();
      this.playing = false;
      playbackOwner.release();
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

  updateYoutubeLayer(
    id: string,
    patch: Partial<Omit<import('../audio/types').YoutubeLayerParams, 'id' | 'videoId' | 'url'>>,
  ): void {
    this.layers = this.layers.map((l) => {
      if (l.kind !== 'youtube' || l.params.id !== id) return l;
      return { kind: 'youtube', params: { ...l.params, ...patch } };
    });
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer || layer.kind !== 'youtube') return;

    // Volume/mute apply whenever the iframe exists (including while paused).
    if (youtubePlayerManager.hasPlayer(id)) {
      audioEngine.updateYoutubeLayer(layer.params);
      if ('muted' in patch || 'solo' in patch) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
    this.notify();
    this.schedulePersist();
  }

  updatePlaylistLayer(
    id: string,
    patch: Partial<Omit<PlaylistLayerParams, 'id' | 'playlistId'>>,
  ): void {
    this.layers = this.layers.map((l) => {
      if (l.kind !== 'playlist' || l.params.id !== id) return l;
      return { kind: 'playlist', params: { ...l.params, ...patch } };
    });
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer || layer.kind !== 'playlist') return;

    if (this.playing) {
      audioEngine.updatePlaylistLayer(layer.params);
      if ('muted' in patch || 'solo' in patch) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
    this.notify();
    this.schedulePersist();
  }

  // ══════════════════════════════════════════════════════════════════
  // Playlist Management & Mixer Layer Controls
  // ══════════════════════════════════════════════════════════════════

  getPlaylists(): Playlist[] {
    return this.playlists;
  }

  getPlaylist(id: string): Playlist | undefined {
    return this.playlists.find((p) => p.id === id);
  }

  createPlaylist(
    name: string,
    items: PlaylistItem[] = [],
    shuffleDefault = false,
  ): Playlist {
    const pl = createPlaylist(name, items, shuffleDefault);
    this.playlists = [...this.playlists, pl];
    savePlaylistsToStorage(this.playlists);
    this.notify();
    return pl;
  }

  updatePlaylist(
    id: string,
    patch: Partial<Omit<Playlist, 'id' | 'createdAt'>>,
  ): void {
    this.playlists = this.playlists.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
    });
    savePlaylistsToStorage(this.playlists);

    if (patch.name) {
      this.layers = this.layers.map((l) => {
        if (l.kind === 'playlist' && l.params.playlistId === id) {
          return {
            kind: 'playlist',
            params: { ...l.params, playlistName: patch.name! },
          };
        }
        return l;
      });
    }

    this.notify();
  }

  deletePlaylist(id: string): void {
    this.playlists = this.playlists.filter((p) => p.id !== id);
    savePlaylistsToStorage(this.playlists);

    const affected = this.layers.filter(
      (l) => l.kind === 'playlist' && l.params.playlistId === id,
    );
    for (const l of affected) {
      this.removeLayer(l.params.id);
    }
    this.notify();
  }

  addPlaylistItem(
    playlistId: string,
    item: Omit<PlaylistItem, 'id' | 'addedAt'>,
  ): PlaylistItem | null {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return null;

    const newItem: PlaylistItem = {
      ...item,
      id: plUid('item'),
      addedAt: Date.now(),
    };

    const updatedItems = [...pl.items, newItem];
    this.updatePlaylist(playlistId, { items: updatedItems });

    for (const l of this.layers) {
      if (l.kind === 'playlist' && l.params.playlistId === playlistId) {
        if (
          !l.params.currentTrackTitle ||
          l.params.currentTrackTitle === 'Empty Playlist'
        ) {
          l.params.currentTrackTitle = newItem.title;
          l.params.currentTrackType = newItem.type;
          if (this.playing) {
            void this.ensurePlaylistInEngine(l, true);
          }
        }
      }
    }
    this.notify();
    return newItem;
  }

  removePlaylistItem(playlistId: string, itemId: string): void {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;

    const updatedItems = pl.items.filter((i) => i.id !== itemId);
    this.updatePlaylist(playlistId, { items: updatedItems });

    for (const l of this.layers) {
      if (l.kind === 'playlist' && l.params.playlistId === playlistId) {
        if (l.params.currentIndex >= updatedItems.length) {
          l.params.currentIndex = Math.max(0, updatedItems.length - 1);
        }
        const curItem = updatedItems[l.params.currentIndex];
        l.params.currentTrackTitle = curItem?.title ?? 'Empty Playlist';
        l.params.currentTrackType = curItem?.type;
        if (this.playing) {
          void this.ensurePlaylistInEngine(l, true);
        }
      }
    }
    this.notify();
  }

  reorderPlaylistItems(
    playlistId: string,
    fromIndex: number,
    toIndex: number,
  ): void {
    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    if (
      fromIndex < 0 ||
      fromIndex >= pl.items.length ||
      toIndex < 0 ||
      toIndex >= pl.items.length
    ) {
      return;
    }

    const items = [...pl.items];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved!);
    this.updatePlaylist(playlistId, { items });
  }

  duplicatePlaylist(id: string): Playlist | null {
    const pl = this.playlists.find((p) => p.id === id);
    if (!pl) return null;

    const clonedItems = pl.items.map((i) => ({
      ...i,
      id: plUid('item'),
      addedAt: Date.now(),
    }));

    return this.createPlaylist(
      `${pl.name} (Copy)`,
      clonedItems,
      pl.shuffleDefault,
    );
  }

  async addPlaylistLayer(
    playlistId: string,
    opts?: { shuffle?: boolean },
  ): Promise<string> {
    if (!this.canAddLayer()) {
      this.setLoadNotice(this.layerCapMessage());
      this.notify();
      return '';
    }

    const pl = this.playlists.find((p) => p.id === playlistId);
    if (!pl) {
      this.setLoadNotice('Playlist not found.');
      this.notify();
      return '';
    }

    const sameCount = this.layers.filter(
      (l) => l.kind === 'playlist' && l.params.playlistId === playlistId,
    ).length;
    if (sameCount >= MAX_SAME_LAYERS) {
      this.setLoadNotice(this.sameLayerCapMessage());
      this.notify();
      return '';
    }

    const id = uid('pl-layer');
    const firstItem = pl.items[0];
    const layer: MixerLayer = {
      kind: 'playlist',
      params: createDefaultPlaylistLayer(id, pl.id, pl.name, {
        shuffle: opts?.shuffle ?? pl.shuffleDefault ?? false,
        currentIndex: 0,
        currentTrackTitle: firstItem?.title ?? 'Empty Playlist',
        currentTrackType: firstItem?.type,
      }),
    };

    this.layers = [...this.layers, layer];
    this.notify();
    this.schedulePersist();

    if (this.playing) {
      await this.ensurePlaylistInEngine(layer, true);
      if (this.hasLayer(id) && this.playing) {
        audioEngine.applyMuteSolo(this.layers);
      }
    } else if (firstItem?.type === 'youtube') {
      // Pre-warm the YouTube iframe in the background while paused
      // so clicking Play will start immediately in the gesture handler.
      void this.ensurePlaylistInEngine(layer, false);
    }
    this.notify();
    return id;
  }

  async nextPlaylistTrack(layerId: string): Promise<void> {
    const layer = this.layers.find((l) => l.params.id === layerId);
    if (!layer || layer.kind !== 'playlist') return;
    const pl = this.playlists.find((p) => p.id === layer.params.playlistId);
    if (!pl || pl.items.length === 0) return;

    const nextIdx = getNextTrackIndex(
      pl.items.length,
      layer.params.currentIndex,
      layer.params.shuffle,
    );
    layer.params.currentIndex = nextIdx;
    const item = pl.items[nextIdx];
    layer.params.currentTrackTitle = item?.title ?? 'Empty Playlist';
    layer.params.currentTrackType = item?.type;
    this.notify();
    this.schedulePersist();

    if (this.playing) {
      await this.ensurePlaylistInEngine(layer, true);
      if (this.hasLayer(layerId) && this.playing) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
  }

  async prevPlaylistTrack(layerId: string): Promise<void> {
    const layer = this.layers.find((l) => l.params.id === layerId);
    if (!layer || layer.kind !== 'playlist') return;
    const pl = this.playlists.find((p) => p.id === layer.params.playlistId);
    if (!pl || pl.items.length === 0) return;

    const prevIdx = getPreviousTrackIndex(
      pl.items.length,
      layer.params.currentIndex,
    );
    layer.params.currentIndex = prevIdx;
    const item = pl.items[prevIdx];
    layer.params.currentTrackTitle = item?.title ?? 'Empty Playlist';
    layer.params.currentTrackType = item?.type;
    this.notify();
    this.schedulePersist();

    if (this.playing) {
      await this.ensurePlaylistInEngine(layer, true);
      if (this.hasLayer(layerId) && this.playing) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
  }

  async selectPlaylistTrack(layerId: string, index: number): Promise<void> {
    const layer = this.layers.find((l) => l.params.id === layerId);
    if (!layer || layer.kind !== 'playlist') return;
    const pl = this.playlists.find((p) => p.id === layer.params.playlistId);
    if (!pl || pl.items.length === 0) return;

    const safeIdx = Math.max(0, Math.min(pl.items.length - 1, index));
    layer.params.currentIndex = safeIdx;
    const item = pl.items[safeIdx];
    layer.params.currentTrackTitle = item?.title ?? 'Empty Playlist';
    layer.params.currentTrackType = item?.type;
    this.notify();
    this.schedulePersist();

    if (this.playing) {
      await this.ensurePlaylistInEngine(layer, true);
      if (this.hasLayer(layerId) && this.playing) {
        audioEngine.applyMuteSolo(this.layers);
      }
    }
  }

  setPlaylistLayerShuffle(layerId: string, shuffle: boolean): void {
    this.updatePlaylistLayer(layerId, { shuffle });
  }

  async ensurePlaylistInEngine(
    layer: MixerLayer,
    wantPlay = true,
  ): Promise<void> {
    if (layer.kind !== 'playlist') return;
    const id = layer.params.id;
    if (!this.hasLayer(id)) return;

    const pl = this.playlists.find((p) => p.id === layer.params.playlistId);
    if (!pl || pl.items.length === 0) {
      layer.params.currentTrackTitle = 'Empty Playlist';
      layer.params.currentTrackType = undefined;
      await audioEngine.addPlaylistLayer(layer.params, undefined);
      this.notify();
      return;
    }

    const idx = Math.max(
      0,
      Math.min(pl.items.length - 1, layer.params.currentIndex),
    );
    layer.params.currentIndex = idx;
    const item = pl.items[idx];
    layer.params.currentTrackTitle = item?.title ?? 'Unknown Track';
    layer.params.currentTrackType = item?.type;

    if (item?.type === 'youtube') {
      const curStatus = youtubePlayerManager.getStatus(id);
      this.youtubeStatus.set(
        id,
        curStatus === 'idle' ? 'loading' : curStatus,
      );
    }

    try {
      await audioEngine.addPlaylistLayer(
        layer.params,
        item,
        () => {
          void this.nextPlaylistTrack(id);
        },
        { wantPlay, preloadOnly: !wantPlay && !this.playing },
      );
      if (item?.type === 'youtube') {
        this.youtubeStatus.set(id, youtubePlayerManager.getStatus(id));
      }
    } catch (err) {
      console.warn('ensurePlaylistInEngine failed:', err);
      if (item?.type === 'youtube') {
        this.youtubeStatus.set(id, 'error');
      }
      if (pl.items.length > 1 && this.playing) {
        setTimeout(() => {
          void this.nextPlaylistTrack(id);
        }, 1000);
      }
    }
    this.notify();
  }

  getYoutubeStatus(id: string): YoutubePlayerStatus {
    return this.youtubeStatus.get(id) ?? youtubePlayerManager.getStatus(id);
  }

  /**
   * Preload iframes for all YouTube mix layers (call after host element is bound).
   * Safe while paused — Play then reuses ready players for reliable audio start.
   */
  preloadYoutubeLayers(): void {
    void loadYouTubeApi().catch(() => {
      /* non-fatal */
    });
    for (const layer of this.layers) {
      if (layer.kind === 'youtube') {
        void this.ensureYoutubeInEngine(layer, this.playing);
      } else if (layer.kind === 'playlist') {
        const pl = this.playlists.find((p) => p.id === layer.params.playlistId);
        const curItem = pl?.items[layer.params.currentIndex ?? 0];
        if (curItem?.type === 'youtube') {
          void this.ensurePlaylistInEngine(layer, this.playing);
        }
      }
    }
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
      driftPitch?: boolean;
      driftPan?: boolean;
      driftGain?: boolean;
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
    else if (layer.kind === 'youtube') this.updateYoutubeLayer(id, normalized);
    else if (layer.kind === 'playlist') this.updatePlaylistLayer(id, normalized);
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
    const p = layer.kind === 'youtube' ? 0 : Math.max(-1, Math.min(1, pan));
    const v = clampLinear(volumeLinear);
    const patch: {
      pan: number;
      volumeLinear: number;
      lowpassHz?: number;
    } = { pan: p, volumeLinear: v };
    if (opts?.coupleFilter) {
      // Natural Realism Distance Model: Near (v high ~ 1.0) -> crisp ~14,000 Hz, Far (v low ~ 0.0) -> air absorbed ~1,200 Hz
      const vClamped = Math.max(0, Math.min(1, v));
      const distanceFactor = 1.0 - vClamped;
      const lp = Math.round(14000 - distanceFactor * 12800);
      patch.lowpassHz = clampLowpassHz(lp);
    }
    this.updateLayerCommon(id, patch);
  }

  getLayerLiveDrift(id: string): LayerLiveDrift | null {
    const fromEngine = audioEngine.getLayerLiveDrift(id);
    if (fromEngine) return fromEngine;
    const layer = this.layers.find((l) => l.params.id === id);
    if (!layer) return null;
    const basePan = layer.kind === 'youtube' ? 0 : layer.params.pan;
    const baseVol = layer.params.volumeLinear;
    const baseRate = 'playbackRate' in layer.params ? (layer.params.playbackRate ?? 1) : 1;
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
      driftPanActive: layer.params.driftPan,
      driftGainActive: layer.params.driftGain,
      driftPitchActive: layer.params.driftPitch,
    };
  }

  getPeakLevels(): { left: number; right: number } {
    return audioEngine.getPeakLevels();
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

  private scheduleWakeups(): void {
    this.clearWakeups();
    if (this.timer.status !== 'running' && this.timer.status !== 'fading') return;
    const remaining = this.remainingMs();
    if (remaining == null) return;
    if (remaining <= 0) {
      void this.tickTimer();
      return;
    }

    const fadeMs = this.timer.fadeSec * 1000;
    if (this.timer.status === 'running') {
      const timeUntilFade = Math.max(0, remaining - fadeMs);
      if (timeUntilFade > 0) {
        this.fadeWakeupTimer = setTimeout(() => {
          this.fadeWakeupTimer = null;
          void this.tickTimer();
        }, timeUntilFade);
      } else {
        void this.tickTimer();
      }
    } else if (this.timer.status === 'fading') {
      this.finishWakeupTimer = setTimeout(() => {
        this.finishWakeupTimer = null;
        void this.tickTimer();
      }, remaining);
    }
  }

  private clearWakeups(): void {
    if (this.fadeWakeupTimer != null) {
      clearTimeout(this.fadeWakeupTimer);
      this.fadeWakeupTimer = null;
    }
    if (this.finishWakeupTimer != null) {
      clearTimeout(this.finishWakeupTimer);
      this.finishWakeupTimer = null;
    }
  }

  private ensurePoll(): void {
    this.scheduleWakeups();
    if (this.pollId == null) {
      // Foreground tick for UI progress bars when document is visible
      this.pollId = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return; // Skip tick in background tabs to permit deep CPU sleep
        }
        void this.tickTimer();
      }, 1000);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.onVisibility);
    }
  }

  private clearPoll(): void {
    this.clearWakeups();
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
    this.scheduleWakeups();
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
      this.scheduleWakeups();
      const fadeSec = Math.max(remaining, 50) / 1000;
      const completed = await audioEngine.startFadeOut(fadeSec);
      if (completed && this.timer.status === 'fading') {
        await this.finishTimer();
      }
      return;
    }
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
    this.youtubeStatus.clear();
    audioEngine.restoreMasterGain();
    await audioEngine.suspend();
    this.playing = false;
    playbackOwner.release();
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
    this.youtubeStatus.clear();
    this.masterVolumeLinear = clampLinear(preset.master.volumeLinear);
    this.masterTone = masterToneFromPreset(preset.master);
    this.driftConfig = driftConfigFromPreset(preset.master);
    // Enforce YouTube layer limit & prevent duplicate YouTube streams from presets/share links
    const maxYt = getMaxYoutubeLayers();
    let youtubeCount = 0;
    const seenYtVideoIds = new Set<string>();
    const filteredLayers = preset.layers.filter((l) => {
      if (l.kind === 'youtube') {
        if (seenYtVideoIds.has(l.params.videoId)) {
          return false;
        }
        seenYtVideoIds.add(l.params.videoId);
        youtubeCount++;
        return youtubeCount <= maxYt;
      }
      return true;
    });
    this.layers = filteredLayers.map((l) => {
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
      if (l.kind === 'youtube') {
        return {
          kind: 'youtube' as const,
          params: {
            ...l.params,
            id: uid('yt'),
            volumeLinear: clampLinear(l.params.volumeLinear),
            pan: Math.max(-1, Math.min(1, l.params.pan)),
            lowpassHz: clampLowpassHz(l.params.lowpassHz ?? FILTER_LP_OPEN_HZ),
            highpassHz: clampHighpassHz(l.params.highpassHz ?? FILTER_HP_OPEN_HZ),
            panLfoEnabled: Boolean(l.params.panLfoEnabled),
            panLfoRateHz: clampPanLfoRateHz(l.params.panLfoRateHz ?? 0.08),
            panLfoDepth: clampPanLfoDepth(l.params.panLfoDepth ?? 0.35),
          },
        };
      }
      if (l.kind === 'playlist') {
        return {
          kind: 'playlist' as const,
          params: {
            ...l.params,
            id: uid('pl-layer'),
            volumeLinear: clampLinear(l.params.volumeLinear),
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
  }

  /**
   * Crossfade out → swap scene → optionally restart with fade-in (ENH-18).
   */
  private async swapSceneWithCrossfade(preset: PresetV1): Promise<void> {
    const wasPlaying = this.playing;
    this.cancelTimer();

    if (wasPlaying && this.layers.length > 0) {
      await audioEngine.startFadeOut(PRESET_CROSSFADE_SEC);
    }

    audioEngine.stopAll();
    this.youtubeStatus.clear();
    this.applyPresetData(preset);
    audioEngine.setMasterVolumeLinear(this.masterVolumeLinear);
    audioEngine.setMasterTone(this.masterTone);
    audioEngine.setDriftConfig(this.driftConfig);
    this.playing = false;
    // Preload any YT layers from the new scene while paused.
    for (const layer of this.layers) {
      if (layer.kind === 'youtube') {
        void this.ensureYoutubeInEngine(layer, false);
      } else if (layer.kind === 'playlist') {
        const pl = this.playlists.find((p) => p.id === layer.params.playlistId);
        const curItem = pl?.items[layer.params.currentIndex ?? 0];
        if (curItem?.type === 'youtube') {
          void this.ensurePlaylistInEngine(layer, false);
        }
      }
    }

    if (wasPlaying && this.layers.length > 0) {
      await this.play({ holdSilent: true });
      if (this.playing) {
        await audioEngine.startFadeIn(PRESET_CROSSFADE_SEC);
      } else {
        audioEngine.restoreMasterGain();
      }
    } else {
      audioEngine.restoreMasterGain();
    }
  }

  async loadPreset(id: string): Promise<void> {
    const preset = this.presets.find((p) => p.id === id);
    if (!preset) return;

    await this.swapSceneWithCrossfade(preset);
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
      masterTone: this.masterTone,
      masterDrift: this.driftConfig,
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

  /**
   * Apply a full scene from a shared link or imported preset (layers +
   * optional timer). Does not add to the saved presets list.
   */
  async applySharedScene(preset: PresetV1): Promise<void> {
    await this.swapSceneWithCrossfade(preset);
    this.notify();
    this.schedulePersist();
  }

  /** Snapshot of the current mix for share links / export. */
  captureSceneSnapshot(name = 'Shared mix'): PresetV1 {
    return snapshotFromSession({
      name,
      layers: this.layers,
      masterVolumeLinear: this.masterVolumeLinear,
      masterTone: this.masterTone,
      masterDrift: this.driftConfig,
      timerDefaults: this.timerDefaults,
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
    if (
      layer.kind === 'noise' ||
      layer.kind === 'youtube' ||
      layer.kind === 'playlist'
    ) {
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
   * Ensure YouTube iframe for a layer. Safe to call repeatedly (reuses player).
   * Does not throw — timeouts/errors surface via status + loadNotice.
   */
  private async ensureYoutubeInEngine(
    layer: MixerLayer,
    wantPlay: boolean,
  ): Promise<void> {
    if (layer.kind !== 'youtube') return;
    if (!this.hasLayer(layer.params.id)) return;
    this.youtubeStatus.set(
      layer.params.id,
      youtubePlayerManager.getStatus(layer.params.id) === 'idle'
        ? 'loading'
        : youtubePlayerManager.getStatus(layer.params.id),
    );
    try {
      await audioEngine.addYoutubeLayer(layer.params, {
        wantPlay,
        preloadOnly: !wantPlay && !this.playing,
      });
    } catch (err) {
      console.warn('ensureYoutubeInEngine failed:', err);
      this.youtubeStatus.set(layer.params.id, 'error');
    }
  }

  /**
   * Start a sample layer in the engine if still present in the mix.
   * Discards the engine node if the user removed/cleared the layer mid-download.
   * On fetch/decode failure, auto-removes the layer and sets {@link loadNotice}.
   */
  private async ensureSampleInEngine(layer: MixerLayer): Promise<void> {
    if (layer.kind === 'youtube') {
      await this.ensureYoutubeInEngine(layer, this.playing);
      return;
    }
    if (layer.kind === 'playlist') {
      await this.ensurePlaylistInEngine(layer, this.playing);
      return;
    }
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
