/**
 * Pure DSP utilities for discrete-hold random sound variation (drift).
 * Generates bounded random targets for pitch (playbackRate), stereo pan, and gain
 * with multi-tier saturation and clipping prevention.
 */

import type { DriftConfig, DriftSpeed } from '../types';

export const PITCH_DRIFT_MAX_OFFSET = 0.035; // ±3.5% default nominal
export const PAN_DRIFT_MAX_OFFSET = 0.25; // ±0.25 stereo field default nominal
export const GAIN_DRIFT_MIN_MULT = 0.75; // -2.5 dB default nominal
export const GAIN_DRIFT_MAX_MULT = 1.06; // +0.5 dB default nominal

export const HOLD_MIN_SEC_NORMAL = 15;
export const HOLD_MAX_SEC_NORMAL = 35;
export const RAMP_MIN_SEC_NORMAL = 3;
export const RAMP_MAX_SEC_NORMAL = 6;

export const HOLD_MIN_SEC_ECO = 45;
export const HOLD_MAX_SEC_ECO = 90;
export const RAMP_MIN_SEC_ECO = 6;
export const RAMP_MAX_SEC_ECO = 10;

/** Speed multipliers applied to hold & ramp intervals */
export const SPEED_FACTORS: Record<DriftSpeed, number> = {
  fast: 0.4, // 6-14s hold
  normal: 1.0, // 15-35s hold
  slow: 2.2, // 33-77s hold
  languid: 4.0, // 60-140s hold
};

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
export function calculateRandomInterval(
  powerSaverActive: boolean,
  speed: DriftSpeed = 'normal',
): {
  holdSec: number;
  rampSec: number;
} {
  const factor = SPEED_FACTORS[speed] ?? 1.0;
  if (powerSaverActive) {
    // In eco mode, ensure interval is comfortably stretched
    const ecoFactor = Math.max(1.0, factor);
    return {
      holdSec: randomRange(HOLD_MIN_SEC_ECO * ecoFactor, HOLD_MAX_SEC_ECO * ecoFactor),
      rampSec: randomRange(RAMP_MIN_SEC_ECO * ecoFactor, RAMP_MAX_SEC_ECO * ecoFactor),
    };
  }
  return {
    holdSec: randomRange(HOLD_MIN_SEC_NORMAL * factor, HOLD_MAX_SEC_NORMAL * factor),
    rampSec: randomRange(RAMP_MIN_SEC_NORMAL * factor, RAMP_MAX_SEC_NORMAL * factor),
  };
}

/**
 * Calculates a subtly drifted playbackRate around the base playback rate.
 * Clamped strictly to a safe Web Audio playback rate range (0.25 - 4.0).
 * @param pitchOffsetRatio Maximum fractional offset ratio (e.g. 0.035 for 3.5%, 0.10 for 10%)
 */
export function calculateDriftPitch(
  baseRate: number,
  depth = 1,
  pitchOffsetRatio = PITCH_DRIFT_MAX_OFFSET,
): number {
  const safeBase = Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 1.0;
  const d = Math.max(0, Math.min(1, depth));
  if (d === 0) return safeBase;

  const maxOffset = Math.max(0.001, Math.min(0.35, pitchOffsetRatio));
  const deltaRatio = (Math.random() * 2 - 1) * (maxOffset * d);
  const drifted = safeBase * (1 + deltaRatio);
  return Math.max(0.25, Math.min(4.0, drifted));
}

/**
 * Calculates a subtly drifted stereo pan around the base pan position.
 * Uses edge compression so positions near -1 or +1 drift inwards rather than clipping.
 * @param panMaxOffset Maximum stereo offset width (e.g. 0.25 for standard wander, up to 0.80)
 */
export function calculateDriftPan(
  basePan: number,
  depth = 1,
  panMaxOffset = PAN_DRIFT_MAX_OFFSET,
): number {
  const safeBase = Number.isFinite(basePan) ? Math.max(-1, Math.min(1, basePan)) : 0;
  const d = Math.max(0, Math.min(1, depth));
  if (d === 0) return safeBase;

  const maxOffset = Math.max(0.01, Math.min(0.95, panMaxOffset));
  // Soften drift near hard-pan edges so motion remains natural and doesn't clip
  const edgeFactor = 1 - Math.abs(safeBase) * 0.6;
  const delta = (Math.random() * 2 - 1) * (maxOffset * d * edgeFactor);
  return Math.max(-1, Math.min(1, safeBase + delta));
}

/**
 * Tier 1 & 2 Saturation Prevention:
 * Calculates headroom-aware drifting gain.
 *
 * - Tier 1: Asymmetric ceiling clamping. If base volume is near max (1.0),
 *   drift is purely downward / breathing so it never exceeds 1.0.
 * - Tier 2: Multi-layer aggregate energy scaling. If total mix energy is high,
 *   positive multiplier range is attenuated to preserve aggregate headroom.
 * @param downwardDb The downward breathing depth in dB (e.g. 2.5 dB)
 */
export function calculateDriftGain(
  baseVolumeLinear: number,
  totalMixEnergy = 1.0,
  depth = 1.0,
  downwardDb = 2.5,
): number {
  const safeBase = Number.isFinite(baseVolumeLinear)
    ? Math.max(0, Math.min(1, baseVolumeLinear))
    : 0.7;
  const d = Math.max(0, Math.min(1, depth));
  if (d === 0 || safeBase <= 0.001) return safeBase;

  // Convert downward dB to linear multiplier (e.g. 2.5 dB -> ~0.75, 6 dB -> ~0.50)
  const safeDownDb = Math.max(0.2, Math.min(12, downwardDb));
  const nominalMinMult = Math.pow(10, -safeDownDb / 20);

  // Tier 2: Attenuate positive boost when multiple loud layers are active
  const energyHeadroomFactor = totalMixEnergy > 2.0 ? Math.max(0.2, 2.0 / totalMixEnergy) : 1.0;
  const maxMult = 1.0 + (GAIN_DRIFT_MAX_MULT - 1.0) * energyHeadroomFactor * d;
  const minMult = 1.0 - (1.0 - nominalMinMult) * d;

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
