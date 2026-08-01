import { equalPowerFadeIn, equalPowerFadeOut } from './curves';

/** Clamp crossfade so it never exceeds 25% of buffer duration. */
export function clampCrossfadeSec(crossfadeMs: number, durationSec: number): number {
  const requested = Math.max(0, crossfadeMs) / 1000;
  const max = 0.25 * durationSec;
  return Math.min(requested, max);
}

/** Seconds between successive segment starts. */
export function loopPeriodSec(
  durationSec: number,
  overlapSec: number,
  playbackRate: number,
): number {
  const rate = Math.max(0.01, playbackRate);
  return Math.max(0.01, (durationSec - overlapSec) / rate);
}

/** Build equal-power gain curves for a crossfade of `n` samples. */
export function buildEqualPowerCurves(n: number): {
  fadeIn: Float32Array;
  fadeOut: Float32Array;
} {
  const fadeIn = new Float32Array(Math.max(2, n));
  const fadeOut = new Float32Array(Math.max(2, n));
  const len = fadeIn.length;
  for (let i = 0; i < len; i++) {
    const t = i / (len - 1);
    fadeIn[i] = equalPowerFadeIn(t);
    fadeOut[i] = equalPowerFadeOut(t);
  }
  return { fadeIn, fadeOut };
}

/** Default / bounds for user-editable min start offset of duplicate sample layers. */
export const DUPLICATE_MIN_OFFSET_DEFAULT_SEC = 5;
export const DUPLICATE_MIN_OFFSET_MIN_SEC = 0.5;
export const DUPLICATE_MIN_OFFSET_MAX_SEC = 60;

/** Clamp the user preference into the allowed UI range. */
export function clampDuplicateMinOffsetSec(sec: number): number {
  if (!Number.isFinite(sec)) return DUPLICATE_MIN_OFFSET_DEFAULT_SEC;
  return Math.max(
    DUPLICATE_MIN_OFFSET_MIN_SEC,
    Math.min(DUPLICATE_MIN_OFFSET_MAX_SEC, sec),
  );
}

/**
 * Effective minimum buffer offset for a given clip duration.
 * Caps the user min so short buffers still leave room to start mid-loop.
 */
export function effectiveMinOffsetSec(
  durationSec: number,
  userMinSec: number,
): number {
  const D = Math.max(0, durationSec);
  if (D <= 0.15) return 0;
  const user = clampDuplicateMinOffsetSec(userMinSec);
  const cap = Math.max(0.05, 0.4 * D);
  return Math.min(user, cap);
}

/**
 * Start offset (seconds into the buffer) for a sample layer that shares an asset
 * with other layers. Index 0 always returns 0; later siblings are spread across
 * the loop with light jitter, each at least `minOffsetSec` from the start when
 * duration allows.
 */
export function pickDuplicateStartOffset(
  durationSec: number,
  siblingIndex: number,
  siblingCount: number,
  minOffsetSec: number,
  rng: () => number = Math.random,
): number {
  const D = Math.max(0, durationSec);
  if (siblingIndex <= 0 || D <= 0.15) return 0;

  const N = Math.max(2, siblingCount, siblingIndex + 1);
  const effMin = effectiveMinOffsetSec(D, minOffsetSec);
  if (effMin <= 0) return 0;

  const eps = Math.min(0.05, D * 0.01);
  const maxOff = Math.max(effMin, D - Math.max(eps, 0.1));

  // Even phase spread: i/N of the loop (e.g. N=3 → ~0, D/3, 2D/3).
  const slot = D / N;
  let offset = (siblingIndex / N) * D + (rng() - 0.5) * slot * 0.35;
  offset = ((offset % D) + D) % D;

  if (offset < effMin) offset = effMin;
  if (offset > maxOff) offset = maxOff;
  if (offset < 0.01) return 0;
  return offset;
}
