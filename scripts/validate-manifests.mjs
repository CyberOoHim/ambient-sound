/**
 * Validate public/sounds/catalog.json license + file presence.
 * Usage: node scripts/validate-manifests.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const catalogPath = join(root, 'public', 'sounds', 'catalog.json');
const ALLOWED = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'PD']);

let failed = 0;

function fail(msg) {
  console.error('FAIL:', msg);
  failed++;
}

if (!existsSync(catalogPath)) {
  fail(`Missing ${catalogPath}`);
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
if (catalog.version !== 1) fail('catalog.version must be 1');
if (!catalog.packId) fail('missing packId');
if (!Array.isArray(catalog.assets) || catalog.assets.length === 0) {
  fail('assets must be a non-empty array');
}

const ids = new Set();
for (const a of catalog.assets ?? []) {
  if (!a.id) fail('asset missing id');
  if (ids.has(a.id)) fail(`duplicate id ${a.id}`);
  ids.add(a.id);
  if (!a.title) fail(`${a.id}: missing title`);
  if (!a.file) fail(`${a.id}: missing file`);
  if (!a.loop || (a.loop.mode !== 'native' && a.loop.mode !== 'crossfade')) {
    fail(`${a.id}: invalid loop.mode`);
  }
  if (!a.license?.spdx) fail(`${a.id}: missing license.spdx`);
  else if (!ALLOWED.has(a.license.spdx)) {
    fail(`${a.id}: license ${a.license.spdx} not allowed in core`);
  }
  if (!a.license?.author) fail(`${a.id}: missing license.author`);
  const filePath = join(root, 'public', 'sounds', a.file);
  if (!existsSync(filePath)) fail(`${a.id}: file missing ${a.file}`);
}

const soundsConfigPath = join(root, 'config', 'sounds.json');
const presetsConfigPath = join(root, 'config', 'default-presets.json');

if (!existsSync(soundsConfigPath)) {
  fail(`Missing ${soundsConfigPath}`);
} else {
  try {
    const soundsConf = JSON.parse(readFileSync(soundsConfigPath, 'utf8'));
    if (!Array.isArray(soundsConf)) fail('config/sounds.json must be an array');
  } catch (e) {
    fail(`Invalid config/sounds.json: ${e.message}`);
  }
}

if (!existsSync(presetsConfigPath)) {
  fail(`Missing ${presetsConfigPath}`);
} else {
  try {
    const presetsConf = JSON.parse(readFileSync(presetsConfigPath, 'utf8'));
    if (!Array.isArray(presetsConf)) {
      fail('config/default-presets.json must be an array');
    } else {
      for (const p of presetsConf) {
        if (!p.id || !p.name) fail(`Preset missing id or name`);
        if (!Array.isArray(p.layers)) fail(`Preset ${p.id} missing layers array`);
        for (const layer of p.layers ?? []) {
          if (layer.kind === 'sample') {
            const assetId = layer.params?.assetId;
            if (!assetId) fail(`Preset ${p.id} sample layer missing assetId`);
            else if (!ids.has(assetId)) {
              fail(`Preset ${p.id} references unknown catalog assetId: "${assetId}"`);
            }
          }
        }
      }
    }
  } catch (e) {
    fail(`Invalid config/default-presets.json: ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} validation error(s)`);
  process.exit(1);
}
console.log(`OK: ${catalog.assets.length} asset(s) in pack "${catalog.packId}" and presets validated successfully`);
