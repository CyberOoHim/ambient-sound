# QA checklist — Ambient Sound web 0.2.x

Web-only release definition of done (no Tauri). Run before tagging. Covers Phase 0–3 product surface and Phase 4 polish (master tone, share, local backup, crossfade).

## Automated

```bash
pnpm install
pnpm validate-manifests
pnpm check
pnpm test
pnpm build
```

Confirm `dist/sw.js` contains a stamped `CACHE_VERSION` (not plain `v1`).

## Manual — desktop browser

1. **Play / pause** — Space toggles; master meter moves while playing.
2. **Add sample while playing** — download progress; layer appears in mix.
3. **Layer limit** — add until 10 layers; next add shows limit message.
4. **Clear all** — confirm dialog; mix empties and audio stops.
5. **LP / HP filters** — lower LP on rain (muffled); raise HP; presets round-trip filters.
6. **Sleep timer** — start, watch fade, cancel mid-run.
7. **Pomodoro** — Start focus → work phase → auto-break; Cancel stops cycles.
8. **Presets** — save, load, overwrite same name (confirm), restore defaults.
9. **Preset crossfade** — while playing, load another preset; short fade out/in (not abrupt cut).
10. **Share link** — Copy link → open in new tab → scene loads; toast auto-dismisses; hash clears.
11. **Surprise me** — random mix of 2–4 layers; tones/events off by default.
12. **Library search** — filter by title/tags; category chips still work.
13. **Tone generator** — enable while paused shows “Starts with Play”; Play starts tones.
14. **One-shots** — enable pack; hear discrete events; fire toast appears.
15. **Attributions** — footer modal / `#attributions`.
16. **Mix settings ⚙** — min offset; **Bass / Treble / Space** change the whole mix; values persist via last session / save preset.
17. **Visualizer** — animates while playing; OS reduced-motion → static wash.
18. **Mood theme** — add rain / fire / forest; page palette shifts.
19. **Space canvas** — drag icons update pan + volume.
20. **Auto-pan LFO** — enable on a layer; hear slow stereo motion.
21. **Local import** — drop/pick mp3/wav/ogg; add to mix; survives reload.
22. **Local backup** — Export backup → Import backup; Remove unused; storage line updates; quota-friendly error on huge files.

## Manual — mobile / PWA

1. Install or open as PWA; Play once, lock screen — audio continues.
2. Lock-screen **artwork** visible; play/pause works.
3. **Next / previous** track cycles saved presets (if supported).
4. First-run tip dismisses and stays dismissed.
5. Side panels collapse/expand on narrow viewports; transport header stays sticky.
6. Offline after first load: shell + cached audio still usable.
7. Master tone + local import usable on a small screen.

## Content

- [ ] `public/sounds/events/*.ogg` present for event_* catalog entries
- [ ] `pnpm validate-manifests` clean
- [ ] ATTRIBUTIONS still accurate for core pack

## Phase 4 automated QA note (POL-01)

Ran full suite (`validate-manifests`, `check`, `test`, `build`) after Phase 4 implementation. Manual matrix above remains the release gate for audio/PWA behavior.
