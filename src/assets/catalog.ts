export type AllowedSpdx = 'CC0-1.0' | 'CC-BY-3.0' | 'CC-BY-4.0' | 'PD';

export interface CatalogLicense {
  spdx: AllowedSpdx | string;
  author: string;
  sourceUrl?: string;
  attribution?: string;
  notes?: string;
}

export interface CatalogLoop {
  mode: 'native' | 'crossfade';
  crossfadeMs?: number;
}

/** Per-asset hints for stochastic one-shots (sliced from long loops). */
export interface CatalogOneShotMeta {
  /** Preferred play length when slicing a long buffer (seconds). */
  eventDurationSec?: number;
  /** Preferred start offset in seconds (if buffer is long enough). */
  preferOffsetSec?: number;
  /** If true, play the full buffer without random mid-file slices. */
  playFull?: boolean;
}

export interface CatalogAsset {
  id: string;
  title: string;
  category: string;
  /** Path relative to /sounds/ */
  file: string;
  tags?: string[];
  loop: CatalogLoop;
  license: CatalogLicense;
  /** Optional one-shot slice hints (FIX-03). */
  oneShot?: CatalogOneShotMeta;
}

export interface SoundCatalog {
  version: 1;
  packId: string;
  title: string;
  assets: CatalogAsset[];
}

const ALLOWED_SPDX = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'PD']);

export function isAllowedCoreLicense(spdx: string): boolean {
  return ALLOWED_SPDX.has(spdx);
}

export function parseCatalog(raw: unknown): SoundCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (typeof o.packId !== 'string' || typeof o.title !== 'string') return null;
  if (!Array.isArray(o.assets)) return null;

  const assets: CatalogAsset[] = [];
  for (const a of o.assets) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    if (typeof x.id !== 'string' || typeof x.title !== 'string') continue;
    if (typeof x.category !== 'string' || typeof x.file !== 'string') continue;
    if (!x.loop || typeof x.loop !== 'object') continue;
    if (!x.license || typeof x.license !== 'object') continue;
    const loop = x.loop as Record<string, unknown>;
    const lic = x.license as Record<string, unknown>;
    if (loop.mode !== 'native' && loop.mode !== 'crossfade') continue;
    if (typeof lic.spdx !== 'string' || typeof lic.author !== 'string') continue;

    let oneShot: CatalogOneShotMeta | undefined;
    if (x.oneShot && typeof x.oneShot === 'object') {
      const os = x.oneShot as Record<string, unknown>;
      oneShot = {
        eventDurationSec:
          typeof os.eventDurationSec === 'number' ? os.eventDurationSec : undefined,
        preferOffsetSec:
          typeof os.preferOffsetSec === 'number' ? os.preferOffsetSec : undefined,
        playFull: typeof os.playFull === 'boolean' ? os.playFull : undefined,
      };
    }

    assets.push({
      id: x.id,
      title: x.title,
      category: x.category,
      file: x.file,
      tags: Array.isArray(x.tags)
        ? x.tags.filter((t): t is string => typeof t === 'string')
        : undefined,
      loop: {
        mode: loop.mode,
        crossfadeMs:
          typeof loop.crossfadeMs === 'number' ? loop.crossfadeMs : undefined,
      },
      license: {
        spdx: lic.spdx,
        author: lic.author,
        sourceUrl: typeof lic.sourceUrl === 'string' ? lic.sourceUrl : undefined,
        attribution:
          typeof lic.attribution === 'string' ? lic.attribution : undefined,
        notes: typeof lic.notes === 'string' ? lic.notes : undefined,
      },
      ...(oneShot ? { oneShot } : {}),
    });
  }

  return {
    version: 1,
    packId: o.packId,
    title: o.title,
    assets,
  };
}

const getBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) {
    const base = import.meta.env.BASE_URL;
    return base.endsWith('/') ? base : `${base}/`;
  }
  return '/';
};

/** Resolve public URL for an asset file path. */
export function assetUrl(file: string): string {
  const cleaned = file.replace(/^\/+/, '');
  return `${getBaseUrl()}sounds/${cleaned}`;
}

export function findAsset(
  catalog: SoundCatalog,
  assetId: string,
): CatalogAsset | undefined {
  return catalog.assets.find((a) => a.id === assetId);
}

let cached: SoundCatalog | null | undefined;

export async function loadCoreCatalog(
  fetchFn: typeof fetch = fetch,
): Promise<SoundCatalog> {
  if (cached) return cached;
  const res = await fetchFn(`${getBaseUrl()}sounds/catalog.json`);
  if (!res.ok) throw new Error(`Failed to load catalog: ${res.status}`);
  const parsed = parseCatalog(await res.json());
  if (!parsed) throw new Error('Invalid catalog.json');
  cached = parsed;
  return parsed;
}

/** Test helper / HMR. */
export function clearCatalogCache(): void {
  cached = undefined;
}

export function buildAttributionsMarkdown(catalog: SoundCatalog): string {
  const lines = [
    '# Attributions',
    '',
    `Pack: **${catalog.title}** (\`${catalog.packId}\`)`,
    '',
  ];
  for (const a of catalog.assets) {
    lines.push(`## ${a.title} (\`${a.id}\`)`);
    lines.push('');
    lines.push(`- **License:** ${a.license.spdx}`);
    lines.push(`- **Author:** ${a.license.author}`);
    if (a.license.sourceUrl) lines.push(`- **Source:** ${a.license.sourceUrl}`);
    if (a.license.attribution) lines.push(`- **Attribution:** ${a.license.attribution}`);
    if (a.license.notes) lines.push(`- **Notes:** ${a.license.notes}`);
    lines.push('');
  }
  return lines.join('\n');
}
