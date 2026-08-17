<script lang="ts">
  import { pwa } from '../app/pwa';

  interface Props {
    open?: boolean;
    onclose?: () => void;
  }

  let { open = false, onclose }: Props = $props();

  let isIOS = $derived(pwa.isIOS);

  function close() {
    onclose?.();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
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
      aria-labelledby="install-title"
      tabindex="-1"
    >
      <header class="dlg-head">
        <h2 id="install-title">
          {isIOS ? 'Install on iPad & iPhone' : 'Install Ambient'}
        </h2>
        <button type="button" class="close" aria-label="Close" onclick={close}>
          ×
        </button>
      </header>

      <div class="body">
        <div class="app-card">
          <img
            src="./apple-touch-icon.png"
            alt="Ambient app icon"
            class="app-icon"
            width="56"
            height="56"
          />
          <div class="app-info">
            <span class="app-name">Ambient</span>
            <span class="app-sub">Soft ambient mixer & sleep timer</span>
            <span class="app-tag">PWA · Offline-ready</span>
          </div>
        </div>

        {#if isIOS}
          <div class="guide-steps">
            <p class="steps-heading">Follow these 3 quick steps in Safari:</p>
            <ol class="steps-list">
              <li>
                <div class="step-num">1</div>
                <div class="step-content">
                  <p>
                    Tap the <strong>Share</strong> button
                    <span class="icon-pill" title="Share button">⎋</span>
                    in Safari’s toolbar.
                  </p>
                  <span class="step-sub">Found at the top on iPad, or bottom on iPhone.</span>
                </div>
              </li>
              <li>
                <div class="step-num">2</div>
                <div class="step-content">
                  <p>
                    Scroll down and select
                    <strong>Add to Home Screen</strong>
                    <span class="icon-pill" title="Add to Home Screen">➕</span>
                  </p>
                  <span class="step-sub">Creates an independent standalone app icon.</span>
                </div>
              </li>
              <li>
                <div class="step-num">3</div>
                <div class="step-content">
                  <p>Tap <strong>Add</strong> in the top-right corner.</p>
                  <span class="step-sub">Launch from your Home Screen anytime!</span>
                </div>
              </li>
            </ol>
          </div>
        {:else}
          <div class="guide-steps">
            <p class="steps-heading">Add Ambient to your device:</p>
            <ol class="steps-list">
              <li>
                <div class="step-num">1</div>
                <div class="step-content">
                  <p>Open your browser menu (<strong>⋮</strong> or <strong>File</strong>).</p>
                </div>
              </li>
              <li>
                <div class="step-num">2</div>
                <div class="step-content">
                  <p>Click <strong>Install Ambient</strong> or <strong>Add to Home Screen</strong>.</p>
                  <span class="step-sub">Runs in its own window with zero clutter.</span>
                </div>
              </li>
            </ol>
          </div>
        {/if}

        <div class="features-card">
          <ul class="features-list">
            <li>✦ Works seamlessly offline with zero latency</li>
            <li>✦ Fullscreen view without address bars</li>
            <li>✦ Background & lock-screen audio playback</li>
          </ul>
        </div>

        <div class="actions">
          <button type="button" class="btn-primary" onclick={close}>
            Got it
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 85;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(8, 6, 4, 0.76);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  .dialog {
    width: min(30rem, 100%);
    max-height: min(88svh, 44rem);
    display: flex;
    flex-direction: column;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card), 0 20px 48px rgba(0, 0, 0, 0.5);
    outline: none;
    animation: fadeInScale 0.18s ease-out;
  }

  @keyframes fadeInScale {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .dlg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--text);
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
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .app-card {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 0.85rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
  }

  .app-icon {
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 0.75rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    flex-shrink: 0;
  }

  .app-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .app-name {
    font-size: 0.95rem;
    font-weight: 650;
    color: var(--text);
  }

  .app-sub {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .app-tag {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .guide-steps {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .steps-heading {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-soft);
  }

  .steps-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .steps-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.6rem 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .step-num {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-pill);
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 700;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .step-content {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .step-content p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.35;
    color: var(--text-soft);
  }

  .step-sub {
    font-size: 0.72rem;
    color: var(--muted-soft);
  }

  .icon-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.1rem 0.35rem;
    font-size: 0.8rem;
    background: var(--card);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-sm);
    color: var(--text);
    vertical-align: middle;
    margin: 0 0.15rem;
  }

  .features-card {
    padding: 0.65rem 0.8rem;
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
  }

  .features-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .features-list li {
    font-size: 0.74rem;
    color: var(--muted);
    line-height: 1.3;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.25rem;
  }

  .btn-primary {
    padding: 0.55rem 1.25rem;
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    font-weight: 650;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }
</style>
