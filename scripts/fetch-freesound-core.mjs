/**
 * Download Freesound HQ previews (public, no OAuth) for curated CC0 sounds,
 * normalize, encode Ogg, write catalog.json + ATTRIBUTIONS.md.
 *
 * Preview redistribution of CC0 works is allowed under CC0.
 * Full-quality originals require a logged-in Freesound account / OAuth.
 *
 * Usage: node scripts/fetch-freesound-core.mjs
 */
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const coreDir = join(root, 'public', 'sounds', 'core');
const staging = join(root, 'assets-masters', 'freesound');

mkdirSync(coreDir, { recursive: true });
mkdirSync(staging, { recursive: true });

/**
 * Curated CC0 pack — verified on freesound.org pages 2026-07-31.
 * HQ preview paths scraped from sound pages (public CDN).
 */
const SOUNDS = [
  {
    id: 'rain_light',
    title: 'Light rain',
    category: 'rain',
    tags: ['rain', 'ambient', 'field-recording', 'freesound'],
    freesoundId: 478665,
    username: 'DBlover',
    originalTitle: 'Rain ambient sounds',
    license: 'CC0-1.0',
    previewPath: 'previews/478/478665_7846219-hq.mp3',
    pageUrl: 'https://freesound.org/people/DBlover/sounds/478665/',
    maxSec: 60,
    crossfadeMs: 100,
  },
  {
    id: 'ocean_shore',
    title: 'Ocean shore',
    category: 'ocean',
    tags: ['ocean', 'waves', 'ambient', 'freesound'],
    freesoundId: 450755,
    username: 'florianreichelt',
    originalTitle: 'Waves of Hawaii',
    license: 'CC0-1.0',
    previewPath: 'previews/450/450755_6253486-hq.mp3',
    pageUrl: 'https://freesound.org/people/florianreichelt/sounds/450755/',
    maxSec: 60,
    crossfadeMs: 120,
  },
  {
    id: 'wind_trees',
    title: 'Wind in trees',
    category: 'wind',
    tags: ['wind', 'forest', 'ambient', 'freesound'],
    freesoundId: 563571,
    username: 'Cinetony',
    originalTitle: 'Wind in forest with creaking tree',
    license: 'CC0-1.0',
    previewPath: 'previews/563/563571_5985747-hq.mp3',
    pageUrl: 'https://freesound.org/people/Cinetony/sounds/563571/',
    maxSec: 60,
    crossfadeMs: 100,
  },
  {
    id: 'fire_camp',
    title: 'Campfire',
    category: 'fire',
    tags: ['fire', 'campfire', 'crackling', 'loop', 'freesound'],
    freesoundId: 813328,
    username: 'NickTayloe',
    originalTitle: 'Crackling Flames (loop)',
    license: 'CC0-1.0',
    previewPath: 'previews/813/813328_11606594-hq.mp3',
    pageUrl: 'https://freesound.org/people/NickTayloe/sounds/813328/',
    maxSec: 90,
    crossfadeMs: 80,
    loopMode: 'native', // labeled loop on Freesound
  },
  {
    id: 'stream_small',
    title: 'Small stream',
    category: 'stream',
    tags: ['stream', 'river', 'water', 'ambient', 'freesound'],
    freesoundId: 733004,
    username: 'sonicalypse',
    originalTitle: 'Water Stream River Creek with crickets',
    license: 'CC0-1.0',
    previewPath: 'previews/733/733004_3141657-hq.mp3',
    pageUrl: 'https://freesound.org/people/sonicalypse/sounds/733004/',
    maxSec: 60,
    crossfadeMs: 100,
  },
];

const CDN_BASES = [
  'https://cdn.freesound.org/',
  'https://freesound.org/data/',
];

async function download(previewPath, dest) {
  let lastErr;
  for (const base of CDN_BASES) {
    const url = base + previewPath;
    try {
      console.log('GET', url);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ambient-sound-core-pack/0.1 (personal tool)' },
      });
      if (!res.ok) {
        lastErr = new Error(`${url} → ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) {
        lastErr = new Error(`${url} too small`);
        continue;
      }
      writeFileSync(dest, buf);
      console.log('  saved', dest, `(${buf.length} bytes)`);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('download failed');
}

function runFfmpeg(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr?.slice(-800));
    throw new Error(`ffmpeg failed: ${args.join(' ')}`);
  }
}

function processAudio(src, destOgg, maxSec) {
  // Trim to maxSec (from start — previews are usually continuous ambience),
  // loudnorm to -18 LUFS, encode vorbis.
  const tmp = destOgg.replace(/\.ogg$/, '.norm.wav');
  runFfmpeg([
    '-y',
    '-i',
    src,
    '-t',
    String(maxSec),
    '-af',
    'loudnorm=I=-18:TP=-1.5:LRA=11',
    '-ar',
    '48000',
    '-ac',
    '2',
    tmp,
  ]);
  runFfmpeg([
    '-y',
    '-i',
    tmp,
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    destOgg,
  ]);
  try {
    unlinkSync(tmp);
  } catch {
    /* */
  }
  console.log('  encoded', destOgg);
}

const assets = [];

for (const s of SOUNDS) {
  const src = join(staging, `${s.id}-src.mp3`);
  const ogg = join(coreDir, `${s.id}.ogg`);
  console.log(`\n=== ${s.id} (${s.freesoundId}) ===`);
  await download(s.previewPath, src);
  processAudio(src, ogg, s.maxSec);

  assets.push({
    id: s.id,
    title: s.title,
    category: s.category,
    file: `core/${s.id}.ogg`,
    tags: s.tags,
    loop: {
      mode: s.loopMode ?? 'crossfade',
      crossfadeMs: s.crossfadeMs ?? 100,
    },
    license: {
      spdx: s.license,
      author: s.username,
      sourceUrl: s.pageUrl,
      attribution: `"${s.originalTitle}" by ${s.username} (${s.pageUrl}) — ${s.license}`,
      notes: `Freesound #${s.freesoundId}. Packaged from public HQ preview; trimmed/normalized for ambient looping.`,
    },
    freesound: {
      id: s.freesoundId,
      username: s.username,
      originalTitle: s.originalTitle,
    },
  });
}

// Remove old procedural files that are not in the new set
const keep = new Set(assets.map((a) => a.file.split('/').pop()));
for (const name of ['rain_light', 'ocean_shore', 'wind_trees', 'fire_camp', 'stream_small']) {
  // all kept
  void name;
}
void keep;

const catalog = {
  version: 1,
  packId: 'core',
  title: 'Core ambient pack (Freesound CC0)',
  assets,
};

const catalogPath = join(root, 'public', 'sounds', 'catalog.json');
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log('\nWrote', catalogPath);

const lines = [
  '# Attributions',
  '',
  'Core ambient pack sourced from **[Freesound](https://freesound.org)** under **CC0-1.0**.',
  '',
  'Audio files in this repository are derived from Freesound **HQ previews** (publicly accessible), then trimmed and loudness-normalized for looping. Full-resolution originals remain available on each Freesound page for logged-in users.',
  '',
  '## Sounds',
  '',
];

for (const a of assets) {
  lines.push(`### ${a.title} (\`${a.id}\`)`);
  lines.push('');
  lines.push(`- **Original:** ${a.freesound.originalTitle}`);
  lines.push(`- **Author:** [${a.license.author}](https://freesound.org/people/${a.license.author}/)`);
  lines.push(`- **Freesound:** [#${a.freesound.id}](${a.license.sourceUrl})`);
  lines.push(`- **License:** [${a.license.spdx}](https://creativecommons.org/publicdomain/zero/1.0/)`);
  lines.push(`- **Attribution text:** ${a.license.attribution}`);
  lines.push('');
}

lines.push('## License note');
lines.push('');
lines.push(
  'CC0 dedications waive copyright to the extent allowed by law. No attribution is legally required for CC0, but we retain full provenance for transparency and community courtesy.',
);
lines.push('');

writeFileSync(join(root, 'ATTRIBUTIONS.md'), lines.join('\n'));
console.log('Wrote ATTRIBUTIONS.md');
console.log('\nDone. Run: pnpm validate-manifests');
