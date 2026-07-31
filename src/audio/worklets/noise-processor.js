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
  static: 0.38,
};

const BROWN_C = 0.03;
const BROWN_LEAK = 0.997;

function createChannel() {
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
    amPhase: Math.random(),
    amState: 0,
  };
}

function gaussian() {
  let s = 0;
  for (let i = 0; i < 6; i++) s += Math.random();
  return (s - 3) * 0.7;
}

function uniform() {
  return Math.random() * 2 - 1;
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

function sampleChannel(type, s, sampleRate) {
  const white = type === 'static' ? uniform() : gaussian();
  let y;

  switch (type) {
    case 'white':
      y = white;
      break;
    case 'static':
      y = white;
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
      s.amState = 0.9995 * s.amState + 0.0005 * gaussian();
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
    this.l = createChannel();
    this.r = createChannel();

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
