export type OneShotDensity = 'subtle' | 'balanced' | 'lively' | 'custom';

export interface OneShotPack {
  id: string;
  label: string;
  icon: string;
  description: string;
  assetIds: string[];
  isCustom?: boolean;
}

export interface CustomOneShotPack extends OneShotPack {
  isCustom: true;
}

export const ONE_SHOT_PACKS: OneShotPack[] = [
  {
    id: 'storm',
    label: 'Storm & Sky',
    icon: '🌩️',
    description: 'Distant thunder rumbles, lightning strikes & wind gusts',
    assetIds: ['thunder_distant', 'thunder_storm', 'winter_storm'],
  },
  {
    id: 'forest',
    label: 'Wild Forest',
    icon: '🌲',
    description: 'Woodland songbirds, night owls, rustling canopy leaves',
    assetIds: ['birds_morning', 'owls_forest', 'leaves_rustle', 'wind_trees'],
  },
  {
    id: 'coastal',
    label: 'Coastal Ambiance',
    icon: '🌊',
    description: 'Seagull cries, rogue wave accents & shore ripples',
    assetIds: ['seagulls', 'seagulls_surf', 'lake_shore', 'pebble_beach'],
  },
  {
    id: 'cozy',
    label: 'Cozy & Nature',
    icon: '☕',
    description: 'Cave drips, rain on roof, fire pops & small streams',
    assetIds: ['cave_drips', 'rain_roof', 'fire_camp', 'stream_small'],
  },
];

export const ALL_ONE_SHOT_ASSETS: string[] = ONE_SHOT_PACKS.flatMap((p) => p.assetIds);

export interface OneShotConfig {
  enabled: boolean;
  density: OneShotDensity;
  customIntervalMs: number;
  selectedPacks: string[];
  selectedAssets: string[];
  volumeLinear: number;
  spatialPan: boolean;
  pitchJitter: boolean;
  distanceFilter: boolean;
  burstSequence: boolean;
  acousticTail: boolean;
}

export const ONE_SHOT_STORAGE_KEY = 'ambient-sound:one-shot-config';
export const CUSTOM_ONE_SHOT_PACKS_STORAGE_KEY = 'ambient-sound:custom-one-shot-packs';

export const DEFAULT_ONE_SHOT_CONFIG: OneShotConfig = {
  enabled: false,
  density: 'balanced',
  customIntervalMs: 60_000,
  selectedPacks: ['storm', 'forest', 'coastal', 'cozy'],
  selectedAssets: [...ALL_ONE_SHOT_ASSETS],
  volumeLinear: 0.7,
  spatialPan: true,
  pitchJitter: true,
  distanceFilter: true,
  burstSequence: true,
  acousticTail: true,
};

/**
 * Load Custom One-Shot Sound Packs from LocalStorage.
 */
export function loadCustomOneShotPacksFromStorage(): CustomOneShotPack[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_ONE_SHOT_PACKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => ({
      id: String(p.id || `custom-${Date.now()}`),
      label: String(p.label || 'Custom Pack'),
      icon: String(p.icon || '📦'),
      description: String(p.description || 'User defined event pack'),
      assetIds: Array.isArray(p.assetIds) ? p.assetIds.map(String) : [],
      isCustom: true as const,
    }));
  } catch (e) {
    console.warn('Failed to load custom one-shot packs from storage:', e);
    return [];
  }
}

/**
 * Persist Custom One-Shot Sound Packs to LocalStorage.
 */
export function saveCustomOneShotPacksToStorage(packs: CustomOneShotPack[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_ONE_SHOT_PACKS_STORAGE_KEY, JSON.stringify(packs));
  } catch (e) {
    console.warn('Failed to save custom one-shot packs to storage:', e);
  }
}

/**
 * Merge built-in default packs with custom packs.
 */
export function getAllOneShotPacks(customPacks: CustomOneShotPack[] = []): OneShotPack[] {
  return [...ONE_SHOT_PACKS, ...customPacks];
}

/**
 * Normalize unknown/partial input into a valid OneShotConfig.
 * Used by localStorage, presets, and share links.
 * Unknown pack/asset ids are kept when they appear as strings so shared
 * scenes still round-trip; the engine skips missing assets at trigger time.
 */
export function parseOneShotConfig(
  raw: unknown,
  customPacks: CustomOneShotPack[] = [],
): OneShotConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_ONE_SHOT_CONFIG, selectedAssets: [...ALL_ONE_SHOT_ASSETS] };
  }
  const parsed = raw as Partial<OneShotConfig>;

  const validDensities: OneShotDensity[] = ['subtle', 'balanced', 'lively', 'custom'];
  const density: OneShotDensity = validDensities.includes(parsed.density as OneShotDensity)
    ? (parsed.density as OneShotDensity)
    : DEFAULT_ONE_SHOT_CONFIG.density;

  const allPacks = getAllOneShotPacks(customPacks);
  const validPackIds = new Set(allPacks.map((p) => p.id));
  const selectedPacks = Array.isArray(parsed.selectedPacks)
    ? parsed.selectedPacks.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [...DEFAULT_ONE_SHOT_CONFIG.selectedPacks];

  // Prefer known packs; if none remain known, keep raw ids for share round-trip.
  const knownPacks = selectedPacks.filter((id) => validPackIds.has(id));
  const resolvedPacks =
    knownPacks.length > 0
      ? knownPacks
      : selectedPacks.length > 0
        ? selectedPacks
        : [...DEFAULT_ONE_SHOT_CONFIG.selectedPacks];

  const allAvailableAssets = Array.from(new Set(allPacks.flatMap((p) => p.assetIds)));
  const selectedAssets = Array.isArray(parsed.selectedAssets)
    ? parsed.selectedAssets.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [...allAvailableAssets];

  const knownAssets = selectedAssets.filter((id) => allAvailableAssets.includes(id));
  const resolvedAssets =
    knownAssets.length > 0
      ? knownAssets
      : selectedAssets.length > 0
        ? selectedAssets
        : [...allAvailableAssets];

  const customIntervalMs =
    typeof parsed.customIntervalMs === 'number'
      ? Math.max(5_000, Math.min(600_000, parsed.customIntervalMs))
      : DEFAULT_ONE_SHOT_CONFIG.customIntervalMs;

  return {
    enabled:
      typeof parsed.enabled === 'boolean'
        ? parsed.enabled
        : DEFAULT_ONE_SHOT_CONFIG.enabled,
    density,
    customIntervalMs,
    selectedPacks: resolvedPacks,
    selectedAssets: resolvedAssets,
    volumeLinear:
      typeof parsed.volumeLinear === 'number'
        ? Math.max(0, Math.min(1, parsed.volumeLinear))
        : DEFAULT_ONE_SHOT_CONFIG.volumeLinear,
    spatialPan:
      typeof parsed.spatialPan === 'boolean'
        ? parsed.spatialPan
        : DEFAULT_ONE_SHOT_CONFIG.spatialPan,
    pitchJitter:
      typeof parsed.pitchJitter === 'boolean'
        ? parsed.pitchJitter
        : DEFAULT_ONE_SHOT_CONFIG.pitchJitter,
    distanceFilter:
      typeof parsed.distanceFilter === 'boolean'
        ? parsed.distanceFilter
        : DEFAULT_ONE_SHOT_CONFIG.distanceFilter,
    burstSequence:
      typeof parsed.burstSequence === 'boolean'
        ? parsed.burstSequence
        : DEFAULT_ONE_SHOT_CONFIG.burstSequence,
    acousticTail:
      typeof parsed.acousticTail === 'boolean'
        ? parsed.acousticTail
        : DEFAULT_ONE_SHOT_CONFIG.acousticTail,
  };
}

/**
 * Load One-Shot configuration from browser LocalStorage with fallback defaults.
 */
export function loadOneShotConfigFromStorage(customPacks: CustomOneShotPack[] = []): OneShotConfig {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_ONE_SHOT_CONFIG, selectedAssets: [...ALL_ONE_SHOT_ASSETS] };
  }
  try {
    const raw = localStorage.getItem(ONE_SHOT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ONE_SHOT_CONFIG, selectedAssets: [...ALL_ONE_SHOT_ASSETS] };
    return parseOneShotConfig(JSON.parse(raw) as unknown, customPacks);
  } catch (e) {
    console.warn('Failed to load one-shot config from localStorage:', e);
    return { ...DEFAULT_ONE_SHOT_CONFIG, selectedAssets: [...ALL_ONE_SHOT_ASSETS] };
  }
}

/**
 * Persist One-Shot configuration to browser LocalStorage.
 */
export function saveOneShotConfigToStorage(config: OneShotConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ONE_SHOT_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save one-shot config to localStorage:', e);
  }
}
