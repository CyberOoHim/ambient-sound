<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { session } from '../app/session';
  import { NOISE_TYPES, type NoiseType } from '../audio/dsp/colored-noise';
  import { dbToLinear, linearToDb, DB_MIN, DB_MAX } from '../audio/dsp/curves';
  import type { MixerLayer } from '../audio/types';
  import TimerPanel from './TimerPanel.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import LibraryPanel from './LibraryPanel.svelte';
  import OneShotPanel from './OneShotPanel.svelte';
  import { formatRemaining } from './format';

  let layers = $state<MixerLayer[]>(session.layers);
  let playing = $state(session.playing);
  let masterDb = $state(linearToDb(session.masterVolumeLinear));
  let peak = $state(0);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Sample layer ids currently fetching FreeSound files (for "Downloading…" UI). */
  let loadingIds = $state<string[]>([]);
  /** layerId → progress snapshot for bars */
  let loadProgress = $state<
    Record<string, { ratio: number; determinate: boolean }>
  >({});
  let loadNotice = $state<string | null>(null);
  let timerStatus = $state(session.timer.status);
  let timerRemainingMs = $state<number | null>(session.remainingMs());

  let timerPanel: TimerPanel | undefined = $state();
  let presetsPanel: PresetsPanel | undefined = $state();
  let libraryPanel: LibraryPanel | undefined = $state();
  let oneShotPanel: OneShotPanel | undefined = $state();

  let meterRaf = 0;
  let unsub: (() => void) | undefined;

  function syncFromSession() {
    layers = session.layers;
    playing = session.playing;
    masterDb = linearToDb(session.masterVolumeLinear);
    loadingIds = [...session.loadingLayerIds];
    const prog: Record<string, { ratio: number; determinate: boolean }> = {};
    for (const [id, p] of session.loadingProgress) {
      prog[id] = p;
    }
    loadProgress = prog;
    loadNotice = session.loadNotice;
    timerStatus = session.timer.status;
    timerRemainingMs = session.remainingMs();
    timerPanel?.sync();
    presetsPanel?.sync();
    libraryPanel?.sync();
    oneShotPanel?.sync();
  }

  function isLayerLoading(id: string): boolean {
    return loadingIds.includes(id);
  }

  function layerProgress(id: string): { ratio: number; determinate: boolean } {
    return loadProgress[id] ?? { ratio: 0, determinate: false };
  }

  function dismissNotice() {
    session.clearLoadNotice();
    syncFromSession();
  }

  async function togglePlay() {
    error = null;
    busy = true;
    try {
      // Show downloading state as soon as play starts fetching sample files.
      syncFromSession();
      await session.togglePlay();
      syncFromSession();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      syncFromSession();
    }
  }

  function setMasterDb(db: number) {
    masterDb = db;
    session.setMasterVolumeLinear(dbToLinear(db));
  }

  function removeLayer(id: string) {
    session.removeLayer(id);
    syncFromSession();
  }

  function clearAll() {
    session.clearAllLayers();
    syncFromSession();
  }

  function setLayerDb(id: string, db: number) {
    session.updateLayerCommon(id, { volumeLinear: dbToLinear(db) });
    syncFromSession();
  }

  function setMuted(id: string, muted: boolean) {
    session.updateLayerCommon(id, { muted });
    syncFromSession();
  }

  function setSolo(id: string, solo: boolean) {
    session.updateLayerCommon(id, { solo });
    syncFromSession();
  }

  function setPan(id: string, pan: number) {
    session.updateLayerCommon(id, { pan });
    syncFromSession();
  }

  function setNoiseType(id: string, type: NoiseType) {
    session.updateNoiseLayer(id, { type });
    syncFromSession();
  }

  function setWidth(id: string, stereoWidth: number) {
    session.updateNoiseLayer(id, { stereoWidth });
    syncFromSession();
  }

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (
      e.code === 'Space' &&
      tag !== 'INPUT' &&
      tag !== 'SELECT' &&
      tag !== 'TEXTAREA' &&
      tag !== 'BUTTON'
    ) {
      e.preventDefault();
      void togglePlay();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    unsub = session.subscribe(() => {
      syncFromSession();
    });
    void session.whenCatalogReady().then(() => libraryPanel?.sync());
    const tick = () => {
      if (session.playing) {
        peak = session.getPeakLevel();
      } else {
        peak *= 0.9;
      }
      if (session.timer.status === 'running' || session.timer.status === 'fading') {
        timerStatus = session.timer.status;
        timerRemainingMs = session.remainingMs();
        timerPanel?.sync();
      } else if (timerStatus !== 'idle' && timerStatus !== 'done') {
        timerStatus = session.timer.status;
        timerRemainingMs = null;
      }
      meterRaf = requestAnimationFrame(tick);
    };
    meterRaf = requestAnimationFrame(tick);
    queueMicrotask(() => syncFromSession());
  });

  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    cancelAnimationFrame(meterRaf);
    unsub?.();
  });

  function labelType(t: NoiseType): string {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
</script>

<div class="mixer">
  <header class="header">
    <div class="brand">
      <span class="logo" aria-hidden="true">◎</span>
      <div class="brand-text">
        <h1>Ambient</h1>
        <p class="sub">soft sounds · rest easy</p>
      </div>
    </div>

    <div class="transport">
      <button
        class="play"
        class:active={playing}
        disabled={busy}
        onclick={() => void togglePlay()}
        aria-label={playing ? 'Pause' : 'Play'}
        title="Space to play/pause"
      >
        {#if playing}
          <span class="play-icon" aria-hidden="true">❚❚</span>
          <span>Pause</span>
        {:else}
          <span class="play-icon" aria-hidden="true">▶</span>
          <span>Play</span>
        {/if}
      </button>
      <kbd class="hint-kbd" title="Keyboard shortcut">Space</kbd>

      {#if (timerStatus === 'running' || timerStatus === 'fading') && timerRemainingMs != null}
        <div
          class="header-timer-badge"
          class:fading={timerStatus === 'fading'}
          title="Sleep timer active"
        >
          <span class="timer-badge-icon" aria-hidden="true">⏱</span>
          <span>{formatRemaining(timerRemainingMs)}</span>
          {#if timerStatus === 'fading'}
            <span class="fade-tag">fade</span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="master">
      <label for="master" class="master-label">Master</label>
      <input
        id="master"
        type="range"
        min={DB_MIN}
        max={DB_MAX}
        step="0.5"
        value={masterDb}
        oninput={(e) => setMasterDb(Number(e.currentTarget.value))}
      />
      <span class="db">{masterDb.toFixed(0)} dB</span>
      <div class="meter" aria-hidden="true">
        <div class="meter-fill" style="width: {Math.min(100, peak * 100)}%"></div>
      </div>
    </div>
  </header>

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  {#if loadNotice}
    <div class="notice" role="status">
      <p>{loadNotice}</p>
      <button type="button" class="text-btn notice-dismiss" onclick={dismissNotice}>
        Dismiss
      </button>
    </div>
  {/if}

  {#if loadingIds.length > 0}
    <div class="status-line" role="status">
      Downloading sound{loadingIds.length > 1 ? 's' : ''}…
    </div>
  {/if}

  <section class="layers">
    <div class="layers-head">
      <h2>
        Now playing
        {#if layers.length > 0}
          <span class="count">{layers.length}</span>
        {/if}
      </h2>
      {#if layers.length > 0}
        <button type="button" class="text-btn" onclick={clearAll}>Clear all</button>
      {/if}
    </div>

    {#if layers.length === 0}
      <div class="empty-layers">
        <p>Your mix is quiet. Pick a sound below to begin.</p>
      </div>
    {/if}

    <div class="layer-list">
      {#each layers as layer (layer.params.id)}
        <article class="layer" class:muted={layer.params.muted}>
          <div class="layer-top">
            {#if layer.kind === 'noise'}
              <select
                aria-label="Noise type"
                value={layer.params.type}
                onchange={(e) =>
                  setNoiseType(layer.params.id, e.currentTarget.value as NoiseType)}
              >
                {#each NOISE_TYPES as t}
                  <option value={t}>{labelType(t)}</option>
                {/each}
              </select>
            {:else}
              <div class="sample-label">
                <span class="name">{layer.params.label}</span>
                {#if isLayerLoading(layer.params.id)}
                  {@const prog = layerProgress(layer.params.id)}
                  <span class="load-status">
                    {#if prog.determinate}
                      Downloading {Math.round(prog.ratio * 100)}%
                    {:else}
                      Downloading…
                    {/if}
                  </span>
                {/if}
              </div>
            {/if}

            <div class="toggles">
              <button
                type="button"
                class="chip"
                class:on={layer.params.muted}
                aria-pressed={layer.params.muted}
                title="Mute"
                onclick={() => setMuted(layer.params.id, !layer.params.muted)}
              >
                M
              </button>
              <button
                type="button"
                class="chip solo"
                class:on={layer.params.solo}
                aria-pressed={layer.params.solo}
                title="Solo"
                onclick={() => setSolo(layer.params.id, !layer.params.solo)}
              >
                S
              </button>
              <button
                type="button"
                class="chip danger"
                aria-label="Remove layer"
                title="Remove"
                onclick={() => removeLayer(layer.params.id)}
              >
                ×
              </button>
            </div>
          </div>

          {#if isLayerLoading(layer.params.id)}
            {@const prog = layerProgress(layer.params.id)}
            <div
              class="dl-progress"
              class:indeterminate={!prog.determinate}
              role="progressbar"
              aria-label="Download progress for {layer.kind === 'sample'
                ? layer.params.label
                : 'layer'}"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={prog.determinate ? Math.round(prog.ratio * 100) : undefined}
            >
              <div
                class="dl-progress-fill"
                style={prog.determinate
                  ? `width: ${Math.round(prog.ratio * 100)}%`
                  : undefined}
              ></div>
            </div>
          {/if}

          <div class="row">
            <label for="vol-{layer.params.id}">Vol</label>
            <input
              id="vol-{layer.params.id}"
              type="range"
              min={DB_MIN}
              max={DB_MAX}
              step="0.5"
              value={linearToDb(layer.params.volumeLinear)}
              oninput={(e) => setLayerDb(layer.params.id, Number(e.currentTarget.value))}
            />
            <span class="db">{linearToDb(layer.params.volumeLinear).toFixed(0)}</span>
          </div>

          <div class="controls-compact">
            <div class="row mini">
              <label for="pan-{layer.params.id}">Pan</label>
              <input
                id="pan-{layer.params.id}"
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={layer.params.pan}
                oninput={(e) => setPan(layer.params.id, Number(e.currentTarget.value))}
              />
            </div>

            {#if layer.kind === 'noise'}
              <div class="row mini">
                <label for="width-{layer.params.id}">Width</label>
                <input
                  id="width-{layer.params.id}"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={layer.params.stereoWidth}
                  oninput={(e) =>
                    setWidth(layer.params.id, Number(e.currentTarget.value))}
                />
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </section>

  <div class="side-grid">
    <LibraryPanel bind:this={libraryPanel} />
    <div class="side-stack">
      <TimerPanel bind:this={timerPanel} />
      <PresetsPanel bind:this={presetsPanel} />
      <OneShotPanel bind:this={oneShotPanel} />
    </div>
  </div>

  <footer class="footer">
    <p>Sounds from Freesound (CC0) · see <code>ATTRIBUTIONS.md</code></p>
  </footer>
</div>

<style>
  .mixer {
    max-width: 52rem;
    margin: 0 auto;
    padding: 0.75rem 0.85rem 2rem;
  }

  /* ── Sticky warm header ── */
  .header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 0.65rem 0.85rem;
    margin: 0 -0.15rem 0.85rem;
    background: color-mix(in srgb, var(--card) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-soft);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .logo {
    display: grid;
    place-items: center;
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 50%;
    background: var(--accent-dim);
    color: var(--accent);
    font-size: 0.95rem;
    line-height: 1;
    box-shadow: 0 0 12px var(--accent-glow);
    flex-shrink: 0;
  }

  .brand-text {
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--text);
    line-height: 1.15;
  }

  .sub {
    margin: 0.05rem 0 0;
    color: var(--muted);
    font-size: 0.68rem;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .play {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius-pill);
    border: none;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 650;
    font-size: 0.85rem;
    padding: 0.45rem 0.95rem;
    min-width: 5.25rem;
    justify-content: center;
    box-shadow: 0 2px 10px var(--accent-glow);
    transition:
      background 0.15s ease,
      transform 0.12s ease;
  }

  .play:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .play:active:not(:disabled) {
    transform: scale(0.97);
  }

  .play.active {
    background: var(--accent-hover);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
      0 2px 10px var(--accent-glow);
  }

  .play:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .play-icon {
    font-size: 0.7rem;
    line-height: 1;
  }

  .hint-kbd {
    display: none;
    font: inherit;
    font-size: 0.65rem;
    font-weight: 600;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 0.3rem;
    padding: 0.1rem 0.35rem;
    background: var(--bg);
    color: var(--muted);
  }

  .header-timer-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.65rem;
    border-radius: var(--radius-pill);
    background: var(--accent-dim);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    transition: all 0.25s ease;
  }

  .header-timer-badge.fading {
    background: var(--solo-dim);
    border-color: color-mix(in srgb, var(--solo) 55%, transparent);
    color: var(--solo);
    box-shadow: 0 0 10px rgba(251, 191, 36, 0.25);
    animation: fade-badge-pulse 1.5s ease-in-out infinite alternate;
  }

  .timer-badge-icon {
    font-size: 0.8rem;
    line-height: 1;
  }

  .fade-tag {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: color-mix(in srgb, var(--solo) 25%, transparent);
    padding: 0.05rem 0.3rem;
    border-radius: var(--radius-sm);
  }

  @keyframes fade-badge-pulse {
    0% {
      border-color: color-mix(in srgb, var(--solo) 40%, transparent);
    }
    100% {
      border-color: var(--solo);
    }
  }

  .master {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    gap: 0.2rem 0.5rem;
    min-width: 0;
  }

  .master-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .master input[type='range'] {
    grid-column: 2;
    grid-row: 1;
    width: 100%;
    min-width: 0;
  }

  .master .db {
    grid-column: 3;
    grid-row: 1;
    font-variant-numeric: tabular-nums;
    font-size: 0.72rem;
    color: var(--muted);
    text-align: right;
    min-width: 2.6rem;
  }

  .meter {
    grid-column: 2 / -1;
    grid-row: 2;
    height: 0.22rem;
    background: var(--bg);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    background: var(--accent);
    opacity: 0.85;
    transition: width 50ms linear;
    border-radius: inherit;
  }

  /* ── Layers ── */
  .layers {
    margin-bottom: 0.85rem;
  }

  .layers-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.45rem;
    padding: 0 0.15rem;
  }

  h2 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .count {
    display: inline-grid;
    place-items: center;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    border-radius: var(--radius-pill);
    background: var(--accent-dim);
    color: var(--accent);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0;
  }

  .text-btn {
    font: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0.35rem;
    border-radius: var(--radius-sm);
  }

  .text-btn:hover {
    color: var(--danger);
    background: var(--danger-dim);
  }

  .empty-layers {
    border: 1px dashed var(--border-soft);
    border-radius: var(--radius);
    padding: 1rem 1.1rem;
    text-align: center;
    background: color-mix(in srgb, var(--card) 60%, transparent);
  }

  .empty-layers p {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .layer-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .layer {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.55rem 0.7rem 0.6rem;
    box-shadow: var(--shadow-card);
    transition: opacity 0.15s ease;
  }

  .layer.muted {
    opacity: 0.55;
  }

  .layer-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .sample-label {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    min-width: 0;
  }

  .sample-label .name {
    font-weight: 650;
    font-size: 0.9rem;
    color: var(--text-soft);
  }

  .sample-label .load-status {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.02em;
  }

  .dl-progress {
    height: 0.28rem;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
    margin: 0.15rem 0 0.35rem;
  }

  .dl-progress-fill {
    height: 100%;
    width: 0%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, white));
    transition: width 0.12s ease-out;
  }

  .dl-progress.indeterminate .dl-progress-fill {
    width: 35%;
    animation: dl-indeterminate 1.1s ease-in-out infinite;
  }

  @keyframes dl-indeterminate {
    0% {
      transform: translateX(-120%);
    }
    100% {
      transform: translateX(320%);
    }
  }

  select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.28rem 0.45rem;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    max-width: 100%;
  }

  .toggles {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .chip {
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.35rem;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
    line-height: 1;
  }

  .chip.on {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip.solo.on {
    background: var(--solo-dim);
    border-color: var(--solo);
    color: var(--solo);
  }

  .chip.danger {
    color: var(--danger);
    border-color: transparent;
    background: transparent;
  }

  .chip.danger:hover {
    background: var(--danger-dim);
  }

  .row {
    display: grid;
    grid-template-columns: 2rem 1fr 2rem;
    align-items: center;
    gap: 0.4rem;
  }

  .row label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--muted);
  }

  .row .db {
    font-variant-numeric: tabular-nums;
    font-size: 0.7rem;
    color: var(--muted);
    text-align: right;
  }

  .controls-compact {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem 0.75rem;
    margin-top: 0.35rem;
  }

  .row.mini {
    grid-template-columns: 2.4rem 1fr;
  }

  .row.mini label {
    font-size: 0.68rem;
  }

  /* ── Side panels grid ── */
  .side-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.65rem;
    align-items: start;
  }

  .side-stack {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .error {
    background: var(--danger-dim);
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.65rem;
    font-size: 0.85rem;
  }

  .status-line {
    background: var(--accent-dim);
    border: 1px solid var(--border);
    color: var(--accent);
    border-radius: var(--radius);
    padding: 0.45rem 0.75rem;
    margin-bottom: 0.65rem;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .notice {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    background: var(--danger-dim, color-mix(in srgb, var(--danger) 14%, transparent));
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.65rem;
    font-size: 0.82rem;
  }

  .notice p {
    margin: 0;
    line-height: 1.35;
  }

  .notice-dismiss {
    flex-shrink: 0;
    color: inherit;
    opacity: 0.9;
  }

  .footer {
    margin-top: 1.1rem;
    color: var(--muted-soft);
    font-size: 0.72rem;
    text-align: center;
    line-height: 1.4;
  }

  .footer p {
    margin: 0;
  }

  .footer code {
    font-size: 0.9em;
    color: var(--muted);
  }

  @media (min-width: 640px) {
    .mixer {
      padding: 1rem 1.15rem 2.5rem;
    }

    .header {
      padding: 0.7rem 1rem;
      margin-bottom: 1rem;
    }

    .hint-kbd {
      display: inline-block;
    }

    .side-grid {
      grid-template-columns: 1.15fr 0.85fr;
      gap: 0.75rem;
    }
  }

  @media (max-width: 520px) {
    .header {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        'brand transport'
        'master master';
    }

    .brand {
      grid-area: brand;
    }

    .transport {
      grid-area: transport;
    }

    .master {
      grid-area: master;
      margin-top: 0.15rem;
    }

    .controls-compact {
      grid-template-columns: 1fr;
    }
  }
</style>
