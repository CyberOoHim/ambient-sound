/**
 * URL hash shareable scenes.
 *
 * Format: `#mix=<base64url(JSON SharePayload)>`
 * Also recognizes `#attributions` for the in-app credits panel.
 *
 * Encode path strips default layer / master fields so hashes stay shorter (POL-02).
 */
import type { MixerLayer } from '../audio/types';
import {
  FILTER_HP_OPEN_HZ,
  FILTER_LP_OPEN_HZ,
  MASTER_BASS_DB_DEFAULT,
  MASTER_REVERB_WET_DEFAULT,
  MASTER_TREBLE_DB_DEFAULT,
  PAN_LFO_DEPTH_DEFAULT,
  PAN_LFO_RATE_DEFAULT_HZ,
} from '../audio/types';
import {
  parsePreset,
  type PresetMaster,
  type PresetTimerConfig,
  type PresetV1,
} from './presets';

export const SHARE_HASH_PREFIX = 'mix=';
export const ATTRIBUTIONS_HASH = 'attributions';

/** Compact wire format stored in the URL hash (no id/timestamps). */
export interface SharePayload {
  v: 1;
  name?: string;
  master: PresetMaster;
  layers: MixerLayer[];
  timer?: PresetTimerConfig | null;
}

export type LocationHashIntent =
  | { kind: 'mix'; preset: PresetV1 }
  | { kind: 'attributions' }
  | null;

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure JS base64 (no Buffer / btoa) for Node unit tests + browsers. */
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64_ALPHABET[(triple >> 18) & 63];
    out += B64_ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64_ALPHABET[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[triple & 63] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = cleaned.length;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(Math.max(0, outLen));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const n =
      (B64_ALPHABET.indexOf(cleaned[i]!) << 18) |
      (B64_ALPHABET.indexOf(cleaned[i + 1]!) << 12) |
      (B64_ALPHABET.indexOf(cleaned[i + 2] ?? 'A') << 6) |
      B64_ALPHABET.indexOf(cleaned[i + 3] ?? 'A');
    if (o < outLen) out[o++] = (n >> 16) & 255;
    if (o < outLen) out[o++] = (n >> 8) & 255;
    if (o < outLen) out[o++] = n & 255;
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return base64ToBytes(padded + '='.repeat(padLen));
}

function utf8ToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64UrlToUtf8(b64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

/** Drop defaulted fields from a layer so share hashes stay shorter. */
function compactLayer(layer: MixerLayer): Record<string, unknown> {
  if (layer.kind === 'noise') {
    const p = layer.params;
    const params: Record<string, unknown> = {
      id: p.id,
      type: p.type,
      volumeLinear: p.volumeLinear,
      muted: p.muted,
      solo: p.solo,
      stereoWidth: p.stereoWidth,
      pan: p.pan,
    };
    if (p.lowpassHz < FILTER_LP_OPEN_HZ - 100) params.lowpassHz = p.lowpassHz;
    if (p.highpassHz > FILTER_HP_OPEN_HZ + 5) params.highpassHz = p.highpassHz;
    if (p.panLfoEnabled) {
      params.panLfoEnabled = true;
      if (p.panLfoRateHz !== PAN_LFO_RATE_DEFAULT_HZ) {
        params.panLfoRateHz = p.panLfoRateHz;
      }
      if (p.panLfoDepth !== PAN_LFO_DEPTH_DEFAULT) {
        params.panLfoDepth = p.panLfoDepth;
      }
    }
    return { kind: 'noise', params };
  }
  if (layer.kind === 'youtube') {
    const p = layer.params;
    const params: Record<string, unknown> = {
      id: p.id,
      videoId: p.videoId,
      url: p.url,
      label: p.label,
      thumbnailUrl: p.thumbnailUrl,
      volumeLinear: p.volumeLinear,
      muted: p.muted,
      solo: p.solo,
      pan: p.pan,
    };
    if (p.lowpassHz < FILTER_LP_OPEN_HZ - 100) params.lowpassHz = p.lowpassHz;
    if (p.highpassHz > FILTER_HP_OPEN_HZ + 5) params.highpassHz = p.highpassHz;
    if (p.panLfoEnabled) {
      params.panLfoEnabled = true;
      if (p.panLfoRateHz !== PAN_LFO_RATE_DEFAULT_HZ) {
        params.panLfoRateHz = p.panLfoRateHz;
      }
      if (p.panLfoDepth !== PAN_LFO_DEPTH_DEFAULT) {
        params.panLfoDepth = p.panLfoDepth;
      }
    }
    return { kind: 'youtube', params };
  }
  if (layer.kind === 'playlist') {
    const p = layer.params;
    const params: Record<string, unknown> = {
      id: p.id,
      playlistId: p.playlistId,
      playlistName: p.playlistName,
      currentIndex: p.currentIndex,
      currentTrackTitle: p.currentTrackTitle,
      currentTrackType: p.currentTrackType,
      shuffle: p.shuffle,
      volumeLinear: p.volumeLinear,
      muted: p.muted,
      solo: p.solo,
      pan: p.pan,
    };
    if (p.lowpassHz < FILTER_LP_OPEN_HZ - 100) params.lowpassHz = p.lowpassHz;
    if (p.highpassHz > FILTER_HP_OPEN_HZ + 5) params.highpassHz = p.highpassHz;
    if (p.panLfoEnabled) {
      params.panLfoEnabled = true;
      if (p.panLfoRateHz !== PAN_LFO_RATE_DEFAULT_HZ) {
        params.panLfoRateHz = p.panLfoRateHz;
      }
      if (p.panLfoDepth !== PAN_LFO_DEPTH_DEFAULT) {
        params.panLfoDepth = p.panLfoDepth;
      }
    }
    return { kind: 'playlist', params };
  }
  const p = layer.params;
  const params: Record<string, unknown> = {
    id: p.id,
    assetId: p.assetId,
    label: p.label,
    volumeLinear: p.volumeLinear,
    muted: p.muted,
    solo: p.solo,
    pan: p.pan,
    loopMode: p.loopMode,
    crossfadeMs: p.crossfadeMs,
    playbackRate: p.playbackRate,
  };
  if (p.lowpassHz < FILTER_LP_OPEN_HZ - 100) params.lowpassHz = p.lowpassHz;
  if (p.highpassHz > FILTER_HP_OPEN_HZ + 5) params.highpassHz = p.highpassHz;
  if (p.panLfoEnabled) {
    params.panLfoEnabled = true;
    if (p.panLfoRateHz !== PAN_LFO_RATE_DEFAULT_HZ) {
      params.panLfoRateHz = p.panLfoRateHz;
    }
    if (p.panLfoDepth !== PAN_LFO_DEPTH_DEFAULT) {
      params.panLfoDepth = p.panLfoDepth;
    }
  }
  return { kind: 'sample', params };
}

function compactMaster(master: PresetMaster): PresetMaster {
  const out: PresetMaster = { volumeLinear: master.volumeLinear };
  if (
    master.bassDb != null &&
    master.bassDb !== MASTER_BASS_DB_DEFAULT
  ) {
    out.bassDb = master.bassDb;
  }
  if (
    master.trebleDb != null &&
    master.trebleDb !== MASTER_TREBLE_DB_DEFAULT
  ) {
    out.trebleDb = master.trebleDb;
  }
  if (
    master.reverbWet != null &&
    master.reverbWet !== MASTER_REVERB_WET_DEFAULT
  ) {
    out.reverbWet = master.reverbWet;
  }
  return out;
}

/** Build a share payload from a full preset / session snapshot. */
export function presetToSharePayload(preset: PresetV1): SharePayload {
  return {
    v: 1,
    name: preset.name,
    master: compactMaster(preset.master),
    layers: preset.layers,
    timer: preset.timer ?? null,
  };
}

/** Encode a share payload as a base64url string (no `#mix=` prefix). */
export function encodeSharePayload(payload: SharePayload): string {
  const compact = {
    v: payload.v,
    ...(payload.name ? { name: payload.name } : {}),
    master: compactMaster(payload.master),
    layers: payload.layers.map((l) => compactLayer(l)),
    ...(payload.timer ? { timer: payload.timer } : {}),
  };
  return utf8ToBase64Url(JSON.stringify(compact));
}

/** Decode base64url share body into a validated PresetV1, or null. */
export function decodeSharePayload(encoded: string): PresetV1 | null {
  try {
    const text = base64UrlToUtf8(encoded.trim());
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (o.v !== 1 && o.version !== 1) return null;

    const asPreset = {
      version: 1 as const,
      id: typeof o.id === 'string' ? o.id : 'shared-mix',
      name: typeof o.name === 'string' && o.name ? o.name : 'Shared mix',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      master: o.master,
      layers: o.layers,
      timer: o.timer,
    };
    return parsePreset(asPreset);
  } catch {
    return null;
  }
}

/** Full hash fragment including `#`, e.g. `#mix=eJ…`. */
export function encodeMixHash(preset: PresetV1): string {
  const encoded = encodeSharePayload(presetToSharePayload(preset));
  return `#${SHARE_HASH_PREFIX}${encoded}`;
}

/** Absolute share URL for the current origin + path + mix hash. */
export function buildShareUrl(
  preset: PresetV1,
  locationLike: Pick<Location, 'origin' | 'pathname' | 'search'> = typeof location !== 'undefined'
    ? location
    : { origin: '', pathname: '/', search: '' },
): string {
  const hash = encodeMixHash(preset);
  return `${locationLike.origin}${locationLike.pathname}${locationLike.search}${hash}`;
}

/** Character length of the full share URL (for UI feedback). */
export function shareUrlLength(
  preset: PresetV1,
  locationLike?: Pick<Location, 'origin' | 'pathname' | 'search'>,
): number {
  return buildShareUrl(preset, locationLike).length;
}

/**
 * Parse `location.hash` for a shared mix or attributions intent.
 * Accepts `#mix=…`, `#/mix=…`, and bare `mix=…`.
 */
export function parseLocationHash(hash: string): LocationHashIntent {
  let raw = hash.startsWith('#') ? hash.slice(1) : hash;
  raw = raw.replace(/^\/+/, '');
  if (!raw) return null;

  if (raw === ATTRIBUTIONS_HASH || raw.startsWith(`${ATTRIBUTIONS_HASH}?`)) {
    return { kind: 'attributions' };
  }

  if (raw.startsWith(SHARE_HASH_PREFIX)) {
    const encoded = raw.slice(SHARE_HASH_PREFIX.length);
    const preset = decodeSharePayload(encoded);
    if (!preset) return null;
    return { kind: 'mix', preset };
  }

  return null;
}

/** Replace the hash without adding a history entry (after applying a shared mix). */
export function clearMixHashFromLocation(): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const url = `${location.pathname}${location.search}`;
  history.replaceState(null, '', url);
}

export function setAttributionsHash(): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  history.replaceState(null, '', `${location.pathname}${location.search}#${ATTRIBUTIONS_HASH}`);
}
