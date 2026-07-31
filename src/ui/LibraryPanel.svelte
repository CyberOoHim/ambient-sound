<script lang="ts">
  import { session } from '../app/session';
  import { NOISE_TYPES, type NoiseType } from '../audio/dsp/colored-noise';
  import type { CatalogAsset } from '../assets/catalog';

  let assets = $state<CatalogAsset[]>([]);
  let catalogError = $state<string | null>(null);
  let busy = $state(false);
  let message = $state<string | null>(null);

  export function sync() {
    assets = session.catalog?.assets ?? [];
    catalogError = session.catalogError;
  }

  function labelNoise(t: NoiseType): string {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  async function addNoise(type: NoiseType) {
    busy = true;
    message = null;
    try {
      await session.addNoiseLayer(type);
      message = `Added ${labelNoise(type)}`;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function addSample(asset: CatalogAsset) {
    busy = true;
    message = null;
    try {
      await session.addSampleFromAsset(asset);
      message = `Added ${asset.title}`;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  /** Friendly short labels for ambient categories / titles */
  function shortTitle(title: string): string {
    return title;
  }
</script>

<section class="panel library">
  <header class="panel-head">
    <h2>Sounds</h2>
    <p class="hint">tap to add</p>
  </header>

  <div class="section">
    <h3>Noise</h3>
    <div class="chips">
      {#each NOISE_TYPES as t}
        <button type="button" class="chip" disabled={busy} onclick={() => void addNoise(t)}>
          {labelNoise(t)}
        </button>
      {/each}
    </div>
  </div>

  <div class="section">
    <h3>Nature</h3>
    {#if catalogError}
      <p class="err">{catalogError}</p>
    {:else if assets.length === 0}
      <p class="empty">Loading…</p>
    {:else}
      <div class="sound-grid">
        {#each assets as a (a.id)}
          <button
            type="button"
            class="sound-tile"
            disabled={busy}
            title="{a.title} · {a.category}"
            onclick={() => void addSample(a)}
          >
            <span class="tile-title">{shortTitle(a.title)}</span>
            <span class="tile-cat">{a.category}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if message}
    <p class="msg" role="status">{message}</p>
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
    margin-bottom: 0.5rem;
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

  .section + .section {
    margin-top: 0.55rem;
  }

  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--muted-soft);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .chip {
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.28rem 0.55rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-soft);
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      background 0.12s ease,
      color 0.12s ease;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--accent);
  }

  .chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sound-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
    gap: 0.35rem;
  }

  .sound-tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.12rem;
    text-align: left;
    font: inherit;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    min-height: 2.6rem;
    transition:
      border-color 0.12s ease,
      background 0.12s ease,
      transform 0.1s ease;
  }

  .sound-tile:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-dim);
    transform: translateY(-1px);
  }

  .sound-tile:active:not(:disabled) {
    transform: translateY(0);
  }

  .sound-tile:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tile-title {
    font-size: 0.78rem;
    font-weight: 650;
    line-height: 1.2;
    color: var(--text-soft);
  }

  .sound-tile:hover:not(:disabled) .tile-title {
    color: var(--accent);
  }

  .tile-cat {
    font-size: 0.62rem;
    color: var(--muted-soft);
    text-transform: capitalize;
  }

  .empty,
  .err {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0.15rem 0;
  }

  .err {
    color: var(--danger);
  }

  .msg {
    margin: 0.5rem 0 0;
    font-size: 0.72rem;
    color: var(--accent);
  }
</style>
