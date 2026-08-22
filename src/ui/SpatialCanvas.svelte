<script lang="ts">
  /**
   * 2D spatial sound canvas (ENH-14).
   * X = pan (−1..1), Y = volume (top quiet / far, bottom loud / near).
   * Visualizes live real-time random pan wandering, applied gain/pitch readouts,
   * base anchors, and 2D wander bounds.
   */
  import { onDestroy, onMount } from 'svelte';
  import { session } from '../app/session';
  import type { LayerLiveDrift, MixerLayer } from '../audio/types';
  import {
    PAN_DRIFT_MAX_OFFSET,
    GAIN_DRIFT_MIN_MULT,
    GAIN_DRIFT_MAX_MULT,
  } from '../audio/dsp/drift';

  interface Props {
    layers: MixerLayer[];
    playing?: boolean;
    open?: boolean;
    onToggle?: () => void;
  }

  let { layers, playing = false, open = true, onToggle }: Props = $props();

  let coupleFilter = $state(true);
  let showDriftZones = $state(true);
  let draggingId: string | null = $state(null);
  let surface: HTMLDivElement | undefined = $state();
  let liveStates = $state<Record<string, LayerLiveDrift>>({});
  let liveRaf = 0;

  function labelFor(layer: MixerLayer): string {
    if (layer.kind === 'noise') {
      return layer.params.type.charAt(0).toUpperCase() + layer.params.type.slice(1);
    }
    if (layer.kind === 'youtube') {
      const t = layer.params.label || 'YouTube';
      return t.length > 14 ? `${t.slice(0, 12)}…` : t;
    }
    if (layer.kind === 'playlist') {
      const t = layer.params.currentTrackTitle || layer.params.playlistName || 'Playlist';
      return t.length > 14 ? `${t.slice(0, 12)}…` : t;
    }
    const t = layer.params.label;
    return t.length > 14 ? `${t.slice(0, 12)}…` : t;
  }

  function iconFor(layer: MixerLayer): string {
    if (layer.kind === 'noise') {
      switch (layer.params.type) {
        case 'rain':
          return '🌧';
        case 'pink':
        case 'brown':
          return '〰';
        case 'fan':
          return '🌀';
        case 'static':
          return '📺';
        default:
          return '◎';
      }
    }
    if (layer.kind === 'youtube') {
      return '▶';
    }
    if (layer.kind === 'playlist') {
      return '📑';
    }
    const id = layer.params.assetId.toLowerCase();
    if (id.includes('rain') || id.includes('thunder')) return '🌧';
    if (id.includes('fire')) return '🔥';
    if (id.includes('ocean') || id.includes('sea') || id.includes('wave')) return '🌊';
    if (id.includes('forest') || id.includes('bird') || id.includes('owl')) return '🌲';
    if (id.includes('train') || id.includes('bus')) return '🚂';
    if (id.includes('wind')) return '💨';
    if (id.startsWith('local:')) return '📁';
    return '◆';
  }

  /** pan -1..1 → left% 8..92 */
  function panToX(pan: number): number {
    return 8 + ((pan + 1) / 2) * 84;
  }

  /** volume 0..1 → top% 12..88 (top quiet / far, bottom loud / near) */
  function volToY(vol: number): number {
    const v = Math.max(0, Math.min(1, vol));
    return 12 + v * 76;
  }

  function xyToParams(clientX: number, clientY: number): { pan: number; vol: number } {
    const el = surface;
    if (!el) return { pan: 0, vol: 0.7 };
    const rect = el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const pan = nx * 2 - 1;
    const vol = ny; // top = 0 (far), bottom = 1 (near)
    return { pan, vol: Math.max(0.02, Math.min(1, vol)) };
  }

  function isYoutubeLayer(layer?: MixerLayer): boolean {
    if (!layer) return false;
    return (
      layer.kind === 'youtube' ||
      (layer.kind === 'playlist' && layer.params.currentTrackType === 'youtube')
    );
  }

  function supportsPitch(layer: MixerLayer): boolean {
    return (
      layer.kind === 'sample' ||
      (layer.kind === 'playlist' && layer.params.currentTrackType !== 'youtube')
    );
  }

  function supportsPan(layer: MixerLayer): boolean {
    return !isYoutubeLayer(layer);
  }

  function toggleDrift(id: string, type: 'pitch' | 'pan' | 'gain') {
    const layer = layers.find((l) => l.params.id === id);
    if (!layer) return;
    if (type === 'pitch') {
      session.updateLayerCommon(id, { driftPitch: !layer.params.driftPitch });
    } else if (type === 'pan') {
      session.updateLayerCommon(id, { driftPan: !layer.params.driftPan });
    } else if (type === 'gain') {
      session.updateLayerCommon(id, { driftGain: !layer.params.driftGain });
    }
  }

  interface DriftZoneInfo {
    hasAny: boolean;
    hasPan: boolean;
    hasGain: boolean;
    hasPitch: boolean;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
  }

  function getDriftZone(layer: MixerLayer): DriftZoneInfo {
    const isYt = isYoutubeLayer(layer);
    const hasPan = Boolean(layer.params.driftPan && !isYt);
    const hasGain = Boolean(layer.params.driftGain);
    const hasPitch = Boolean(layer.params.driftPitch && supportsPitch(layer));
    const hasAny = hasPan || hasGain || hasPitch;

    const basePan = isYt ? 0 : layer.params.pan;
    const baseVol = layer.params.volumeLinear;

    let x1 = panToX(basePan);
    let x2 = x1;
    if (hasPan) {
      const edgeFactor = 1 - Math.abs(basePan) * 0.6;
      const deltaPan = PAN_DRIFT_MAX_OFFSET * edgeFactor;
      const minPan = Math.max(-1, basePan - deltaPan);
      const maxPan = Math.min(1, basePan + deltaPan);
      x1 = panToX(minPan);
      x2 = panToX(maxPan);
    }

    let y1 = volToY(baseVol);
    let y2 = y1;
    if (hasGain) {
      const minGain = baseVol * GAIN_DRIFT_MIN_MULT;
      const maxGain = Math.min(1.0, baseVol * GAIN_DRIFT_MAX_MULT);
      y1 = volToY(minGain);
      y2 = volToY(maxGain);
    }

    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const width = Math.max(12, Math.abs(x2 - x1) + (hasPan ? 10 : 4));
    const height = Math.max(12, Math.abs(y2 - y1) + (hasGain ? 10 : 4));

    return {
      hasAny,
      hasPan,
      hasGain,
      hasPitch,
      centerX,
      centerY,
      width,
      height,
    };
  }

  function onPointerDown(e: PointerEvent, id: string) {
    e.preventDefault();
    draggingId = id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    applyAt(id, e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent) {
    if (!draggingId) return;
    applyAt(draggingId, e.clientX, e.clientY);
  }

  function onPointerUp(e: PointerEvent) {
    if (draggingId) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
    }
    draggingId = null;
  }

  function applyAt(id: string, clientX: number, clientY: number) {
    const layer = layers.find((l) => l.params.id === id);
    const { pan, vol } = xyToParams(clientX, clientY);
    const effectivePan = isYoutubeLayer(layer) ? 0 : pan;
    session.setLayerSpatial(id, effectivePan, vol, { coupleFilter });
  }

  function onKeyDown(e: KeyboardEvent, layer: MixerLayer) {
    let pan = layer.params.pan;
    let vol = layer.params.volumeLinear;
    let handled = false;
    const isYt = isYoutubeLayer(layer);

    if (e.key === 'ArrowLeft') {
      if (!isYt) {
        pan = Math.max(-1, pan - 0.1);
        handled = true;
      }
    } else if (e.key === 'ArrowRight') {
      if (!isYt) {
        pan = Math.min(1, pan + 0.1);
        handled = true;
      }
    } else if (e.key === 'ArrowUp') {
      vol = Math.max(0.02, vol - 0.1);
      handled = true;
    } else if (e.key === 'ArrowDown') {
      vol = Math.min(1, vol + 0.1);
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      session.setLayerSpatial(layer.params.id, isYt ? 0 : pan, vol, { coupleFilter });
    }
  }

  function updateLive() {
    if (
      !open ||
      typeof document === 'undefined' ||
      document.visibilityState === 'hidden'
    ) {
      liveRaf = 0;
      return;
    }
    const updated: Record<string, LayerLiveDrift> = {};
    for (const layer of layers) {
      const d = session.getLayerLiveDrift(layer.params.id);
      if (d) updated[layer.params.id] = d;
    }
    liveStates = updated;
    liveRaf = requestAnimationFrame(updateLive);
  }

  function ensureLiveLoop() {
    if (
      liveRaf === 0 &&
      open &&
      typeof document !== 'undefined' &&
      document.visibilityState !== 'hidden'
    ) {
      liveRaf = requestAnimationFrame(updateLive);
    }
  }

  function stopLiveLoop() {
    if (liveRaf !== 0) {
      cancelAnimationFrame(liveRaf);
      liveRaf = 0;
    }
  }

  $effect(() => {
    if (open && layers.length > 0) {
      ensureLiveLoop();
    } else {
      stopLiveLoop();
      liveStates = {};
    }
  });

  onMount(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        stopLiveLoop();
      } else if (open) {
        ensureLiveLoop();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    if (open) {
      ensureLiveLoop();
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stopLiveLoop();
    };
  });

  onDestroy(() => {
    stopLiveLoop();
  });
</script>

<section class="panel spatial" class:collapsed={!open}>
  <header
    class="panel-head"
    onclick={onToggle}
    role="button"
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle?.();
      }
    }}
    aria-expanded={open}
    aria-label={open ? 'Collapse Space deck' : 'Expand Space deck'}
  >
    <div class="head-left">
      <h2>Space</h2>
      <p class="hint">drag / arrows · L/R pan · up quiet</p>
    </div>
    <button
      type="button"
      class="expander-btn"
      onclick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      aria-expanded={open}
      aria-label={open ? 'Collapse Space deck' : 'Expand Space deck'}
    >
      <span class="expander-icon" class:collapsed={!open} aria-hidden="true">▾</span>
    </button>
  </header>

  {#if open}
    <div class="panel-body">
      <div class="canvas-toolbar">
        <label class="couple">
          <input type="checkbox" bind:checked={coupleFilter} />
          Distance filter
        </label>
        <label class="couple" title="Show random wander boundaries on the canvas">
          <input type="checkbox" bind:checked={showDriftZones} />
          Drift zones
        </label>
      </div>

      {#if layers.length === 0}
        <p class="empty">Add sounds to place them in space.</p>
      {:else}
        <div
          class="surface"
          bind:this={surface}
          role="application"
          aria-label="Spatial sound canvas. Horizontal is pan, vertical is volume."
        >
          <div class="axis x-left" aria-hidden="true">L</div>
          <div class="axis x-right" aria-hidden="true">R</div>
          <div class="axis y-top" aria-hidden="true">far</div>
          <div class="axis y-bot" aria-hidden="true">near</div>
          <div class="cross-h" aria-hidden="true"></div>
          <div class="cross-v" aria-hidden="true"></div>

          {#if showDriftZones}
            {#each layers as layer (layer.params.id + '-zone')}
              {@const zone = getDriftZone(layer)}
              {#if zone.hasAny && !layer.params.muted}
                <div
                  class="drift-zone"
                  class:has-pan={zone.hasPan}
                  class:has-gain={zone.hasGain}
                  class:has-pitch={zone.hasPitch}
                  style="left: {zone.centerX}%; top: {zone.centerY}%; width: {zone.width}%; height: {zone.height}%;"
                  aria-hidden="true"
                ></div>
              {/if}
            {/each}
          {/if}

          {#each layers as layer (layer.params.id)}
            {@const isYt = isYoutubeLayer(layer)}
            {@const live = liveStates[layer.params.id]}
            {@const isPlaying = playing || session.playing}
            {@const isDrifting = isPlaying && draggingId !== layer.params.id}
            {@const currentPan = isDrifting ? (live?.livePan ?? (isYt ? 0 : layer.params.pan)) : (isYt ? 0 : layer.params.pan)}
            {@const currentVol = isDrifting ? (live?.liveVol ?? layer.params.volumeLinear) : layer.params.volumeLinear}
            {@const panDelta = isDrifting ? (live?.panDelta ?? 0) : 0}
            {@const gainDelta = isDrifting ? (live?.gainDbDelta ?? 0) : 0}
            {@const pitchDelta = isDrifting ? (live?.pitchPercentDelta ?? 0) : 0}
            {@const hasOffset = Math.abs(panDelta) >= 0.02 || Math.abs(gainDelta) >= 0.2}

            <!-- Base anchor marker when sound is drifting away from set point -->
            {#if isDrifting && hasOffset && !layer.params.muted}
              <div
                class="base-anchor"
                style="left: {panToX(isYt ? 0 : layer.params.pan)}%; top: {volToY(layer.params.volumeLinear)}%;"
                title={`Set anchor: pan ${layer.params.pan.toFixed(2)}, vol ${Math.round(layer.params.volumeLinear * 100)}%`}
                aria-hidden="true"
              >
                <div class="anchor-dot"></div>
              </div>
            {/if}

            <div
              class="marker"
              class:muted={layer.params.muted}
              class:dragging={draggingId === layer.params.id}
              class:vertical-only={isYt}
              class:drifting={isDrifting && (layer.params.driftPan || layer.params.driftGain)}
              style="left: {panToX(currentPan)}%; top: {volToY(currentVol)}%"
              tabindex="0"
              role="button"
              title={isYt
                ? `${labelFor(layer)} · volume ${Math.round(currentVol * 100)}% (${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB) · vertical move only`
                : `${labelFor(layer)} · pan ${currentPan.toFixed(2)} (${panDelta >= 0 ? '+' : ''}${panDelta.toFixed(2)}) · vol ${Math.round(currentVol * 100)}% (${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB) · pitch ${pitchDelta >= 0 ? '+' : ''}${pitchDelta.toFixed(1)}%`}
              aria-label={isYt
                ? `${labelFor(layer)}, volume ${Math.round(currentVol * 100)}%, gain applied ${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB`
                : `${labelFor(layer)}, pan ${currentPan.toFixed(2)}, volume ${Math.round(currentVol * 100)}%, pitch applied ${pitchDelta >= 0 ? '+' : ''}${pitchDelta.toFixed(1)}%, gain applied ${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB`}
              onpointerdown={(e) => onPointerDown(e, layer.params.id)}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
              onpointercancel={onPointerUp}
              onkeydown={(e) => onKeyDown(e, layer)}
            >
              <div class="marker-head">
                <span class="ico" aria-hidden="true">{iconFor(layer)}</span>
                <span class="lab">{labelFor(layer)}</span>
              </div>

              <div class="drift-chips" role="group" aria-label="Random variation status and live deltas">
                {#if supportsPan(layer)}
                  <button
                    type="button"
                    class="drift-chip"
                    class:on={layer.params.driftPan}
                    title={layer.params.driftPan
                      ? `Pan drift: applied Δ ${panDelta >= 0 ? '+' : ''}${panDelta.toFixed(2)} (click to disable)`
                      : 'Enable stereo pan drift (±0.25 wandering)'}
                    aria-label="Toggle pan drift"
                    aria-pressed={layer.params.driftPan}
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={(e) => {
                      e.stopPropagation();
                      toggleDrift(layer.params.id, 'pan');
                    }}
                  >
                    {#if layer.params.driftPan}
                      ↔ {panDelta >= 0 ? '+' : ''}{panDelta.toFixed(2)}
                    {:else}
                      ↔ off
                    {/if}
                  </button>
                {/if}

                <button
                  type="button"
                  class="drift-chip"
                  class:on={layer.params.driftGain}
                  title={layer.params.driftGain
                    ? `Gain drift: applied Δ ${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB (click to disable)`
                    : 'Enable volume gain drift (volume breathing)'}
                  aria-label="Toggle gain drift"
                  aria-pressed={layer.params.driftGain}
                  onpointerdown={(e) => e.stopPropagation()}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleDrift(layer.params.id, 'gain');
                  }}
                >
                  {#if layer.params.driftGain}
                    🔊 {gainDelta >= 0 ? '+' : ''}{gainDelta.toFixed(1)}dB
                  {:else}
                    🔊 off
                  {/if}
                </button>

                {#if supportsPitch(layer)}
                  <button
                    type="button"
                    class="drift-chip"
                    class:on={layer.params.driftPitch}
                    title={layer.params.driftPitch
                      ? `Pitch drift: applied Δ ${pitchDelta >= 0 ? '+' : ''}${pitchDelta.toFixed(1)}% (click to disable)`
                      : 'Enable pitch drift (±3.5% random micro-pitch variation)'}
                    aria-label="Toggle pitch drift"
                    aria-pressed={layer.params.driftPitch}
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={(e) => {
                      e.stopPropagation();
                      toggleDrift(layer.params.id, 'pitch');
                    }}
                  >
                    {#if layer.params.driftPitch}
                      🎵 {pitchDelta >= 0 ? '+' : ''}{pitchDelta.toFixed(1)}%
                    {:else}
                      🎵 off
                    {/if}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.65rem 0.75rem 0.75rem;
    box-shadow: var(--shadow-card);
  }

  .panel.collapsed {
    padding-bottom: 0.65rem;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    cursor: pointer;
    user-select: none;
  }

  .panel:not(.collapsed) .panel-head {
    margin-bottom: 0.4rem;
  }

  .head-left {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    flex-wrap: wrap;
  }

  .expander-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: transparent;
    color: var(--muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
    font-size: 0.85rem;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .expander-btn:hover {
    color: var(--accent);
    background: var(--card-soft);
  }

  .expander-icon {
    display: inline-block;
    transition: transform 0.2s ease;
    line-height: 1;
  }

  .expander-icon.collapsed {
    transform: rotate(-90deg);
  }

  h2 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .hint {
    margin: 0;
    font-size: 0.68rem;
    color: var(--muted-soft);
  }

  .canvas-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.45rem;
  }

  .couple {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    color: var(--text-soft);
    cursor: pointer;
    user-select: none;
  }

  .couple input {
    accent-color: var(--accent);
  }

  .empty {
    margin: 0.35rem 0;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .surface {
    position: relative;
    height: 14rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background:
      radial-gradient(ellipse 80% 70% at 50% 50%, var(--accent-glow) 0%, transparent 65%),
      var(--bg);
    touch-action: none;
    overflow: hidden;
  }

  .axis {
    position: absolute;
    font-size: 0.62rem;
    font-weight: 650;
    color: var(--muted-soft);
    pointer-events: none;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .x-left {
    left: 0.4rem;
    top: 50%;
    transform: translateY(-50%);
  }

  .x-right {
    right: 0.4rem;
    top: 50%;
    transform: translateY(-50%);
  }

  .y-top {
    top: 0.3rem;
    left: 50%;
    transform: translateX(-50%);
  }

  .y-bot {
    bottom: 0.3rem;
    left: 50%;
    transform: translateX(-50%);
  }

  .cross-h,
  .cross-v {
    position: absolute;
    pointer-events: none;
    background: color-mix(in srgb, var(--border) 70%, transparent);
  }

  .cross-h {
    left: 8%;
    right: 8%;
    top: 50%;
    height: 1px;
  }

  .cross-v {
    top: 12%;
    bottom: 12%;
    left: 50%;
    width: 1px;
  }

  .base-anchor {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 1;
  }

  .anchor-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--muted) 40%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    box-shadow: 0 0 4px var(--accent-glow);
  }

  .drift-zone {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: var(--radius);
    border: 1px dashed color-mix(in srgb, var(--accent) 30%, transparent);
    background: radial-gradient(
      ellipse at center,
      color-mix(in srgb, var(--accent) 10%, transparent) 0%,
      transparent 72%
    );
    pointer-events: none;
    z-index: 1;
    transition: width 0.2s ease, height 0.2s ease, left 0.1s linear, top 0.1s linear;
  }

  .drift-zone.has-pitch {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }

  .marker {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.3rem 0.45rem 0.28rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    background: color-mix(in srgb, var(--card) 92%, var(--accent-dim));
    color: var(--text);
    font: inherit;
    cursor: grab;
    box-shadow: var(--shadow-soft);
    min-width: 5.2rem;
    max-width: 13rem;
    z-index: 2;
    touch-action: none;
    user-select: none;
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }

  .marker-head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 100%;
  }

  .marker:hover,
  .marker.dragging {
    border-color: var(--accent);
    background: var(--accent-dim);
    z-index: 3;
  }

  .marker.vertical-only,
  .marker.vertical-only:hover,
  .marker.vertical-only.dragging {
    cursor: ns-resize;
  }

  .marker.dragging {
    cursor: grabbing;
    box-shadow: 0 0 0 2px var(--accent-glow), var(--shadow-soft);
  }

  .marker.muted {
    opacity: 0.45;
  }

  .ico {
    font-size: 0.88rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .lab {
    font-size: 0.6rem;
    font-weight: 650;
    color: var(--text-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 6.5rem;
  }

  .drift-chips {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    flex-wrap: nowrap;
  }

  .drift-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.12rem;
    padding: 0.09rem 0.26rem;
    font-size: 0.54rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 550;
    line-height: 1.15;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--muted-soft);
    cursor: pointer;
    user-select: none;
    touch-action: manipulation;
    white-space: nowrap;
    transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  }

  .drift-chip:hover {
    color: var(--text);
    border-color: var(--accent);
    transform: scale(1.04);
  }

  .drift-chip.on {
    background: color-mix(in srgb, var(--accent) 26%, var(--card));
    border-color: var(--accent);
    color: var(--text);
    box-shadow: 0 0 4px var(--accent-glow);
    font-weight: 600;
  }
</style>
