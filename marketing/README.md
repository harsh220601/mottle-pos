# Mottle POS films

Four marketing films, rendered frame by frame from HTML and scored with music and sound design synthesized in code. The finished files are published with the site in [`../assets/films/`](../assets/films/) and shown on the [Films page](../films/).

| Film | Format | Length | Style | Use it for |
|---|---|---|---|---|
| `launch.mp4` — Introducing Mottle POS | 1920×1080, 60 fps | 1:03 | Keynote launch film: one continuous camera move around a 3D iPad, kinetic type, live app footage | Website, App Store preview source, YouTube, presentations |
| `ai.mp4` — Mottle AI | 1920×1080, 60 fps | 0:34 | Navy, glowing orb, live Mottle AI footage with synced captions | Feature launch, social, AI page |
| `privacy.mp4` — Private by design | 1920×1080, 60 fps | 0:27 | White, minimal, line icons that draw themselves, felt-piano score | Privacy messaging, owner-focused ads |
| `reel.mp4` — vertical reel | 1080×1920, 60 fps | 0:21 | Fast cuts on a 120 bpm beat, slam type, flash cuts | Instagram Reels, TikTok, YouTube Shorts |

Each film has a matching `*-poster.jpg`. Audio is normalised to −16 LUFS (streaming standard). All footage is the app's own screen recordings and screenshots from `../assets`. Figures and guests shown are sample data, and each film says so on screen where numbers appear.

## How it works

```
films/<name>.html   one HTML page per film; frame(t) poses every element for time t
engine/engine.js    timeline helpers: easing, Apple-style springs, keyframes, word reveals, image sequences
engine/base.css     shared stage, type (Inter Display), iPad and iPhone frames, chips, badges
engine/render.mjs   drives Chromium frame by frame (4 parallel workers) and encodes with ffmpeg
engine/audio.py     synthesizes the score from the film's cue list (pads, plucks, bells, kick, whooshes, risers, UI ticks)
engine/prepare-footage.sh  extracts the app recordings into image sequences in .cache/
```

Every frame is a pure function of time, so renders are deterministic and frame-accurate. The music follows each film's tempo; scene changes are placed on bar lines and emit cues (`whoosh`, `impact`, `tick`, `type`, `success`, `section`, `end`) that the score turns into sound design.

## Rendering

Requires Node 18+ with Playwright, ffmpeg, and Python 3 with numpy.

```bash
cd marketing
engine/prepare-footage.sh                       # once: extract app footage
node engine/render.mjs launch --still 12.5,30   # check single frames → .cache/stills/
node engine/render.mjs launch --draft           # fast half-size preview → .cache/drafts/
node engine/render.mjs launch                   # full render → ../assets/films/launch.mp4
node engine/render.mjs launch --remux           # re-score and re-mux cached frames (after audio edits)
```

A full 60 fps render of the launch film takes about 7 minutes on 4 cores.

## Editing a film

- Copy lives in the HTML. Keep claims to what the app does today; the site's own copy is the reference.
- Timing lives in `frame(t)`. Use `M.kf` for camera moves, `reveal()` for word-by-word type, `E.spring` for anything that should land with a little bounce.
- Sound lives in the `cues` array. Add a `{ t, type: 'whoosh' }` on a cut, `'tick'` on a tap, `'success'` on a completed action.
