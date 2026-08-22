<script lang="ts">
  /**
   * 2D spatial sound canvas (ENH-14).
   * X = pan (−1..1), Y = volume (top quiet / far, bottom loud / near).
   * Displays target placements, bounded drift areas, and rolling history telemetry.
   */
  import { onDestroy, onMount } from 'svelte';
  import { session } from '../app/session';
  import type { MixerLayer } from '../audio/types';
  import {
    PAN_DRIFT_MAX_OFFSET,
    GAIN_DRIFT_MIN_MULT,
    GAIN_DRIFT_MAX_MULT,
  } from '../audio/dsp/drift';

  const MAX_HISTORY_DEPTH = 20;

  export interface LayerDriftMetric {
    id: string;
    label: string;
    icon: string;
    isYoutube: boolean;
    supportsPitch: boolean;
    panDelta: number;
    gainDbDelta: number;
    pitchPercentDelta: number;
    targetPan: number;
    targetVol: number;
    targetRate: number;
  }

  export interface DriftHistoryEntry {
    id: string;
    timestamp: string;
    layers: LayerDriftMetric[];
  }

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
  let dragCoords = $state<{ pan: number; vol: number } | null>(null);
  let surface: HTMLDivElement | undefined = $state();

  let historyLog = $state<DriftHistoryEntry[]>([]);
  let currentPositions = $state<Record<string, { pan: number; vol: number }>>({});
  let pollTimer: ReturnType<typeof setInterval> | null = null;

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

  let prevTargets: Record<string, { targetPan: number; targetVol: number; targetRate: number }> = {};

  function recordDriftSnapshot() {
    if (!open || !playing || layers.length === 0) {
      prevTargets = {};
      return;
    }
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 8);
    const jumpedMetrics: LayerDriftMetric[] = [];
    const nextPositions: Record<string, { pan: number; vol: number }> = {};
    let anyJumped = false;

    // Clean up removed layers
    const currentLayerIds = new Set(layers.map((l) => l.params.id));
    for (const id of Object.keys(prevTargets)) {
      if (!currentLayerIds.has(id)) {
        delete prevTargets[id];
      }
    }

    for (const layer of layers) {
      const isYt = isYoutubeLayer(layer);
      const supPitch = supportsPitch(layer);
      const d = session.getLayerLiveDrift(layer.params.id);

      const targetPan = isYt ? 0 : (d ? d.targetPan : layer.params.pan);
      const targetVol = d ? d.targetVol : layer.params.volumeLinear;
      const targetRate = d
        ? d.targetRate
        : 'playbackRate' in layer.params
          ? (layer.params.playbackRate ?? 1)
          : 1;

      nextPositions[layer.params.id] = { pan: targetPan, vol: targetVol };

      const prev = prevTargets[layer.params.id];
      const isFirst = !prev;
      const hasJumped =
        !prev ||
        Math.abs(targetPan - prev.targetPan) > 0.002 ||
        Math.abs(targetVol - prev.targetVol) > 0.002 ||
        Math.abs(targetRate - prev.targetRate) > 0.002;

      prevTargets[layer.params.id] = { targetPan, targetVol, targetRate };

      if (hasJumped) {
        anyJumped = true;
        const hasDrift = d && (d.driftPanActive || d.driftGainActive || d.driftPitchActive);
        const hasDeltas =
          Math.abs(d ? d.panDelta : 0) > 0.002 ||
          Math.abs(d ? d.gainDbDelta : 0) > 0.02 ||
          Math.abs(d ? d.pitchPercentDelta : 0) > 0.02;

        if (hasDrift || hasDeltas || !isFirst) {
          jumpedMetrics.push({
            id: layer.params.id,
            label: labelFor(layer),
            icon: iconFor(layer),
            isYoutube: isYt,
            supportsPitch: supPitch,
            panDelta: d ? d.panDelta : 0,
            gainDbDelta: d ? d.gainDbDelta : 0,
            pitchPercentDelta: d ? d.pitchPercentDelta : 0,
            targetPan,
            targetVol,
            targetRate,
          });
        }
      }
    }

    if (anyJumped) {
      currentPositions = nextPositions;
    }

    if (jumpedMetrics.length > 0) {
      const newEntry: DriftHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: timeStr,
        layers: jumpedMetrics,
      };
      historyLog = [newEntry, ...historyLog.slice(0, MAX_HISTORY_DEPTH - 1)];
    }
  }

  onMount(() => {
    pollTimer = setInterval(() => {
      recordDriftSnapshot();
    }, 400);
  });

  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

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
    dragCoords = null;
  }

  function applyAt(id: string, clientX: number, clientY: number) {
    const layer = layers.find((l) => l.params.id === id);
    const { pan, vol } = xyToParams(clientX, clientY);
    const effectivePan = isYoutubeLayer(layer) ? 0 : pan;
    dragCoords = { pan: effectivePan, vol };
    currentPositions = {
      ...currentPositions,
      [id]: { pan: effectivePan, vol },
    };
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
      const effectivePan = isYt ? 0 : pan;
      currentPositions = {
        ...currentPositions,
        [layer.params.id]: { pan: effectivePan, vol },
      };
      session.setLayerSpatial(layer.params.id, effectivePan, vol, { coupleFilter });
    }
  }
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
            {@const activeDrag = draggingId === layer.params.id ? dragCoords : null}
            {@const livePos = playing ? currentPositions[layer.params.id] : null}
            {@const currentPan = activeDrag
              ? activeDrag.pan
              : (livePos ? livePos.pan : (isYt ? 0 : layer.params.pan))}
            {@const currentVol = activeDrag
              ? activeDrag.vol
              : (livePos ? livePos.vol : layer.params.volumeLinear)}

            <div
              class="marker"
              class:muted={layer.params.muted}
              class:dragging={draggingId === layer.params.id}
              class:vertical-only={isYt}
              style="left: {panToX(currentPan)}%; top: {volToY(currentVol)}%"
              tabindex="0"
              role="button"
              title={isYt
                ? `${labelFor(layer)} · volume ${Math.round(currentVol * 100)}% · vertical move only`
                : `${labelFor(layer)} · pan ${currentPan.toFixed(2)} · vol ${Math.round(currentVol * 100)}%`}
              aria-label={isYt
                ? `${labelFor(layer)}, volume ${Math.round(currentVol * 100)}%`
                : `${labelFor(layer)}, pan ${currentPan.toFixed(2)}, volume ${Math.round(currentVol * 100)}%`}
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
            </div>
          {/each}
        </div>

        <div class="drift-log-section">
          <div class="drift-log-head">
            <div class="log-title-area">
              <span
                class="pulse-indicator"
                class:recording={playing && layers.length > 0}
                aria-hidden="true"
              ></span>
              <span class="log-title">Drift History Log</span>
              <span class="log-badge">{historyLog.length}/{MAX_HISTORY_DEPTH}</span>
            </div>
            {#if historyLog.length > 0}
              <button
                type="button"
                class="clear-log-btn"
                onclick={() => (historyLog = [])}
                title="Clear drift history log"
              >
                Clear
              </button>
            {/if}
          </div>

          {#if historyLog.length === 0}
            <div class="log-empty">
              {#if playing}
                Capturing drift telemetry…
              {:else}
                Start playback to record real-time drift telemetry (depth: {MAX_HISTORY_DEPTH}).
              {/if}
            </div>
          {:else}
            <div class="log-table-container">
              <table class="log-table">
                <thead>
                  <tr>
                    <th class="th-time">Time</th>
                    <th class="th-layer">Layer</th>
                    <th class="th-num" title="Stereo Pan Offset (ΔPan)">ΔPan</th>
                    <th class="th-num" title="Gain Breathing Offset (ΔGain)">ΔGain</th>
                    <th class="th-num" title="Pitch Micro-Drift Offset (ΔPitch)">ΔPitch</th>
                  </tr>
                </thead>
                <tbody>
                  {#each historyLog as entry (entry.id)}
                    {#each entry.layers as m, idx (entry.id + '-' + m.id)}
                      <tr class:row-first={idx === 0}>
                        {#if idx === 0}
                          <td class="td-time" rowspan={entry.layers.length}>
                            <span class="time-stamp">{entry.timestamp}</span>
                          </td>
                        {/if}
                        <td class="td-layer">
                          <span class="l-ico">{m.icon}</span>
                          <span class="l-lab">{m.label}</span>
                        </td>
                        <td class="td-num">
                          {#if m.isYoutube}
                            <span class="val-center">0.00</span>
                          {:else}
                            <span
                              class="val-chip"
                              class:pos={m.panDelta > 0.005}
                              class:neg={m.panDelta < -0.005}
                            >
                              {m.panDelta > 0
                                ? `+${m.panDelta.toFixed(2)}`
                                : m.panDelta.toFixed(2)}
                            </span>
                          {/if}
                        </td>
                        <td class="td-num">
                          <span
                            class="val-chip"
                            class:pos={m.gainDbDelta > 0.05}
                            class:neg={m.gainDbDelta < -0.05}
                          >
                            {m.gainDbDelta > 0
                              ? `+${m.gainDbDelta.toFixed(1)} dB`
                              : `${m.gainDbDelta.toFixed(1)} dB`}
                          </span>
                        </td>
                        <td class="td-num">
                          {#if m.supportsPitch}
                            <span
                              class="val-chip"
                              class:pos={m.pitchPercentDelta > 0.05}
                              class:neg={m.pitchPercentDelta < -0.05}
                            >
                              {m.pitchPercentDelta > 0
                                ? `+${m.pitchPercentDelta.toFixed(1)}%`
                                : `${m.pitchPercentDelta.toFixed(1)}%`}
                            </span>
                          {:else}
                            <span class="val-na">—</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
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
    transition: width 0.2s ease, height 0.2s ease;
  }

  .drift-zone.has-pitch {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }

  .marker {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    background: color-mix(in srgb, var(--card) 92%, var(--accent-dim));
    color: var(--text);
    font: inherit;
    cursor: grab;
    box-shadow: var(--shadow-soft);
    white-space: nowrap;
    z-index: 2;
    touch-action: none;
    user-select: none;
    transition: box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
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
    font-size: 0.64rem;
    font-weight: 650;
    color: var(--text-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 7.5rem;
  }

  /* --- Rolling Drift History Log Styles --- */
  .drift-log-section {
    margin-top: 0.65rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.45rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .drift-log-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .log-title-area {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .pulse-indicator {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--muted-soft);
    transition: background 0.2s ease;
  }

  .pulse-indicator.recording {
    background: #22c55e;
    box-shadow: 0 0 6px #22c55e;
  }

  .log-title {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-soft);
  }

  .log-badge {
    font-size: 0.58rem;
    padding: 0.05rem 0.3rem;
    border-radius: var(--radius-pill);
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: ui-monospace, monospace;
  }

  .clear-log-btn {
    padding: 0.1rem 0.38rem;
    font-size: 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--muted-soft);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .clear-log-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .log-empty {
    font-size: 0.68rem;
    color: var(--muted-soft);
    font-style: italic;
    padding: 0.4rem 0.2rem;
    text-align: center;
  }

  .log-table-container {
    max-height: 9.5rem;
    overflow-y: auto;
    overflow-x: auto;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .log-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.62rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .log-table thead {
    position: sticky;
    top: 0;
    background: color-mix(in srgb, var(--card) 95%, var(--bg));
    z-index: 1;
    border-bottom: 1px solid var(--border);
  }

  .log-table th {
    padding: 0.22rem 0.35rem;
    font-weight: 650;
    color: var(--muted);
    text-align: left;
    white-space: nowrap;
  }

  .log-table th.th-num {
    text-align: right;
  }

  .log-table td {
    padding: 0.18rem 0.35rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 35%, transparent);
    white-space: nowrap;
    vertical-align: middle;
  }

  .row-first td {
    border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
  }

  .td-time {
    vertical-align: top;
    color: var(--muted);
    background: color-mix(in srgb, var(--bg) 80%, var(--card));
    border-right: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    font-weight: 600;
  }

  .time-stamp {
    font-size: 0.58rem;
    color: var(--muted-soft);
  }

  .td-layer {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--text-soft);
    font-weight: 550;
    max-width: 7rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .l-ico {
    font-size: 0.72rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .l-lab {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .td-num {
    text-align: right;
  }

  .val-chip {
    display: inline-block;
    padding: 0.05rem 0.25rem;
    border-radius: var(--radius-sm);
    color: var(--text-soft);
  }

  .val-chip.pos {
    color: #38bdf8;
    background: color-mix(in srgb, #38bdf8 12%, transparent);
  }

  .val-chip.neg {
    color: #f472b6;
    background: color-mix(in srgb, #f472b6 12%, transparent);
  }

  .val-center,
  .val-na {
    color: var(--muted-soft);
  }
</style>
