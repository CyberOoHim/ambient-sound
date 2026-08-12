<script lang="ts">
  import {
    loadSavedYouTubeItems,
    addYouTubeItem,
    deleteYouTubeItem,
    type YouTubeItem,
  } from '../app/youtube-urls';
  import { getMaxYoutubeLayers } from '../audio/types';

  interface Props {
    layers: import('../audio/types').MixerLayer[];
    canAddLayer: boolean;
    onAddYoutube: (videoId: string, url: string, title: string, thumbnailUrl: string) => Promise<void>;
  }

  let { layers, canAddLayer, onAddYoutube }: Props = $props();

  let inputUrl = $state('');
  let isAdding = $state(false);
  let errorMessage = $state<string | null>(null);
  let savedItems = $state<YouTubeItem[]>(loadSavedYouTubeItems());

  let maxYoutubeLayers = $derived(getMaxYoutubeLayers());
  let activeYoutubeCount = $derived(
    layers.filter((l) => l.kind === 'youtube').length,
  );
  let isYoutubeCapReached = $derived(activeYoutubeCount >= maxYoutubeLayers);

  async function handleAddUrl(e?: SubmitEvent) {
    if (e) e.preventDefault();
    if (!inputUrl.trim() || isAdding) return;

    isAdding = true;
    errorMessage = null;

    try {
      const res = await addYouTubeItem(inputUrl.trim());
      if (res.error) {
        errorMessage = res.error;
      } else if (res.item) {
        inputUrl = '';
        savedItems = loadSavedYouTubeItems();
      }
    } catch {
      errorMessage = 'Failed to fetch video details';
    } finally {
      isAdding = false;
    }
  }

  function handleDelete(id: string) {
    savedItems = deleteYouTubeItem(id);
  }

  async function handleAddToMix(item: YouTubeItem) {
    if (isYoutubeCapReached || !canAddLayer) return;
    await onAddYoutube(item.videoId, item.url, item.title, item.thumbnailUrl);
  }
</script>

<div class="youtube-panel" aria-label="YouTube Streams Manager">
  <div class="panel-header">
    <div class="header-title">
      <svg class="yt-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
      <h3>YouTube Audio Streams</h3>
    </div>
    <div class="channel-cap-badge" class:at-cap={isYoutubeCapReached}>
      {activeYoutubeCount} / {maxYoutubeLayers} {maxYoutubeLayers === 1 ? 'Channel' : 'Channels'} in Mix
    </div>
  </div>

  <p class="panel-intro">
    Paste YouTube URLs to stream background lofi, rain sounds, or music channels alongside your ambient mix.
    {#if maxYoutubeLayers === 1}
      <span class="ios-cap-note">Note: iOS WebKit limits media playback to 1 YouTube stream at a time.</span>
    {/if}
  </p>

  <form class="add-form" onsubmit={handleAddUrl}>
    <div class="input-row">
      <input
        type="text"
        placeholder="Paste YouTube video or livestream URL…"
        bind:value={inputUrl}
        disabled={isAdding}
      />
      <button type="submit" class="btn-primary" disabled={isAdding || !inputUrl.trim()}>
        {isAdding ? 'Adding…' : 'Add Link'}
      </button>
    </div>
    {#if errorMessage}
      <p class="error-msg">{errorMessage}</p>
    {/if}
  </form>

  <div class="saved-section">
    <h4>Saved YouTube Channels ({savedItems.length})</h4>

    {#if savedItems.length === 0}
      <p class="empty-state">No saved YouTube streams yet. Paste a URL above to add one!</p>
    {:else}
      <div class="yt-grid">
        {#each savedItems as item (item.id)}
          {@const isAlreadyInMix = layers.some(
            (l) => l.kind === 'youtube' && l.params.videoId === item.videoId,
          )}
          <div class="yt-card" class:in-mix={isAlreadyInMix}>
            <div class="thumb-wrapper">
              <img src={item.thumbnailUrl} alt={item.title} loading="lazy" />
              <a href={item.url} target="_blank" rel="noopener noreferrer" class="yt-link" title="Open on YouTube">
                ↗
              </a>
            </div>

            <div class="card-details">
              <span class="card-title" title={item.title}>{item.title}</span>
              
              <div class="card-actions">
                <button
                  type="button"
                  class="btn-add-mix"
                  disabled={isAlreadyInMix || isYoutubeCapReached || !canAddLayer}
                  onclick={() => handleAddToMix(item)}
                >
                  {#if isAlreadyInMix}
                    ✓ In Mix
                  {:else if isYoutubeCapReached}
                    Max 3 YT
                  {:else}
                    + Add to Mix
                  {/if}
                </button>
                <button
                  type="button"
                  class="btn-delete"
                  title="Remove from saved list"
                  onclick={() => handleDelete(item.id)}
                >
                  🗑
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .youtube-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: rgba(18, 24, 38, 0.75);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: #e2e8f0;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-title h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .yt-icon {
    color: #ff0000;
  }

  .channel-cap-badge {
    font-size: 0.8rem;
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.08);
    color: #94a3b8;
    font-weight: 500;
  }

  .channel-cap-badge.at-cap {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  .panel-intro {
    margin: 0;
    font-size: 0.85rem;
    color: #94a3b8;
    line-height: 1.4;
  }

  .add-form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .input-row {
    display: flex;
    gap: 0.5rem;
  }

  input[type='text'] {
    flex: 1;
    padding: 0.55rem 0.8rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(10, 14, 23, 0.6);
    color: #fff;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.15s ease;
  }

  input[type='text']:focus {
    border-color: #38bdf8;
  }

  .btn-primary {
    padding: 0.55rem 1rem;
    border-radius: 6px;
    border: none;
    background: #e11d48;
    color: #fff;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease;
  }

  .btn-primary:hover:not(:disabled) {
    background: #f43f5e;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-msg {
    margin: 0;
    font-size: 0.8rem;
    color: #f87171;
  }

  .saved-section h4 {
    margin: 0 0 0.6rem 0;
    font-size: 0.9rem;
    color: #cbd5e1;
    font-weight: 500;
  }

  .empty-state {
    font-size: 0.85rem;
    color: #64748b;
    font-style: italic;
  }

  .yt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.8rem;
  }

  .yt-card {
    display: flex;
    flex-direction: column;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    overflow: hidden;
    transition: transform 0.15s ease, border-color 0.15s ease;
  }

  .yt-card:hover {
    border-color: rgba(255, 255, 255, 0.15);
  }

  .yt-card.in-mix {
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(14, 116, 144, 0.15);
  }

  .thumb-wrapper {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
  }

  .thumb-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .yt-link {
    position: absolute;
    top: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.75rem;
    text-decoration: none;
    transition: background 0.15s ease;
  }

  .yt-link:hover {
    background: rgba(225, 29, 72, 0.8);
  }

  .card-details {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem;
    flex: 1;
  }

  .card-title {
    font-size: 0.82rem;
    font-weight: 500;
    line-height: 1.3;
    color: #e2e8f0;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
  }

  .btn-add-mix {
    flex: 1;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    border: none;
    background: #0284c7;
    color: #fff;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-add-mix:hover:not(:disabled) {
    background: #0369a1;
  }

  .btn-add-mix:disabled {
    opacity: 0.5;
    background: rgba(255, 255, 255, 0.1);
    color: #94a3b8;
    cursor: not-allowed;
  }

  .btn-delete {
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.8rem;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .btn-delete:hover {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.4);
  }

  .ios-cap-note {
    display: block;
    margin-top: 0.35rem;
    font-size: 0.73rem;
    color: #f59e0b;
    font-style: italic;
  }
</style>
