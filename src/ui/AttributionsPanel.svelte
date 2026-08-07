<script lang="ts">
  import type { CatalogAsset, SoundCatalog } from '../assets/catalog';

  interface Props {
    catalog: SoundCatalog | null;
    open?: boolean;
    onclose?: () => void;
  }

  let { catalog, open = false, onclose }: Props = $props();

  function close() {
    onclose?.();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function sourceLabel(asset: CatalogAsset): string {
    return asset.license.sourceUrl ?? '';
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    onkeydown={onKey}
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attr-title"
      tabindex="-1"
    >
      <header class="dlg-head">
        <h2 id="attr-title">Attributions</h2>
        <button type="button" class="close" aria-label="Close" onclick={close}>
          ×
        </button>
      </header>

      <div class="body">
        <p class="intro">
          Ambient field recordings are from
          <a href="https://freesound.org" target="_blank" rel="noopener noreferrer"
            >Freesound.org</a
          >
          under
          <a
            href="https://creativecommons.org/publicdomain/zero/1.0/"
            target="_blank"
            rel="noopener noreferrer">CC0 1.0</a
          >
          (public domain dedication). App source is MIT.
        </p>

        {#if !catalog}
          <p class="empty">Catalog not loaded yet.</p>
        {:else}
          <p class="pack">
            Pack: <strong>{catalog.title}</strong>
            <span class="muted">({catalog.packId})</span>
          </p>
          <ul class="list">
            {#each catalog.assets as asset (asset.id)}
              <li>
                <div class="title-row">
                  <span class="title">{asset.title}</span>
                  <span class="spdx">{asset.license.spdx}</span>
                </div>
                <div class="meta">
                  <span>{asset.license.author}</span>
                  {#if sourceLabel(asset)}
                    <span aria-hidden="true">·</span>
                    <a
                      href={sourceLabel(asset)}
                      target="_blank"
                      rel="noopener noreferrer">Source</a
                    >
                  {/if}
                </div>
                {#if asset.license.attribution}
                  <p class="note">{asset.license.attribution}</p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(8, 6, 4, 0.72);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  .dialog {
    width: min(32rem, 100%);
    max-height: min(80svh, 40rem);
    display: flex;
    flex-direction: column;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card), 0 16px 48px rgba(0, 0, 0, 0.45);
    outline: none;
  }

  .dlg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .close {
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: 1.35rem;
    line-height: 1;
    cursor: pointer;
  }

  .close:hover {
    background: var(--bg);
    color: var(--text);
  }

  .body {
    overflow-y: auto;
    padding: 0.75rem 0.9rem 1rem;
  }

  .intro {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-soft);
  }

  .intro a {
    color: var(--accent);
  }

  .pack {
    margin: 0 0 0.65rem;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .muted {
    color: var(--muted-soft);
  }

  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .list li {
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-soft);
  }

  .spdx {
    font-size: 0.65rem;
    font-weight: 650;
    color: var(--accent);
    white-space: nowrap;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.15rem;
    font-size: 0.72rem;
    color: var(--muted);
  }

  .meta a {
    color: var(--accent);
  }

  .note {
    margin: 0.25rem 0 0;
    font-size: 0.7rem;
    color: var(--muted-soft);
    line-height: 1.35;
  }
</style>
