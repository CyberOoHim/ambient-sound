export type OneShotDensity = 'subtle' | 'balanced' | 'lively';

export interface OneShotPack {
  id: string;
  label: string;
  icon: string;
  description: string;
  assetIds: string[];
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

export interface OneShotConfig {
  enabled: boolean;
  density: OneShotDensity;
  selectedPacks: string[];
  volumeLinear: number;
  spatialPan: boolean;
  pitchJitter: boolean;
  distanceFilter: boolean;
}

export const ONE_SHOT_STORAGE_KEY = 'ambient-sound:one-shot-config';

export const DEFAULT_ONE_SHOT_CONFIG: OneShotConfig = {
  enabled: false,
  density: 'balanced',
  selectedPacks: ['storm', 'forest', 'coastal', 'cozy'],
  volumeLinear: 0.7,
  spatialPan: true,
  pitchJitter: true,
  distanceFilter: true,
};

/**
 * Load One-Shot configuration from browser LocalStorage with fallback defaults.
 */
export function loadOneShotConfigFromStorage(): OneShotConfig {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_ONE_SHOT_CONFIG };
  }
  try {
    const raw = localStorage.getItem(ONE_SHOT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ONE_SHOT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<OneShotConfig>;
    
    const validDensities: OneShotDensity[] = ['subtle', 'balanced', 'lively'];
    const density: OneShotDensity = validDensities.includes(parsed.density as OneShotDensity)
      ? (parsed.density as OneShotDensity)
      : DEFAULT_ONE_SHOT_CONFIG.density;

    const allPackIds = ONE_SHOT_PACKS.map(p => p.id);
    const selectedPacks = Array.isArray(parsed.selectedPacks)
      ? parsed.selectedPacks.filter(id => allPackIds.includes(id))
      : DEFAULT_ONE_SHOT_CONFIG.selectedPacks;

    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_ONE_SHOT_CONFIG.enabled,
      density,
      selectedPacks: selectedPacks.length > 0 ? selectedPacks : [...DEFAULT_ONE_SHOT_CONFIG.selectedPacks],
      volumeLinear: typeof parsed.volumeLinear === 'number'
        ? Math.max(0, Math.min(1, parsed.volumeLinear))
        : DEFAULT_ONE_SHOT_CONFIG.volumeLinear,
      spatialPan: typeof parsed.spatialPan === 'boolean' ? parsed.spatialPan : DEFAULT_ONE_SHOT_CONFIG.spatialPan,
      pitchJitter: typeof parsed.pitchJitter === 'boolean' ? parsed.pitchJitter : DEFAULT_ONE_SHOT_CONFIG.pitchJitter,
      distanceFilter: typeof parsed.distanceFilter === 'boolean' ? parsed.distanceFilter : DEFAULT_ONE_SHOT_CONFIG.distanceFilter,
    };
  } catch (e) {
    console.warn('Failed to load one-shot config from localStorage:', e);
    return { ...DEFAULT_ONE_SHOT_CONFIG };
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
