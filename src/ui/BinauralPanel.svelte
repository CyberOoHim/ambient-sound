<script lang="ts">
  import { session } from '../app/session';
  import {
    BRAINWAVE_PRESETS,
    type BinauralMode,
    type BrainwavePresetId,
    type WaveformType,
  } from '../app/binaural';
  import { linearToDb, dbToLinear } from '../audio/dsp/curves';

  interface Props {
    open?: boolean;
    onToggle?: () => void;
  }

  let { open = true, onToggle }: Props = $props();

  let config = $state(session.binauralConfig);

  export function sync() {
    config = session.binauralConfig;
    playing = session.playing;
  }

  let playing = $state(session.playing);

  function toggleEnabled() {
    session.updateBinauralConfig({ enabled: !config.enabled });
    playing = session.playing;
    sync();
  }

  function setMode(mode: BinauralMode) {
    session.updateBinauralConfig({ mode });
    sync();
  }

  function selectPreset(presetId: BrainwavePresetId) {
    const preset = BRAINWAVE_PRESETS[presetId];
    if (presetId === 'custom') {
      session.updateBinauralConfig({ preset: 'custom' });
    } else {
      session.updateBinauralConfig({
        preset: presetId,
        carrierFreq: preset.carrierFreq,
        beatFreq: preset.beatFreq,
      });
    }
    sync();
  }

  function setCarrierFreq(freq: number) {
    const carrierFreq = Math.max(40, Math.min(1000, freq));
    session.updateBinauralConfig({ carrierFreq, preset: 'custom' });
    sync();
  }

  function setBeatFreq(freq: number) {
    const beatFreq = Math.max(0.5, Math.min(50, Math.round(freq * 10) / 10));
    session.updateBinauralConfig({ beatFreq, preset: 'custom' });
    sync();
  }

  function setVolumeDb(db: number) {
    session.updateBinauralConfig({ volumeLinear: dbToLinear(db) });
    sync();
  }

  function setWaveform(waveform: WaveformType) {
    session.updateBinauralConfig({ waveform });
    sync();
  }

  const presetList = Object.values(BRAINWAVE_PRESETS);
</script>

<div class="binaural-panel" class:collapsed={!open}>
  <div
    class="panel-header"
    onclick={onToggle}
    role="button"
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle?.();
      }
    }}
    aria-expanded={open}
    aria-label={open ? 'Collapse Tone Generator deck' : 'Expand Tone Generator deck'}
  >
    <div class="header-info">
      <h3>
        <span>🎧</span> Tone Generator
      </h3>
      <p class="subtitle">
        Binaural beats & isochronic tones for deep sleep, meditation & focus.
      </p>
    </div>
    <div class="header-actions">
      <button
        class="toggle-btn"
        class:active={config.enabled}
        onclick={(e) => {
          e.stopPropagation();
          toggleEnabled();
        }}
        type="button"
        aria-label="Toggle Tone Generator"
      >
        <span class="toggle-track">
          <span class="toggle-thumb"></span>
        </span>
        <span class="toggle-label">{config.enabled ? 'Enabled' : 'Disabled'}</span>
      </button>
      <button
        type="button"
        class="expander-btn"
        onclick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-expanded={open}
        aria-label={open ? 'Collapse Tone Generator deck' : 'Expand Tone Generator deck'}
      >
        <span class="expander-icon" class:collapsed={!open} aria-hidden="true">▾</span>
      </button>
    </div>
  </div>

  {#if open}
    <div class="panel-body">
      {#if config.enabled && !playing}
        <p class="paused-hint" role="status">Starts with Play</p>
      {/if}

      {#if config.enabled}
        <div class="panel-content">
      <!-- Mode Tabs -->
      <div class="mode-tabs">
        <button
          type="button"
          class="tab-btn"
          class:active={config.mode === 'binaural'}
          onclick={() => setMode('binaural')}
        >
          🎧 Binaural Beats
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={config.mode === 'isochronic'}
          onclick={() => setMode('isochronic')}
        >
          🔊 Isochronic Tones
        </button>
      </div>

      {#if config.mode === 'binaural'}
        <div class="headphone-notice">
          <span class="notice-icon">🎧</span>
          <span>
            <strong>Headphones Required:</strong> Binaural beats route separate left/right
            frequencies to generate acoustic brainwave entrainment in your mind.
          </span>
        </div>
      {:else}
        <div class="headphone-notice isochronic">
          <span class="notice-icon">🔊</span>
          <span>
            <strong>Speaker Friendly:</strong> Isochronic tones use rapid amplitude pulses.
            Headphones are not required.
          </span>
        </div>
      {/if}

      <!-- Brainwave State Presets -->
      <div class="section-label">Brainwave Target State</div>
      <div class="preset-grid">
        {#each presetList as p (p.id)}
          <button
            type="button"
            class="preset-chip"
            class:active={config.preset === p.id}
            onclick={() => selectPreset(p.id)}
            title={p.description}
          >
            <span class="chip-icon">{p.icon}</span>
            <div class="chip-text">
              <span class="chip-title">{p.label}</span>
              {#if p.id !== 'custom'}
                <span class="chip-freq">{p.beatFreq} Hz</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>

      <!-- Frequency Sliders -->
      <div class="sliders-section">
        <div class="slider-group">
          <div class="slider-header">
            <label for="carrier-freq">Carrier Frequency</label>
            <span class="freq-value">{Math.round(config.carrierFreq)} Hz</span>
          </div>
          <input
            id="carrier-freq"
            type="range"
            min="40"
            max="1000"
            step="1"
            value={config.carrierFreq}
            oninput={(e) => setCarrierFreq(Number(e.currentTarget.value))}
          />
          <div class="slider-hints">
            <span>40 Hz (Low Pitch)</span>
            <span>1000 Hz (High Pitch)</span>
          </div>
        </div>

        <div class="slider-group">
          <div class="slider-header">
            <label for="beat-freq">Beat / Brainwave Frequency</label>
            <span class="freq-value beat">{config.beatFreq.toFixed(1)} Hz</span>
          </div>
          <input
            id="beat-freq"
            type="range"
            min="0.5"
            max="50"
            step="0.1"
            value={config.beatFreq}
            oninput={(e) => setBeatFreq(Number(e.currentTarget.value))}
          />
          <div class="slider-hints">
            <span>0.5 Hz (Delta)</span>
            <span>15 Hz (Beta)</span>
            <span>50 Hz (Gamma)</span>
          </div>
        </div>

        <!-- Volume & Waveform -->
        <div class="controls-row">
          <div class="slider-group vol-group">
            <div class="slider-header">
              <label for="binaural-vol">Tone Volume</label>
              <span class="vol-value">{linearToDb(config.volumeLinear).toFixed(0)} dB</span>
            </div>
            <input
              id="binaural-vol"
              type="range"
              min="-60"
              max="0"
              step="1"
              value={linearToDb(config.volumeLinear)}
              oninput={(e) => setVolumeDb(Number(e.currentTarget.value))}
            />
          </div>

          <div class="waveform-group">
            <label for="waveform-select">Waveform</label>
            <select
              id="waveform-select"
              value={config.waveform}
              onchange={(e) => setWaveform(e.currentTarget.value as WaveformType)}
            >
              <option value="sine">Sine (Pure)</option>
              <option value="triangle">Triangle (Warm)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Pulse Visualizer -->
      <div class="visualizer-bar">
        <div
          class="pulse-indicator"
          class:pulsing={playing && config.enabled}
          style="animation-duration: {Math.max(0.25, Math.min(2, 1 / Math.max(0.5, config.beatFreq)))}s"
        ></div>
        <span class="viz-text">
          {#if playing}
            Pulsing at <strong>{config.beatFreq.toFixed(1)} Hz</strong> ({config.mode === 'binaural' ? 'Binaural' : 'Isochronic'} Entrainment Active)
          {:else}
            Ready at <strong>{config.beatFreq.toFixed(1)} Hz</strong> ({config.mode === 'binaural' ? 'Binaural' : 'Isochronic'})
          {/if}
        </span>
      </div>
    </div>
  {/if}
    </div>
  {/if}
</div>

<style>
  .binaural-panel {
    background: var(--card, rgba(30, 41, 59, 0.7));
    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    border-radius: var(--radius-lg, 12px);
    padding: 1rem;
    margin-bottom: 0.85rem;
    box-shadow: var(--shadow-soft, 0 4px 12px rgba(0, 0, 0, 0.15));
  }

  .binaural-panel.collapsed {
    padding-bottom: 1rem;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
    user-select: none;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .expander-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: transparent;
    color: var(--muted, #94a3b8);
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    padding: 0;
    font-size: 0.85rem;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .expander-btn:hover {
    color: var(--accent, #60a5fa);
    background: rgba(255, 255, 255, 0.06);
  }

  .expander-icon {
    display: inline-block;
    transition: transform 0.2s ease;
    line-height: 1;
  }

  .expander-icon.collapsed {
    transform: rotate(-90deg);
  }

  .header-info h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 650;
    color: var(--text, #f1f5f9);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .subtitle {
    margin: 0.2rem 0 0 0;
    font-size: 0.725rem;
    color: var(--muted, #94a3b8);
    line-height: 1.35;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .toggle-track {
    width: 2.25rem;
    height: 1.25rem;
    background: rgba(100, 116, 139, 0.4);
    border-radius: 999px;
    position: relative;
    transition: background 0.2s ease;
  }

  .toggle-btn.active .toggle-track {
    background: #a855f7;
    box-shadow: 0 0 10px rgba(168, 85, 247, 0.4);
  }

  .toggle-thumb {
    width: 0.95rem;
    height: 0.95rem;
    background: #ffffff;
    border-radius: 50%;
    position: absolute;
    top: 0.15rem;
    left: 0.15rem;
    transition: transform 0.2s ease;
  }

  .toggle-btn.active .toggle-thumb {
    transform: translateX(1rem);
  }

  .toggle-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted, #94a3b8);
  }

  .toggle-btn.active .toggle-label {
    color: #c084fc;
  }

  .paused-hint {
    margin: 0.35rem 0 0;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--accent, #60a5fa);
  }

  .panel-content {
    margin-top: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
    background: rgba(15, 23, 42, 0.6);
    padding: 0.25rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .tab-btn {
    padding: 0.45rem 0.5rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #94a3b8;
    font-size: 0.775rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
  }

  .tab-btn:hover {
    color: #e2e8f0;
  }

  .tab-btn.active {
    background: rgba(168, 85, 247, 0.2);
    color: #e9d5ff;
    border: 1px solid rgba(168, 85, 247, 0.4);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .headphone-notice {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.65rem;
    background: rgba(168, 85, 247, 0.1);
    border: 1px solid rgba(168, 85, 247, 0.25);
    border-radius: 8px;
    font-size: 0.725rem;
    color: #e9d5ff;
    line-height: 1.35;
  }

  .headphone-notice.isochronic {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.25);
    color: #bfdbfe;
  }

  .notice-icon {
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .section-label {
    font-size: 0.725rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 0.4rem;
  }

  .preset-chip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
  }

  .preset-chip:hover {
    background: rgba(30, 41, 59, 0.7);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .preset-chip.active {
    background: rgba(168, 85, 247, 0.18);
    border-color: #a855f7;
    box-shadow: 0 0 8px rgba(168, 85, 247, 0.25);
  }

  .chip-icon {
    font-size: 0.95rem;
  }

  .chip-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .chip-title {
    font-size: 0.725rem;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preset-chip.active .chip-title {
    color: #f5f3ff;
  }

  .chip-freq {
    font-size: 0.65rem;
    color: #94a3b8;
  }

  .preset-chip.active .chip-freq {
    color: #d8b4fe;
  }

  .sliders-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: rgba(15, 23, 42, 0.4);
    padding: 0.75rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .slider-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .freq-value {
    font-weight: 600;
    color: #c084fc;
    font-size: 0.8rem;
  }

  .freq-value.beat {
    color: #38bdf8;
  }

  .vol-value {
    font-weight: 600;
    color: #a7f3d0;
    font-size: 0.8rem;
  }

  input[type='range'] {
    width: 100%;
    accent-color: #a855f7;
    cursor: pointer;
  }

  .slider-hints {
    display: flex;
    justify-content: space-between;
    font-size: 0.65rem;
    color: #64748b;
  }

  .controls-row {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 0.75rem;
    align-items: flex-end;
  }

  .waveform-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .waveform-group label {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .waveform-group select {
    padding: 0.35rem 0.5rem;
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: #f1f5f9;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .visualizer-bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    background: rgba(168, 85, 247, 0.08);
    border: 1px solid rgba(168, 85, 247, 0.2);
    border-radius: 6px;
  }

  .pulse-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #c084fc;
    box-shadow: 0 0 10px #c084fc;
    opacity: 0.5;
    transform: scale(0.85);
  }

  .pulse-indicator.pulsing {
    animation: vizPulse infinite ease-in-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse-indicator.pulsing {
      animation: none;
      opacity: 0.8;
      transform: scale(1);
    }
  }

  @keyframes vizPulse {
    0%, 100% {
      transform: scale(0.7);
      opacity: 0.4;
    }
    50% {
      transform: scale(1.3);
      opacity: 1;
      box-shadow: 0 0 14px #e9d5ff;
    }
  }

  .viz-text {
    font-size: 0.7rem;
    color: #d8b4fe;
  }
</style>
