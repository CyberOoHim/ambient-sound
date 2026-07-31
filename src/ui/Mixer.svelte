<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { session } from '../app/session';
  import { NOISE_TYPES, type NoiseType } from '../audio/dsp/colored-noise';
  import { dbToLinear, linearToDb, DB_MIN, DB_MAX } from '../audio/dsp/curves';
  import type { MixerLayer } from '../audio/types';
  import TimerPanel from './TimerPanel.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import LibraryPanel from './LibraryPanel.svelte';

  let layers = $state<MixerLayer[]>(session.layers);
  let playing = $state(session.playing);
  let masterDb = $state(linearToDb(session.masterVolumeLinear));
  let peak = $state(0);
  let error = $state<string | null>(null);
  let busy = $state(false);

  let timerPanel: TimerPanel | undefined = $state();
  let presetsPanel: PresetsPanel | undefined = $state();
  let libraryPanel: LibraryPanel | undefined = $state();

  let meterRaf = 0;
  let unsub: (() => void) | undefined;

  function syncFromSession() {
    layers = session.layers;
    playing = session.playing;
    masterDb = linearToDb(session.masterVolumeLinear);
    timerPanel?.sync();
    presetsPanel?.sync();
    libraryPanel?.sync();
  }

  async function togglePlay() {
    error = null;
    busy = true;
    try {
      await session.togglePlay();
      syncFromSession();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
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
      layers = session.layers;
      playing = session.playing;
      masterDb = linearToDb(session.masterVolumeLinear);
      timerPanel?.sync();
      presetsPanel?.sync();
      libraryPanel?.sync();
    });
    void session.whenCatalogReady().then(() => libraryPanel?.sync());
    const tick = () => {
      if (session.playing) {
        peak = session.getPeakLevel();
      } else {
        peak *= 0.9;
      }
      if (session.timer.status === 'running' || session.timer.status === 'fading') {
        timerPanel?.sync();
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
    <div>
      <h1>Ambient Sound</h1>
      <p class="sub">Noise + ambient loops · timer · presets</p>
    </div>
    <div class="transport">
      <button class="play" class:active={playing} disabled={busy} onclick={() => void togglePlay()}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <span class="hint" title="Press the Space bar on your keyboard to play or pause">
        Keyboard: <kbd>Space</kbd> play/pause
      </span>
    </div>
  </header>

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  <section class="master card">
    <div class="row">
      <label for="master">Master</label>
      <input
        id="master"
        type="range"
        min={DB_MIN}
        max={DB_MAX}
        step="0.5"
        value={masterDb}
        oninput={(e) => setMasterDb(Number(e.currentTarget.value))}
      />
      <span class="db">{masterDb.toFixed(1)} dB</span>
    </div>
    <div class="meter" aria-hidden="true">
      <div class="meter-fill" style="width: {Math.min(100, peak * 100)}%"></div>
    </div>
  </section>

  <LibraryPanel bind:this={libraryPanel} />
  <TimerPanel bind:this={timerPanel} />
  <PresetsPanel bind:this={presetsPanel} />

  <section class="layers">
    <div class="layers-head">
      <h2>Mixer layers</h2>
    </div>

    {#each layers as layer (layer.params.id)}
      <article class="layer card" class:muted={layer.params.muted}>
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
              <span class="kind">Ambient</span>
              <span class="name">{layer.params.label}</span>
            </div>
          {/if}

          <div class="toggles">
            <button
              type="button"
              class="chip"
              class:on={layer.params.muted}
              aria-pressed={layer.params.muted}
              onclick={() => setMuted(layer.params.id, !layer.params.muted)}
            >
              M
            </button>
            <button
              type="button"
              class="chip solo"
              class:on={layer.params.solo}
              aria-pressed={layer.params.solo}
              onclick={() => setSolo(layer.params.id, !layer.params.solo)}
            >
              S
            </button>
            <button
              type="button"
              class="chip danger"
              aria-label="Remove layer"
              disabled={layers.length <= 1}
              onclick={() => removeLayer(layer.params.id)}
            >
              ×
            </button>
          </div>
        </div>

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
          <span class="db">{linearToDb(layer.params.volumeLinear).toFixed(1)} dB</span>
        </div>

        <div class="row">
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
          <span class="db">{layer.params.pan.toFixed(2)}</span>
        </div>

        {#if layer.kind === 'noise'}
          <div class="row">
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
            <span class="db">{layer.params.stereoWidth.toFixed(2)}</span>
          </div>
        {/if}
      </article>
    {/each}
  </section>

  <footer class="footer">
    <p>
      Ambient loops from Freesound (CC0) — full credits in <code>ATTRIBUTIONS.md</code>.
    </p>
  </footer>
</div>

<style>
  .mixer {
    max-width: 40rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .sub {
    margin: 0.25rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--muted);
    max-width: 9rem;
    line-height: 1.3;
  }

  .hint kbd {
    display: inline-block;
    font: inherit;
    font-size: 0.7rem;
    font-weight: 650;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 0.3rem;
    padding: 0.05rem 0.35rem;
    background: var(--card);
    color: var(--text);
  }

  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.85rem;
    padding: 0.9rem 1rem;
    margin-bottom: 0.75rem;
  }

  .row {
    display: grid;
    grid-template-columns: 3.2rem 1fr 4.2rem;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.45rem;
  }

  .row:first-child {
    margin-top: 0;
  }

  label {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .db {
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
    color: var(--muted);
    text-align: right;
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }

  select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.4rem 0.55rem;
    font: inherit;
  }

  button {
    font: inherit;
    cursor: pointer;
    border-radius: 0.55rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    padding: 0.45rem 0.85rem;
  }

  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  button.play {
    background: var(--accent);
    border-color: transparent;
    color: #0b1020;
    font-weight: 650;
    min-width: 5.5rem;
  }

  button.play.active {
    background: #f0b429;
  }

  .layers-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 1rem 0 0.6rem;
  }

  .layer-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }

  .sample-label {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .sample-label .kind {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .sample-label .name {
    font-weight: 650;
  }

  .toggles {
    display: flex;
    gap: 0.35rem;
  }

  .chip {
    min-width: 2rem;
    padding: 0.3rem 0.45rem;
    font-size: 0.8rem;
    font-weight: 650;
  }

  .chip.on {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip.solo.on {
    background: #3d2a12;
    border-color: #f0b429;
    color: #f0b429;
  }

  .chip.danger {
    color: #f07178;
  }

  .layer.muted {
    opacity: 0.65;
  }

  .meter {
    margin-top: 0.65rem;
    height: 0.35rem;
    background: var(--bg);
    border-radius: 999px;
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #7fd99a);
    transition: width 50ms linear;
  }

  .error {
    background: #3a1a1a;
    border: 1px solid #f07178;
    color: #ffb4b4;
    border-radius: 0.6rem;
    padding: 0.65rem 0.85rem;
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
  }

  .footer {
    margin-top: 1.5rem;
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .footer p {
    margin: 0;
  }

  .footer code {
    font-size: 0.85em;
  }
</style>
