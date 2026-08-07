/**
 * URL hash shareable scenes.
 *
 * Format: `#mix=<base64url(JSON SharePayload)>`
 * Also recognizes `#attributions` for the in-app credits panel.
 */
import type { MixerLayer } from '../audio/types';
import {
  parsePreset,
  type PresetTimerConfig,
  type PresetV1,
} from './presets';
import type { BinauralConfig } from './binaural';
import type { OneShotConfig } from './one-shot';

export const SHARE_HASH_PREFIX = 'mix=';
export const ATTRIBUTIONS_HASH = 'attributions';

/** Compact wire format stored in the URL hash (no id/timestamps). */
export interface SharePayload {
  v: 1;
  name?: string;
  master: { volumeLinear: number };
  layers: MixerLayer[];
  timer?: PresetTimerConfig | null;
  binaural?: BinauralConfig | null;
  oneShot?: OneShotConfig | null;
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
  const pad = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const len = cleaned.length;
  const outLen = Math.floor((len * 3) / 4) - pad;
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

/** Build a share payload from a full preset / session snapshot. */
export function presetToSharePayload(preset: PresetV1): SharePayload {
  return {
    v: 1,
    name: preset.name,
    master: { volumeLinear: preset.master.volumeLinear },
    layers: preset.layers,
    timer: preset.timer ?? null,
    ...(preset.binaural !== undefined ? { binaural: preset.binaural } : {}),
    ...(preset.oneShot !== undefined ? { oneShot: preset.oneShot } : {}),
  };
}

/** Encode a share payload as a base64url string (no `#mix=` prefix). */
export function encodeSharePayload(payload: SharePayload): string {
  return utf8ToBase64Url(JSON.stringify(payload));
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
      binaural: o.binaural,
      oneShot: o.oneShot,
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
