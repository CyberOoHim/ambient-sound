/**
 * Download Freesound HQ previews (public, no OAuth) for curated CC0 sounds,
 * normalize, encode Ogg, write catalog.json + ATTRIBUTIONS.md.
 *
 * Preview redistribution of CC0 works is allowed under CC0.
 * Full-quality originals require a logged-in Freesound account / OAuth.
 *
 * Usage: node scripts/fetch-freesound-core.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const coreDir = join(root, 'public', 'sounds', 'core');
const staging = join(root, 'assets-masters', 'freesound');
const configPath = join(root, 'config', 'sounds.json');

mkdirSync(coreDir, { recursive: true });
mkdirSync(staging, { recursive: true });

const SOUNDS = JSON.parse(readFileSync(configPath, 'utf8'));

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
  if (!existsSync(src)) {
    await download(s.previewPath, src);
  } else {
    console.log('  cached master source:', src);
  }
  if (!existsSync(ogg) || process.argv.includes('--force')) {
    processAudio(src, ogg, s.maxSec);
  } else {
    console.log('  cached ogg:', ogg);
  }

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

// Remove orphan audio files in coreDir that are not in assets
const keepFiles = new Set(assets.map((a) => a.file.split('/').pop()));
for (const file of readdirSync(coreDir)) {
  if (file.endsWith('.ogg') && !keepFiles.has(file)) {
    const orphan = join(coreDir, file);
    unlinkSync(orphan);
    console.log('  deleted orphan audio:', file);
  }
}

const catalog = {
  version: 1,
  packId: 'core',
  title: 'Core ambient pack (Freesound CC0)',
  assets,
};

const catalogPath = join(root, 'public', 'sounds', 'catalog.json');
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log('\nWrote', catalogPath);

const LICENSE_URLS = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY-NC-4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
};

const lines = [
  '# Attributions',
  '',
  'Core ambient pack sourced from **[Freesound](https://freesound.org)** under Creative Commons licenses.',
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
  lines.push(`- **License:** [${a.license.spdx}](${LICENSE_URLS[a.license.spdx] || 'https://creativecommons.org/'})`);
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
