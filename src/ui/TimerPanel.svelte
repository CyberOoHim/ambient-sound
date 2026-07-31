<script lang="ts">
  import { session } from '../app/session';
  import { formatDurationLabel, formatRemaining } from './format';

  let durationSec = $state(session.timerDefaults.durationSec);
  let fadeSec = $state(session.timerDefaults.fadeSec);
  let status = $state(session.timer.status);
  let remainingMs = $state<number | null>(null);
  let busy = $state(false);

  const presets = [
    { sec: 5 * 60, label: '5m' },
    { sec: 15 * 60, label: '15m' },
    { sec: 30 * 60, label: '30m' },
    { sec: 45 * 60, label: '45m' },
    { sec: 60 * 60, label: '60m' },
    { sec: 90 * 60, label: '90m' },
  ];

  const fadeOptions = [
    { sec: 15, label: '15s' },
    { sec: 30, label: '30s' },
    { sec: 60, label: '1m' },
    { sec: 120, label: '2m' },
    { sec: 300, label: '5m' },
  ];

  export function sync() {
    durationSec = session.timerDefaults.durationSec;
    fadeSec = session.timerDefaults.fadeSec;
    status = session.timer.status;
    remainingMs = session.remainingMs();
  }

  async function start() {
    busy = true;
    try {
      session.setTimerDefaults(durationSec, fadeSec);
      await session.startTimer(durationSec, fadeSec);
      sync();
    } finally {
      busy = false;
    }
  }

  function cancel() {
    session.cancelTimer();
    sync();
  }

  function pickDuration(sec: number) {
    durationSec = sec;
    session.setTimerDefaults(durationSec, fadeSec);
  }

  function pickFade(sec: number) {
    fadeSec = sec;
    session.setTimerDefaults(durationSec, fadeSec);
  }
</script>

<section class="card timer">
  <div class="head">
    <h2>Sleep timer</h2>
    {#if status === 'running' || status === 'fading'}
      <span class="countdown" class:fading={status === 'fading'}>
        {remainingMs != null ? formatRemaining(remainingMs) : '—'}
        {status === 'fading' ? ' · fading' : ''}
      </span>
    {:else if status === 'done'}
      <span class="countdown done">Ended</span>
    {/if}
  </div>

  <p class="help">
    Plays for the chosen duration, then fades out and stops. Total time includes the fade.
  </p>

  <div class="chips" role="group" aria-label="Duration">
    {#each presets as p}
      <button
        type="button"
        class="chip"
        class:on={durationSec === p.sec}
        disabled={status === 'running' || status === 'fading'}
        onclick={() => pickDuration(p.sec)}
      >
        {p.label}
      </button>
    {/each}
  </div>

  <div class="row">
    <label for="dur-custom">Custom</label>
    <input
      id="dur-custom"
      type="number"
      min="1"
      max="720"
      step="1"
      value={Math.round(durationSec / 60)}
      disabled={status === 'running' || status === 'fading'}
      oninput={(e) => {
        const mins = Math.max(1, Number(e.currentTarget.value) || 1);
        durationSec = mins * 60;
        session.setTimerDefaults(durationSec, fadeSec);
      }}
    />
    <span class="db">min ({formatDurationLabel(durationSec)})</span>
  </div>

  <div class="fade-label">Fade out</div>
  <div class="chips" role="group" aria-label="Fade length">
    {#each fadeOptions as f}
      <button
        type="button"
        class="chip"
        class:on={fadeSec === f.sec}
        disabled={status === 'running' || status === 'fading'}
        onclick={() => pickFade(f.sec)}
      >
        {f.label}
      </button>
    {/each}
  </div>

  <div class="actions">
    {#if status === 'running' || status === 'fading'}
      <button type="button" class="secondary" onclick={cancel}>Cancel timer</button>
    {:else}
      <button type="button" class="primary" disabled={busy} onclick={() => void start()}>
        Start timer
      </button>
    {/if}
  </div>
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }

  h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .help {
    margin: 0 0 0.65rem;
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.4;
  }

  .countdown {
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    color: var(--accent);
    font-size: 0.95rem;
  }

  .countdown.fading {
    color: #f0b429;
  }

  .countdown.done {
    color: var(--muted);
    font-weight: 500;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.55rem;
  }

  .chip {
    min-width: auto;
    padding: 0.3rem 0.55rem;
    font-size: 0.8rem;
    font-weight: 600;
    border-radius: 0.45rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }

  .chip.on {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .row {
    display: grid;
    grid-template-columns: 3.5rem 5rem 1fr;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.55rem;
  }

  .row label {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .row input {
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.3rem 0.4rem;
  }

  .db {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .fade-label {
    font-size: 0.8rem;
    color: var(--muted);
    margin-bottom: 0.35rem;
  }

  .actions {
    margin-top: 0.35rem;
  }

  .primary {
    background: var(--accent);
    border: none;
    color: #0b1020;
    font-weight: 650;
    border-radius: 0.55rem;
    padding: 0.45rem 0.9rem;
    cursor: pointer;
    font: inherit;
  }

  .secondary {
    font: inherit;
    cursor: pointer;
    border-radius: 0.55rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    padding: 0.45rem 0.85rem;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
