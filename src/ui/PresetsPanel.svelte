<script lang="ts">
  import { session } from '../app/session';
  import type { PresetV1 } from '../app/presets';
  import { buildShareUrl } from '../app/share';

  let presets = $state<PresetV1[]>(session.presets);
  let name = $state('');
  let selectedId = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);

  export function sync() {
    presets = session.presets;
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
    const existing = presets.find(
      (p) => p.name.toLowerCase() === n.toLowerCase(),
    );
    if (existing) {
      if (!confirm(`Overwrite preset “${existing.name}”?`)) return;
      const p = session.savePreset(n, existing.id);
      name = '';
      selectedId = p.id;
      sync();
      message = `Updated “${p.name}”`;
      return;
    }
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

  function restoreDefaults() {
    const n = session.restoreDefaultPresets();
    sync();
    message =
      n > 0
        ? `Restored ${n} default preset${n === 1 ? '' : 's'}`
        : 'All default presets already present';
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
    <button type="button" class="secondary" onclick={restoreDefaults}>
      Restore defaults
    </button>
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
</style>
