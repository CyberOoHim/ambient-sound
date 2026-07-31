/** Single source of truth for volume unit conversion (KD-13). */

export const DB_MIN = -60;
export const DB_MAX = 0;

/** Linear gain 0..1 → dB in [DB_MIN, DB_MAX]. 0 linear → DB_MIN. */
export function linearToDb(linear: number): number {
  if (linear <= 0) return DB_MIN;
  const db = 20 * Math.log10(linear);
  return Math.max(DB_MIN, Math.min(DB_MAX, db));
}

/** dB in [DB_MIN, DB_MAX] → linear gain 0..1. At/below DB_MIN → 0. */
export function dbToLinear(db: number): number {
  if (db <= DB_MIN) return 0;
  const clamped = Math.min(DB_MAX, db);
  return 10 ** (clamped / 20);
}

/** Clamp linear gain to [0, 1]. */
export function clampLinear(linear: number): number {
  return Math.max(0, Math.min(1, linear));
}

/** Equal-power fade-in for t in [0, 1]. */
export function equalPowerFadeIn(t: number): number {
  return Math.sin(Math.max(0, Math.min(1, t)) * 0.5 * Math.PI);
}

/** Equal-power fade-out for t in [0, 1]. */
export function equalPowerFadeOut(t: number): number {
  return Math.cos(Math.max(0, Math.min(1, t)) * 0.5 * Math.PI);
}
