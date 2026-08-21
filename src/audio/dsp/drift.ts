/**
 * Pure DSP utilities for discrete-hold random sound variation (drift).
 * Generates bounded random targets for pitch (playbackRate), stereo pan, and gain
 * with multi-tier saturation and clipping prevention.
 */

export const PITCH_DRIFT_MAX_OFFSET = 0.035; // ±3.5%
export const PAN_DRIFT_MAX_OFFSET = 0.25; // ±0.25 stereo field
export const GAIN_DRIFT_MIN_MULT = 0.75; // -2.5 dB
export const GAIN_DRIFT_MAX_MULT = 1.06; // +0.5 dB

export const HOLD_MIN_SEC_NORMAL = 15;
export const HOLD_MAX_SEC_NORMAL = 35;
export const RAMP_MIN_SEC_NORMAL = 3;
export const RAMP_MAX_SEC_NORMAL = 6;

export const HOLD_MIN_SEC_ECO = 45;
export const HOLD_MAX_SEC_ECO = 90;
export const RAMP_MIN_SEC_ECO = 6;
export const RAMP_MAX_SEC_ECO = 10;

/**
 * Random float between min and max (inclusive).
 */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Calculates randomized hold and ramp durations in seconds.
 * Power saver mode lengthens intervals to minimize AudioParam automation updates.
 */
export function calculateRandomInterval(powerSaverActive: boolean): {
  holdSec: number;
  rampSec: number;
} {
  if (powerSaverActive) {
    return {
      holdSec: randomRange(HOLD_MIN_SEC_ECO, HOLD_MAX_SEC_ECO),
      rampSec: randomRange(RAMP_MIN_SEC_ECO, RAMP_MAX_SEC_ECO),
    };
  }
  return {
    holdSec: randomRange(HOLD_MIN_SEC_NORMAL, HOLD_MAX_SEC_NORMAL),
    rampSec: randomRange(RAMP_MIN_SEC_NORMAL, RAMP_MAX_SEC_NORMAL),
  };
}

/**
 * Calculates a subtly drifted playbackRate around the base playback rate.
 * Clamped strictly to a safe Web Audio playback rate range (0.25 - 4.0).
 */
export function calculateDriftPitch(baseRate: number, depth = 1): number {
  const safeBase = Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 1.0;
  const d = Math.max(0, Math.min(1, depth));
  if (d === 0) return safeBase;

  const deltaRatio = (Math.random() * 2 - 1) * (PITCH_DRIFT_MAX_OFFSET * d);
  const drifted = safeBase * (1 + deltaRatio);
  return Math.max(0.25, Math.min(4.0, drifted));
}

/**
 * Calculates a subtly drifted stereo pan around the base pan position.
 * Uses edge compression so positions near -1 or +1 drift inwards rather than clipping.
 */
export function calculateDriftPan(basePan: number, depth = 1): number {
  const safeBase = Number.isFinite(basePan) ? Math.max(-1, Math.min(1, basePan)) : 0;
  const d = Math.max(0, Math.min(1, depth));
  if (d === 0) return safeBase;

  // Soften drift near hard-pan edges so motion remains natural and doesn't clip
  const edgeFactor = 1 - Math.abs(safeBase) * 0.6;
  const delta = (Math.random() * 2 - 1) * (PAN_DRIFT_MAX_OFFSET * d * edgeFactor);
  return Math.max(-1, Math.min(1, safeBase + delta));
}

/**
 * Tier 1 & 2 Saturation Prevention:
 * Calculates headroom-aware drifting gain.
 *
 * - Tier 1: Asymmetric ceiling clamping. If base volume is near max (1.0),
 *   drift is purely downward / breathing (0.75 - 1.0) so it never exceeds 1.0.
 * - Tier 2: Multi-layer aggregate energy scaling. If total mix energy is high,
 *   positive multiplier range is attenuated to preserve aggregate headroom.
 */
export function calculateDriftGain(
  baseVolumeLinear: number,
  totalMixEnergy = 1.0,
  depth = 1.0,
): number {
  const safeBase = Number.isFinite(baseVolumeLinear)
    ? Math.max(0, Math.min(1, baseVolumeLinear))
    : 0.7;
  const d = Math.max(0, Math.min(1, depth));
  if (d === 0 || safeBase <= 0.001) return safeBase;

  // Tier 2: Attenuate positive boost when multiple loud layers are active
  const energyHeadroomFactor = totalMixEnergy > 2.0 ? Math.max(0.2, 2.0 / totalMixEnergy) : 1.0;
  const maxMult = 1.0 + (GAIN_DRIFT_MAX_MULT - 1.0) * energyHeadroomFactor * d;
  const minMult = 1.0 - (1.0 - GAIN_DRIFT_MIN_MULT) * d;

  // Tier 1: Asymmetric clamping based on user volume level
  // If base volume is high (> 0.8), reduce upper headroom to keep gain <= 1.0
  const availableUpperHeadroom = Math.max(0, 1.0 - safeBase);
  const rawMult = randomRange(minMult, maxMult);
  const targetGain = safeBase * rawMult;

  // Clamp to [safeBase * minMult, min(1.0, safeBase + availableUpperHeadroom)]
  const maxAllowedGain = Math.min(1.0, safeBase + availableUpperHeadroom);
  return Math.max(0, Math.min(maxAllowedGain, targetGain));
}

/**
 * Calculates the total nominal mix energy sum: sum(volumeLinear^2) for all active (unmuted) layers.
 */
export function calculateMixEnergy(
  layers: Array<{ volumeLinear: number; muted: boolean; solo?: boolean }>,
): number {
  const anySolo = layers.some((l) => Boolean(l.solo));
  let energy = 0;
  for (const layer of layers) {
    if (layer.muted) continue;
    if (anySolo && !layer.solo) continue;
    const v = Math.max(0, Math.min(1, layer.volumeLinear));
    energy += v * v;
  }
  return energy;
}
