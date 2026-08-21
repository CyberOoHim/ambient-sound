/**
 * Dynamic mood themes from active mixer layers (ENH-12).
 * Sets `data-mood` on <html> so CSS can retint the palette.
 */
import type { MixerLayer } from '../audio/types';
import type { SoundCatalog } from '../assets/catalog';
import { findAsset } from '../assets/catalog';

export type MoodId =
  | 'default'
  | 'rain'
  | 'fire'
  | 'forest'
  | 'ocean'
  | 'night'
  | 'train'
  | 'cave';

const MOOD_SCORES: Record<Exclude<MoodId, 'default'>, number> = {
  rain: 0,
  fire: 0,
  forest: 0,
  ocean: 0,
  night: 0,
  train: 0,
  cave: 0,
};

function scoreReset(): void {
  for (const k of Object.keys(MOOD_SCORES) as (keyof typeof MOOD_SCORES)[]) {
    MOOD_SCORES[k] = 0;
  }
}

function bump(mood: keyof typeof MOOD_SCORES, amount: number): void {
  MOOD_SCORES[mood] += amount;
}

function scoreText(text: string, weight: number): void {
  const t = text.toLowerCase();
  if (/\brain|thunder|storm|drizzle/.test(t)) bump('rain', weight);
  if (/\bfire|camp|hearth|ember|crackl|fireplace/.test(t)) bump('fire', weight);
  if (/\bforest|jungle|tree|leaves|bird|owl|insect|cicada|cricket|frog|amazon|bamboo|meadow|grass/.test(t))
    bump('forest', weight);
  if (
    /\bocean|sea|shore|wave|surf|beach|seagull|underwater|lake|stream|waterfall|water|harbor|harbour|dock|fountain|river|creek/.test(
      t,
    )
  )
    bump('ocean', weight);
  if (/\bnight|cricket|owl|moon|dark/.test(t)) bump('night', weight * 0.85);
  // Indoor beds (cafe/library/temple/hvac) → calm night mood, not forest
  if (
    /\bcafe|library|indoor|murmur|restaurant|study|room-tone|hvac|cathedral|church|temple|ac_room|air.conditioner/.test(
      t,
    )
  )
    bump('night', weight * 1.1);
  // Soft urban / park / distant traffic → train (city) mood
  if (/\bcity|urban|traffic|neighbourhood|neighborhood|park_city|plaza/.test(t))
    bump('train', weight * 0.95);
  if (/\btrain|bus|jet|airliner|transport|engine|rail|metro|subway/.test(t)) bump('train', weight);
  if (/\bcave|drip|underwater/.test(t)) bump('cave', weight * 0.9);
  if (/\bwind|desert|winter|snow/.test(t)) bump('forest', weight * 0.4);
}

/**
 * Infer mood from unmuted layers (weighted by volume).
 * Muted / solo-gated layers contribute less.
 */
export function detectMood(
  layers: MixerLayer[],
  catalog: SoundCatalog | null = null,
): MoodId {
  if (layers.length === 0) return 'default';

  const anySolo = layers.some((l) => l.params.solo);
  scoreReset();

  for (const layer of layers) {
    if (layer.params.muted) continue;
    if (anySolo && !layer.params.solo) continue;

    const vol = Math.max(0.15, layer.params.volumeLinear);
    if (layer.kind === 'noise') {
      switch (layer.params.type) {
        case 'rain':
          bump('rain', vol * 2);
          break;
        case 'fan':
          bump('train', vol * 0.8);
          break;
        case 'brown':
        case 'pink':
          bump('night', vol * 0.5);
          break;
        case 'static':
          bump('train', vol * 0.4);
          break;
        default:
          bump('night', vol * 0.3);
      }
      continue;
    }

    if (layer.kind === 'youtube') {
      scoreText(layer.params.label, vol * 1.4);
      continue;
    }

    if (layer.kind === 'playlist') {
      scoreText(layer.params.playlistName, vol * 1.4);
      if (layer.params.currentTrackTitle) {
        scoreText(layer.params.currentTrackTitle, vol * 1.2);
      }
      continue;
    }

    const asset = catalog ? findAsset(catalog, layer.params.assetId) : undefined;
    scoreText(layer.params.label, vol * 1.4);
    scoreText(layer.params.assetId, vol * 1.2);
    if (asset) {
      scoreText(asset.category, vol * 1.6);
      if (asset.tags) {
        for (const tag of asset.tags) scoreText(tag, vol * 0.9);
      }
    }
  }

  let best: MoodId = 'default';
  let bestScore = 0.35; // threshold — below this stay default
  for (const [mood, score] of Object.entries(MOOD_SCORES) as [
    Exclude<MoodId, 'default'>,
    number,
  ][]) {
    if (score > bestScore) {
      bestScore = score;
      best = mood;
    }
  }
  return best;
}

/** Apply mood to documentElement for CSS `[data-mood="…"]` rules. */
export function applyMoodTheme(mood: MoodId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const current = root.getAttribute('data-mood') ?? 'default';
  if (current === mood) return;
  if (mood === 'default') {
    root.removeAttribute('data-mood');
  } else {
    root.setAttribute('data-mood', mood);
  }
}

export function syncMoodFromLayers(
  layers: MixerLayer[],
  catalog: SoundCatalog | null = null,
): MoodId {
  const mood = detectMood(layers, catalog);
  applyMoodTheme(mood);
  return mood;
}
