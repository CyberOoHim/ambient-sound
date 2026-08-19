// @ts-nocheck
/**
 * Self-contained AudioWorklet processor (no imports — Vite ?url safe).
 * Algorithms mirror src/audio/dsp/colored-noise.ts
 *
 * Messages:
 *   { type: 'setNoiseType', noiseType: string }
 *
 * Parameters:
 *   width — 0 mono .. 1 full decorrelated stereo
 *
 * Runs in AudioWorkletGlobalScope (sampleRate, registerProcessor, etc.).
 */

/* Keep in sync with src/audio/dsp/colored-noise.ts CALIBRATION_GAIN */
const CALIBRATION = {
  white: 0.45,
  pink: 0.5,
  brown: 0.75,
  blue: 0.4,
  violet: 0.32,
  rain: 0.55,
  fan: 0.7,
  static: 0.32,
};

const BROWN_C = 0.03;
const BROWN_LEAK = 0.997;

function createChannel(seed) {
  return {
    rngState: (seed || Math.floor(Math.random() * 0xffffffff) + 1) >>> 0,
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
    amPhase: Math.random(),
    amState: 0,
    holdLeft: 0,
    held: 0,
    crackle: 0,
  };
}

/** Fast 32-bit PRNG float in [0, 1) */
function nextFloat(s) {
  let x = s.rngState;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rngState = x >>> 0;
  return (x >>> 0) * 2.3283064365386963e-10;
}

/** Fast Irwin-Hall 6-uniform normal approximation with inlined bitwise xorshift */
function gaussian(s) {
  let sum = 0;
  let x = s.rngState;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; sum += (x >>> 0);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; sum += (x >>> 0);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; sum += (x >>> 0);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; sum += (x >>> 0);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; sum += (x >>> 0);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; sum += (x >>> 0);
  s.rngState = x >>> 0;
  return (sum * 2.3283064365386963e-10 - 3) * 0.7;
}

/** Fast uniform float in [-1, 1) */
function uniform(s) {
  let x = s.rngState;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rngState = x >>> 0;
  return (x >>> 0) * 4.6566128730773926e-10 - 1;
}

function pinkFromWhite(s, white) {
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

function brownFromWhite(s, white) {
  s.brown = BROWN_LEAK * s.brown + BROWN_C * white;
  if (s.brown > 1) s.brown = 1;
  if (s.brown < -1) s.brown = -1;
  return s.brown;
}

/** Harsh TV/radio static — mirrors colored-noise.ts staticFromUniform */
function staticFromUniform(s, white) {
  if (s.holdLeft <= 0) {
    s.held = white;
    s.holdLeft = 3 + (nextFloat(s) * 4 | 0); // 3..6
  }
  s.holdLeft -= 1;

  const levels = 16;
  let y = Math.round(s.held * levels) / levels;

  if (nextFloat(s) < 0.0012) {
    s.crackle = (nextFloat(s) * 2 - 1) * (0.55 + nextFloat(s) * 0.45);
  }
  y += s.crackle;
  s.crackle *= 0.82;

  if (y > 1) y = 1;
  if (y < -1) y = -1;
  return y;
}

function sampleChannel(type, s, sampleRate) {
  const white = type === 'static' ? uniform(s) : gaussian(s);
  let y;

  switch (type) {
    case 'white':
      y = white;
      break;
    case 'static':
      y = staticFromUniform(s, white);
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
      const pink = pinkFromWhite(s, white);
      s.amState = 0.9995 * s.amState + 0.0005 * gaussian(s);
      s.amPhase += (0.7 + s.amState * 0.4) / sampleRate;
      if (s.amPhase > 1) s.amPhase -= 1;
      const am = 0.65 + 0.35 * Math.sin(s.amPhase * Math.PI * 2);
      y = pink * am;
      break;
    }
    case 'fan':
      y = brownFromWhite(s, white);
      break;
    default:
      y = white;
  }

  const g = CALIBRATION[type] ?? CALIBRATION.white;
  return y * g;
}

class NoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseType = 'white';
    this.l = createChannel(0x12345678 ^ ((Math.random() * 0x7fffffff) | 0));
    this.r = createChannel(0x87654321 ^ ((Math.random() * 0x7fffffff) | 0));

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (msg && msg.type === 'setNoiseType' && typeof msg.noiseType === 'string') {
        this.noiseType = msg.noiseType;
      }
    };
  }

  static get parameterDescriptors() {
    return [
      {
        name: 'width',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  process(_inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    const widthArr = parameters.width;
    const width =
      widthArr.length === 1 ? widthArr[0] : widthArr[widthArr.length - 1];
    const w = Math.max(0, Math.min(1, width));
    const type = this.noiseType;
    const sr = sampleRate;

    for (let i = 0; i < frames; i++) {
      const l = sampleChannel(type, this.l, sr);
      const r = sampleChannel(type, this.r, sr);
      const mid = 0.5 * (l + r);
      outL[i] = mid + (l - mid) * w;
      if (outR !== outL) {
        outR[i] = mid + (r - mid) * w;
      }
    }

    return true;
  }
}

registerProcessor('noise-processor', NoiseProcessor);
