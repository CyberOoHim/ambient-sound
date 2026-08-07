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
}

export type MixerLayer =
  | { kind: 'noise'; params: NoiseLayerParams }
  | { kind: 'sample'; params: SampleLayerParams };

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
    pan: 0,
    loopMode: opts?.loopMode ?? 'crossfade',
    crossfadeMs: opts?.crossfadeMs ?? 80,
    playbackRate: opts?.playbackRate ?? 1,
    lowpassHz: opts?.lowpassHz ?? FILTER_LP_OPEN_HZ,
    highpassHz: opts?.highpassHz ?? FILTER_HP_OPEN_HZ,
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
