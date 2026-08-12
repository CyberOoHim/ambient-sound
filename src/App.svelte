<script lang="ts">
  import Mixer from './ui/Mixer.svelte';

  let hasError = $state(false);
  let errorMessage = $state('');

  function handleBoundaryError(err: unknown) {
    hasError = true;
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Unhandled app error:', err);
  }
</script>

<main>
  {#if hasError}
    <div style="padding: 2rem; max-width: 600px; margin: 4rem auto; text-align: center; background: #1e293b; color: #f8fafc; border-radius: 12px; font-family: system-ui, sans-serif;">
      <h2 style="margin-top: 0; color: #f87171;">Something went wrong</h2>
      <p style="color: #94a3b8; font-size: 0.95rem;">{errorMessage || 'An unexpected error occurred.'}</p>
      <button
        onclick={() => location.reload()}
        style="margin-top: 1rem; padding: 0.6rem 1.2rem; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;"
      >
        Reload Application
      </button>
    </div>
  {:else}
    <svelte:boundary onerror={handleBoundaryError}>
      <Mixer />
    </svelte:boundary>
  {/if}
</main>

<style>
  main {
    min-height: 100svh;
  }
</style>
