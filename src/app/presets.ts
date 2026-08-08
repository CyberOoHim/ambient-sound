import type {
  MasterToneParams,
  MixerLayer,
  NoiseLayerParams,
  NoiseType,
  SampleLayerParams,
} from '../audio/types';
import {
  clampHighpassHz,
  clampLowpassHz,
  clampMasterEqDb,
  clampPanLfoDepth,
  clampPanLfoRateHz,
  clampReverbWet,
  defaultMasterTone,
  FILTER_HP_OPEN_HZ,
  FILTER_LP_OPEN_HZ,
  MASTER_BASS_DB_DEFAULT,
  MASTER_REVERB_WET_DEFAULT,
  MASTER_TREBLE_DB_DEFAULT,
  PAN_LFO_DEPTH_DEFAULT,
  PAN_LFO_RATE_DEFAULT_HZ,
} from '../audio/types';
import { NOISE_TYPES } from '../audio/dsp/colored-noise';
import { clampLinear } from '../audio/dsp/curves';
import {
  clampDuplicateMinOffsetSec,
  DUPLICATE_MIN_OFFSET_DEFAULT_SEC,
} from '../audio/dsp/loop';
import defaultPresetsRaw from '../../config/default-presets.json';
import {
  parseBinauralConfig,
  type BinauralConfig,
} from './binaural';
import {
  parseOneShotConfig,
  type OneShotConfig,
} from './one-shot';

export const PRESETS_STORAGE_KEY = 'ambient-sound:presets';
export const LAST_SESSION_KEY = 'ambient-sound:last-session';
/** User preference: min buffer offset (seconds) for 2nd+ copy of the same sample. */
export const DUPLICATE_MIN_OFFSET_KEY = 'ambient-sound:duplicate-min-offset-sec';

export interface PresetTimerConfig {
  durationSec: number;
  fadeSec: number;
}

/**
 * Scene preset: mixer layers + optional tone generator and one-shot accents.
 * Older presets omit binaural/oneShot; loaders leave current session values
 * unchanged when those fields are absent.
 */
export interface PresetMaster {
  volumeLinear: number;
  /** Master low-shelf dB (ENH-17). Omitted / 0 = flat. */
  bassDb?: number;
  /** Master high-shelf dB (ENH-17). */
  trebleDb?: number;
  /** Master reverb wet 0…~0.55 (ENH-17). */
  reverbWet?: number;
}

export interface PresetV1 {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  master: PresetMaster;
  layers: MixerLayer[];
  timer?: PresetTimerConfig | null;
  /** Present when the preset captures tone-generator state. */
  binaural?: BinauralConfig | null;
  /** Present when the preset captures stochastic one-shot state. */
  oneShot?: OneShotConfig | null;
}

export function masterToneFromPreset(master: PresetMaster): MasterToneParams {
  return {
    bassDb:
      master.bassDb != null
        ? clampMasterEqDb(master.bassDb)
        : MASTER_BASS_DB_DEFAULT,
    trebleDb:
      master.trebleDb != null
        ? clampMasterEqDb(master.trebleDb)
        : MASTER_TREBLE_DB_DEFAULT,
    reverbWet:
      master.reverbWet != null
        ? clampReverbWet(master.reverbWet)
        : MASTER_REVERB_WET_DEFAULT,
  };
}

export function presetMasterFromSession(
  volumeLinear: number,
  tone: MasterToneParams,
): PresetMaster {
  const master: PresetMaster = {
    volumeLinear: clampLinear(volumeLinear),
  };
  if (tone.bassDb !== MASTER_BASS_DB_DEFAULT) {
    master.bassDb = clampMasterEqDb(tone.bassDb);
  }
  if (tone.trebleDb !== MASTER_TREBLE_DB_DEFAULT) {
    master.trebleDb = clampMasterEqDb(tone.trebleDb);
  }
  if (tone.reverbWet !== MASTER_REVERB_WET_DEFAULT) {
    master.reverbWet = clampReverbWet(tone.reverbWet);
  }
  return master;
}

export interface PresetStoreFile {
  version: 1;
  presets: PresetV1[];
}

function isNoiseType(v: unknown): v is NoiseType {
  return typeof v === 'string' && (NOISE_TYPES as string[]).includes(v);
}

function parseNoiseParams(raw: unknown, fallbackId: string): NoiseLayerParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isNoiseType(o.type)) return null;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : fallbackId,
    type: o.type,
    volumeLinear: clampLinear(Number(o.volumeLinear) || 0),
    muted: Boolean(o.muted),
    solo: Boolean(o.solo),
    stereoWidth: Math.max(0, Math.min(1, Number(o.stereoWidth) || 0)),
    pan: Math.max(-1, Math.min(1, Number(o.pan) || 0)),
    lowpassHz:
      o.lowpassHz != null
        ? clampLowpassHz(Number(o.lowpassHz))
        : FILTER_LP_OPEN_HZ,
    highpassHz:
      o.highpassHz != null
        ? clampHighpassHz(Number(o.highpassHz))
        : FILTER_HP_OPEN_HZ,
    panLfoEnabled: Boolean(o.panLfoEnabled),
    panLfoRateHz:
      o.panLfoRateHz != null
        ? clampPanLfoRateHz(Number(o.panLfoRateHz))
        : PAN_LFO_RATE_DEFAULT_HZ,
    panLfoDepth:
      o.panLfoDepth != null
        ? clampPanLfoDepth(Number(o.panLfoDepth))
        : PAN_LFO_DEPTH_DEFAULT,
  };
}

function parseSampleParams(
  raw: unknown,
  fallbackId: string,
): SampleLayerParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.assetId !== 'string' || !o.assetId) return null;
  const loopMode = o.loopMode === 'native' ? 'native' : 'crossfade';
  return {
    id: typeof o.id === 'string' && o.id ? o.id : fallbackId,
    assetId: o.assetId,
    label: typeof o.label === 'string' ? o.label : o.assetId,
    volumeLinear: clampLinear(Number(o.volumeLinear) || 0),
    muted: Boolean(o.muted),
    solo: Boolean(o.solo),
    pan: Math.max(-1, Math.min(1, Number(o.pan) || 0)),
    loopMode,
    crossfadeMs: Math.max(0, Number(o.crossfadeMs) || 80),
    playbackRate: Math.max(0.5, Math.min(1.5, Number(o.playbackRate) || 1)),
    lowpassHz:
      o.lowpassHz != null
        ? clampLowpassHz(Number(o.lowpassHz))
        : FILTER_LP_OPEN_HZ,
    highpassHz:
      o.highpassHz != null
        ? clampHighpassHz(Number(o.highpassHz))
        : FILTER_HP_OPEN_HZ,
    panLfoEnabled: Boolean(o.panLfoEnabled),
    panLfoRateHz:
      o.panLfoRateHz != null
        ? clampPanLfoRateHz(Number(o.panLfoRateHz))
        : PAN_LFO_RATE_DEFAULT_HZ,
    panLfoDepth:
      o.panLfoDepth != null
        ? clampPanLfoDepth(Number(o.panLfoDepth))
        : PAN_LFO_DEPTH_DEFAULT,
  };
}

/** Parse a single preset; returns null if invalid. */
export function parsePreset(raw: unknown): PresetV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  if (!o.master || typeof o.master !== 'object') return null;
  const master = o.master as Record<string, unknown>;
  if (!Array.isArray(o.layers)) return null;

  const layers: MixerLayer[] = [];
  for (let i = 0; i < o.layers.length; i++) {
    const entry = o.layers[i];
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    if (e.kind === 'noise') {
      const params = parseNoiseParams(e.params, `noise-${i + 1}`);
      if (!params) return null;
      layers.push({ kind: 'noise', params });
    } else if (e.kind === 'sample') {
      const params = parseSampleParams(e.params, `sample-${i + 1}`);
      if (!params) return null;
      layers.push({ kind: 'sample', params });
    } else {
      return null;
    }
  }

  let timer: PresetTimerConfig | null | undefined;
  if (o.timer === null || o.timer === undefined) {
    timer = o.timer as null | undefined;
  } else if (typeof o.timer === 'object') {
    const t = o.timer as Record<string, unknown>;
    const durationSec = Number(t.durationSec);
    const fadeSec = Number(t.fadeSec);
    if (Number.isFinite(durationSec) && Number.isFinite(fadeSec)) {
      timer = {
        durationSec: Math.max(1, durationSec),
        fadeSec: Math.max(0, fadeSec),
      };
    }
  }

  let binaural: BinauralConfig | null | undefined;
  if (o.binaural === null) {
    binaural = null;
  } else if (o.binaural !== undefined) {
    binaural = parseBinauralConfig(o.binaural);
  }

  let oneShot: OneShotConfig | null | undefined;
  if (o.oneShot === null) {
    oneShot = null;
  } else if (o.oneShot !== undefined) {
    oneShot = parseOneShotConfig(o.oneShot);
  }

  const now = new Date().toISOString();
  const parsedMaster: PresetMaster = {
    volumeLinear: clampLinear(Number(master.volumeLinear) || 0),
  };
  if (master.bassDb != null && Number.isFinite(Number(master.bassDb))) {
    parsedMaster.bassDb = clampMasterEqDb(Number(master.bassDb));
  }
  if (master.trebleDb != null && Number.isFinite(Number(master.trebleDb))) {
    parsedMaster.trebleDb = clampMasterEqDb(Number(master.trebleDb));
  }
  if (master.reverbWet != null && Number.isFinite(Number(master.reverbWet))) {
    parsedMaster.reverbWet = clampReverbWet(Number(master.reverbWet));
  }

  return {
    version: 1,
    id: o.id,
    name: o.name,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
    master: parsedMaster,
    layers,
    timer: timer ?? null,
    ...(binaural !== undefined ? { binaural } : {}),
    ...(oneShot !== undefined ? { oneShot } : {}),
  };
}

export function parsePresetStore(raw: unknown): PresetStoreFile {
  if (!raw || typeof raw !== 'object') return { version: 1, presets: [] };
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.presets)) return { version: 1, presets: [] };
  const presets: PresetV1[] = [];
  for (const p of o.presets) {
    const parsed = parsePreset(p);
    if (parsed) presets.push(parsed);
  }
  return { version: 1, presets };
}



export function getDefaultPresets(): PresetV1[] {
  if (!Array.isArray(defaultPresetsRaw)) return [];
  const presets: PresetV1[] = [];
  for (const p of defaultPresetsRaw) {
    const parsed = parsePreset(p);
    if (parsed) presets.push(parsed);
  }
  return presets;
}

export function loadPresetsFromStorage(
  storage?: Storage,
): PresetStoreFile {
  const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!st) return { version: 1, presets: getDefaultPresets() };
  try {
    const text = st.getItem(PRESETS_STORAGE_KEY);
    if (!text) return { version: 1, presets: getDefaultPresets() };
    const parsed = parsePresetStore(JSON.parse(text) as unknown);
    if (parsed.presets.length === 0) {
      return { version: 1, presets: getDefaultPresets() };
    }
    return parsed;
  } catch {
    return { version: 1, presets: getDefaultPresets() };
  }
}

export function savePresetsToStorage(
  store: PresetStoreFile,
  storage?: Storage,
): void {
  const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  st?.setItem(PRESETS_STORAGE_KEY, JSON.stringify(store));
}

export function loadLastSession(
  storage?: Storage,
): PresetV1 | null {
  const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!st) return null;
  try {
    const text = st.getItem(LAST_SESSION_KEY);
    if (!text) return null;
    return parsePreset(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function saveLastSession(
  snapshot: PresetV1,
  storage?: Storage,
): void {
  const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  st?.setItem(LAST_SESSION_KEY, JSON.stringify(snapshot));
}

export function loadDuplicateMinOffsetSec(storage?: Storage): number {
  const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!st) return DUPLICATE_MIN_OFFSET_DEFAULT_SEC;
  try {
    const text = st.getItem(DUPLICATE_MIN_OFFSET_KEY);
    if (text == null || text === '') return DUPLICATE_MIN_OFFSET_DEFAULT_SEC;
    return clampDuplicateMinOffsetSec(Number(text));
  } catch {
    return DUPLICATE_MIN_OFFSET_DEFAULT_SEC;
  }
}

export function saveDuplicateMinOffsetSec(
  sec: number,
  storage?: Storage,
): void {
  const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!st) return;
  try {
    st.setItem(
      DUPLICATE_MIN_OFFSET_KEY,
      String(clampDuplicateMinOffsetSec(sec)),
    );
  } catch {
    /* private mode / quota */
  }
}

export function createPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SessionSnapshotInput {
  layers: MixerLayer[];
  masterVolumeLinear: number;
  masterTone?: MasterToneParams;
  timerDefaults?: PresetTimerConfig | null;
  binaural?: BinauralConfig | null;
  oneShot?: OneShotConfig | null;
  name?: string;
  id?: string;
}

/** Build a PresetV1 snapshot from the current session (does not persist). */
export function snapshotFromSession(input: SessionSnapshotInput): PresetV1 {
  const now = new Date().toISOString();
  const id = input.id ?? createPresetId();
  const tone = input.masterTone ?? defaultMasterTone();
  return {
    version: 1,
    id,
    name: input.name ?? 'Session',
    createdAt: now,
    updatedAt: now,
    master: presetMasterFromSession(input.masterVolumeLinear, tone),
    layers: input.layers.map((layer) => {
      if (layer.kind === 'noise') {
        return { kind: 'noise' as const, params: { ...layer.params } };
      }
      return { kind: 'sample' as const, params: { ...layer.params } };
    }),
    timer: input.timerDefaults ?? null,
    binaural: input.binaural
      ? parseBinauralConfig(input.binaural)
      : input.binaural === null
        ? null
        : undefined,
    oneShot: input.oneShot
      ? parseOneShotConfig(input.oneShot)
      : input.oneShot === null
        ? null
        : undefined,
  };
}

export function upsertPreset(store: PresetStoreFile, preset: PresetV1): PresetStoreFile {
  const idx = store.presets.findIndex((p) => p.id === preset.id);
  const presets = [...store.presets];
  if (idx >= 0) presets[idx] = preset;
  else presets.push(preset);
  return { version: 1, presets };
}

export function deletePreset(store: PresetStoreFile, id: string): PresetStoreFile {
  return {
    version: 1,
    presets: store.presets.filter((p) => p.id !== id),
  };
}
