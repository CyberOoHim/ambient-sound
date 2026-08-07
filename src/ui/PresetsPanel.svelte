<script lang="ts">
  import { session } from '../app/session';
  import type { PresetV1 } from '../app/presets';
  import { buildShareUrl } from '../app/share';
  import {
    DUPLICATE_MIN_OFFSET_MAX_SEC,
    DUPLICATE_MIN_OFFSET_MIN_SEC,
  } from '../audio/dsp/loop';

  let presets = $state<PresetV1[]>(session.presets);
  let name = $state('');
  let selectedId = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let minOffsetSec = $state(session.duplicateMinOffsetSec);

  export function sync() {
    presets = session.presets;
    minOffsetSec = session.duplicateMinOffsetSec;
  }

  function onMinOffsetInput(e: Event) {
    const raw = Number((e.target as HTMLInputElement).value);
    session.setDuplicateMinOffsetSec(raw);
    minOffsetSec = session.duplicateMinOffsetSec;
  }

  function sceneHint(p: PresetV1): string {
    const parts = [`${p.layers.length} layer${p.layers.length === 1 ? '' : 's'}`];
    if (p.binaural?.enabled) parts.push('tones');
    if (p.oneShot?.enabled) parts.push('events');
    return parts.join(' · ');
  }

  async function load(id: string) {
    busy = true;
    message = null;
    try {
      await session.loadPreset(id);
      selectedId = id;
      message = 'Loaded — press Play if paused';
    } finally {
      busy = false;
    }
  }

  function save() {
    message = null;
    const n = name.trim() || `Preset ${presets.length + 1}`;
    const p = session.savePreset(n);
    name = '';
    selectedId = p.id;
    sync();
    message = `Saved “${p.name}” (mix + tones + events)`;
  }

  function remove(id: string) {
    if (!confirm('Delete this preset?')) return;
    session.removePreset(id);
    if (selectedId === id) selectedId = null;
    sync();
    message = 'Deleted';
  }

  async function exportSelected() {
    if (!selectedId) {
      message = 'Select a preset first';
      return;
    }
    const json = session.exportPresetJson(selectedId);
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      message = 'Copied JSON to clipboard';
    } catch {
      message = 'Could not copy';
    }
  }

  async function copyShareLink() {
    message = null;
    const snap =
      selectedId != null
        ? (session.presets.find((p) => p.id === selectedId) ??
          session.captureSceneSnapshot())
        : session.captureSceneSnapshot(name.trim() || 'Shared mix');
    const url = buildShareUrl(snap);
    try {
      await navigator.clipboard.writeText(url);
      message = 'Share link copied';
    } catch {
      message = 'Could not copy link';
    }
  }

  async function importFromClipboard() {
    message = null;
    try {
      const text = await navigator.clipboard.readText();
      const p = session.importPresetJson(text);
      if (!p) {
        message = 'Not a valid preset';
        return;
      }
      sync();
      selectedId = p.id;
      message = `Imported “${p.name}”`;
    } catch {
      message = 'Could not read clipboard';
    }
  }
</script>

<section class="panel presets">
  <header class="panel-head">
    <h2>Presets</h2>
    <p class="hint">auto-saves last mix</p>
  </header>

  <div class="save-row">
    <input
      type="text"
      placeholder="Name this mix…"
      bind:value={name}
      maxlength="48"
      aria-label="Preset name"
    />
    <button type="button" class="primary" onclick={save}>Save</button>
  </div>

  {#if presets.length === 0}
    <p class="empty">No presets yet — save your favorite mix.</p>
  {:else}
    <ul class="list">
      {#each presets as p (p.id)}
        <li class:selected={selectedId === p.id}>
          <button
            type="button"
            class="name"
            disabled={busy}
            onclick={() => void load(p.id)}
          >
            <span class="title">{p.name}</span>
            <span class="meta">{sceneHint(p)}</span>
          </button>
          <button
            type="button"
            class="chip danger"
            aria-label="Delete {p.name}"
            onclick={() => remove(p.id)}
          >
            ×
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="io">
    <button type="button" class="secondary" onclick={() => void copyShareLink()}>
      Copy link
    </button>
    <button type="button" class="secondary" onclick={() => void exportSelected()}>
      Copy JSON
    </button>
    <button type="button" class="secondary" onclick={() => void importFromClipboard()}>
      Paste JSON
    </button>
  </div>

  {#if message}
    <p class="msg" role="status">{message}</p>
  {/if}

  <div class="dup-offset">
    <label class="dup-label" for="dup-min-offset">
      Min offset (same sound)
    </label>
    <div class="dup-row">
      <input
        id="dup-min-offset"
        class="dup-input"
        type="number"
        min={DUPLICATE_MIN_OFFSET_MIN_SEC}
        max={DUPLICATE_MIN_OFFSET_MAX_SEC}
        step="0.5"
        value={minOffsetSec}
        onchange={onMinOffsetInput}
        title="Later copies of the same sound start at least this far into the loop"
      />
      <span class="dup-unit">s</span>
    </div>
    <p class="dup-hint">
      Extra copies start later in the loop so they thicken the mix, not only the volume.
    </p>
  </div>
</section>

<style>
  .panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.65rem 0.75rem 0.7rem;
    box-shadow: var(--shadow-card);
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
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

  .save-row {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .save-row input {
    flex: 1;
    min-width: 0;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.5rem;
    font: inherit;
    font-size: 0.8rem;
  }

  .save-row input::placeholder {
    color: var(--muted-soft);
  }

  .primary {
    background: var(--accent);
    border: none;
    color: var(--accent-ink);
    font-weight: 650;
    border-radius: var(--radius-pill);
    padding: 0.35rem 0.7rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    white-space: nowrap;
    box-shadow: 0 2px 8px var(--accent-glow);
  }

  .primary:hover {
    background: var(--accent-hover);
  }

  .secondary {
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--muted);
    padding: 0.28rem 0.55rem;
    font-size: 0.72rem;
    font-weight: 600;
  }

  .secondary:hover {
    color: var(--text-soft);
    border-color: var(--border-soft);
  }

  .empty {
    margin: 0.1rem 0 0.5rem;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.35;
  }

  .list {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 9.5rem;
    overflow-y: auto;
  }

  .list li {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    padding: 0.1rem 0.15rem 0.1rem 0.1rem;
  }

  .list li.selected {
    border-color: var(--accent);
    background: var(--accent-dim);
  }

  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    padding: 0.3rem 0.4rem;
    border-radius: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
  }

  .name:hover {
    background: color-mix(in srgb, var(--card) 70%, transparent);
  }

  .title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    font-size: 0.65rem;
    color: var(--muted-soft);
  }

  .chip {
    min-width: 1.6rem;
    height: 1.6rem;
    border: none;
    background: transparent;
    color: var(--danger);
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
    font: inherit;
    font-weight: 700;
    font-size: 0.9rem;
    line-height: 1;
  }

  .chip:hover {
    background: var(--danger-dim);
  }

  .io {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .msg {
    margin: 0.4rem 0 0;
    font-size: 0.72rem;
    color: var(--accent);
  }

  .dup-offset {
    margin-top: 0.65rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--border);
  }

  .dup-label {
    display: block;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--muted-soft);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.25rem;
  }

  .dup-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .dup-input {
    width: 4.5rem;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.28rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }

  .dup-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .dup-unit {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .dup-hint {
    margin: 0.3rem 0 0;
    font-size: 0.65rem;
    line-height: 1.35;
    color: var(--muted-soft);
  }
</style>
