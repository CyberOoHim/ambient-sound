# QA checklist — Ambient Sound web 0.1.0

Web-only release definition of done (no Tauri). Run before tagging.

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
9. **Share link** — Copy link → open in new tab → scene loads.
10. **Surprise me** — random mix of 2–4 layers; tones/events off by default.
11. **Library search** — filter by title/tags; category chips still work.
12. **Tone generator** — enable while paused shows “Starts with Play”; Play starts tones.
13. **One-shots** — enable pack; hear discrete events (not long loop snips); fire toast appears.
14. **Attributions** — footer modal / `#attributions`.
15. **Mix settings** — gear → min offset for duplicate sounds.

## Manual — mobile / PWA

1. Install or open as PWA; Play once, lock screen — audio continues.
2. Lock-screen **artwork** visible; play/pause works.
3. **Next / previous** track cycles saved presets (if supported).
4. First-run tip dismisses and stays dismissed.
5. Side panels collapse/expand on narrow viewports; transport header stays sticky.
6. Offline after first load: shell + cached audio still usable.

## Content

- [ ] `public/sounds/events/*.ogg` present for event_* catalog entries
- [ ] `pnpm validate-manifests` clean
- [ ] ATTRIBUTIONS still accurate for core pack
