import type { NoiseType } from './dsp/colored-noise';

export type { NoiseType };

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
  };
}

export function createDefaultSampleLayer(
  id: string,
  assetId: string,
  label: string,
  opts?: Partial<
    Pick<SampleLayerParams, 'loopMode' | 'crossfadeMs' | 'playbackRate' | 'volumeLinear'>
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
