<script lang="ts">
  /**
   * 2D spatial sound canvas (ENH-14).
   * X = pan (−1..1), Y = volume (top quiet / far, bottom loud / near).
   */
  import { session } from '../app/session';
  import type { MixerLayer } from '../audio/types';

  interface Props {
    layers: MixerLayer[];
  }

  let { layers }: Props = $props();

  let coupleFilter = $state(true);
  let draggingId: string | null = $state(null);
  let surface: HTMLDivElement | undefined = $state();

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

  function isYoutubeLayer(layer?: MixerLayer): boolean {
    if (!layer) return false;
    return (
      layer.kind === 'youtube' ||
      (layer.kind === 'playlist' && layer.params.currentTrackType === 'youtube')
    );
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
</script>

<section class="panel spatial">
  <header class="panel-head">
    <h2>Space</h2>
    <p class="hint">drag / arrows · L/R pan · up quiet</p>
  </header>

  <label class="couple">
    <input type="checkbox" bind:checked={coupleFilter} />
    Distance filter
  </label>

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

      {#each layers as layer (layer.params.id)}
        {@const isYt = isYoutubeLayer(layer)}
        <button
          type="button"
          class="marker"
          class:muted={layer.params.muted}
          class:dragging={draggingId === layer.params.id}
          class:vertical-only={isYt}
          style="left: {panToX(isYt ? 0 : layer.params.pan)}%; top: {volToY(
            layer.params.volumeLinear,
          )}%"
          title={isYt
            ? `${labelFor(layer)} · vertical move only (pan N/A)`
            : `${labelFor(layer)} · pan ${layer.params.pan.toFixed(2)}`}
          aria-label={isYt
            ? `${labelFor(layer)}, volume ${Math.round(
                layer.params.volumeLinear * 100,
              )}% (vertical move only, pan not available)`
            : `${labelFor(layer)}, pan ${layer.params.pan.toFixed(2)}, volume ${Math.round(
                layer.params.volumeLinear * 100,
              )}%`}
          onpointerdown={(e) => onPointerDown(e, layer.params.id)}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onkeydown={(e) => onKeyDown(e, layer)}
        >
          <span class="ico" aria-hidden="true">{iconFor(layer)}</span>
          <span class="lab">{labelFor(layer)}</span>
        </button>
      {/each}
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

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
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

  .couple {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    color: var(--text-soft);
    margin-bottom: 0.45rem;
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
    height: 11.5rem;
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

  .marker {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.28rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    background: color-mix(in srgb, var(--card) 88%, var(--accent-dim));
    color: var(--text);
    font: inherit;
    cursor: grab;
    box-shadow: var(--shadow-soft);
    max-width: 5.5rem;
    z-index: 2;
    touch-action: none;
    user-select: none;
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
    font-size: 0.95rem;
    line-height: 1;
  }

  .lab {
    font-size: 0.58rem;
    font-weight: 650;
    color: var(--text-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 4.8rem;
  }
</style>
