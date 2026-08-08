<script lang="ts">
  /**
   * Lightweight canvas visualizer tied to master AnalyserNode (ENH-11).
   * Respects prefers-reduced-motion (static wash only).
   */
  import { onDestroy, onMount } from 'svelte';
  import { session } from '../app/session';

  let canvas: HTMLCanvasElement | undefined = $state();
  let reducedMotion = $state(false);
  let raf = 0;
  let playing = $state(session.playing);

  /** Soft particle field driven by spectrum energy. */
  const particles: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] =
    [];

  function initParticles(w: number, h: number) {
    particles.length = 0;
    const n = Math.min(48, Math.floor((w * h) / 18_000));
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.2 - 0.05,
        r: 1.2 + Math.random() * 2.8,
        a: 0.08 + Math.random() * 0.18,
      });
    }
  }

  function readAccent(): string {
    if (typeof getComputedStyle === 'undefined') return '217, 119, 54';
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim();
    // hex #rrggbb
    const m = raw.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    }
    return '217, 119, 54';
  }

  function drawStatic(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const rgb = readAccent();
    const g = ctx.createRadialGradient(w * 0.5, h * 0.15, 0, w * 0.5, h * 0.4, h * 0.9);
    g.addColorStop(0, `rgba(${rgb}, 0.12)`);
    g.addColorStop(0.45, `rgba(${rgb}, 0.04)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function frame() {
    const el = canvas;
    if (!el) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = el.clientWidth;
    const cssH = el.clientHeight;
    if (cssW < 2 || cssH < 2) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
      initParticles(w, h);
    }

    const ctx = el.getContext('2d');
    if (!ctx) {
      raf = requestAnimationFrame(frame);
      return;
    }

    playing = session.playing;

    if (reducedMotion || !playing) {
      drawStatic(ctx, w, h);
      raf = requestAnimationFrame(frame);
      return;
    }

    const freq = session.getFrequencyData();
    const time = session.getTimeDomainData();
    const rgb = readAccent();

    ctx.clearRect(0, 0, w, h);

    // Soft vertical spectrum wash
    if (freq && freq.length > 0) {
      let energy = 0;
      const bands = 32;
      const step = Math.floor(freq.length / bands);
      for (let i = 0; i < bands; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += freq[i * step + j] ?? 0;
        const v = sum / (step * 255);
        energy += v;
        const x0 = (i / bands) * w;
        const bw = w / bands + 1;
        const barH = v * h * 0.55;
        const grad = ctx.createLinearGradient(0, h, 0, h - barH);
        grad.addColorStop(0, `rgba(${rgb}, 0)`);
        grad.addColorStop(1, `rgba(${rgb}, ${0.08 + v * 0.22})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x0, h - barH, bw, barH);
      }
      energy /= bands;

      // Particles drift with energy
      for (const p of particles) {
        p.x += p.vx * (1 + energy * 4);
        p.y += p.vy * (1 + energy * 3);
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${rgb}, ${p.a + energy * 0.35})`;
        ctx.arc(p.x, p.y, p.r * (1 + energy), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Thin waveform ribbon
    if (time && time.length > 4) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${rgb}, 0.28)`;
      ctx.lineWidth = Math.max(1, dpr);
      const mid = h * 0.42;
      const amp = h * 0.12;
      const step = Math.max(1, Math.floor(time.length / Math.min(160, w)));
      for (let i = 0, x = 0; i < time.length; i += step, x++) {
        const v = (time[i]! - 128) / 128;
        const px = (x / (time.length / step)) * w;
        const py = mid + v * amp;
        if (x === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    raf = requestAnimationFrame(frame);
  }

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMq = () => {
      reducedMotion = mq.matches;
    };
    syncMq();
    mq.addEventListener('change', syncMq);
    raf = requestAnimationFrame(frame);
    return () => mq.removeEventListener('change', syncMq);
  });

  onDestroy(() => {
    cancelAnimationFrame(raf);
  });
</script>

<div class="viz" aria-hidden="true">
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .viz {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
