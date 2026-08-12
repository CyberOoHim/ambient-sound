import type { OneShotConfig, OneShotDensity, CustomOneShotPack } from '../app/one-shot';
import { ONE_SHOT_PACKS, getAllOneShotPacks } from '../app/one-shot';
import { decodeCache } from './decode-cache';
import { assetUrl, findAsset, type SoundCatalog } from '../assets/catalog';

export interface OneShotTriggerEvent {
  packId: string;
  packLabel: string;
  assetId: string;
  assetLabel: string;
  timestamp: number;
  pan: number;
  pitch: number;
  distanceFilterCutoff: number;
  burstCount: number;
}

export interface OneShotDelayRange {
  meanMs: number;
  minMs: number;
  maxMs: number;
}

export const DENSITY_RANGES: Record<Exclude<OneShotDensity, 'custom'>, OneShotDelayRange> = {
  subtle: { meanMs: 180_000, minMs: 90_000, maxMs: 300_000 },   // 1.5m - 5m
  balanced: { meanMs: 75_000, minMs: 35_000, maxMs: 120_000 },  // 35s - 2m
  lively: { meanMs: 25_000, minMs: 10_000, maxMs: 45_000 },     // 10s - 45s
};

/**
 * Calculates stochastic delay based on Poisson exponential distribution.
 */
export function calculateNextDelayMs(density: OneShotDensity, customIntervalMs = 60_000): number {
  if (density === 'custom') {
    const mean = Math.max(5_000, Math.min(600_000, customIntervalMs));
    const u = Math.random();
    const raw = -Math.log(Math.max(0.0001, 1 - u)) * mean;
    return Math.round(Math.max(mean * 0.4, Math.min(mean * 2.2, raw)));
  }

  const range = DENSITY_RANGES[density] ?? DENSITY_RANGES.balanced;
  const u = Math.random();
  // Exponential distribution formula: -ln(1 - u) * mean
  const raw = -Math.log(Math.max(0.0001, 1 - u)) * range.meanMs;
  return Math.round(Math.max(range.minMs, Math.min(range.maxMs, raw)));
}

let cachedReverbImpulse: AudioBuffer | null = null;

function getOrCreateReverbImpulse(ctx: AudioContext): AudioBuffer {
  if (cachedReverbImpulse && cachedReverbImpulse.sampleRate === ctx.sampleRate) {
    return cachedReverbImpulse;
  }
  const durationSec = 1.5;
  const decay = 2.8;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  cachedReverbImpulse = buffer;
  return buffer;
}

export class OneShotEngine {
  private ctx: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private catalog: SoundCatalog | null = null;
  private config: OneShotConfig;
  private customPacks: CustomOneShotPack[] = [];
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTriggerEvent: OneShotTriggerEvent | null = null;
  private eventHistory: OneShotTriggerEvent[] = [];
  private listeners = new Set<(event: OneShotTriggerEvent) => void>();
  private activeEventsCount = 0;
  private sharedConvolver: ConvolverNode | null = null;
  private sharedWetGain: GainNode | null = null;

  constructor(config: OneShotConfig) {
    this.config = { ...config };
  }

  setConfig(config: OneShotConfig): void {
    const wasEnabled = this.config.enabled;
    const oldDensity = this.config.density;
    const oldCustomInterval = this.config.customIntervalMs;
    this.config = { ...config };

    if (!this.config.enabled) {
      this.stop();
    } else if (this.running) {
      if (!wasEnabled || oldDensity !== this.config.density || oldCustomInterval !== this.config.customIntervalMs) {
        this.reschedule();
      }
    }
  }

  setCustomPacks(customPacks: CustomOneShotPack[]): void {
    this.customPacks = [...customPacks];
  }

  getConfig(): OneShotConfig {
    return { ...this.config };
  }

  setAudioTarget(ctx: AudioContext, destination: AudioNode, catalog: SoundCatalog | null): void {
    if (this.ctx !== ctx) {
      this.sharedConvolver = null;
      this.sharedWetGain = null;
    }
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

  getEventHistory(): OneShotTriggerEvent[] {
    return [...this.eventHistory];
  }

  private reschedule(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (!this.running || !this.config.enabled) return;

    const delayMs = calculateNextDelayMs(this.config.density, this.config.customIntervalMs);
    this.timerId = setTimeout(() => {
      this.timerId = null;
      void this.triggerRandomEvent().finally(() => {
        if (this.running && this.config.enabled) {
          this.reschedule();
        }
      });
    }, delayMs);
  }

  private getOrCreateSharedReverb(ctx: AudioContext, destination: AudioNode): { convolver: ConvolverNode; wetGain: GainNode } | null {
    if (this.sharedConvolver && this.sharedWetGain && this.sharedConvolver.context === ctx) {
      return { convolver: this.sharedConvolver, wetGain: this.sharedWetGain };
    }
    if (typeof ctx.createConvolver !== 'function') return null;
    try {
      this.sharedConvolver = ctx.createConvolver();
      this.sharedConvolver.buffer = getOrCreateReverbImpulse(ctx);
      this.sharedWetGain = ctx.createGain();
      this.sharedWetGain.gain.value = 0.22;
      this.sharedConvolver.connect(this.sharedWetGain);
      this.sharedWetGain.connect(destination);
      return { convolver: this.sharedConvolver, wetGain: this.sharedWetGain };
    } catch (e) {
      console.warn('Failed to setup shared convolver:', e);
      return null;
    }
  }

  /**
   * Immediately trigger a one-shot audio event (useful for UI testing and manual triggering).
   */
  async triggerRandomEvent(specificAssetId?: string): Promise<OneShotTriggerEvent | null> {
    if (!this.ctx || !this.destination || !this.catalog) {
      return null;
    }
    if (this.config.selectedPacks.length === 0) {
      return null;
    }

    // Handset / Tablet Mobile Safeguard: throttle rapid stochastic triggers when 4 events are active
    if (!specificAssetId && this.activeEventsCount >= 4) {
      return null;
    }

    const allPacks = getAllOneShotPacks(this.customPacks);
    let pack = allPacks.find(p => this.config.selectedPacks.includes(p.id));
    let assetId = specificAssetId;

    if (assetId) {
      // Find matching pack for specific asset
      const foundPack = allPacks.find(p => p.assetIds.includes(assetId!));
      if (foundPack) pack = foundPack;
    } else {
      // Pick random active pack
      const activePacks = allPacks.filter(p => this.config.selectedPacks.includes(p.id));
      if (activePacks.length === 0) return null;
      pack = activePacks[Math.floor(Math.random() * activePacks.length)];
      if (!pack) return null;

      // Filter assets by selectedAssets if configured
      const candidateAssetIds = pack.assetIds.filter(id =>
        !this.config.selectedAssets || this.config.selectedAssets.includes(id)
      );

      const availableAssets = candidateAssetIds.length > 0 ? candidateAssetIds : pack.assetIds;
      assetId = availableAssets[Math.floor(Math.random() * availableAssets.length)];
    }

    if (!pack || !assetId) return null;

    const asset = findAsset(this.catalog, assetId);
    if (!asset) return null;

    try {
      const url = assetUrl(asset.file);
      const buffer = await decodeCache.get(this.ctx, url);
      if (!buffer) return null;

      // Skip triggering if engine was stopped while loading in non-preview mode
      if (!specificAssetId && (!this.running || !this.config.enabled)) {
        return null;
      }

      const meta = this.playOneShotBuffer(buffer, asset.id, asset.oneShot);

      const triggerEvent: OneShotTriggerEvent = {
        packId: pack.id,
        packLabel: pack.label,
        assetId: asset.id,
        assetLabel: asset.title,
        timestamp: Date.now(),
        pan: meta.pan,
        pitch: meta.pitch,
        distanceFilterCutoff: meta.filterCutoff,
        burstCount: meta.burstCount,
      };

      this.lastTriggerEvent = triggerEvent;
      this.eventHistory = [triggerEvent, ...this.eventHistory].slice(0, 10);
      this.notifyListeners(triggerEvent);
      return triggerEvent;
    } catch (e) {
      console.warn('Failed to play one-shot audio event:', e);
      return null;
    }
  }

  private playOneShotBuffer(
    buffer: AudioBuffer,
    assetId: string,
    oneShotMeta?: {
      eventDurationSec?: number;
      preferOffsetSec?: number;
      playFull?: boolean;
    },
  ): { pan: number; pitch: number; filterCutoff: number; burstCount: number } {
    if (!this.ctx || !this.destination) {
      return { pan: 0, pitch: 1, filterCutoff: 14000, burstCount: 1 };
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.activeEventsCount++;

    // Calculate acoustic micro-variations
    let pitch = 1.0;
    if (this.config.pitchJitter) {
      pitch = 1.0 + (Math.random() * 0.16 - 0.08);
    }

    let panStart = 0;
    let panEnd = 0;
    if (this.config.spatialPan) {
      panStart = (Math.random() * 1.6) - 0.8;
      const panTravel = (Math.random() * 0.5 + 0.25) * (Math.random() > 0.5 ? 1 : -1);
      panEnd = Math.max(-1, Math.min(1, panStart + panTravel));
    }
    const pan = (panStart + panEnd) / 2;

    // Unified Physical Distance Model (Natural Realism Physics & DSP)
    // Distance d in [0, 1]: 0 = near field, 1 = distant.
    // Near field: loud (gain ~ 1.0), crisp high frequency bandwidth (cutoff ~ 14,000 Hz)
    // Far field: quiet (gain ~ 0.45), air-absorbed low-pass cutoff (cutoff ~ 1,200 Hz)
    const distanceFactor = Math.random();

    let distanceGain = 1.0;
    let filterCutoff = 14000;

    if (this.config.distanceFilter) {
      filterCutoff = Math.round(14000 * Math.pow(1200 / 14000, distanceFactor));
      distanceGain = 1.0 - distanceFactor * 0.55;
    } else {
      distanceGain = 0.45 + Math.random() * 0.55;
    }

    // Determine Burst Sequence parameters
    const isEventClip = assetId.startsWith('event_');
    const isBirdOrAnimal =
      assetId.startsWith('birds') ||
      assetId.startsWith('owls') ||
      assetId.startsWith('seagulls') ||
      assetId.startsWith('cave_drips') ||
      assetId.includes('bird') ||
      assetId.includes('owl');
    const isThunder = assetId.startsWith('thunder') || assetId.includes('thunder');

    let burstCount = 1;
    if (!isEventClip && this.config.burstSequence && isBirdOrAnimal) {
      burstCount = Math.floor(Math.random() * 3) + 2; // 2 to 4 bursts
    } else if (!isEventClip && this.config.burstSequence && isThunder) {
      burstCount = 2; // Initial crack + rolling echo
    }

    // Master Gain Node for this event
    const gainNode = ctx.createGain();
    const targetGain = Math.max(0, Math.min(1, this.config.volumeLinear * distanceGain));

    const destination = this.destination;

    // Zero-allocation Shared Acoustic Reverb Send Bus
    if (this.config.acousticTail) {
      const sharedReverb = this.getOrCreateSharedReverb(ctx, destination);
      if (sharedReverb) {
        gainNode.connect(sharedReverb.convolver);
      }
    }

    // Haas Early Reflection Delay Node for Distant Acoustic Events (d > 0.55)
    let earlyDelayNode: DelayNode | null = null;
    let earlyDelayGain: GainNode | null = null;
    if (this.config.earlyReflections && distanceFactor > 0.55 && typeof ctx.createDelay === 'function') {
      try {
        earlyDelayNode = ctx.createDelay(0.05);
        earlyDelayNode.delayTime.value = 0.022; // 22ms boundary reflection
        earlyDelayGain = ctx.createGain();
        earlyDelayGain.gain.value = targetGain * 0.25;
        gainNode.connect(earlyDelayNode);
        earlyDelayNode.connect(earlyDelayGain);
        earlyDelayGain.connect(destination);
      } catch {
        // Fallback gracefully
      }
    }

    gainNode.connect(destination);

    // Atmospheric Sidechain Ambient Ducking for Heavy Transient Events
    if (targetGain > 0.65 && (isThunder || assetId.includes('splash') || assetId.includes('crack'))) {
      if (destination && 'gain' in destination) {
        const destGainNode = (destination as GainNode).gain;
        try {
          const duckTime = now;
          const currentVal = destGainNode.value;
          destGainNode.cancelScheduledValues(duckTime);
          destGainNode.setValueAtTime(currentVal, duckTime);
          destGainNode.linearRampToValueAtTime(currentVal * 0.82, duckTime + 0.04);
          destGainNode.linearRampToValueAtTime(currentVal, duckTime + 0.35);
        } catch {
          // Ignore if audio param is not schedulable
        }
      }
    }

    const totalDuration = buffer.duration;
    const playFull =
      oneShotMeta?.playFull === true ||
      isEventClip ||
      totalDuration <= 6;

    let baseStartOffset = 0;
    let maxEventEndTime = now;

    // Play bursts
    for (let i = 0; i < burstCount; i++) {
      const burstDelay = i === 0 ? 0 : isThunder ? 0.42 + i * 0.15 : i * (0.24 + Math.random() * 0.22);
      const burstNow = now + burstDelay;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      let burstLastNode: AudioNode = source;

      if (this.config.distanceFilter) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = isThunder && i > 0 ? 450 : filterCutoff; // lower rumbling tail for thunder
        filter.Q.value = 0.7;
        source.connect(filter);
        burstLastNode = filter;
      }

      if (this.config.spatialPan && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(panStart, burstNow);
        if (panStart !== panEnd) {
          panner.pan.linearRampToValueAtTime(panEnd, burstNow + 1.2);
        }
        burstLastNode.connect(panner);
        burstLastNode = panner;
      }

      // Acoustic Doppler Motion Pitch Shift (sound-speed shift as source travels across soundstage)
      const basePitch = pitch + (i > 0 ? (Math.random() * 0.08 - 0.04) : 0);
      let dopplerPitchStart = basePitch;
      let dopplerPitchEnd = basePitch;
      if (this.config.dopplerShift && this.config.spatialPan) {
        const panDelta = panEnd - panStart;
        const dopplerVel = Math.max(-0.8, Math.min(0.8, panDelta));
        dopplerPitchStart = Math.max(0.5, Math.min(1.6, basePitch * (1.0 + dopplerVel * 0.04)));
        dopplerPitchEnd = Math.max(0.5, Math.min(1.6, basePitch * (1.0 - dopplerVel * 0.04)));
      }

      source.playbackRate.setValueAtTime(dopplerPitchStart, burstNow);
      if (dopplerPitchStart !== dopplerPitchEnd) {
        source.playbackRate.linearRampToValueAtTime(dopplerPitchEnd, burstNow + 1.2);
      }

      const burstGainNode = ctx.createGain();
      const burstGainVal = i === 0 ? targetGain : isThunder ? targetGain * 0.65 : targetGain * (0.75 + Math.random() * 0.2);

      burstLastNode.connect(burstGainNode);
      burstGainNode.connect(gainNode);

      let startOffset = 0;
      let playDuration = totalDuration;

      if (!playFull && totalDuration > 4) {
        const metaDur = oneShotMeta?.eventDurationSec;
        playDuration =
          typeof metaDur === 'number' && metaDur > 0
            ? Math.min(metaDur, totalDuration - 0.05)
            : 0.8 + Math.random() * 1.4;

        if (i === 0) {
          if (
            typeof oneShotMeta?.preferOffsetSec === 'number' &&
            oneShotMeta.preferOffsetSec >= 0
          ) {
            const maxOff = Math.max(0, totalDuration - playDuration - 0.05);
            startOffset = Math.min(oneShotMeta.preferOffsetSec, maxOff);
            startOffset = Math.max(0, startOffset + (Math.random() * 0.4 - 0.2));
            startOffset = Math.min(startOffset, maxOff);
          } else {
            const maxOffset = Math.max(0, totalDuration - playDuration - 0.05);
            startOffset = Math.random() * maxOffset;
          }
          baseStartOffset = startOffset;
        } else {
          const maxOff = Math.max(0, totalDuration - playDuration - 0.05);
          const jitter = (Math.random() * 0.3 - 0.15);
          startOffset = Math.max(0, Math.min(maxOff, baseStartOffset + jitter));
        }
      } else if (playFull) {
        startOffset = 0;
        playDuration = totalDuration;
      }

      const fadeIn = playFull ? 0.02 : 0.04;
      const fadeOut = Math.min(0.35, playDuration * 0.2);

      burstGainNode.gain.setValueAtTime(0.0001, burstNow);
      burstGainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, burstGainVal), burstNow + fadeIn);
      burstGainNode.gain.setValueAtTime(
        Math.max(0.001, burstGainVal),
        Math.max(burstNow + fadeIn, burstNow + playDuration - fadeOut),
      );
      burstGainNode.gain.exponentialRampToValueAtTime(0.0001, burstNow + playDuration);

      source.start(burstNow, startOffset, playDuration);
      source.stop(burstNow + playDuration + 0.1);

      const burstEndTime = burstNow + playDuration + 0.1;
      if (burstEndTime > maxEventEndTime) {
        maxEventEndTime = burstEndTime;
      }
    }

    // Schedule cleanup of event AudioNodes after playback + reverb tail (1.6s) to prevent memory & DSP graph leaks
    const cleanupDelayMs = Math.ceil((maxEventEndTime - now + 1.6) * 1000);
    setTimeout(() => {
      this.activeEventsCount = Math.max(0, this.activeEventsCount - 1);
      try {
        gainNode.disconnect();
        if (earlyDelayNode) earlyDelayNode.disconnect();
        if (earlyDelayGain) earlyDelayGain.disconnect();
      } catch {
        // Ignore if context closed or already disconnected
      }
    }, cleanupDelayMs);

    return { pan, pitch, filterCutoff, burstCount };
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

