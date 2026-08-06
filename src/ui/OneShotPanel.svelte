<script lang="ts">
  import { session } from '../app/session';
  import { ONE_SHOT_PACKS, type OneShotDensity } from '../app/one-shot';
  import { dbToLinear, linearToDb } from '../audio/dsp/curves';

  let config = $state(session.oneShotConfig);
  let lastTrigger = $state(session.lastOneShotTrigger);
  let triggering = $state(false);
  let pulseTrigger = $state(false);

  export function sync() {
    config = session.oneShotConfig;
    lastTrigger = session.lastOneShotTrigger;
  }

  function toggleEnabled() {
    session.updateOneShotConfig({ enabled: !config.enabled });
    sync();
  }

  function setDensity(density: OneShotDensity) {
    session.updateOneShotConfig({ density });
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

  async function triggerNow() {
    triggering = true;
    try {
      const evt = await session.triggerOneShotNow();
      if (evt) {
        pulseTrigger = true;
        setTimeout(() => (pulseTrigger = false), 1200);
      }
    } finally {
      triggering = false;
      sync();
    }
  }

  const densities: { id: OneShotDensity; label: string; icon: string; desc: string }[] = [
    { id: 'subtle', label: 'Subtle', icon: '🧘', desc: 'Every 3–5 min' },
    { id: 'balanced', label: 'Balanced', icon: '🌿', desc: 'Every 1–2 min' },
    { id: 'lively', label: 'Lively', icon: '⚡', desc: 'Every 15–45 sec' },
  ];
</script>

<div class="oneshot-panel">
  <div class="panel-header">
    <div class="header-info">
      <h3>🌿 Organic Audio Events</h3>
      <p class="subtitle">
        Occasional background events (thunder, birds, ocean swells) to break loop monotony.
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

  {#if lastTrigger}
    <div class="last-trigger-badge" class:pulse={pulseTrigger}>
      <span class="pulse-dot"></span>
      <span class="trigger-text">
        <strong>Recent Event:</strong>
        {lastTrigger.assetLabel} ({lastTrigger.packLabel})
      </span>
    </div>
  {/if}

  <div class="test-row">
    <button
      class="btn btn-secondary test-btn"
      disabled={triggering}
      onclick={triggerNow}
      type="button"
    >
      {triggering ? '⚡ Triggering Event…' : '⚡ Test Random Event Now'}
    </button>
  </div>

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
  </div>

  <div class="section">
    <h4 class="section-title">Sound Event Packs</h4>
    <div class="packs-grid">
      {#each ONE_SHOT_PACKS as pack}
        {@const selected = config.selectedPacks.includes(pack.id)}
        <button
          class="pack-card"
          class:selected
          onclick={() => togglePack(pack.id)}
          type="button"
        >
          <div class="pack-top">
            <span class="pack-icon">{pack.icon}</span>
            <span class="pack-label">{pack.label}</span>
            <span class="pack-check">{selected ? '✓' : ''}</span>
          </div>
          <p class="pack-desc">{pack.description}</p>
        </button>
      {/each}
    </div>
  </div>

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

  <div class="section">
    <h4 class="section-title">Natural Realism Physics</h4>
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
    </div>
  </div>
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

  .last-trigger-badge {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(59, 130, 246, 0.3);
    padding: 0.5rem 0.85rem;
    border-radius: 10px;
    font-size: 0.85rem;
    color: #cbd5e1;
    transition: all 0.3s ease;
  }

  .last-trigger-badge.pulse {
    border-color: #60a5fa;
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.4);
    background: rgba(30, 58, 138, 0.4);
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: #38bdf8;
    border-radius: 50%;
    box-shadow: 0 0 8px #38bdf8;
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

  .section-title {
    margin: 0;
    font-size: 0.825rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
    font-weight: 600;
  }

  .density-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.6rem;
  }

  .density-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.65rem 0.5rem;
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
    font-size: 1.25rem;
  }

  .density-label {
    font-size: 0.85rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }

  .density-desc {
    font-size: 0.725rem;
    color: #64748b;
  }

  .density-card.selected .density-desc {
    color: #93c5fd;
  }

  .packs-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.6rem;
  }

  .pack-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.65rem;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
  }

  .pack-card:hover {
    background: rgba(51, 65, 85, 0.6);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .pack-card.selected {
    background: rgba(16, 185, 129, 0.15);
    border-color: #10b981;
  }

  .pack-top {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 0.4rem;
  }

  .pack-icon {
    font-size: 1.1rem;
  }

  .pack-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #f1f5f9;
    flex: 1;
  }

  .pack-check {
    font-size: 0.85rem;
    color: #34d399;
    font-weight: bold;
  }

  .pack-desc {
    margin: 0.25rem 0 0 0;
    font-size: 0.725rem;
    color: #64748b;
    line-height: 1.2;
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
</style>
