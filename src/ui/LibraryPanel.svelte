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
      message = `Added ${labelNoise(type)} noise`;
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
</script>

<section class="card library">
  <div class="head">
    <h2>Library</h2>
  </div>
  <p class="help">Add noise generators or core ambient loops to the mixer.</p>

  <h3>Noise</h3>
  <div class="chips">
    {#each NOISE_TYPES as t}
      <button type="button" class="chip" disabled={busy} onclick={() => void addNoise(t)}>
        {labelNoise(t)}
      </button>
    {/each}
  </div>

  <h3>Ambient (core pack)</h3>
  {#if catalogError}
    <p class="err">{catalogError}</p>
  {:else if assets.length === 0}
    <p class="empty">Loading catalog…</p>
  {:else}
    <ul class="list">
      {#each assets as a (a.id)}
        <li>
          <div class="meta">
            <span class="title">{a.title}</span>
            <span class="cat">{a.category} · {a.license.spdx}</span>
          </div>
          <button type="button" class="primary" disabled={busy} onclick={() => void addSample(a)}>
            Add
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if message}
    <p class="msg" role="status">{message}</p>
  {/if}
</section>

<style>
  .head {
    margin-bottom: 0.35rem;
  }

  h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  h3 {
    margin: 0.75rem 0 0.4rem;
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 600;
  }

  .help {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.4;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip {
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.3rem 0.55rem;
    border-radius: 0.45rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }

  .chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg);
    padding: 0.4rem 0.5rem;
  }

  .title {
    display: block;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .cat {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
    margin-top: 0.1rem;
  }

  .primary {
    font: inherit;
    font-size: 0.8rem;
    font-weight: 650;
    background: var(--accent);
    border: none;
    color: #0b1020;
    border-radius: 0.45rem;
    padding: 0.3rem 0.65rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty,
  .err {
    font-size: 0.85rem;
    color: var(--muted);
    margin: 0.25rem 0;
  }

  .err {
    color: #ffb4b4;
  }

  .msg {
    margin: 0.55rem 0 0;
    font-size: 0.8rem;
    color: var(--accent);
  }
</style>
