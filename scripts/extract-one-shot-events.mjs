/**
 * Extract short discrete one-shot clips from long ambient loops (ENH-01).
 * Requires ffmpeg. Usage: node scripts/extract-one-shot-events.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const coreDir = join(root, 'public', 'sounds', 'core');
const eventsDir = join(root, 'public', 'sounds', 'events');
const catalogPath = join(root, 'public', 'sounds', 'catalog.json');

/** @type {{ id: string, title: string, category: string, tags: string[], source: string, startSec: number, durationSec: number, author: string, sourceUrl?: string }[]} */
const EVENTS = [
  {
    id: 'event_thunder_crack',
    title: 'Thunder crack',
    category: 'thunder',
    tags: ['thunder', 'one-shot', 'event'],
    source: 'thunder_distant.ogg',
    startSec: 1.5,
    durationSec: 3.5,
    author: 'SholeColtis',
    sourceUrl: 'https://freesound.org/people/SholeColtis/sounds/683419/',
  },
  {
    id: 'event_thunder_roll',
    title: 'Thunder roll',
    category: 'thunder',
    tags: ['thunder', 'one-shot', 'event'],
    source: 'thunder_storm.ogg',
    startSec: 2,
    durationSec: 4,
    author: 'felix.blume',
    sourceUrl: 'https://freesound.org/people/felix.blume/sounds/237242/',
  },
  {
    id: 'event_bird_chirp',
    title: 'Bird chirp',
    category: 'birds',
    tags: ['birds', 'one-shot', 'event'],
    source: 'birds_morning.ogg',
    startSec: 3,
    durationSec: 2.2,
    author: 'Freesound',
  },
  {
    id: 'event_owl_hoot',
    title: 'Owl hoot',
    category: 'birds',
    tags: ['owls', 'one-shot', 'event'],
    source: 'owls_forest.ogg',
    startSec: 2,
    durationSec: 2.5,
    author: 'Freesound',
  },
  {
    id: 'event_leaf_snap',
    title: 'Leaf snap',
    category: 'forest',
    tags: ['leaves', 'one-shot', 'event'],
    source: 'leaves_rustle.ogg',
    startSec: 1,
    durationSec: 1.8,
    author: 'Freesound',
  },
  {
    id: 'event_seagull_cry',
    title: 'Seagull cry',
    category: 'birds',
    tags: ['seagulls', 'one-shot', 'event'],
    source: 'seagulls.ogg',
    startSec: 2,
    durationSec: 2.0,
    author: 'Freesound',
  },
  {
    id: 'event_fire_pop',
    title: 'Fire pop',
    category: 'fire',
    tags: ['fire', 'one-shot', 'event'],
    source: 'fire_camp.ogg',
    startSec: 4,
    durationSec: 1.6,
    author: 'Freesound',
  },
  {
    id: 'event_cave_drip',
    title: 'Cave drip',
    category: 'cave',
    tags: ['cave', 'drip', 'one-shot', 'event'],
    source: 'cave_drips.ogg',
    startSec: 1.5,
    durationSec: 1.4,
    author: 'Freesound',
  },
];

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function extract(src, dest, start, dur) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      String(start),
      '-t',
      String(dur),
      '-i',
      src,
      '-c:a',
      'libvorbis',
      '-q:a',
      '4',
      dest,
    ],
    { stdio: 'inherit' },
  );
}

if (!hasFfmpeg()) {
  console.error('ffmpeg not found — install ffmpeg to extract event clips');
  process.exit(1);
}

mkdirSync(eventsDir, { recursive: true });

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const existingIds = new Set(catalog.assets.map((a) => a.id));

// Add oneShot meta to long-loop assets used as fallbacks
const LONG_META = {
  thunder_distant: { eventDurationSec: 2.8, preferOffsetSec: 1.5 },
  thunder_storm: { eventDurationSec: 3.2, preferOffsetSec: 2 },
  birds_morning: { eventDurationSec: 1.6, preferOffsetSec: 3 },
  owls_forest: { eventDurationSec: 2.0, preferOffsetSec: 2 },
  leaves_rustle: { eventDurationSec: 1.4, preferOffsetSec: 1 },
  seagulls: { eventDurationSec: 1.5, preferOffsetSec: 2 },
  fire_camp: { eventDurationSec: 1.2, preferOffsetSec: 4 },
  cave_drips: { eventDurationSec: 1.0, preferOffsetSec: 1.5 },
  wind_trees: { eventDurationSec: 1.8, preferOffsetSec: 5 },
  winter_storm: { eventDurationSec: 2.5, preferOffsetSec: 3 },
};

for (const a of catalog.assets) {
  if (LONG_META[a.id] && !a.oneShot) {
    a.oneShot = LONG_META[a.id];
  }
}

for (const ev of EVENTS) {
  const src = join(coreDir, ev.source);
  const destFile = `${ev.id}.ogg`;
  const dest = join(eventsDir, destFile);
  if (!existsSync(src)) {
    console.warn(`skip ${ev.id}: missing source ${ev.source}`);
    continue;
  }
  console.log(`extract ${ev.id} from ${ev.source} @${ev.startSec}s +${ev.durationSec}s`);
  extract(src, dest, ev.startSec, ev.durationSec);

  const asset = {
    id: ev.id,
    title: ev.title,
    category: ev.category,
    file: `events/${destFile}`,
    tags: ev.tags,
    loop: { mode: 'native', crossfadeMs: 40 },
    license: {
      spdx: 'CC0-1.0',
      author: ev.author,
      sourceUrl: ev.sourceUrl,
      attribution: `"${ev.title}" one-shot excerpt (CC0)`,
      notes: `Short event clip extracted from ${ev.source} for discrete one-shot playback.`,
    },
    oneShot: { playFull: true, eventDurationSec: ev.durationSec },
  };

  if (existingIds.has(ev.id)) {
    const idx = catalog.assets.findIndex((a) => a.id === ev.id);
    catalog.assets[idx] = asset;
  } else {
    catalog.assets.push(asset);
    existingIds.add(ev.id);
  }
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Updated ${catalogPath} (${catalog.assets.length} assets)`);

// Mirror to dist if present
const distCatalog = join(root, 'dist', 'sounds', 'catalog.json');
if (existsSync(join(root, 'dist', 'sounds'))) {
  mkdirSync(join(root, 'dist', 'sounds', 'events'), { recursive: true });
  for (const ev of EVENTS) {
    const f = join(eventsDir, `${ev.id}.ogg`);
    if (existsSync(f)) {
      copyFileSync(f, join(root, 'dist', 'sounds', 'events', `${ev.id}.ogg`));
    }
  }
  writeFileSync(distCatalog, JSON.stringify(catalog, null, 2) + '\n');
}
