# Plan: Core Loop Expansion (Diversified & Rich)

| Field | Value |
|-------|--------|
| **Status** | Ready to execute |
| **Tracks** | CNT-03 (primary), unlocks CNT-01 / CNT-02 |
| **Effort** | Medium–High (content + light UI wiring) |
| **Impact** | High — library breadth is the main remaining product gap |
| **Constraint** | CC0 / CC-BY only · Ogg via Freesound pipeline · ~1 MB/clip budget |

---

## 1. Goal

Grow the **bundled core pack** from a nature/transport-heavy set into a **scene-complete library**: enough continuous loops that users can build sleep, focus, cozy indoor, urban mask, travel, and weather scenes without faking layers (e.g. “cafe” via bus + campfire).

**Success looks like:**

| Metric | Today | Target |
|--------|------:|-------:|
| Core continuous loops | 37 | **52–55** (+15–18) |
| Library category groups | 6 | **8–9** (add Indoor & Urban) |
| Singleton categories (≤1 clip) | fire, stream, waterfall, cave, frogs | No critical singleton for “scene anchors” |
| Default presets using only “true” layers | Partial (cafe fakes) | Cafe / city / indoor presets use real indoor/urban loops |
| Core pack size | ~36 MB | **≤50 MB** (~1 MB/clip average, `maxSec` 45–60) |

---

## 2. Current inventory (gap analysis)

### 2.1 By category (37 loops)

| Category | Count | Notes |
|----------|------:|-------|
| transport | 6 | Strong (train×3, bus, jet, boat) |
| insects | 5 | Strong night/summer drone coverage |
| birds | 4 | Morning, owls, seagulls×2 |
| wind | 4 | Trees, leaves, desert, winter storm |
| rain | 3 | Light, roof, tent — no heavy/window/city |
| ocean | 3 | Shore, pebble, stormy |
| forest | 3 | Bamboo, amazon morning, jungle |
| thunder | 2 | Distant + storm |
| water | 2 | Lake shore, underwater |
| stream | 1 | Only small stream |
| waterfall | 1 | Singleton |
| cave | 1 | Singleton |
| frogs | 1 | Singleton |
| fire | 1 | **Overused** in presets (4/11 scenes) |

### 2.2 Hard product gaps

These are the holes that force awkward mixes or empty filter tabs:

1. **Indoor / human spaces** — no cafe, library, office, room tone, fireplace interior  
2. **Urban exterior** — no soft city hum, distant traffic, street rain, park  
3. **Rain diversity** — missing heavy rain, window rain, thunder-free downpour  
4. **Fire diversity** — only `fire_camp`; presets re-use it as “warmth”  
5. **Water mid-layer** — no broad river, creek bed, fountain, rain-on-water  
6. **Calm anchors** — no soft HVAC / AC / fridge-style continuous mask (beyond procedural fan noise)  
7. **Seasonal texture** — no snow / soft ice wind (only harsh `winter_storm`)

### 2.3 What is already rich (do not over-add)

- Transport (6) — maybe **+1** subway/metro cabin max  
- Insects / tropical forest — near saturation  
- Seagull coastal set — enough  

**Rule:** prefer **new scene roles** over more near-duplicates of rain/forest/insects.

---

## 3. Design principles (diversified *and* rich)

### 3.1 Diversity axes

Every new clip should score on at least two axes:

| Axis | Examples |
|------|----------|
| **Place** | indoor · urban · wilderness · coastal · transit |
| **Climate** | rain · dry wind · snow · humid night · calm dry |
| **Texture** | broadband mask · mid rhythmic · sparse organic · crackle |
| **Energy** | sleep-soft · focus-steady · storm-active |
| **Mix role** | **bed** (always-on) · **color** (mid) · **accent bed** (slow variation) |

Richness comes from **orthogonal mix partners** (e.g. cafe murmur + window rain + soft pink), not from five nearly identical bird beds.

### 3.2 Clip quality bar (listen before ship)

Reject or re-pick if:

- Obvious loop seam even with 100–150 ms crossfade  
- Speech / music / sirens that break immersion  
- Loud one-shot events every few seconds (those belong in **event_*** packs, CNT-02)  
- Dry mono room tone with no spatial interest *unless* tagged as intentional soft mask  
- License not in allowlist (core: **CC0-1.0 / CC-BY-3.0 / CC-BY-4.0 / PD** only)

Prefer:

- Continuous field recordings ≥30 s source (trim `maxSec` 45–60)  
- Steady broadband beds that layer under noise without phasey beating  
- Distinct stereo image when available  
- `loopMode: "native"` only when the recording is already seamless; else crossfade 90–150 ms  

### 3.3 Size & packaging

- Target **~0.8–1.2 MB** Ogg per clip (existing average)  
- Prefer `maxSec: 45` for busy textures; `60` for slow ocean/wind beds  
- Never remove existing `sounds.json` entries (orphan cleanup deletes `.ogg`)  
- Ship audio via `pnpm sounds:freesound` only — not `generate-core-pack.mjs`

---

## 4. Target catalog: proposed additions

Organized in **waves**. IDs are provisional; final Freesound picks may rename descriptors but keep the **role**.

### Wave A — Scene anchors (highest impact) · +6

Closes the biggest fake-mix problem and enables CNT-01 presets.

| Proposed id | Category | Role | Search intent (Freesound) |
|-------------|----------|------|---------------------------|
| `cafe_murmur` | `indoor` | Soft crowd + dish clink bed | cafe ambience interior crowd quiet |
| `library_quiet` | `indoor` | Near-silent room + distant page/AC | library room tone quiet |
| `city_soft` | `urban` | Distant traffic hum, no horns | city ambience distant traffic night soft |
| `rain_window` | `rain` | Indoor POV rain on glass | rain window glass apartment |
| `rain_heavy` | `rain` | Dense outdoor downpour bed | heavy rain continuous no thunder |
| `fireplace_indoor` | `fire` | Hearth / wood stove interior | fireplace crackling indoor loop |

**Unlocks presets:** true Cozy Cafe, Study Library, Soft City Night, Window Rain Focus, Heavy Storm Bed (without forcing thunder).

### Wave B — Texture depth · +6

Fills singleton / thin categories so mixes feel layered.

| Proposed id | Category | Role | Search intent |
|-------------|----------|------|---------------|
| `river_wide` | `stream` | Broader water bed vs `stream_small` | wide river flow continuous |
| `creek_rocks` | `stream` | Mid-detail water color | creek stones babbling |
| `fountain_plaza` | `water` | Soft public fountain | fountain water plaza ambient |
| `snow_wind` | `wind` | Soft winter texture (not blizzard) | soft snow wind winter gentle |
| `meadow_day` | `forest` | Open field / grass wind + distant life | meadow grass wind summer ambient |
| `ac_room` | `indoor` | Steady HVAC mask (real-world cousin of fan noise) | air conditioner room tone continuous |

### Wave C — Flavor & long-tail · +4–6

Optional richness after A/B; pick by Freesound quality, not quota.

| Proposed id | Category | Role | Notes |
|-------------|----------|------|-------|
| `park_city` | `urban` | Birds + distant city blend | Complements pure nature birds |
| `metro_cabin` | `transport` | Subway/metro interior | Distinct from train/bus/jet |
| `rain_leaves` | `rain` | Forest floor rain | Layers under `rain_light` |
| `temple_soft` | `indoor` | Quiet hall / soft reverb space | **No** music/chant if avoidable |
| `harbor_night` | `ocean` | Quiet dock water + distant | Night coastal without seagull spam |
| `woodstove` | `fire` | Alternate fire texture if A’s fireplace is too similar to camp | Skip if redundant |

**Stretch (only if pack size allows):** `office_hvac`, `market_distant`, `ice_crack_soft` (careful — may be event-like).

### Wave totals

| Wave | Clips | Running total | Pack size est. |
|------|------:|--------------:|----------------|
| A | 6 | 43 | ~42 MB |
| B | 6 | 49 | ~48 MB |
| C | 4–6 | 53–55 | ~50–52 MB |

Stop at Wave B if size or attribution review pressure is high; Wave C is polish.

---

## 5. Category & UI wiring (small code work)

New categories must appear in the library filters and stay consistent in docs.

| File | Change |
|------|--------|
| `docs/FREESOUND_IMPORT_GUIDE.md` | Extend allowed `category` list with `indoor`, `urban` (and keep existing) |
| `src/ui/LibraryPanel.svelte` `CATEGORY_GROUPS` | Add groups, e.g. **Indoor** (`indoor`), **Urban** (`urban`); optionally merge Fire into “Warmth & Fire” if a second fire lands |
| `src/ui/mood-theme.ts` | Score `cafe|library|indoor|hvac|room` → calm `night` or new `cozy`; `city|urban|traffic` → soft `train` or new `city` mood |
| `src/app.css` (if new mood) | Optional `data-mood="cozy"|"city"` palette — only if scoring needs it |
| `scripts/validate-manifests.mjs` | No category enum today (free string) — confirm; add allowlist only if desired |

No engine changes required for new loops (existing sample layers + crossfade looper).

---

## 6. Execution workflow (per wave)

Use the **freesound-import** skill and guide. For each proposed role:

1. **Search** Freesound (CC0 / CC-BY preferred; avoid NC in core).  
2. **Audition** HQ preview for loopability and speech-free content.  
3. **Extract** metadata (`freesoundId`, user, license, `previewPath`, page URL).  
4. **Append** entry to `config/sounds.json` near related clips.  
5. **Fetch** `pnpm sounds:freesound` (or `node scripts/fetch-freesound-core.mjs`).  
6. **Validate** `pnpm validate-manifests`.  
7. **Listen in app** — solo clip, then 2–3 layer combos, check seams at loop point.  
8. **Build** `pnpm build` — confirm SW/catalog pick up new files.  
9. **Git hygiene** — only new `.ogg` + manifest/attribution diffs; never rewrite existing oggs.

### Suggested mix-smoke tests (Wave A)

| Scene | Layers |
|-------|--------|
| True cafe | `cafe_murmur` + `rain_window` + pink noise low |
| Study | `library_quiet` + `rain_window` + brown noise low |
| City sleep | `city_soft` + `rain_heavy` low + brown |
| Storm without thunder | `rain_heavy` + `wind_trees` |
| Hearth night | `fireplace_indoor` + `winter_storm` low or `snow_wind` |

---

## 7. Follow-on content (same bundle, separate PRs)

Expanding cores **enables** but does not replace:

| ID | Work | Depends on |
|----|------|------------|
| **CNT-01** | New default presets: Cafe Focus, Library Study, Soft City Night, Window Rain, River Camp, Snow Quiet | Wave A–B assets |
| **CNT-02** | More `event_*` one-shots (cup clink, distant horn, page turn, thunder crack variants) | Pairs with indoor/urban beds |
| Mood / Surprise me | Optional weight table tweaks so Surprise me can pick indoor/urban | Wave A categories |

Recommend PR order: **Wave A cores → CNT-01 presets → Wave B → CNT-02 events → Wave C**.

---

## 8. Out of scope

- Procedural replacements for missing scenes (noise stays noise; this plan is sample cores)  
- CC-BY-NC or non-redistributable stock libraries in the **core** pack  
- Replacing or deleting existing loops  
- Large multi-minute untrimmed files  
- AI-generated audio  

---

## 9. Definition of done (CNT-03 expanded)

- [x] Wave A (+6) shipped, licensed, attributed, offline-cached  
- [x] Library shows **Indoor** and **Urban** groups with correct counts  
- [x] Mood detection does not mis-tag cafe/city as pure forest  
- [x] At least **2** new default presets (CNT-01) that use Wave A without fake layers  
- [x] `validate-manifests` + unit tests + build green  
- [x] Core pack ≤ ~50 MB (or documented exception) — **54 cores after B+C** (monitor size; trim later if needed)  
- [x] Wave B (+6) complete  
- [x] Wave C (+5) complete (woodstove skipped as redundant with fireplace_indoor)  

---

## 10. Suggested implementation tickets

| Ticket | Scope | Effort |
|--------|-------|--------|
| CNT-03a | Wave A Freesound import + attributions | M |
| CNT-03b | Library categories + mood scoring for indoor/urban | S |
| CNT-03c | Wave B import | M |
| CNT-01a | 3–5 presets using new cores | S |
| CNT-03d | Wave C optional flavor | S |
| CNT-02 | Event pack growth (parallel track) | M |

---

## 11. Immediate next step

Execute **CNT-03a / Wave A**: find six Freesound candidates matching the search intents above, import via the freesound skill, then wire library groups. No engine redesign required.
