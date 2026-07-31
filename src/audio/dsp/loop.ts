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
