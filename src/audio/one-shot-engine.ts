import type { OneShotConfig, OneShotDensity } from '../app/one-shot';
import { ONE_SHOT_PACKS } from '../app/one-shot';
import { decodeCache } from './decode-cache';
import { assetUrl, findAsset, type SoundCatalog } from '../assets/catalog';

export interface OneShotTriggerEvent {
  packId: string;
  packLabel: string;
  assetId: string;
  assetLabel: string;
  timestamp: number;
}

export interface OneShotDelayRange {
  meanMs: number;
  minMs: number;
  maxMs: number;
}

export const DENSITY_RANGES: Record<OneShotDensity, OneShotDelayRange> = {
  subtle: { meanMs: 180_000, minMs: 90_000, maxMs: 300_000 },   // 1.5m - 5m
  balanced: { meanMs: 75_000, minMs: 35_000, maxMs: 120_000 },  // 35s - 2m
  lively: { meanMs: 25_000, minMs: 10_000, maxMs: 45_000 },     // 10s - 45s
};

/**
 * Calculates stochastic delay based on Poisson exponential distribution.
 */
export function calculateNextDelayMs(density: OneShotDensity): number {
  const range = DENSITY_RANGES[density] ?? DENSITY_RANGES.balanced;
  const u = Math.random();
  // Exponential distribution formula: -ln(1 - u) * mean
  const raw = -Math.log(Math.max(0.0001, 1 - u)) * range.meanMs;
  return Math.round(Math.max(range.minMs, Math.min(range.maxMs, raw)));
}

export class OneShotEngine {
  private ctx: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private catalog: SoundCatalog | null = null;
  private config: OneShotConfig;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTriggerEvent: OneShotTriggerEvent | null = null;
  private listeners = new Set<(event: OneShotTriggerEvent) => void>();

  constructor(config: OneShotConfig) {
    this.config = { ...config };
  }

  setConfig(config: OneShotConfig): void {
    const wasEnabled = this.config.enabled;
    const oldDensity = this.config.density;
    this.config = { ...config };

    if (!this.config.enabled) {
      this.stop();
    } else if (this.running) {
      if (!wasEnabled || oldDensity !== this.config.density) {
        this.reschedule();
      }
    }
  }

  getConfig(): OneShotConfig {
    return { ...this.config };
  }

  setAudioTarget(ctx: AudioContext, destination: AudioNode, catalog: SoundCatalog | null): void {
    this.ctx = ctx;
    this.destination = destination;
    this.catalog = catalog;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.config.enabled) {
      this.reschedule();
    }
  }

  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  addListener(fn: (event: OneShotTriggerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getLastTriggerEvent(): OneShotTriggerEvent | null {
    return this.lastTriggerEvent;
  }

  private reschedule(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (!this.running || !this.config.enabled) return;

    const delayMs = calculateNextDelayMs(this.config.density);
    this.timerId = setTimeout(() => {
      this.timerId = null;
      void this.triggerRandomEvent().finally(() => {
        if (this.running && this.config.enabled) {
          this.reschedule();
        }
      });
    }, delayMs);
  }

  /**
   * Immediately trigger a one-shot audio event (useful for UI testing and manual triggering).
   */
  async triggerRandomEvent(): Promise<OneShotTriggerEvent | null> {
    if (!this.ctx || !this.destination || !this.catalog) {
      return null;
    }
    if (this.config.selectedPacks.length === 0) {
      return null;
    }

    // Pick random enabled pack
    const activePacks = ONE_SHOT_PACKS.filter(p => this.config.selectedPacks.includes(p.id));
    if (activePacks.length === 0) return null;
    const pack = activePacks[Math.floor(Math.random() * activePacks.length)];

    // Pick random asset from pack
    const assetId = pack.assetIds[Math.floor(Math.random() * pack.assetIds.length)];
    const asset = findAsset(this.catalog, assetId);
    if (!asset) return null;

    try {
      const url = assetUrl(asset.file);
      const buffer = await decodeCache.get(this.ctx, url);
      if (!buffer) return null;

      this.playOneShotBuffer(buffer);

      const triggerEvent: OneShotTriggerEvent = {
        packId: pack.id,
        packLabel: pack.label,
        assetId: asset.id,
        assetLabel: asset.title,
        timestamp: Date.now(),
      };

      this.lastTriggerEvent = triggerEvent;
      this.notifyListeners(triggerEvent);
      return triggerEvent;
    } catch (e) {
      console.warn('Failed to play one-shot audio event:', e);
      return null;
    }
  }

  private playOneShotBuffer(buffer: AudioBuffer): void {
    if (!this.ctx || !this.destination) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // 1. Micro Pitch Jitter (±5% .. 10%)
    if (this.config.pitchJitter) {
      const jitter = (Math.random() * 0.16) - 0.08;
      source.playbackRate.value = Math.max(0.5, Math.min(1.5, 1 + jitter));
    }

    let lastNode: AudioNode = source;

    // 2. Distance Atmospheric Low-pass Filter
    if (this.config.distanceFilter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200 + Math.random() * 12800; // 1.2kHz - 14kHz
      filter.Q.value = 0.7;
      source.connect(filter);
      lastNode = filter;
    }

    // 3. Spatial Stereo Panning (-0.85 .. +0.85)
    if (this.config.spatialPan && 'createStereoPanner' in ctx) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = (Math.random() * 1.7) - 0.85;
      lastNode.connect(panner);
      lastNode = panner;
    }

    // 4. Gain Node & Dynamic Distance Volume Attenuation
    const gainNode = ctx.createGain();
    const distanceGain = 0.45 + Math.random() * 0.55;
    const targetGain = Math.max(0, Math.min(1, this.config.volumeLinear * distanceGain));

    lastNode.connect(gainNode);
    gainNode.connect(this.destination);

    // Dynamic Slicing & Envelope
    const totalDuration = buffer.duration;
    let startOffset = 0;
    let playDuration = totalDuration;

    if (totalDuration > 8) {
      // Pick an organic 2.5s - 5.5s slice from the asset
      playDuration = 2.5 + Math.random() * 3.0;
      const maxOffset = Math.max(0, totalDuration - playDuration - 0.5);
      startOffset = Math.random() * maxOffset;
    }

    const fadeIn = 0.08;
    const fadeOut = Math.min(0.5, playDuration * 0.25);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, targetGain), now + fadeIn);
    gainNode.gain.setValueAtTime(Math.max(0.001, targetGain), now + playDuration - fadeOut);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + playDuration);

    source.start(now, startOffset, playDuration);
    source.stop(now + playDuration + 0.1);
  }

  private notifyListeners(event: OneShotTriggerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error in one-shot listener:', e);
      }
    }
  }
}
