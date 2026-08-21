<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '../app/session';
  import {
    type Playlist,
    type PlaylistItem,
  } from '../app/playlist';
  import {
    extractYouTubeVideoId,
    fetchYouTubeTitle,
    getYouTubeThumbnailUrl,
  } from '../app/youtube-urls';
  import { importLocalAudioFile } from '../audio/local-audio-store';

  let playlists = $state<Playlist[]>(session.playlists);
  let activePlaylistId = $state<string>(session.playlists[0]?.id ?? '');

  let activePlaylist = $derived(
    playlists.find((p) => p.id === activePlaylistId) ?? playlists[0],
  );

  // New playlist creation state
  let isCreating = $state(false);
  let newName = $state('');
  let newShuffle = $state(false);

  // Editing existing playlist state
  let isEditing = $state(false);
  let editName = $state('');
  let editShuffle = $state(false);

  // Adding track state
  let trackAddMode = $state<'local' | 'youtube'>('local');
  let youtubeUrl = $state('');
  let isAddingTrack = $state(false);
  let trackError = $state<string | null>(null);

  let fileInputRef = $state<HTMLInputElement>();

  export function sync() {
    playlists = session.playlists;
    if (playlists.length > 0 && (!activePlaylistId || !playlists.some((p) => p.id === activePlaylistId))) {
      activePlaylistId = playlists[0]?.id ?? '';
    }
  }

  onMount(() => {
    const unsub = session.subscribe(() => {
      sync();
    });
    return unsub;
  });

  function handleCreatePlaylist() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const pl = session.createPlaylist(trimmed, [], newShuffle);
    playlists = session.playlists;
    activePlaylistId = pl.id;
    newName = '';
    newShuffle = false;
    isCreating = false;
  }

  function startEditing(pl: Playlist) {
    editName = pl.name;
    editShuffle = pl.shuffleDefault ?? false;
    isEditing = true;
  }

  function saveEdit() {
    if (!activePlaylist) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    session.updatePlaylist(activePlaylist.id, {
      name: trimmed,
      shuffleDefault: editShuffle,
    });
    playlists = session.playlists;
    isEditing = false;
  }

  function handleDelete(id: string) {
    if (confirm('Delete this playlist?')) {
      session.deletePlaylist(id);
      playlists = session.playlists;
      if (activePlaylistId === id) {
        activePlaylistId = playlists[0]?.id ?? '';
      }
    }
  }

  function handleDuplicate(id: string) {
    const copy = session.duplicatePlaylist(id);
    if (copy) {
      playlists = session.playlists;
      activePlaylistId = copy.id;
    }
  }

  async function handleAddLocalFiles(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0 || !activePlaylist) return;

    isAddingTrack = true;
    trackError = null;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
          continue;
        }

        const localMeta = await importLocalAudioFile(file);

        session.addPlaylistItem(activePlaylist.id, {
          type: 'local',
          title: localMeta.title || file.name.replace(/\.[^/.]+$/, ''),
          assetId: localMeta.id,
        });
      }
      playlists = session.playlists;
    } catch (err) {
      trackError = err instanceof Error ? err.message : 'Failed to import local audio file.';
    } finally {
      isAddingTrack = false;
      if (target) target.value = '';
    }
  }

  async function handleAddYouTube(e?: SubmitEvent) {
    if (e) e.preventDefault();
    if (!youtubeUrl.trim() || !activePlaylist || isAddingTrack) return;

    isAddingTrack = true;
    trackError = null;

    try {
      const trimmed = youtubeUrl.trim();
      const videoId = extractYouTubeVideoId(trimmed);
      if (!videoId) {
        trackError = 'Invalid YouTube URL. Please enter a standard video or stream link.';
        isAddingTrack = false;
        return;
      }

      const title = await fetchYouTubeTitle(videoId);
      const thumbnailUrl = getYouTubeThumbnailUrl(videoId);
      session.addPlaylistItem(activePlaylist.id, {
        type: 'youtube',
        title,
        url: trimmed,
        videoId,
        thumbnailUrl,
      });

      youtubeUrl = '';
      playlists = session.playlists;
    } catch (err) {
      trackError = err instanceof Error ? err.message : 'Failed to add YouTube video.';
    } finally {
      isAddingTrack = false;
    }
  }

  function handleRemoveItem(itemId: string) {
    if (!activePlaylist) return;
    session.removePlaylistItem(activePlaylist.id, itemId);
    playlists = session.playlists;
  }

  function handleMoveUp(index: number) {
    if (!activePlaylist || index <= 0) return;
    session.reorderPlaylistItems(activePlaylist.id, index, index - 1);
    playlists = session.playlists;
  }

  function handleMoveDown(index: number) {
    if (!activePlaylist || index >= activePlaylist.items.length - 1) return;
    session.reorderPlaylistItems(activePlaylist.id, index, index + 1);
    playlists = session.playlists;
  }

  async function handleAddToMix(pl: Playlist) {
    await session.addPlaylistLayer(pl.id, { shuffle: pl.shuffleDefault });
  }
</script>

<div class="playlist-panel" aria-label="Playlists Manager">
  <div class="panel-header">
    <div class="header-title">
      <span class="pl-icon" aria-hidden="true">📑</span>
      <h3>Playlists</h3>
    </div>
    <button
      type="button"
      class="btn-new"
      onclick={() => (isCreating = !isCreating)}
      aria-expanded={isCreating}
    >
      {isCreating ? 'Cancel' : '+ New Playlist'}
    </button>
  </div>

  <p class="panel-intro">
    Combine local audio files and YouTube streams into custom playlists. Add any playlist as an ambient mix layer that plays sequentially or randomly.
  </p>

  {#if isCreating}
    <div class="create-form">
      <h4 class="form-title">Create New Playlist</h4>
      <input
        type="text"
        placeholder="Playlist name (e.g., Focus Lo-Fi & Rain)…"
        bind:value={newName}
        onkeydown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
      />
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={newShuffle} />
        <span>Default to Random / Shuffle mode (unchecked = Sequential / Rotate)</span>
      </label>
      <div class="form-actions">
        <button
          type="button"
          class="btn-primary"
          disabled={!newName.trim()}
          onclick={handleCreatePlaylist}
        >
          Create Playlist
        </button>
        <button
          type="button"
          class="btn-secondary"
          onclick={() => {
            isCreating = false;
            newName = '';
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  {#if playlists.length === 0}
    <div class="empty-state">
      <p>No playlists yet. Create one above to start organizing local sounds and YouTube streams.</p>
    </div>
  {:else}
    <!-- Playlist tabs -->
    <div class="playlist-tabs" role="tablist" aria-label="Playlists">
      {#each playlists as pl (pl.id)}
        <button
          type="button"
          role="tab"
          class="tab-btn"
          class:active={pl.id === activePlaylistId}
          aria-selected={pl.id === activePlaylistId}
          onclick={() => {
            activePlaylistId = pl.id;
            isEditing = false;
          }}
        >
          <span class="tab-name">{pl.name}</span>
          <span class="tab-badge">{pl.items.length}</span>
        </button>
      {/each}
    </div>

    {#if activePlaylist}
      <div class="active-playlist-view">
        <!-- Playlist details header -->
        <div class="active-header">
          {#if isEditing}
            <div class="edit-box">
              <input
                type="text"
                class="edit-name-input"
                bind:value={editName}
                onkeydown={(e) => e.key === 'Enter' && saveEdit()}
              />
              <label class="checkbox-label compact">
                <input type="checkbox" bind:checked={editShuffle} />
                <span>Shuffle by default</span>
              </label>
              <div class="edit-btns">
                <button type="button" class="btn-primary-sm" onclick={saveEdit}>Save</button>
                <button type="button" class="btn-secondary-sm" onclick={() => (isEditing = false)}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="title-meta">
              <h4 class="pl-name">{activePlaylist.name}</h4>
              <div class="meta-tags">
                <span class="tag-count">{activePlaylist.items.length} {activePlaylist.items.length === 1 ? 'track' : 'tracks'}</span>
                <span class="tag-mode" class:shuffle={activePlaylist.shuffleDefault}>
                  {activePlaylist.shuffleDefault ? '🔀 Random / Shuffle' : '🔁 Sequential / Rotate'}
                </span>
              </div>
            </div>
            <div class="active-actions">
              <button
                type="button"
                class="btn-mix"
                disabled={!session.canAddLayer() || activePlaylist.items.length === 0}
                title={activePlaylist.items.length === 0 ? 'Add tracks to playlist first' : 'Add this playlist as a layer in the mix'}
                onclick={() => handleAddToMix(activePlaylist)}
              >
                + Add to Mix
              </button>
              <button
                type="button"
                class="icon-btn"
                title="Edit playlist name & settings"
                onclick={() => startEditing(activePlaylist)}
              >
                ✏️
              </button>
              <button
                type="button"
                class="icon-btn"
                title="Duplicate playlist"
                onclick={() => handleDuplicate(activePlaylist.id)}
              >
                ❐
              </button>
              <button
                type="button"
                class="icon-btn danger"
                title="Delete playlist"
                onclick={() => handleDelete(activePlaylist.id)}
              >
                🗑
              </button>
            </div>
          {/if}
        </div>

        <!-- Add Tracks Section -->
        <div class="add-track-section">
          <div class="add-modes">
            <button
              type="button"
              class="mode-btn"
              class:selected={trackAddMode === 'local'}
              onclick={() => {
                trackAddMode = 'local';
                trackError = null;
              }}
            >
              📁 Add Local Audio
            </button>
            <button
              type="button"
              class="mode-btn"
              class:selected={trackAddMode === 'youtube'}
              onclick={() => {
                trackAddMode = 'youtube';
                trackError = null;
              }}
            >
              ▶ Add YouTube URL
            </button>
          </div>

          {#if trackAddMode === 'local'}
            <div class="add-local-area">
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                multiple
                bind:this={fileInputRef}
                style="display: none;"
                onchange={handleAddLocalFiles}
              />
              <button
                type="button"
                class="btn-file-select"
                disabled={isAddingTrack}
                onclick={() => fileInputRef?.click()}
              >
                <span class="file-icon">📂</span>
                <span>{isAddingTrack ? 'Importing audio files…' : 'Choose Local Audio Files (MP3, WAV, OGG, M4A, FLAC)'}</span>
              </button>
            </div>
          {:else}
            <form class="add-yt-form" onsubmit={handleAddYouTube}>
              <input
                type="text"
                placeholder="Paste YouTube video or livestream URL…"
                bind:value={youtubeUrl}
                disabled={isAddingTrack}
              />
              <button
                type="submit"
                class="btn-primary"
                disabled={isAddingTrack || !youtubeUrl.trim()}
              >
                {isAddingTrack ? 'Adding…' : 'Add Track'}
              </button>
            </form>
          {/if}

          {#if trackError}
            <p class="track-error">{trackError}</p>
          {/if}
        </div>

        <!-- Playlist Items List -->
        <div class="items-container">
          <h5 class="items-head">Tracks in Playlist</h5>
          {#if activePlaylist.items.length === 0}
            <div class="empty-items">
              <p>No tracks added yet. Use the buttons above to import local files or add YouTube streams.</p>
            </div>
          {:else}
            <div class="items-list">
              {#each activePlaylist.items as item, index (item.id)}
                <div class="item-card">
                  <div class="item-index">{index + 1}</div>
                  
                  {#if item.type === 'youtube'}
                    <div class="item-thumb-wrapper">
                      {#if item.thumbnailUrl}
                        <img src={item.thumbnailUrl} alt={item.title} class="item-thumb" loading="lazy" />
                      {:else}
                        <div class="item-thumb-placeholder yt">▶</div>
                      {/if}
                    </div>
                  {:else}
                    <div class="item-thumb-wrapper">
                      <div class="item-thumb-placeholder local">🎵</div>
                    </div>
                  {/if}

                  <div class="item-info">
                    <div class="item-title" title={item.title}>{item.title}</div>
                    <div class="item-type-badge" class:yt={item.type === 'youtube'} class:local={item.type === 'local'}>
                      {item.type === 'youtube' ? '▶ YouTube' : '📁 Local Audio'}
                    </div>
                  </div>

                  <div class="item-actions">
                    <button
                      type="button"
                      class="order-btn"
                      disabled={index === 0}
                      title="Move track up"
                      onclick={() => handleMoveUp(index)}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      class="order-btn"
                      disabled={index === activePlaylist.items.length - 1}
                      title="Move track down"
                      onclick={() => handleMoveDown(index)}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      class="remove-btn"
                      title="Remove from playlist"
                      onclick={() => handleRemoveItem(item.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .playlist-panel {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem;
    background: #181b20;
    color: #e2e8f0;
    border-radius: 8px;
    font-size: 0.9rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-title h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .pl-icon {
    font-size: 1.15rem;
  }

  .panel-intro {
    margin: 0;
    font-size: 0.82rem;
    color: #94a3b8;
    line-height: 1.4;
  }

  .btn-new {
    padding: 0.35rem 0.75rem;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-new:hover {
    background: #1d4ed8;
  }

  .create-form {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem;
    background: #20252e;
    border: 1px solid #334155;
    border-radius: 6px;
  }

  .form-title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #cbd5e1;
  }

  input[type='text'] {
    width: 100%;
    padding: 0.45rem 0.65rem;
    background: #111418;
    border: 1px solid #334155;
    border-radius: 5px;
    color: #f8fafc;
    font-size: 0.85rem;
    box-sizing: border-box;
  }

  input[type='text']:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.8rem;
    color: #94a3b8;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-label.compact {
    font-size: 0.78rem;
  }

  .form-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-primary {
    padding: 0.4rem 0.85rem;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 5px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: 0.4rem 0.75rem;
    background: transparent;
    color: #94a3b8;
    border: 1px solid #475569;
    border-radius: 5px;
    font-size: 0.82rem;
    cursor: pointer;
  }

  .btn-secondary:hover {
    color: #f1f5f9;
    border-color: #64748b;
  }

  .empty-state {
    padding: 1.5rem 1rem;
    text-align: center;
    color: #64748b;
    font-size: 0.85rem;
    border: 1px dashed #334155;
    border-radius: 6px;
  }

  .playlist-tabs {
    display: flex;
    gap: 0.35rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid #2d3748;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem;
    background: #20252e;
    color: #94a3b8;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: 0.82rem;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .tab-btn:hover {
    color: #f1f5f9;
    background: #28303b;
  }

  .tab-btn.active {
    background: #334155;
    color: #f8fafc;
    border-color: #3b82f6;
    font-weight: 600;
  }

  .tab-badge {
    display: inline-block;
    padding: 0.1rem 0.35rem;
    background: #111418;
    color: #cbd5e1;
    border-radius: 10px;
    font-size: 0.72rem;
    font-weight: 500;
  }

  .active-playlist-view {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .active-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.65rem 0.85rem;
    background: #20252e;
    border-radius: 6px;
  }

  .title-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .pl-name {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #f8fafc;
  }

  .meta-tags {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .tag-count,
  .tag-mode {
    font-size: 0.72rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    background: #111418;
    color: #94a3b8;
  }

  .tag-mode.shuffle {
    color: #a78bfa;
    border: 1px solid #6d28d9;
  }

  .active-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .btn-mix {
    padding: 0.35rem 0.75rem;
    background: #10b981;
    color: #fff;
    border: none;
    border-radius: 5px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .btn-mix:hover:not(:disabled) {
    background: #059669;
  }

  .btn-mix:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .icon-btn {
    padding: 0.3rem 0.5rem;
    background: #28303b;
    border: 1px solid #334155;
    border-radius: 4px;
    font-size: 0.78rem;
    cursor: pointer;
    color: #cbd5e1;
  }

  .icon-btn:hover {
    background: #334155;
  }

  .icon-btn.danger:hover {
    background: #7f1d1d;
    border-color: #991b1b;
  }

  .edit-box {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    width: 100%;
  }

  .edit-btns {
    display: flex;
    gap: 0.4rem;
  }

  .btn-primary-sm,
  .btn-secondary-sm {
    padding: 0.25rem 0.55rem;
    font-size: 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    border: none;
  }

  .btn-primary-sm {
    background: #3b82f6;
    color: #fff;
  }

  .btn-secondary-sm {
    background: transparent;
    border: 1px solid #475569;
    color: #cbd5e1;
  }

  .add-track-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: #1a1e26;
    border: 1px dashed #334155;
    border-radius: 6px;
  }

  .add-modes {
    display: flex;
    gap: 0.35rem;
  }

  .mode-btn {
    flex: 1;
    padding: 0.35rem 0.5rem;
    background: #20252e;
    color: #94a3b8;
    border: 1px solid #334155;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .mode-btn.selected {
    background: #2563eb;
    color: #fff;
    border-color: #3b82f6;
  }

  .add-local-area {
    display: flex;
  }

  .btn-file-select {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.65rem 1rem;
    background: #20252e;
    border: 1px dashed #475569;
    border-radius: 5px;
    color: #cbd5e1;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-file-select:hover:not(:disabled) {
    background: #28303b;
    border-color: #3b82f6;
    color: #fff;
  }

  .add-yt-form {
    display: flex;
    gap: 0.4rem;
  }

  .track-error {
    margin: 0;
    color: #f87171;
    font-size: 0.78rem;
  }

  .items-container {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .items-head {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .empty-items {
    padding: 1rem;
    text-align: center;
    color: #64748b;
    font-size: 0.82rem;
    border: 1px dashed #2d3748;
    border-radius: 5px;
  }

  .items-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .item-card {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.65rem;
    background: #20252e;
    border: 1px solid #2d3748;
    border-radius: 5px;
    transition: background 0.15s;
  }

  .item-card:hover {
    background: #262d38;
  }

  .item-index {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
    min-width: 1.2rem;
  }

  .item-thumb-wrapper {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .item-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .item-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
  }

  .item-thumb-placeholder.yt {
    background: #7f1d1d;
    color: #fca5a5;
  }

  .item-thumb-placeholder.local {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .item-title {
    font-size: 0.82rem;
    color: #f1f5f9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-type-badge {
    font-size: 0.68rem;
    color: #94a3b8;
  }

  .item-type-badge.yt {
    color: #f87171;
  }

  .item-type-badge.local {
    color: #60a5fa;
  }

  .item-actions {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  .order-btn {
    padding: 0.2rem 0.35rem;
    background: #181b20;
    color: #94a3b8;
    border: 1px solid #334155;
    border-radius: 3px;
    font-size: 0.65rem;
    cursor: pointer;
  }

  .order-btn:hover:not(:disabled) {
    background: #334155;
    color: #f8fafc;
  }

  .order-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .remove-btn {
    padding: 0.15rem 0.45rem;
    background: transparent;
    color: #94a3b8;
    border: none;
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
    border-radius: 3px;
  }

  .remove-btn:hover {
    color: #f87171;
    background: rgba(239, 68, 68, 0.15);
  }
</style>
