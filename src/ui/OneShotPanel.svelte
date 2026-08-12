<script lang="ts">
  import { session } from '../app/session';
  import {
    ONE_SHOT_PACKS,
    ALL_ONE_SHOT_ASSETS,
    getAllOneShotPacks,
    type OneShotDensity,
    type OneShotPack,
    type CustomOneShotPack,
  } from '../app/one-shot';
  import { dbToLinear, linearToDb } from '../audio/dsp/curves';
  import { findAsset } from '../assets/catalog';

  let config = $state(session.oneShotConfig);
  let lastTrigger = $state(session.lastOneShotTrigger);
  let triggering = $state(false);
  let pulseTrigger = $state(false);
  let expandedPacks = $state<Record<string, boolean>>({});
  let history = $state(session.getOneShotHistory());
  let customPacks = $state(session.customOneShotPacks);
  let playing = $state(session.playing);

  // Custom Pack Manager Form state
  let showCreatePackModal = $state(false);
  let newPackTitle = $state('');
  let newPackIcon = $state('📦');
  let newPackDesc = $state('');
  let newPackSelectedAssets = $state<string[]>([...ALL_ONE_SHOT_ASSETS.slice(0, 3)]);
  let editingPackId = $state<string | null>(null);
  let editingPackTitle = $state('');

  const iconOptions = ['📦', '🦉', '🌩️', '🌲', '🌊', '🔥', '☕', '⛺', '🌌', '🎶'];

  export function sync() {
    config = session.oneShotConfig;
    lastTrigger = session.lastOneShotTrigger;
    history = session.getOneShotHistory();
    customPacks = session.customOneShotPacks;
    playing = session.playing;
  }

  function toggleEnabled() {
    session.updateOneShotConfig({ enabled: !config.enabled });
    playing = session.playing;
    sync();
  }

  function setDensity(density: OneShotDensity) {
    session.updateOneShotConfig({ density });
    sync();
  }

  function updateCustomInterval(sec: number) {
    session.updateOneShotConfig({ customIntervalMs: sec * 1000, density: 'custom' });
    sync();
  }

  function togglePack(packId: string) {
    const current = config.selectedPacks;
    let updated: string[];
    if (current.includes(packId)) {
      if (current.length === 1) return; // keep at least 1 pack
      updated = current.filter((id) => id !== packId);
    } else {
      updated = [...current, packId];
    }
    session.updateOneShotConfig({ selectedPacks: updated });
    sync();
  }

  function toggleAsset(assetId: string) {
    const current = config.selectedAssets ?? ALL_ONE_SHOT_ASSETS;
    let updated: string[];
    if (current.includes(assetId)) {
      if (current.length === 1) return;
      updated = current.filter((id) => id !== assetId);
    } else {
      updated = [...current, assetId];
    }
    session.updateOneShotConfig({ selectedAssets: updated });
    sync();
  }

  function togglePackExpand(packId: string, event: MouseEvent) {
    event.stopPropagation();
    expandedPacks[packId] = !expandedPacks[packId];
  }

  function setVolumeDb(db: number) {
    session.updateOneShotConfig({ volumeLinear: dbToLinear(db) });
    sync();
  }

  function toggleSpatialPan() {
    session.updateOneShotConfig({ spatialPan: !config.spatialPan });
    sync();
  }

  function togglePitchJitter() {
    session.updateOneShotConfig({ pitchJitter: !config.pitchJitter });
    sync();
  }

  function toggleDistanceFilter() {
    session.updateOneShotConfig({ distanceFilter: !config.distanceFilter });
    sync();
  }

  function toggleBurstSequence() {
    session.updateOneShotConfig({ burstSequence: !config.burstSequence });
    sync();
  }

  function toggleAcousticTail() {
    session.updateOneShotConfig({ acousticTail: !config.acousticTail });
    sync();
  }

  async function triggerNow(specificAssetId?: string) {
    triggering = true;
    try {
      const evt = await session.triggerOneShotNow(specificAssetId);
      if (evt) {
        pulseTrigger = true;
        setTimeout(() => (pulseTrigger = false), 1200);
      }
    } finally {
      triggering = false;
      sync();
    }
  }

  function handleCreatePack() {
    if (!newPackTitle.trim()) return;
    session.createCustomOneShotPack(
      newPackTitle,
      newPackIcon,
      newPackDesc.trim() || 'Custom user sound event pack',
      newPackSelectedAssets
    );
    newPackTitle = '';
    newPackDesc = '';
    showCreatePackModal = false;
    sync();
  }

  function startEditPack(pack: OneShotPack, event: MouseEvent) {
    event.stopPropagation();
    editingPackId = pack.id;
    editingPackTitle = pack.label;
    editingPackAssets = [...pack.assetIds];
  }

  let editingPackAssets = $state<string[]>([]);

  function saveEditPack(packId: string) {
    if (editingPackTitle.trim()) {
      session.renameCustomOneShotPack(packId, editingPackTitle);
    }
    if (editingPackAssets.length > 0) {
      session.updateCustomOneShotPackAssets(packId, editingPackAssets);
    }
    editingPackId = null;
    sync();
  }

  function toggleEditingPackAsset(assetId: string) {
    if (editingPackAssets.includes(assetId)) {
      if (editingPackAssets.length === 1) return;
      editingPackAssets = editingPackAssets.filter((id) => id !== assetId);
    } else {
      editingPackAssets = [...editingPackAssets, assetId];
    }
  }

  function handleDeletePack(packId: string, event: MouseEvent) {
    event.stopPropagation();
    session.deleteCustomOneShotPack(packId);
    sync();
  }

  function toggleCustomPackAsset(packId: string, assetId: string) {
    const pack = session.customOneShotPacks.find((p) => p.id === packId);
    if (!pack) return;
    const current = pack.assetIds;
    let updated: string[];
    if (current.includes(assetId)) {
      if (current.length === 1) return;
      updated = current.filter((id) => id !== assetId);
    } else {
      updated = [...current, assetId];
    }
    session.updateCustomOneShotPackAssets(packId, updated);
    sync();
  }

  function toggleNewPackAssetChoice(assetId: string) {
    if (newPackSelectedAssets.includes(assetId)) {
      if (newPackSelectedAssets.length === 1) return;
      newPackSelectedAssets = newPackSelectedAssets.filter((id) => id !== assetId);
    } else {
      newPackSelectedAssets = [...newPackSelectedAssets, assetId];
    }
  }

  function formatTimeAgo(ts: number): string {
    const diffSec = Math.round((Date.now() - ts) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    return `${Math.floor(diffSec / 60)}m ago`;
  }

  const densities: { id: OneShotDensity; label: string; icon: string; desc: string }[] = [
    { id: 'subtle', label: 'Subtle', icon: '🧘', desc: '1.5–5 min' },
    { id: 'balanced', label: 'Balanced', icon: '🌿', desc: '35s–2 min' },
    { id: 'lively', label: 'Lively', icon: '⚡', desc: '10–45 sec' },
    { id: 'custom', label: 'Custom', icon: '⏱️', desc: 'Adjustable' },
  ];
</script>

<div class="oneshot-panel">
  <div class="panel-header">
    <div class="header-info">
      <h3>🌿 Organic Audio Events</h3>
      <p class="subtitle">
        Stochastic background events (thunder, birds, ocean swells) with dynamic acoustic variations.
      </p>
    </div>
    <button
      class="toggle-btn"
      class:active={config.enabled}
      onclick={toggleEnabled}
      type="button"
      aria-label="Toggle One-Shot Scheduler"
    >
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
      <span class="toggle-label">{config.enabled ? 'Enabled' : 'Disabled'}</span>
    </button>
  </div>

  {#if config.enabled && !playing}
    <p class="paused-hint" role="status">Starts with Play</p>
  {/if}

  <!-- 2D Soundstage Radar Canvas -->
  <div class="radar-container">
    <div class="radar-header">
      <span class="radar-title">🧭 Spatial Soundstage Radar</span>
      <span class="radar-axis-label">L ◄ ─── Stereo Field ─── ► R</span>
    </div>
    <div class="radar-canvas" class:active-pulse={pulseTrigger}>
      <div class="radar-center-line"></div>
      <div class="radar-listener-node" title="Listener Position">👤</div>

      {#if lastTrigger}
        {@const panPct = ((lastTrigger.pan + 1) / 2) * 100}
        <div
          class="radar-event-ping"
          style="left: {panPct}%;"
          class:pulse={pulseTrigger}
        >
          <div class="ping-ring"></div>
          <div class="ping-core"></div>
          <div class="ping-label">
            <span class="ping-title">{lastTrigger.assetLabel}</span>
            <span class="ping-meta">
              Pan: {Math.round(lastTrigger.pan * 100)}% | {Math.round(lastTrigger.distanceFilterCutoff / 1000)}kHz
              {#if lastTrigger.burstCount > 1}
                | 🦜 x{lastTrigger.burstCount}
              {/if}
            </span>
          </div>
        </div>
      {:else}
        <div class="radar-placeholder">Waiting for next stochastic audio trigger…</div>
      {/if}
    </div>
  </div>

  <div class="test-row">
    <button
      class="btn btn-secondary test-btn"
      disabled={triggering}
      onclick={() => triggerNow()}
      type="button"
    >
      {triggering ? '⚡ Triggering Event…' : '⚡ Test Random Event Now'}
    </button>
  </div>

  <!-- Frequency / Poisson Distribution -->
  <div class="section">
    <h4 class="section-title">Event Frequency (Poisson Distribution)</h4>
    <div class="density-grid">
      {#each densities as d}
        <button
          class="density-card"
          class:selected={config.density === d.id}
          onclick={() => setDensity(d.id)}
          type="button"
        >
          <span class="density-icon">{d.icon}</span>
          <span class="density-label">{d.label}</span>
          <span class="density-desc">{d.desc}</span>
        </button>
      {/each}
    </div>

    {#if config.density === 'custom'}
      <div class="custom-interval-box">
        <div class="slider-row">
          <label for="custom-interval-slider">Average Trigger Interval</label>
          <span class="vol-value">{Math.round(config.customIntervalMs / 1000)}s</span>
        </div>
        <input
          id="custom-interval-slider"
          type="range"
          min="5"
          max="300"
          step="5"
          value={Math.round(config.customIntervalMs / 1000)}
          oninput={(e) => updateCustomInterval(Number((e.target as HTMLInputElement).value))}
        />
        <div class="interval-eta">
          Estimated trigger window: ~{Math.round((config.customIntervalMs * 0.4) / 1000)}s – {Math.round((config.customIntervalMs * 2.2) / 1000)}s
        </div>
      </div>
    {/if}
  </div>

  <!-- Sound Event Packs & Custom Pack Manager -->
  <div class="section">
    <div class="section-header-row">
      <h4 class="section-title">Sound Event Packs & Custom Sets</h4>
      <button
        class="create-pack-btn"
        onclick={() => (showCreatePackModal = !showCreatePackModal)}
        type="button"
      >
        ➕ Create Custom Pack
      </button>
    </div>

    <!-- Inline Create Pack Form Drawer -->
    {#if showCreatePackModal}
      <div class="create-pack-drawer">
        <div class="drawer-title">✨ Create New Custom Sound Pack</div>
        <div class="form-row">
          <div class="icon-picker">
            {#each iconOptions as ic}
              <button
                class="icon-opt"
                class:active={newPackIcon === ic}
                onclick={() => (newPackIcon = ic)}
                type="button"
              >
                {ic}
              </button>
            {/each}
          </div>
          <input
            type="text"
            class="input-field pack-name-input"
            placeholder="Pack Name (e.g., Deep Focus Forest)"
            bind:value={newPackTitle}
          />
        </div>
        <input
          type="text"
          class="input-field"
          placeholder="Short description (optional)"
          bind:value={newPackDesc}
        />

        <div class="modal-asset-select">
          <span class="sub-label">Select Included Audio Events:</span>
          <div class="asset-grid">
            {#each ALL_ONE_SHOT_ASSETS as assetId}
              {@const asset = session.getAsset(assetId)}
              {@const isChecked = newPackSelectedAssets.includes(assetId)}
              <label class="asset-chip" class:active={isChecked}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onchange={() => toggleNewPackAssetChoice(assetId)}
                />
                <span>{asset ? asset.title : assetId}</span>
              </label>
            {/each}
          </div>
        </div>

        <div class="drawer-actions">
          <button
            class="btn btn-secondary"
            onclick={() => (showCreatePackModal = false)}
            type="button"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary save-pack-btn"
            disabled={!newPackTitle.trim()}
            onclick={handleCreatePack}
            type="button"
          >
            Save Custom Pack
          </button>
        </div>
      </div>
    {/if}

    <div class="packs-grid">
      {#each getAllOneShotPacks(customPacks) as pack}
        {@const selected = config.selectedPacks.includes(pack.id)}
        {@const isExpanded = expandedPacks[pack.id]}
        <div class="pack-wrapper" class:selected class:is-custom-pack={pack.isCustom}>
          <div
            class="pack-card"
            class:selected
            onclick={() => togglePack(pack.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && togglePack(pack.id)}
          >
            <div class="pack-top">
              <span class="pack-icon">{pack.icon}</span>
              <span class="pack-label" title={pack.label}>{pack.label}</span>

              {#if pack.isCustom}
                <span class="custom-badge">Custom</span>
              {/if}
              <span class="pack-check">{selected ? '✓' : ''}</span>

              <div class="pack-actions">
                {#if pack.isCustom}
                  <button
                    class="action-icon-btn"
                    onclick={(e) => startEditPack(pack, e)}
                    title="Edit Custom Pack Name & Assets"
                    type="button"
                  >
                    ✏️
                  </button>
                  <button
                    class="action-icon-btn delete-btn"
                    onclick={(e) => handleDeletePack(pack.id, e)}
                    title="Delete Custom Pack"
                    type="button"
                  >
                    🗑️
                  </button>
                {/if}

                <button
                  class="expand-btn"
                  onclick={(e) => togglePackExpand(pack.id, e)}
                  title="Select/deselect individual sound events"
                  type="button"
                >
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>
            </div>
            <p class="pack-desc">{pack.description}</p>
          </div>

          {#if editingPackId === pack.id}
            <div class="pack-edit-box">
              <span class="checklist-sub">Edit Custom Pack Definition:</span>
              <input
                type="text"
                class="input-field"
                bind:value={editingPackTitle}
                placeholder="Pack Name"
              />
              <span class="sub-label">Included assets in this pack:</span>
              <div class="asset-grid">
                {#each ALL_ONE_SHOT_ASSETS as assetId}
                  {@const asset = session.getAsset(assetId)}
                  {@const inPack = editingPackAssets.includes(assetId)}
                  <label class="asset-chip" class:active={inPack}>
                    <input
                      type="checkbox"
                      checked={inPack}
                      onchange={() => toggleEditingPackAsset(assetId)}
                    />
                    <span>{asset ? asset.title : assetId}</span>
                  </label>
                {/each}
              </div>
              <div class="drawer-actions">
                <button
                  class="btn btn-secondary"
                  onclick={() => (editingPackId = null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  class="btn btn-primary save-pack-btn"
                  onclick={() => saveEditPack(pack.id)}
                  type="button"
                >
                  Save Changes
                </button>
              </div>
            </div>
          {/if}

          {#if isExpanded}
            <div class="asset-checklist">
              {#each pack.assetIds as assetId}
                {@const asset = session.getAsset(assetId)}
                {@const assetSelected = (config.selectedAssets ?? ALL_ONE_SHOT_ASSETS).includes(assetId)}
                <div class="asset-item">
                  <label class="asset-label">
                    <input
                      type="checkbox"
                      checked={assetSelected}
                      onchange={() => toggleAsset(assetId)}
                    />
                    <span>{asset ? asset.title : assetId}</span>
                  </label>
                  <button
                    class="asset-test-btn"
                    onclick={() => triggerNow(assetId)}
                    title="Test sound event"
                    type="button"
                  >
                    ▶
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- Master Volume -->
  <div class="section">
    <div class="slider-row">
      <label for="oneshot-vol">One-Shot Master Volume</label>
      <span class="vol-value">{Math.round(config.volumeLinear * 100)}%</span>
    </div>
    <input
      id="oneshot-vol"
      type="range"
      min="-40"
      max="0"
      step="0.5"
      value={linearToDb(config.volumeLinear)}
      oninput={(e) => setVolumeDb(Number((e.target as HTMLInputElement).value))}
    />
  </div>

  <!-- Acoustic Physics & Realism Options -->
  <div class="section">
    <div class="physics-settings-header">
      <span class="badge-physics">NATURAL REALISM PHYSICS & DSP</span>
    </div>
    <h4 class="section-title">Stochastic Event Acoustic Physics</h4>
    <div class="physics-toggles">
      <button
        class="chip-btn"
        class:active={config.spatialPan}
        onclick={toggleSpatialPan}
        type="button"
      >
        🎧 3D Stereo Panning
      </button>

      <button
        class="chip-btn"
        class:active={config.pitchJitter}
        onclick={togglePitchJitter}
        type="button"
      >
        🎵 Pitch Randomization (±8%)
      </button>

      <button
        class="chip-btn"
        class:active={config.distanceFilter}
        onclick={toggleDistanceFilter}
        type="button"
      >
        🌫️ Distance Atmosphere Filter
      </button>

      <button
        class="chip-btn"
        class:active={config.burstSequence}
        onclick={toggleBurstSequence}
        type="button"
      >
        🦜 Burst Call Sequences
      </button>

      <button
        class="chip-btn"
        class:active={config.acousticTail}
        onclick={toggleAcousticTail}
        type="button"
      >
        🏛️ Reverb Acoustic Tail
      </button>
    </div>
  </div>

  <!-- Activity History Log -->
  {#if history.length > 0}
    <div class="section">
      <h4 class="section-title">Recent Event History</h4>
      <div class="history-list">
        {#each history as evt}
          <div class="history-item">
            <span class="history-title">{evt.assetLabel}</span>
            <span class="history-pack">({evt.packLabel})</span>
            <span class="history-tags">
              <span>Pan: {Math.round(evt.pan * 100)}%</span>
              {#if evt.burstCount > 1}
                <span>x{evt.burstCount} bursts</span>
              {/if}
            </span>
            <span class="history-time">{formatTimeAgo(evt.timestamp)}</span>
            <button
              class="history-replay-btn"
              onclick={() => triggerNow(evt.assetId)}
              title="Replay Event"
              type="button"
            >
              🔄
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .oneshot-panel {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.25rem;
    background: rgba(18, 24, 38, 0.7);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    color: #e2e8f0;
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .header-info h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: #f8fafc;
  }

  .subtitle {
    margin: 0.25rem 0 0 0;
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    padding: 0.35rem 0.75rem 0.35rem 0.35rem;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #94a3b8;
    font-size: 0.825rem;
    font-weight: 500;
  }

  .toggle-btn.active {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.4);
    color: #60a5fa;
  }

  .toggle-track {
    width: 32px;
    height: 18px;
    background: #334155;
    border-radius: 999px;
    position: relative;
    transition: background 0.2s ease;
  }

  .toggle-btn.active .toggle-track {
    background: #3b82f6;
  }

  .toggle-thumb {
    width: 14px;
    height: 14px;
    background: #ffffff;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s ease;
  }

  .toggle-btn.active .toggle-thumb {
    transform: translateX(14px);
  }

  .paused-hint {
    margin: 0.35rem 0 0.5rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--accent, #60a5fa);
  }

  /* Soundstage Radar Visualizer */
  .radar-container {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(59, 130, 246, 0.25);
    border-radius: 12px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .radar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.775rem;
    color: #94a3b8;
  }

  .radar-title {
    font-weight: 600;
    color: #60a5fa;
  }

  .radar-axis-label {
    font-size: 0.7rem;
    color: #64748b;
  }

  .radar-canvas {
    height: 64px;
    background: radial-gradient(circle at center, rgba(30, 58, 138, 0.3) 0%, rgba(15, 23, 42, 0.8) 100%);
    border-radius: 8px;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed rgba(255, 255, 255, 0.08);
  }

  .radar-center-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    background: rgba(255, 255, 255, 0.1);
  }

  .radar-listener-node {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .radar-placeholder {
    font-size: 0.75rem;
    color: #64748b;
    font-style: italic;
  }

  .physics-settings-header {
    margin-bottom: 0.35rem;
  }

  .badge-physics {
    display: inline-block;
    font-size: 0.62rem;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    padding: 0.15rem 0.45rem;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .radar-event-ping {
    position: absolute;
    top: 35%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .ping-ring {
    width: 24px;
    height: 24px;
    border: 2px solid #38bdf8;
    border-radius: 50%;
    animation: radar-pulse 1.4s infinite ease-out;
    position: absolute;
  }

  .ping-core {
    width: 8px;
    height: 8px;
    background: #38bdf8;
    border-radius: 50%;
    box-shadow: 0 0 10px #38bdf8;
  }

  .ping-label {
    margin-top: 14px;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(56, 189, 248, 0.4);
    border-radius: 6px;
    padding: 0.2rem 0.4rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    white-space: nowrap;
    z-index: 2;
  }

  .ping-title {
    font-size: 0.725rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .ping-meta {
    font-size: 0.65rem;
    color: #38bdf8;
  }

  @keyframes radar-pulse {
    0% {
      transform: scale(0.5);
      opacity: 1;
    }
    100% {
      transform: scale(2.2);
      opacity: 0;
    }
  }

  .test-row {
    display: flex;
  }

  .test-btn {
    width: 100%;
    padding: 0.6rem 1rem;
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2));
    border: 1px solid rgba(147, 51, 234, 0.3);
    border-radius: 10px;
    color: #e0e7ff;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .test-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.35), rgba(147, 51, 234, 0.35));
    border-color: rgba(168, 85, 247, 0.5);
    transform: translateY(-1px);
  }

  .test-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .section-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-title {
    margin: 0;
    font-size: 0.825rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
    font-weight: 600;
  }

  .create-pack-btn {
    background: rgba(147, 51, 234, 0.15);
    border: 1px solid rgba(147, 51, 234, 0.35);
    color: #c084fc;
    border-radius: 6px;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .create-pack-btn:hover {
    background: rgba(147, 51, 234, 0.3);
    border-color: rgba(168, 85, 247, 0.5);
  }

  /* Create Pack Drawer */
  .create-pack-drawer {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(147, 51, 234, 0.4);
    border-radius: 12px;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .drawer-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #e9d5ff;
  }

  .form-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .icon-picker {
    display: flex;
    gap: 0.2rem;
    background: rgba(30, 41, 59, 0.6);
    padding: 0.2rem;
    border-radius: 6px;
    overflow-x: auto;
  }

  .icon-opt {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: 1rem;
    padding: 0.1rem 0.25rem;
    cursor: pointer;
  }

  .icon-opt.active {
    background: rgba(147, 51, 234, 0.3);
    border-color: #a855f7;
  }

  .input-field {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    color: #f8fafc;
    font-size: 0.825rem;
    flex: 1;
  }

  .input-field:focus {
    outline: none;
    border-color: #a855f7;
  }

  .modal-asset-select {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .sub-label {
    font-size: 0.725rem;
    color: #cbd5e1;
  }

  .asset-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-height: 120px;
    overflow-y: auto;
  }

  .asset-chip {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.2rem 0.45rem;
    border-radius: 6px;
    font-size: 0.725rem;
    color: #94a3b8;
    cursor: pointer;
  }

  .asset-chip.active {
    background: rgba(147, 51, 234, 0.25);
    border-color: #a855f7;
    color: #e9d5ff;
  }

  .drawer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }

  .save-pack-btn {
    background: linear-gradient(135deg, #8b5cf6, #d946ef);
    border: none;
    color: white;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.35rem 0.85rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .pack-edit-box {
    border-top: 1px solid rgba(147, 51, 234, 0.3);
    background: rgba(15, 23, 42, 0.85);
    padding: 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .density-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .density-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.65rem 0.35rem;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #cbd5e1;
  }

  .density-card:hover {
    background: rgba(51, 65, 85, 0.6);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .density-card.selected {
    background: rgba(59, 130, 246, 0.2);
    border-color: #3b82f6;
    color: #60a5fa;
  }

  .density-icon {
    font-size: 1.15rem;
  }

  .density-label {
    font-size: 0.8rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }

  .density-desc {
    font-size: 0.675rem;
    color: #64748b;
  }

  .density-card.selected .density-desc {
    color: #93c5fd;
  }

  .custom-interval-box {
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    margin-top: 0.4rem;
  }

  .interval-eta {
    font-size: 0.725rem;
    color: #94a3b8;
    margin-top: 0.25rem;
  }

  .packs-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.6rem;
  }

  .pack-wrapper {
    display: flex;
    flex-direction: column;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .pack-wrapper.selected {
    border-color: #10b981;
  }

  .pack-wrapper.is-custom-pack {
    border-style: dashed;
  }

  .pack-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.65rem;
    cursor: pointer;
    text-align: left;
  }

  .pack-card:hover {
    background: rgba(51, 65, 85, 0.4);
  }

  .pack-top {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 0.3rem;
  }

  .pack-icon {
    font-size: 1.1rem;
    flex-shrink: 0;
  }

  .pack-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #f1f5f9;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .custom-badge {
    background: rgba(168, 85, 247, 0.2);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.4);
    font-size: 0.6rem;
    font-weight: bold;
    padding: 0.05rem 0.25rem;
    border-radius: 4px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .pack-check {
    font-size: 0.85rem;
    color: #34d399;
    font-weight: bold;
    flex-shrink: 0;
  }

  .pack-actions {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
    margin-left: auto;
  }

  .action-icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.725rem;
    padding: 0.1rem 0.2rem;
    opacity: 0.75;
    flex-shrink: 0;
  }

  .action-icon-btn:hover {
    opacity: 1;
  }

  .expand-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #94a3b8;
    font-size: 0.7rem;
    padding: 0.15rem 0.35rem;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .expand-btn:hover {
    background: rgba(59, 130, 246, 0.25);
    color: #60a5fa;
    border-color: #3b82f6;
  }

  .pack-desc {
    margin: 0.25rem 0 0 0;
    font-size: 0.725rem;
    color: #64748b;
    line-height: 1.2;
  }

  .asset-checklist {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(15, 23, 42, 0.5);
    padding: 0.5rem 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .checklist-sub {
    font-size: 0.675rem;
    color: #a855f7;
    font-weight: 600;
  }

  .asset-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
    color: #cbd5e1;
  }

  .asset-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
  }

  .asset-test-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #60a5fa;
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    font-size: 0.65rem;
    cursor: pointer;
  }

  .asset-test-btn:hover {
    background: rgba(59, 130, 246, 0.2);
  }

  .slider-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.825rem;
    color: #94a3b8;
  }

  .vol-value {
    font-weight: 600;
    color: #60a5fa;
  }

  input[type='range'] {
    width: 100%;
    accent-color: #3b82f6;
  }

  .physics-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .chip-btn {
    padding: 0.4rem 0.75rem;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    font-size: 0.775rem;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .chip-btn:hover {
    background: rgba(51, 65, 85, 0.6);
    color: #e2e8f0;
  }

  .chip-btn.active {
    background: rgba(139, 92, 246, 0.2);
    border-color: #8b5cf6;
    color: #c084fc;
  }

  /* History list */
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 140px;
    overflow-y: auto;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(30, 41, 59, 0.4);
    padding: 0.35rem 0.6rem;
    border-radius: 6px;
    font-size: 0.725rem;
  }

  .history-title {
    font-weight: 600;
    color: #e2e8f0;
  }

  .history-pack {
    color: #64748b;
  }

  .history-tags {
    margin-left: auto;
    color: #38bdf8;
    font-size: 0.675rem;
    display: flex;
    gap: 0.35rem;
  }

  .history-time {
    color: #64748b;
    font-size: 0.675rem;
  }

  .history-replay-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.75rem;
    opacity: 0.7;
    padding: 0 0.2rem;
  }

  .history-replay-btn:hover {
    opacity: 1;
  }
</style>

