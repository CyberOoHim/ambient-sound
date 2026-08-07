<script lang="ts">
  import { session } from '../app/session';
  import { formatDurationLabel, formatRemaining } from './format';

  let durationSec = $state(session.timerDefaults.durationSec);
  let activeDurationSec = $state(session.timer.durationSec);
  let fadeSec = $state(session.timerDefaults.fadeSec);
  let status = $state(session.timer.status);
  let remainingMs = $state<number | null>(session.remainingMs());
  let busy = $state(false);
  let mode = $state<'sleep' | 'pomodoro'>('sleep');
  let pomodoroEnabled = $state(session.pomodoro.enabled);
  let pomodoroPhase = $state(session.pomodoro.phase);
  let workSec = $state(session.pomodoro.workSec);
  let breakSec = $state(session.pomodoro.breakSec);
  let completedCycles = $state(session.pomodoro.completedWorkCycles);

  const presets = [
    { sec: 5 * 60, label: '5m' },
    { sec: 15 * 60, label: '15m' },
    { sec: 30 * 60, label: '30m' },
    { sec: 45 * 60, label: '45m' },
    { sec: 60 * 60, label: '1h' },
    { sec: 90 * 60, label: '1.5h' },
  ];

  const fadeOptions = [
    { sec: 15, label: '15s' },
    { sec: 30, label: '30s' },
    { sec: 60, label: '1m' },
    { sec: 120, label: '2m' },
    { sec: 300, label: '5m' },
  ];

  const pomodoroWorkOptions = [
    { sec: 15 * 60, label: '15m' },
    { sec: 25 * 60, label: '25m' },
    { sec: 45 * 60, label: '45m' },
    { sec: 50 * 60, label: '50m' },
  ];

  const pomodoroBreakOptions = [
    { sec: 3 * 60, label: '3m' },
    { sec: 5 * 60, label: '5m' },
    { sec: 10 * 60, label: '10m' },
    { sec: 15 * 60, label: '15m' },
  ];

  export function sync() {
    durationSec = session.timerDefaults.durationSec;
    activeDurationSec = session.timer.durationSec;
    fadeSec = session.timerDefaults.fadeSec;
    status = session.timer.status;
    remainingMs = session.remainingMs();
    pomodoroEnabled = session.pomodoro.enabled;
    pomodoroPhase = session.pomodoro.phase;
    workSec = session.pomodoro.workSec;
    breakSec = session.pomodoro.breakSec;
    completedCycles = session.pomodoro.completedWorkCycles;
    if (pomodoroEnabled) mode = 'pomodoro';
  }

  async function start() {
    busy = true;
    try {
      if (mode === 'pomodoro') {
        session.setPomodoroDefaults(workSec, breakSec);
        await session.startPomodoro('work');
      } else {
        session.pomodoro = { ...session.pomodoro, enabled: false };
        session.setTimerDefaults(durationSec, fadeSec);
        await session.startTimer(durationSec, fadeSec);
      }
      sync();
    } finally {
      busy = false;
    }
  }

  function cancel() {
    if (pomodoroEnabled) {
      session.stopPomodoro();
    } else {
      session.cancelTimer();
    }
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

  function pickWork(sec: number) {
    workSec = sec;
    session.setPomodoroDefaults(workSec, breakSec);
  }

  function pickBreak(sec: number) {
    breakSec = sec;
    session.setPomodoroDefaults(workSec, breakSec);
  }

  const running = $derived(status === 'running' || status === 'fading');
</script>

<section class="panel timer" class:is-fading={status === 'fading'} class:pomodoro={pomodoroEnabled}>
  <header class="panel-head">
    <h2>{pomodoroEnabled ? 'Focus timer' : 'Sleep timer'}</h2>
    {#if running}
      <span class="countdown" class:fading={status === 'fading'}>
        {remainingMs != null ? formatRemaining(remainingMs) : '—'}
        {#if pomodoroEnabled}
          · {pomodoroPhase === 'work' ? 'work' : 'break'}
        {:else if status === 'fading'}
          · fading
        {/if}
      </span>
    {:else if status === 'done'}
      <span class="countdown done">Ended</span>
    {/if}
  </header>

  {#if !running}
    <div class="mode-tabs" role="tablist" aria-label="Timer mode">
      <button
        type="button"
        class="mode-tab"
        class:on={mode === 'sleep'}
        role="tab"
        aria-selected={mode === 'sleep'}
        onclick={() => (mode = 'sleep')}
      >
        Sleep
      </button>
      <button
        type="button"
        class="mode-tab"
        class:on={mode === 'pomodoro'}
        role="tab"
        aria-selected={mode === 'pomodoro'}
        onclick={() => (mode = 'pomodoro')}
      >
        Pomodoro
      </button>
    </div>
  {/if}

  {#if running && remainingMs != null && activeDurationSec > 0}
    {@const totalMs = activeDurationSec * 1000}
    {@const ratio = Math.max(0, Math.min(1, remainingMs / totalMs))}
    {@const percent = Math.round(ratio * 100)}
    <div
      class="timer-indicator"
      class:fading={status === 'fading'}
      class:break-phase={pomodoroEnabled && pomodoroPhase === 'break'}
      role="progressbar"
      aria-label="Timer countdown progress"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div class="indicator-track">
        <div class="indicator-fill" style="width: {percent}%"></div>
      </div>
      <div class="indicator-meta">
        <span class="status-tag">
          <span class="dot"></span>
          {#if status === 'fading'}
            Fading out ({session.timer.fadeSec}s)
          {:else if pomodoroEnabled}
            {pomodoroPhase === 'work' ? 'Focus' : 'Break'} · cycle {completedCycles + (pomodoroPhase === 'work' ? 1 : 0)}
          {:else}
            Timer active
          {/if}
        </span>
      </div>
    </div>
  {/if}

  {#if mode === 'pomodoro' && !running}
    <div class="fade-row">
      <span class="fade-label">Work</span>
      <div class="chips fade-chips" role="group" aria-label="Work duration">
        {#each pomodoroWorkOptions as p}
          <button
            type="button"
            class="chip sm"
            class:on={workSec === p.sec}
            onclick={() => pickWork(p.sec)}
          >
            {p.label}
          </button>
        {/each}
      </div>
    </div>
    <div class="fade-row">
      <span class="fade-label">Break</span>
      <div class="chips fade-chips" role="group" aria-label="Break duration">
        {#each pomodoroBreakOptions as p}
          <button
            type="button"
            class="chip sm"
            class:on={breakSec === p.sec}
            onclick={() => pickBreak(p.sec)}
          >
            {p.label}
          </button>
        {/each}
      </div>
    </div>
    <p class="pomo-hint">
      Work {formatDurationLabel(workSec)} → break {formatDurationLabel(breakSec)} · auto-cycles
    </p>
  {:else if mode === 'sleep' && !running}
    <div class="chips" role="group" aria-label="Duration">
      {#each presets as p}
        <button
          type="button"
          class="chip"
          class:on={durationSec === p.sec}
          disabled={running}
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
        disabled={running}
        oninput={(e) => {
          const mins = Math.max(1, Number(e.currentTarget.value) || 1);
          durationSec = mins * 60;
          session.setTimerDefaults(durationSec, fadeSec);
        }}
      />
      <span class="unit">min · {formatDurationLabel(durationSec)}</span>
    </div>

    <div class="fade-row">
      <span class="fade-label">Fade</span>
      <div class="chips fade-chips" role="group" aria-label="Fade length">
        {#each fadeOptions as f}
          <button
            type="button"
            class="chip sm"
            class:on={fadeSec === f.sec}
            disabled={running}
            onclick={() => pickFade(f.sec)}
          >
            {f.label}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="actions">
    {#if running}
      <button type="button" class="secondary" onclick={cancel}>Cancel</button>
    {:else}
      <button type="button" class="primary" disabled={busy} onclick={() => void start()}>
        {mode === 'pomodoro' ? 'Start focus' : 'Start timer'}
      </button>
    {/if}
  </div>
</section>

<style>
  .panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.65rem 0.75rem 0.7rem;
    box-shadow: var(--shadow-card);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .panel.timer.is-fading {
    border-color: color-mix(in srgb, var(--solo) 40%, var(--border));
    box-shadow: 0 0 14px rgba(251, 191, 36, 0.1), var(--shadow-card);
  }

  .panel.timer.pomodoro {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }

  .panel-head {
    display: flex;
    align-items: center;
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

  .countdown {
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    color: var(--accent);
    font-size: 0.85rem;
    transition: color 0.2s ease;
  }

  .countdown.fading {
    color: var(--solo);
  }

  .countdown.done {
    color: var(--muted);
    font-weight: 500;
  }

  .mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
  }

  .mode-tab {
    font: inherit;
    font-size: 0.75rem;
    font-weight: 650;
    padding: 0.3rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
  }

  .mode-tab.on {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--accent);
  }

  .pomo-hint {
    margin: 0 0 0.45rem;
    font-size: 0.68rem;
    color: var(--muted-soft);
  }

  .timer-indicator {
    margin-bottom: 0.65rem;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
  }

  .timer-indicator.fading {
    background: var(--solo-dim);
    border-color: color-mix(in srgb, var(--solo) 55%, transparent);
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.15);
  }

  .timer-indicator.break-phase {
    border-color: color-mix(in srgb, #34d399 45%, var(--border));
  }

  .timer-indicator.break-phase .indicator-fill {
    background: linear-gradient(90deg, #34d399, #6ee7b7);
    box-shadow: 0 0 8px rgba(52, 211, 153, 0.4);
  }

  .indicator-track {
    height: 0.45rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--card) 80%, black);
    overflow: hidden;
    margin-bottom: 0.35rem;
    position: relative;
  }

  .indicator-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 80%, #fff));
    box-shadow: 0 0 8px var(--accent-glow);
    transition: width 0.1s linear, background 0.25s ease, box-shadow 0.25s ease;
  }

  .timer-indicator.fading .indicator-fill {
    background: linear-gradient(90deg, var(--solo), #f59e0b);
    box-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
  }

  .indicator-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .status-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--accent);
    transition: color 0.25s ease;
  }

  .timer-indicator.fading .status-tag {
    color: var(--solo);
  }

  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--accent);
    transition: background 0.25s ease;
  }

  .timer-indicator.fading .dot {
    background: var(--solo);
    animation: fade-dot-pulse 1s ease-in-out infinite alternate;
  }

  @keyframes fade-dot-pulse {
    0% {
      opacity: 0.45;
      transform: scale(0.85);
    }
    100% {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    margin-bottom: 0.45rem;
  }

  .chip {
    min-width: auto;
    padding: 0.28rem 0.5rem;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-soft);
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      background 0.12s ease,
      color 0.12s ease;
  }

  .chip.sm {
    padding: 0.2rem 0.4rem;
    font-size: 0.7rem;
  }

  .chip.on {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip:hover:not(:disabled):not(.on) {
    border-color: var(--border-soft);
  }

  .chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .row {
    display: grid;
    grid-template-columns: auto 3.5rem 1fr;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.45rem;
  }

  .row label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
  }

  .row input {
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.35rem;
    font-size: 0.8rem;
  }

  .unit {
    font-size: 0.7rem;
    color: var(--muted-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fade-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.45rem;
  }

  .fade-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
    flex-shrink: 0;
    min-width: 2.4rem;
  }

  .fade-chips {
    margin-bottom: 0;
    flex: 1;
  }

  .actions {
    margin-top: 0.15rem;
  }

  .primary {
    background: var(--accent);
    border: none;
    color: var(--accent-ink);
    font-weight: 650;
    border-radius: var(--radius-pill);
    padding: 0.38rem 0.85rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    box-shadow: 0 2px 8px var(--accent-glow);
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .secondary {
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-soft);
    padding: 0.38rem 0.85rem;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
