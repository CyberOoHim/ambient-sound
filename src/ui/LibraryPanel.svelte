<script lang="ts">
  import { session } from '../app/session';
  import { NOISE_TYPES, type NoiseType } from '../audio/dsp/colored-noise';
  import { MAX_MIXER_LAYERS } from '../audio/types';
  import type { CatalogAsset } from '../assets/catalog';

  let assets = $state<CatalogAsset[]>([]);
  let catalogError = $state<string | null>(null);
  let busy = $state(false);
  let message = $state<string | null>(null);
  let filterGroup = $state<string>('all');
  let searchQuery = $state('');
  let layerCount = $state(session.layers.length);

  export function sync() {
    assets = session.catalog?.assets ?? [];
    catalogError = session.catalogError;
    layerCount = session.layers.length;
  }

  function labelNoise(t: NoiseType): string {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  async function addNoise(type: NoiseType) {
    busy = true;
    message = null;
    try {
      await session.addNoiseLayer(type);
      if (session.loadNotice?.includes('Layer limit')) {
        message = session.loadNotice;
      } else {
        message = `Added ${labelNoise(type)}`;
      }
      layerCount = session.layers.length;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function addSample(asset: CatalogAsset) {
    busy = true;
    const downloading = session.playing && session.needsSampleFetch(asset);
    message = downloading ? `Downloading ${asset.title}…` : null;
    try {
      const layerId = await session.addSampleFromAsset(asset);
      if (session.loadNotice) {
        message = session.loadNotice;
        layerCount = session.layers.length;
        return;
      }
      const stillThere = session.layers.some((l) => l.params.id === layerId);
      message = stillThere
        ? `Added ${asset.title}`
        : downloading
          ? `Download cancelled · ${asset.title} removed`
          : null;
      layerCount = session.layers.length;
    } catch (e) {
      message = session.loadNotice ?? (e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  async function surpriseMe() {
    busy = true;
    message = null;
    try {
      await session.surpriseMe();
      message = session.loadNotice ?? 'Surprise mix ready';
      layerCount = session.layers.length;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  interface GroupDef {
    id: string;
    label: string;
    categories: string[];
  }

  const CATEGORY_GROUPS: GroupDef[] = [
    { id: 'transport', label: 'Transport', categories: ['transport'] },
    { id: 'rain', label: 'Rain & Thunder', categories: ['rain', 'thunder'] },
    { id: 'water', label: 'Water & Ocean', categories: ['ocean', 'water', 'stream', 'waterfall', 'cave'] },
    { id: 'wind', label: 'Wind & Forest', categories: ['wind', 'forest'] },
    { id: 'wildlife', label: 'Wildlife', categories: ['birds', 'insects', 'frogs'] },
    { id: 'fire', label: 'Fire', categories: ['fire'] },
  ];

  function matchesFilter(asset: CatalogAsset, filterId: string): boolean {
    if (filterId === 'all') return true;
    const g = CATEGORY_GROUPS.find((group) => group.id === filterId);
    if (!g) return asset.category === filterId;
    return g.categories.includes(asset.category);
  }

  function matchesSearch(asset: CatalogAsset, q: string): boolean {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    if (asset.title.toLowerCase().includes(needle)) return true;
    if (asset.category.toLowerCase().includes(needle)) return true;
    if (asset.id.toLowerCase().includes(needle)) return true;
    if (asset.tags?.some((t) => t.toLowerCase().includes(needle))) return true;
    return false;
  }

  // Hide dedicated one-shot event clips from continuous layer library
  function isLibraryAsset(asset: CatalogAsset): boolean {
    return !asset.id.startsWith('event_');
  }

  const filteredAssets = $derived(
    assets.filter(
      (a) =>
        isLibraryAsset(a) &&
        matchesFilter(a, filterGroup) &&
        matchesSearch(a, searchQuery),
    ),
  );

  const libraryAssets = $derived(assets.filter(isLibraryAsset));

  function shortTitle(title: string): string {
    return title;
  }

  const maxLayers = MAX_MIXER_LAYERS;
  const capWarn = $derived(layerCount >= maxLayers - 2);
</script>

<section class="panel library">
  <header class="panel-head">
    <h2>Sounds</h2>
    <p class="hint">tap to add · {layerCount}/{maxLayers}</p>
  </header>

  <div class="toolbar">
    <button
      type="button"
      class="surprise"
      disabled={busy}
      onclick={() => void surpriseMe()}
      title="Random complementary mix"
    >
      ✨ Surprise me
    </button>
    <input
      type="search"
      class="search"
      placeholder="Search title or tags…"
      bind:value={searchQuery}
      aria-label="Search sounds"
    />
  </div>

  {#if capWarn}
    <p class="cap-warn" role="status">
      {layerCount >= maxLayers
        ? `Layer limit (${maxLayers}) reached`
        : `Approaching layer limit (${layerCount}/${maxLayers})`}
    </p>
  {/if}

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
    <h3>Categories</h3>
    <div class="chips filter-chips">
      <button
        type="button"
        class="chip filter-chip"
        class:active={filterGroup === 'all'}
        onclick={() => (filterGroup = 'all')}
      >
        All ({libraryAssets.length})
      </button>
      {#each CATEGORY_GROUPS as g}
        {@const count = libraryAssets.filter((a) => g.categories.includes(a.category)).length}
        {#if count > 0}
          <button
            type="button"
            class="chip filter-chip"
            class:active={filterGroup === g.id}
            onclick={() => (filterGroup = g.id)}
          >
            {g.label} ({count})
          </button>
        {/if}
      {/each}
    </div>
  </div>

  <div class="section">
    <h3>Ambience</h3>
    {#if catalogError}
      <p class="err">{catalogError}</p>
    {:else if assets.length === 0}
      <p class="empty">Loading…</p>
    {:else if filteredAssets.length === 0}
      <p class="empty">No matches for “{searchQuery || filterGroup}”</p>
    {:else}
      <div class="sound-grid">
        {#each filteredAssets as a (a.id)}
          <button
            type="button"
            class="sound-tile"
            disabled={busy}
            title="{a.title} · {a.category}{(a.tags?.length ? ' · ' + a.tags.join(', ') : '')}"
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

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .surprise {
    font: inherit;
    font-size: 0.75rem;
    font-weight: 650;
    padding: 0.32rem 0.65rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--accent-dim);
    color: var(--accent);
    cursor: pointer;
    white-space: nowrap;
  }

  .surprise:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .surprise:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .search {
    flex: 1;
    min-width: 8rem;
    font: inherit;
    font-size: 0.8rem;
    padding: 0.32rem 0.55rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }

  .search:focus {
    outline: none;
    border-color: var(--accent);
  }

  .cap-warn {
    margin: 0 0 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--solo, #fbbf24);
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

  .chip.active {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
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
