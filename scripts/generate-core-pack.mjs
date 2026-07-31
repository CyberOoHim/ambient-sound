/**
 * Generate seamless procedural ambient loops (CC0 / project-authored) as WAV,
 * then encode to Ogg Vorbis with ffmpeg when available.
 *
 * Usage: node scripts/generate-core-pack.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'sounds', 'core');
const sampleRate = 48000;
const durationSec = 20;
const channels = 2;

mkdirSync(outDir, { recursive: true });

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rng();
  return (s - 3) * 0.7;
}

function writeWav(path, left, right) {
  const n = left.length;
  const dataSize = n * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE((l * 32767) | 0, o);
    o += 2;
    buf.writeInt16LE((r * 32767) | 0, o);
    o += 2;
  }
  writeFileSync(path, buf);
}

function applySeamlessFade(L, R, fadeSec = 0.08) {
  const n = L.length;
  const fade = Math.floor(fadeSec * sampleRate);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const wIn = Math.sin(t * 0.5 * Math.PI);
    const wOut = Math.cos(t * 0.5 * Math.PI);
    // Crossfade end into start for seamless loop
    const j = n - fade + i;
    const lMix = L[j] * wOut + L[i] * wIn;
    const rMix = R[j] * wOut + R[i] * wIn;
    L[j] = lMix;
    R[j] = rMix;
    L[i] = lMix;
    R[i] = rMix;
  }
}

function normalize(L, R, targetPeak = 0.55) {
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  if (peak < 1e-8) return;
  const g = targetPeak / peak;
  for (let i = 0; i < L.length; i++) {
    L[i] *= g;
    R[i] *= g;
  }
}

function genRain(rng) {
  const n = sampleRate * durationSec;
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    lpL = 0,
    lpR = 0;
  for (let i = 0; i < n; i++) {
    const wL = gaussian(rng);
    const wR = gaussian(rng);
    // cheap pink-ish
    b0 = 0.997 * b0 + wL * 0.05;
    b1 = 0.99 * b1 + wR * 0.05;
    b2 = 0.96 * b2 + ((wL + wR) * 0.5) * 0.08;
    let xL = b0 + b2;
    let xR = b1 + b2;
    // band emphasis
    lpL = lpL + 0.08 * (xL - lpL);
    lpR = lpR + 0.08 * (xR - lpR);
    const hpL = xL - lpL;
    const hpR = xR - lpR;
    const am = 0.75 + 0.25 * Math.sin(i * 0.0003 + rng() * 0.01);
    L[i] = hpL * am * 1.2;
    R[i] = hpR * am * 1.2;
  }
  return { L, R };
}

function genOcean(rng) {
  const n = sampleRate * durationSec;
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  let brownL = 0,
    brownR = 0;
  for (let i = 0; i < n; i++) {
    brownL = 0.998 * brownL + 0.02 * gaussian(rng);
    brownR = 0.998 * brownR + 0.02 * gaussian(rng);
    const swell =
      0.55 +
      0.45 * Math.sin((i / sampleRate) * 0.12 * Math.PI * 2) *
        Math.sin((i / sampleRate) * 0.07 * Math.PI * 2 + 1.2);
    L[i] = brownL * swell;
    R[i] = brownR * swell * 0.95;
  }
  return { L, R };
}

function genWind(rng) {
  const n = sampleRate * durationSec;
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  let lpL = 0,
    lpR = 0,
    brown = 0;
  for (let i = 0; i < n; i++) {
    brown = 0.995 * brown + 0.03 * gaussian(rng);
    const gust = 0.6 + 0.4 * Math.sin((i / sampleRate) * 0.2 * Math.PI * 2 + brown);
    const wL = gaussian(rng);
    const wR = gaussian(rng);
    lpL = 0.97 * lpL + 0.03 * wL;
    lpR = 0.97 * lpR + 0.03 * wR;
    L[i] = (lpL + brown * 0.4) * gust;
    R[i] = (lpR + brown * 0.35) * gust;
  }
  return { L, R };
}

function genFire(rng) {
  const n = sampleRate * durationSec;
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  let brownL = 0,
    brownR = 0;
  for (let i = 0; i < n; i++) {
    brownL = 0.996 * brownL + 0.025 * gaussian(rng);
    brownR = 0.996 * brownR + 0.025 * gaussian(rng);
    // sparse crackles
    let crackL = 0,
      crackR = 0;
    if (rng() < 0.002) crackL = (rng() * 2 - 1) * (0.3 + rng() * 0.7);
    if (rng() < 0.002) crackR = (rng() * 2 - 1) * (0.3 + rng() * 0.7);
    L[i] = brownL * 0.7 + crackL;
    R[i] = brownR * 0.7 + crackR;
  }
  return { L, R };
}

function genStream(rng) {
  const n = sampleRate * durationSec;
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  let b0 = 0,
    b1 = 0;
  for (let i = 0; i < n; i++) {
    const wL = gaussian(rng);
    const wR = gaussian(rng);
    b0 = 0.98 * b0 + wL * 0.12;
    b1 = 0.98 * b1 + wR * 0.12;
    const sparkle = Math.sin(i * 0.02 + b0 * 3) * 0.05 * rng();
    L[i] = b0 * 0.8 + sparkle + wL * 0.08;
    R[i] = b1 * 0.8 - sparkle + wR * 0.08;
  }
  return { L, R };
}

const sounds = [
  { id: 'rain_light', gen: genRain, seed: 1 },
  { id: 'ocean_shore', gen: genOcean, seed: 2 },
  { id: 'wind_trees', gen: genWind, seed: 3 },
  { id: 'fire_camp', gen: genFire, seed: 4 },
  { id: 'stream_small', gen: genStream, seed: 5 },
];

const catalogAssets = [];

for (const s of sounds) {
  const rng = mulberry32(s.seed * 99991);
  const { L, R } = s.gen(rng);
  applySeamlessFade(L, R, 0.1);
  normalize(L, R, 0.5);
  const wavPath = join(outDir, `${s.id}.wav`);
  writeWav(wavPath, L, R);
  console.log('Wrote', wavPath);

  const oggPath = join(outDir, `${s.id}.ogg`);
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-i', wavPath, '-c:a', 'libvorbis', '-q:a', '5', oggPath],
    { encoding: 'utf8' },
  );
  let file = `core/${s.id}.ogg`;
  if (ff.status !== 0 || !existsSync(oggPath)) {
    console.warn('ffmpeg ogg failed for', s.id, '— using WAV');
    file = `core/${s.id}.wav`;
  } else {
    console.log('Encoded', oggPath);
  }

  const titles = {
    rain_light: 'Light rain',
    ocean_shore: 'Ocean shore',
    wind_trees: 'Wind in trees',
    fire_camp: 'Campfire',
    stream_small: 'Small stream',
  };
  const categories = {
    rain_light: 'rain',
    ocean_shore: 'ocean',
    wind_trees: 'wind',
    fire_camp: 'fire',
    stream_small: 'stream',
  };

  catalogAssets.push({
    id: s.id,
    title: titles[s.id],
    category: categories[s.id],
    file,
    tags: [categories[s.id], 'ambient', 'loop', 'procedural'],
    loop: { mode: 'crossfade', crossfadeMs: 80 },
    license: {
      spdx: 'CC0-1.0',
      author: 'ambient-sound project',
      sourceUrl: 'https://github.com/local/ambient-sound',
      notes:
        'Procedurally generated seamless ambience placeholder (not a field recording). Replace with Freesound CC0 when desired.',
    },
  });
}

const catalog = {
  version: 1,
  packId: 'core',
  title: 'Core ambient pack',
  assets: catalogAssets,
};

const catalogPath = join(root, 'public', 'sounds', 'catalog.json');
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log('Wrote', catalogPath);

// ATTRIBUTIONS.md
const lines = [
  '# Attributions',
  '',
  `Pack: **${catalog.title}** (\`${catalog.packId}\`)`,
  '',
  'These core loops are **procedurally generated** by this project and released under **CC0-1.0**.',
  'They are placeholders for production Freesound / PD field recordings (see design doc Sound Acquisition Plan).',
  '',
];
for (const a of catalogAssets) {
  lines.push(`## ${a.title} (\`${a.id}\`)`);
  lines.push('');
  lines.push(`- **License:** ${a.license.spdx}`);
  lines.push(`- **Author:** ${a.license.author}`);
  lines.push(`- **Notes:** ${a.license.notes}`);
  lines.push('');
}
writeFileSync(join(root, 'ATTRIBUTIONS.md'), lines.join('\n'));
console.log('Wrote ATTRIBUTIONS.md');
