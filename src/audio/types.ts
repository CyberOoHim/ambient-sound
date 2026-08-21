import type { NoiseType } from './dsp/colored-noise';

export type { NoiseType };

/** Open lowpass (effectively off). */
export const FILTER_LP_OPEN_HZ = 20_000;
/** Open highpass (effectively off). */
export const FILTER_HP_OPEN_HZ = 20;

export interface LayerFilterParams {
  /** Low-pass cutoff Hz. {@link FILTER_LP_OPEN_HZ} = bypass. */
  lowpassHz: number;
  /** High-pass cutoff Hz. {@link FILTER_HP_OPEN_HZ} = bypass. */
  highpassHz: number;
}

export function defaultLayerFilters(): LayerFilterParams {
  return {
    lowpassHz: FILTER_LP_OPEN_HZ,
    highpassHz: FILTER_HP_OPEN_HZ,
  };
}

export function clampLowpassHz(hz: number): number {
  if (!Number.isFinite(hz)) return FILTER_LP_OPEN_HZ;
  return Math.max(200, Math.min(FILTER_LP_OPEN_HZ, hz));
}

export function clampHighpassHz(hz: number): number {
  if (!Number.isFinite(hz)) return FILTER_HP_OPEN_HZ;
  return Math.max(FILTER_HP_OPEN_HZ, Math.min(8_000, hz));
}

/** Auto-pan LFO defaults (ENH-15). */
export const PAN_LFO_RATE_DEFAULT_HZ = 0.08;
export const PAN_LFO_RATE_MIN_HZ = 0.02;
export const PAN_LFO_RATE_MAX_HZ = 0.5;
export const PAN_LFO_DEPTH_DEFAULT = 0.35;

export interface PanLfoParams {
  /** When true, slow sine LFO modulates pan around the base pan value. */
  panLfoEnabled: boolean;
  /** LFO rate in Hz (very slow for ambient motion). */
  panLfoRateHz: number;
  /** Modulation depth 0..1 (1 ≈ full pan swing). */
  panLfoDepth: number;
}

export function defaultPanLfo(): PanLfoParams {
  return {
    panLfoEnabled: false,
    panLfoRateHz: PAN_LFO_RATE_DEFAULT_HZ,
    panLfoDepth: PAN_LFO_DEPTH_DEFAULT,
  };
}

export function clampPanLfoRateHz(hz: number): number {
  if (!Number.isFinite(hz)) return PAN_LFO_RATE_DEFAULT_HZ;
  return Math.max(PAN_LFO_RATE_MIN_HZ, Math.min(PAN_LFO_RATE_MAX_HZ, hz));
}

export function clampPanLfoDepth(depth: number): number {
  if (!Number.isFinite(depth)) return PAN_LFO_DEPTH_DEFAULT;
  return Math.max(0, Math.min(1, depth));
}

export interface LayerDriftParams {
  /** Subtle playbackRate random drift (sample/playlist only). */
  driftPitch: boolean;
  /** Gentle stereo field wandering. */
  driftPan: boolean;
  /** Organic volume breathing variation with headroom protection. */
  driftGain: boolean;
}

export function defaultLayerDrift(isSample = false): LayerDriftParams {
  return {
    driftPitch: isSample,
    driftPan: true,
    driftGain: true,
  };
}

export interface NoiseLayerParams {
  id: string;
  type: NoiseType;
  /** Linear amplitude 0..1 (never dB). */
  volumeLinear: number;
  muted: boolean;
  solo: boolean;
  /** 0 mono .. 1 full decorrelated. */
  stereoWidth: number;
  /** -1 left .. 1 right. */
  pan: number;
  /** User LP for muffled / indoor feel (after type-specific filter). */
  lowpassHz: number;
  /** User HP. */
  highpassHz: number;
  panLfoEnabled: boolean;
  panLfoRateHz: number;
  panLfoDepth: number;
  driftPitch: boolean;
  driftPan: boolean;
  driftGain: boolean;
}

export type LoopMode = 'native' | 'crossfade';

export interface SampleLayerParams {
  id: string;
  assetId: string;
  /** Display name from catalog. */
  label: string;
  volumeLinear: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  loopMode: LoopMode;
  crossfadeMs: number;
  playbackRate: number;
  lowpassHz: number;
  highpassHz: number;
  panLfoEnabled: boolean;
  panLfoRateHz: number;
  panLfoDepth: number;
  driftPitch: boolean;
  driftPan: boolean;
  driftGain: boolean;
}

export interface YoutubeLayerParams {
  id: string;
  videoId: string;
  url: string;
  label: string;
  thumbnailUrl: string;
  volumeLinear: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  lowpassHz: number;
  highpassHz: number;
  panLfoEnabled: boolean;
  panLfoRateHz: number;
  panLfoDepth: number;
  driftPitch: boolean;
  driftPan: boolean;
  driftGain: boolean;
}

export interface PlaylistLayerParams {
  id: string;
  playlistId: string;
  playlistName: string;
  /** false = sequence / rotate (default), true = random / shuffle */
  shuffle: boolean;
  currentIndex: number;
  currentTrackTitle?: string;
  currentTrackType?: 'local' | 'youtube';
  volumeLinear: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  lowpassHz: number;
  highpassHz: number;
  panLfoEnabled: boolean;
  panLfoRateHz: number;
  panLfoDepth: number;
  driftPitch: boolean;
  driftPan: boolean;
  driftGain: boolean;
}

export type MixerLayer =
  | { kind: 'noise'; params: NoiseLayerParams }
  | { kind: 'sample'; params: SampleLayerParams }
  | { kind: 'youtube'; params: YoutubeLayerParams }
  | { kind: 'playlist'; params: PlaylistLayerParams };

/** Max YouTube stream channels allowed in mixer for standard platforms. */
export const MAX_YOUTUBE_LAYERS = 3;
/** Max YouTube stream channels allowed in mixer on iOS (WebKit single active media element limit). */
export const MAX_YOUTUBE_LAYERS_IOS = 1;
/** Max number of layers of the same sound asset or type allowed in the mixer. */
export const MAX_SAME_LAYERS = 5;


export function isIosDevice(customUa?: string, customPlatform?: string, customTouchPoints?: number): boolean {
  if (typeof navigator === 'undefined' && customUa === undefined) return false;
  const ua = customUa ?? navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  const platform = customPlatform ?? (typeof navigator !== 'undefined' ? navigator.platform : '');
  const touchPoints = customTouchPoints ?? (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0);
  if (platform === 'MacIntel' && touchPoints > 1) return true;
  return false;
}

export function getMaxYoutubeLayers(customUa?: string, customPlatform?: string, customTouchPoints?: number): number {
  return isIosDevice(customUa, customPlatform, customTouchPoints)
    ? MAX_YOUTUBE_LAYERS_IOS
    : MAX_YOUTUBE_LAYERS;
}

export function createDefaultNoiseLayer(
  id: string,
  type: NoiseType = 'white',
): NoiseLayerParams {
  return {
    id,
    type,
    volumeLinear: 0.75,
    muted: false,
    solo: false,
    stereoWidth: 1,
    pan: 0,
    ...defaultLayerFilters(),
    ...defaultPanLfo(),
    ...defaultLayerDrift(false),
  };
}

export function createDefaultSampleLayer(
  id: string,
  assetId: string,
  label: string,
  opts?: Partial<
    Pick<
      SampleLayerParams,
      | 'loopMode'
      | 'crossfadeMs'
      | 'playbackRate'
      | 'volumeLinear'
      | 'lowpassHz'
      | 'highpassHz'
      | 'pan'
      | 'panLfoEnabled'
      | 'panLfoRateHz'
      | 'panLfoDepth'
      | 'driftPitch'
      | 'driftPan'
      | 'driftGain'
    >
  >,
): SampleLayerParams {
  return {
    id,
    assetId,
    label,
    volumeLinear: opts?.volumeLinear ?? 0.7,
    muted: false,
    solo: false,
    pan: opts?.pan ?? 0,
    loopMode: opts?.loopMode ?? 'crossfade',
    crossfadeMs: opts?.crossfadeMs ?? 80,
    playbackRate: opts?.playbackRate ?? 1,
    lowpassHz: opts?.lowpassHz ?? FILTER_LP_OPEN_HZ,
    highpassHz: opts?.highpassHz ?? FILTER_HP_OPEN_HZ,
    panLfoEnabled: opts?.panLfoEnabled ?? false,
    panLfoRateHz: opts?.panLfoRateHz ?? PAN_LFO_RATE_DEFAULT_HZ,
    panLfoDepth: opts?.panLfoDepth ?? PAN_LFO_DEPTH_DEFAULT,
    driftPitch: opts?.driftPitch ?? true,
    driftPan: opts?.driftPan ?? true,
    driftGain: opts?.driftGain ?? true,
  };
}

export function createDefaultYoutubeLayer(
  id: string,
  videoId: string,
  url: string,
  label: string,
  thumbnailUrl: string,
  opts?: Partial<
    Pick<
      YoutubeLayerParams,
      'volumeLinear' | 'pan' | 'driftPitch' | 'driftPan' | 'driftGain'
    >
  >,
): YoutubeLayerParams {
  return {
    id,
    videoId,
    url,
    label,
    thumbnailUrl,
    volumeLinear: opts?.volumeLinear ?? 0.7,
    muted: false,
    solo: false,
    pan: opts?.pan ?? 0,
    ...defaultLayerFilters(),
    ...defaultPanLfo(),
    driftPitch: false,
    driftPan: false,
    driftGain: opts?.driftGain ?? true,
  };
}

export function createDefaultPlaylistLayer(
  id: string,
  playlistId: string,
  playlistName: string,
  opts?: Partial<
    Pick<
      PlaylistLayerParams,
      | 'volumeLinear'
      | 'pan'
      | 'shuffle'
      | 'currentIndex'
      | 'currentTrackTitle'
      | 'currentTrackType'
      | 'driftPitch'
      | 'driftPan'
      | 'driftGain'
    >
  >,
): PlaylistLayerParams {
  return {
    id,
    playlistId,
    playlistName,
    shuffle: opts?.shuffle ?? false,
    currentIndex: opts?.currentIndex ?? 0,
    currentTrackTitle: opts?.currentTrackTitle,
    currentTrackType: opts?.currentTrackType,
    volumeLinear: opts?.volumeLinear ?? 0.7,
    muted: false,
    solo: false,
    pan: opts?.pan ?? 0,
    ...defaultLayerFilters(),
    ...defaultPanLfo(),
    driftPitch: opts?.driftPitch ?? false,
    driftPan: opts?.driftPan ?? true,
    driftGain: opts?.driftGain ?? true,
  };
}

/** Effective mute/solo gate (0 or 1). User volume stays on the volume GainNode. */
export function effectiveMuteSolo(
  muted: boolean,
  solo: boolean,
  anySolo: boolean,
): number {
  if (muted) return 0;
  if (anySolo && !solo) return 0;
  return 1;
}

export function layerId(layer: MixerLayer): string {
  return layer.params.id;
}

export function layerMuted(layer: MixerLayer): boolean {
  return layer.params.muted;
}

export function layerSolo(layer: MixerLayer): boolean {
  return layer.params.solo;
}

/** Soft cap for sample + noise layers (mobile CPU). */
export const MAX_MIXER_LAYERS = 10;

/** Local (user-imported) sample asset id prefix (ENH-13). */
export const LOCAL_ASSET_PREFIX = 'local:';

export function isLocalAssetId(assetId: string): boolean {
  return assetId.startsWith(LOCAL_ASSET_PREFIX);
}

/** Master-bus tone shaping (ENH-17). */
export const MASTER_BASS_DB_DEFAULT = 0;
export const MASTER_TREBLE_DB_DEFAULT = 0;
export const MASTER_REVERB_WET_DEFAULT = 0;
export const MASTER_EQ_DB_MIN = -12;
export const MASTER_EQ_DB_MAX = 12;
export const MASTER_REVERB_WET_MAX = 0.55;

export interface MasterToneParams {
  /** Low-shelf gain dB (−12…+12). */
  bassDb: number;
  /** High-shelf gain dB (−12…+12). */
  trebleDb: number;
  /** Convolver wet amount 0…{@link MASTER_REVERB_WET_MAX}. */
  reverbWet: number;
}

export function defaultMasterTone(): MasterToneParams {
  return {
    bassDb: MASTER_BASS_DB_DEFAULT,
    trebleDb: MASTER_TREBLE_DB_DEFAULT,
    reverbWet: MASTER_REVERB_WET_DEFAULT,
  };
}

export function clampMasterEqDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(MASTER_EQ_DB_MIN, Math.min(MASTER_EQ_DB_MAX, db));
}

export function clampReverbWet(wet: number): number {
  if (!Number.isFinite(wet)) return MASTER_REVERB_WET_DEFAULT;
  return Math.max(0, Math.min(MASTER_REVERB_WET_MAX, wet));
}

/** Short crossfade when loading a preset while playing (ENH-18). */
export const PRESET_CROSSFADE_SEC = 0.4;
