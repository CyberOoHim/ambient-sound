/**
 * Pure colored-noise DSP (no AudioContext) — unit-testable.
 * Worklet mirrors these algorithms in noise-processor.js.
 */

export type NoiseType =
  | 'white'
  | 'pink'
  | 'brown'
  | 'blue'
  | 'violet'
  | 'rain'
  | 'fan'
  | 'static';

export const NOISE_TYPES: NoiseType[] = [
  'white',
  'pink',
  'brown',
  'blue',
  'violet',
  'rain',
  'fan',
  'static',
];

/**
 * Per-type post-gain for comfortable listening level at volumeLinear ≈ 0.7–1.
 * Higher than strict −20 dBFS “unity” so the app is audible without maxing faders.
 */
export const CALIBRATION_GAIN: Record<NoiseType, number> = {
  white: 0.45,
  pink: 0.5,
  brown: 0.75,
  blue: 0.4,
  violet: 0.32,
  rain: 0.55,
  fan: 0.7,
  // Slightly lower: sample-hold + crackle peaks read louder than smooth white
  static: 0.32,
};

export interface ChannelNoiseState {
  // Pink (Kellet economy)
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  b5: number;
  b6: number;
  // Brown
  brown: number;
  // Diff memory (blue/violet)
  prevWhite: number;
  prevPink: number;
  // Rain slow AM
  amPhase: number;
  amState: number;
  // Static: sample-hold + crackle envelope
  holdLeft: number;
  held: number;
  crackle: number;
}

export interface NoiseState {
  l: ChannelNoiseState;
  r: ChannelNoiseState;
}

function createChannelState(): ChannelNoiseState {
  return {
    b0: 0,
    b1: 0,
    b2: 0,
    b3: 0,
    b4: 0,
    b5: 0,
    b6: 0,
    brown: 0,
    prevWhite: 0,
    prevPink: 0,
    amPhase: 0,
    amState: 0,
    holdLeft: 0,
    held: 0,
    crackle: 0,
  };
}

export function createNoiseState(_type?: NoiseType): NoiseState {
  return { l: createChannelState(), r: createChannelState() };
}

/** Box–Muller-ish Gaussian via sum of uniforms (cheap, good enough for ambient). */
export function gaussianSample(rng: () => number = Math.random): number {
  // Irwin–Hall approx to normal
  let s = 0;
  for (let i = 0; i < 6; i++) s += rng();
  return (s - 3) * 0.7; // rough unit scale
}

export function uniformSample(rng: () => number = Math.random): number {
  return rng() * 2 - 1;
}

/** Paul Kellet economy pink filter; returns pink sample from white input. */
export function pinkFromWhite(s: ChannelNoiseState, white: number): number {
  s.b0 = 0.99886 * s.b0 + white * 0.0555179;
  s.b1 = 0.99332 * s.b1 + white * 0.0750759;
  s.b2 = 0.969 * s.b2 + white * 0.153852;
  s.b3 = 0.8665 * s.b3 + white * 0.3104856;
  s.b4 = 0.55 * s.b4 + white * 0.5329522;
  s.b5 = -0.7616 * s.b5 - white * 0.016898;
  const pink =
    s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + white * 0.5362;
  s.b6 = white * 0.115926;
  return pink * 0.11;
}

const BROWN_C = 0.03;
const BROWN_LEAK = 0.997;

export function brownFromWhite(s: ChannelNoiseState, white: number): number {
  s.brown = BROWN_LEAK * s.brown + BROWN_C * white;
  // Soft clamp
  if (s.brown > 1) s.brown = 1;
  if (s.brown < -1) s.brown = -1;
  return s.brown;
}

/**
 * Harsh TV/radio static: uniform white + sample-hold + light bitcrush + sparse crackle.
 * Distinct from smooth Gaussian white — stepped grit and occasional pops.
 */
function staticFromUniform(s: ChannelNoiseState, white: number, rng: () => number): number {
  // Sample-hold: re-sample every 3–6 samples → aliasing grit / reduced bandwidth feel
  if (s.holdLeft <= 0) {
    s.held = white;
    s.holdLeft = 3 + Math.floor(rng() * 4); // 3..6
  }
  s.holdLeft -= 1;

  // Light bitcrush (~5-bit) for digital harshness
  const levels = 16;
  let y = Math.round(s.held * levels) / levels;

  // Sparse crackle impulses (TV snow / radio static pops)
  if (rng() < 0.0012) {
    s.crackle = (rng() * 2 - 1) * (0.55 + rng() * 0.45);
  }
  y += s.crackle;
  s.crackle *= 0.82; // short exponential decay

  // Soft clamp after crackle peaks
  if (y > 1) y = 1;
  if (y < -1) y = -1;
  return y;
}

function sampleChannel(
  type: NoiseType,
  s: ChannelNoiseState,
  rng: () => number,
  sampleRate: number,
): number {
  const white = type === 'static' ? uniformSample(rng) : gaussianSample(rng);

  let y: number;
  switch (type) {
    case 'white':
      y = white;
      break;
    case 'static':
      y = staticFromUniform(s, white, rng);
      break;
    case 'pink':
      y = pinkFromWhite(s, white);
      break;
    case 'brown':
      y = brownFromWhite(s, white);
      break;
    case 'blue': {
      const pink = pinkFromWhite(s, white);
      y = pink - s.prevPink;
      s.prevPink = pink;
      break;
    }
    case 'violet': {
      y = white - s.prevWhite;
      s.prevWhite = white;
      break;
    }
    case 'rain': {
      // Pink base + slow amplitude modulation (~0.3–2 Hz feel)
      const pink = pinkFromWhite(s, white);
      s.amState = 0.9995 * s.amState + 0.0005 * gaussianSample(rng);
      s.amPhase += (0.7 + s.amState * 0.4) / sampleRate;
      if (s.amPhase > 1) s.amPhase -= 1;
      const am = 0.65 + 0.35 * Math.sin(s.amPhase * Math.PI * 2);
      y = pink * am;
      break;
    }
    case 'fan': {
      // Brown rumble (tonal motor optional, off in pure path)
      y = brownFromWhite(s, white);
      break;
    }
    default:
      y = white;
  }

  return y * CALIBRATION_GAIN[type];
}

/**
 * Fill stereo buffers for one block.
 * width: 0 = mono (same L/R mid), 1 = fully independent L/R.
 */
export function processBlock(
  type: NoiseType,
  state: NoiseState,
  outL: Float32Array,
  outR: Float32Array,
  width: number,
  rng: () => number = Math.random,
  sampleRate = 48000,
): void {
  const n = outL.length;
  const w = Math.max(0, Math.min(1, width));

  for (let i = 0; i < n; i++) {
    const l = sampleChannel(type, state.l, rng, sampleRate);
    const r = sampleChannel(type, state.r, rng, sampleRate);
    const mid = 0.5 * (l + r);
    outL[i] = mid + (l - mid) * w;
    outR[i] = mid + (r - mid) * w;
  }
}

/** Rough RMS of a buffer (for tests / calibration). */
export function bufferRms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / buf.length);
}
