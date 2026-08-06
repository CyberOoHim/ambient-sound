export type BinauralMode = 'binaural' | 'isochronic';

export type BrainwavePresetId =
  | 'delta'
  | 'theta'
  | 'alpha'
  | 'beta'
  | 'gamma'
  | 'custom';

export type WaveformType = 'sine' | 'triangle';

export interface BrainwavePresetInfo {
  id: BrainwavePresetId;
  label: string;
  icon: string;
  beatFreq: number;
  carrierFreq: number;
  description: string;
}

export const BRAINWAVE_PRESETS: Record<BrainwavePresetId, BrainwavePresetInfo> = {
  delta: {
    id: 'delta',
    label: 'Delta (1–4 Hz)',
    icon: '🌙',
    beatFreq: 2.5,
    carrierFreq: 150,
    description: 'Deep sleep & physical restoration',
  },
  theta: {
    id: 'theta',
    label: 'Theta (4–8 Hz)',
    icon: '🧘',
    beatFreq: 6.0,
    carrierFreq: 180,
    description: 'Meditation, REM sleep & creativity',
  },
  alpha: {
    id: 'alpha',
    label: 'Alpha (8–13 Hz)',
    icon: '🍃',
    beatFreq: 10.0,
    carrierFreq: 200,
    description: 'Relaxed focus & stress reduction',
  },
  beta: {
    id: 'beta',
    label: 'Beta (13–30 Hz)',
    icon: '⚡',
    beatFreq: 20.0,
    carrierFreq: 250,
    description: 'Active concentration & problem solving',
  },
  gamma: {
    id: 'gamma',
    label: 'Gamma (30–50 Hz)',
    icon: '💡',
    beatFreq: 40.0,
    carrierFreq: 300,
    description: 'High cognition, peak focus & memory',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    icon: '🎛️',
    beatFreq: 10.0,
    carrierFreq: 200,
    description: 'User defined carrier and beat frequencies',
  },
};

export interface BinauralConfig {
  enabled: boolean;
  mode: BinauralMode;
  preset: BrainwavePresetId;
  carrierFreq: number;
  beatFreq: number;
  volumeLinear: number;
  waveform: WaveformType;
}

export const BINAURAL_STORAGE_KEY = 'ambient-sound:binaural-config';

export const DEFAULT_BINAURAL_CONFIG: BinauralConfig = {
  enabled: false,
  mode: 'binaural',
  preset: 'alpha',
  carrierFreq: 200,
  beatFreq: 10.0,
  volumeLinear: 0.5,
  waveform: 'sine',
};

/**
 * Load Binaural configuration from browser LocalStorage with fallback defaults.
 */
export function loadBinauralConfigFromStorage(): BinauralConfig {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_BINAURAL_CONFIG };
  }
  try {
    const raw = localStorage.getItem(BINAURAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINAURAL_CONFIG };
    const parsed = JSON.parse(raw) as Partial<BinauralConfig>;

    const validModes: BinauralMode[] = ['binaural', 'isochronic'];
    const mode: BinauralMode = validModes.includes(parsed.mode as BinauralMode)
      ? (parsed.mode as BinauralMode)
      : DEFAULT_BINAURAL_CONFIG.mode;

    const validPresets: BrainwavePresetId[] = [
      'delta',
      'theta',
      'alpha',
      'beta',
      'gamma',
      'custom',
    ];
    const preset: BrainwavePresetId = validPresets.includes(
      parsed.preset as BrainwavePresetId,
    )
      ? (parsed.preset as BrainwavePresetId)
      : DEFAULT_BINAURAL_CONFIG.preset;

    const validWaveforms: WaveformType[] = ['sine', 'triangle'];
    const waveform: WaveformType = validWaveforms.includes(
      parsed.waveform as WaveformType,
    )
      ? (parsed.waveform as WaveformType)
      : DEFAULT_BINAURAL_CONFIG.waveform;

    const carrierFreq =
      typeof parsed.carrierFreq === 'number' && !isNaN(parsed.carrierFreq)
        ? Math.max(40, Math.min(1000, parsed.carrierFreq))
        : DEFAULT_BINAURAL_CONFIG.carrierFreq;

    const beatFreq =
      typeof parsed.beatFreq === 'number' && !isNaN(parsed.beatFreq)
        ? Math.max(0.5, Math.min(50, parsed.beatFreq))
        : DEFAULT_BINAURAL_CONFIG.beatFreq;

    const volumeLinear =
      typeof parsed.volumeLinear === 'number' && !isNaN(parsed.volumeLinear)
        ? Math.max(0, Math.min(1, parsed.volumeLinear))
        : DEFAULT_BINAURAL_CONFIG.volumeLinear;

    return {
      enabled:
        typeof parsed.enabled === 'boolean'
          ? parsed.enabled
          : DEFAULT_BINAURAL_CONFIG.enabled,
      mode,
      preset,
      carrierFreq,
      beatFreq,
      volumeLinear,
      waveform,
    };
  } catch (e) {
    console.warn('Failed to load binaural config from localStorage:', e);
    return { ...DEFAULT_BINAURAL_CONFIG };
  }
}

/**
 * Save Binaural configuration to browser LocalStorage.
 */
export function saveBinauralConfigToStorage(config: BinauralConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BINAURAL_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save binaural config to localStorage:', e);
  }
}
