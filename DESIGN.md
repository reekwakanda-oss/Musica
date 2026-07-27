---
name: Audio → MIDI
description: A working instrument seen through liquid glass — an aurora light field that the transcription itself illuminates.
colors:
  abyss: "#030f0d"
  abyss-deep: "#010807"
  aurora-teal: "#12b3a6"
  aurora-mint: "#6ff0c0"
  aurora-deep: "#06544c"
  aurora-blue: "#0d6b8a"
  signal: "#c9ff4d"
  signal-soft: "#e2ff9b"
  signal-deep: "#8fc21f"
  signal-ink: "#0d1a02"
  scrim-1: "rgba(0,0,0,0.14)"
  scrim-2: "rgba(0,0,0,0.22)"
  scrim-3: "rgba(0,0,0,0.34)"
  scrim-4: "rgba(0,0,0,0.5)"
  scrim-5: "rgba(0,0,0,0.62)"
  film-1: "rgba(255,255,255,0.04)"
  film-2: "rgba(255,255,255,0.07)"
  film-3: "rgba(255,255,255,0.13)"
  edge-1: "rgba(255,255,255,0.06)"
  edge-2: "rgba(255,255,255,0.1)"
  edge-3: "rgba(255,255,255,0.16)"
  edge-4: "rgba(255,255,255,0.3)"
  glass-tint: "rgba(255,255,255,0.07)"
  glass-edge: "rgba(255,255,255,0.16)"
  glass-spec: "rgba(255,255,255,0.34)"
  key-white-hi: "#f4fffb"
  key-white-mid: "#d5e8e1"
  key-white-lo: "#b9d2ca"
  key-black-hi: "#1b2c28"
  key-black-mid: "#061512"
  text: "#ecfff8"
  text-dim: "#a4cbc0"
  text-faint: "#6d968b"
  alert: "#ff9271"
typography:
  display:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(2.6rem, 6vw, 4.4rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  lg:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.05rem, 1.6vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.55
  md:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  base:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 500
    lineHeight: 1.45
  sm:
    fontFamily: "'Azeret Mono', ui-monospace, 'SF Mono', Consolas, monospace"
    fontSize: "0.82rem"
    fontWeight: 500
  xs:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
  label:
    fontFamily: "'Azeret Mono', ui-monospace, 'SF Mono', Consolas, monospace"
    fontSize: "0.7rem"
    fontWeight: 600
    letterSpacing: "0.12em"
rounded:
  xs: "4px"
  sm: "12px"
  md: "18px"
  lg: "28px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "20px"
  lg: "32px"
  xl: "56px"
  xxl: "88px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.pill}"
    padding: "13px 26px"
  button-primary-hover:
    backgroundColor: "{colors.signal-soft}"
    textColor: "{colors.signal-ink}"
  button-glass:
    backgroundColor: "{colors.glass-tint}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "13px 24px"
---

# Design System: Audio → MIDI

## Overview

**Creative North Star: "The Lit Instrument"**

The product's whole reason to exist is the moment a melody becomes visible light falling onto keys. So the page is not a marketing shell wrapped around a hidden tool — the instrument *is* the page, present and idling from the first viewport, and every surface in front of it is real liquid glass with the instrument's own light passing through it.

Behind everything sits a **dark, inert field** — a deep sea-green ground with no glow of its own. The only light in the room is the pointer: a single large teal bloom that follows the cursor and lights whatever it passes over, leaving the rest of the page in shadow. Every panel, control, and rail is a genuinely translucent glass slab floating above that field — blurred, saturated, catching its own specular highlight from the same light, and rimmed by a refracted edge whose bright arc points back at it. Glass here is not a texture applied to a card; it is the reason you can watch notes fall *through* the panel that sits over them.

Color says one thing. Electric lime means **sounding right now** — a note crossing the hit line, a pressed key, the playhead, the one primary action. Nothing else in the system is allowed to be lime.

**Key characteristics:**
- Deep sea-green ground (never pure black) with no ambient glow — lit only where the pointer is.
- Real translucency: `backdrop-filter` blur + saturation, specular top edge, conic refraction rim.
- Electric lime as the single signal; teal/mint as ambient light, never as UI accent.
- Continuous, generous corners (12 / 18 / 28px) and pill controls.
- Mono readouts for every live number; Manrope for everything a human wrote.
- Rejects: warm paper/cream grounds, flat hairline "measurement panel" chrome, glass over an unlit ground, lime as decoration.

## Colors

### Signal
- **Electric Lime** (`#c9ff4d`): the only accent. A note that is sounding, a pressed key, the hit line, the playhead, and the single primary action.
  - Hover/bright: **Lime Soft** (`#e2ff9b`)
  - Pressed/deep: **Lime Deep** (`#8fc21f`)
  - Text on lime: **Lime Ink** (`#0d1a02`)

### Field (ambient light, never a UI color)
- **Aurora Teal** (`#12b3a6`), **Aurora Mint** (`#6ff0c0`), **Aurora Deep** (`#06544c`), **Aurora Blue** (`#0d6b8a`): the colors of the pointer light, from its hot centre out to its falloff. They appear only in the background field and in glass tint — never as a button, border, icon, or text color.

### Ground & Glass
- **Abyss** (`#030f0d`): page ground. Deep sea-green-black, never `#000`.
- **Abyss Deep** (`#010807`): the vignette at the field's edges.
- **Glass Tint** (`rgba(255,255,255,0.07)`): the base fill of every glass surface.
- **Glass Edge** (`rgba(255,255,255,0.16)`): the 1px boundary.
- **Glass Spec** (`rgba(255,255,255,0.34)`): the top inner highlight and the pointer-tracked sheen.

### Three ramps (the material's working values)
Every translucent value in the build comes from one of three named ramps. A raw one-off alpha is drift.
- **Scrim** `1–5` (`rgba(0,0,0,·)` at `.14 / .22 / .34 / .5 / .62`): darkness pooled *under* glass — recessed inputs, the stage well, the keyboard bed, the inspector.
- **Film** `1–3` (`rgba(255,255,255,·)` at `.04 / .07 / .13`): light caught *on* glass — chip fills, glass button rest/hover, the selected segment.
- **Edge** `1–4` (`rgba(255,255,255,·)` at `.06 / .1 / .16 / .3`): where a glass surface ends — internal dividers through to a lit boundary.

### Key materials
The keyboard is the one component with literal, opaque colors, because it is a physical object rather than a glass surface: **Key White** `#f4fffb → #d5e8e1 → #b9d2ca` (top to bottom) and **Key Black** `#1b2c28 → #061512 → Abyss`.

### Text
- **Text** (`#ecfff8`): primary. **Text Dim** (`#a4cbc0`): secondary and captions. **Text Faint** (`#6d968b`): placeholders and disabled.
- **Alert** (`#ff9271`): error copy only.

### Named Rules
**The Lime-Means-Sounding Rule.** Lime appears only where sound is happening right now, plus the one primary action on screen. Two simultaneous meanings for lime is a system failure.

**The Tinted-Neutral Rule.** Secondary text is tinted from the field's hue (green-cyan), never neutral gray. Gray text on this ground reads as a dead pixel.

## Typography

**Voice:** `Manrope` (400/500/600/700/800) — a semi-geometric grotesque whose round bowls sit naturally against continuous corners and fluid glass, with enough weight range to carry an 800 display without a second face.
**Readout:** `Azeret Mono` (400/500/600) — every number that changes while the page is in use.

### Hierarchy
- **display** (800, `clamp(2.6rem, 6vw, 4.4rem)`, -0.035em): the one headline.
- **lg** (400, `clamp(1.05rem, 1.6vw, 1.25rem)`): subtitle and the largest supporting copy.
- **md** (700, 1.0625rem): panel headings.
- **base** (500, 0.95rem): buttons, inputs, links, body.
- **sm** (500, 0.82rem, mono, tabular-nums): live readouts — elapsed time, note count, inspected note.
- **xs** (600, 0.78rem): nav links, footer, fine print.
- **label** (600, 0.7rem, mono, 0.12em, uppercase): the few module eyebrows and chip labels.

### Named Rules
**The Readout Rule.** Any value that changes while the page is in use — elapsed seconds, note count, pitch name, velocity — renders in Azeret Mono with `font-variant-numeric: tabular-nums`. Static prose never uses mono.

**The Seven-Step Rule.** Every piece of text maps to display / lg / md / base / sm / xs / label. A one-off size means a step is missing from this list, not that a local value is allowed.

## Layout

One screen, then a short tail. The console (roll + keyboard) is the page's center of gravity and occupies the largest single block on the surface; the hero above it is compact enough that both are visible together on a laptop viewport. Content maxes at `1120px` for the console and `620px` for panels and prose. Section rhythm uses `6/12/20/32/56/88`, always more space above a heading than below it.

## Elevation & Depth

Depth is optical, not drawn. A surface is "above" because you can see the field blurring and saturating through it, because its top edge catches a specular highlight, and because it casts a real offset shadow into the dark ground (`0 24px 60px -20px` at high alpha — offset and blur, never a zero-offset halo).

### Named Rules
**The Refraction Rule.** Glass is only used where something is genuinely behind it to refract: the aurora field, or the falling notes. A glass treatment on a surface with nothing behind it is decoration and is not allowed. This is what earns the material.

## Shapes

Continuous, generous corners: `sm` 12px for inputs and small chips, `md` 18px for inner modules, `lg` 28px for the console shell and floating panels, `pill` for every button and toggle. Nested surfaces step the radius down so inner corners stay concentric with outer ones. `xs` 4px exists for one reason — the bottom corners of a piano key and the velocity meter's cap, where a real key edge is nearly square.

## Motion

**The one authored moment is the ignition.** When a transcription lands, the aurora field surges outward from the console, the source panel dissolves — scaling down and blurring out of the way — and the notes cascade in from the top of the roll. Everything else in the system is ambient or responsive, not another entrance.

- **One light, and it is the pointer.** The background has no ambient glow and never moves on its own. A single large bloom (`--light-size: 72vmax`) follows the cursor, trailing it with a `0.09` lerp so it reads as a lamp being carried rather than a cursor decoration; every glass surface takes its specular sheen from the same source, and the refracted rim's bright arc rotates to point back at it. Away from the pointer, the page is genuinely dark. A background that drifts by itself reads as restless wallpaper; a room lit from one moving lamp reads as a place.
- **Brightness is the one thing playback drives.** While notes are sounding the light swells slightly in proportion to how many are sounding at once. That is coupling to something true, and it changes luminance only — never position.
- With no pointer (touch, or before the first move) the light rests at `50% / 42%` and stays there.
- **Responsive:** pointer-tracked specular sheen on glass; press deforms the surface (scale to `0.97` + a light ripple expanding through it) and releases.
- **Easing:** exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) from an already-visible default, with a softer cubic ease-out for long ambient loops. No overshoot or bounce curves anywhere — a press reads physical because of the scale change, not because it wobbles.
- `prefers-reduced-motion` snaps the light straight to the pointer with no trailing, drops ripples, and removes the ignition's movement, keeping every state change instant and legible.

## Components

### Buttons
- **Shape:** pill. Never square, never sharp.
- **Primary:** Electric Lime fill, Lime Ink text, `13px 26px`, weight 700. One per screen.
- **Glass/secondary:** glass tint fill, 1px Glass Edge, Text label. Hover raises tint and edge brightness.
- **Press:** scales to `0.97` and emits a ripple from the click point; springs back on release.
- **Disabled:** 38% opacity, no sheen, no ripple.

### Panels
Glass slab: Glass Tint fill on a `blur(28px) saturate(180%)` backdrop, 1px Glass Edge, `lg` radius, an inset top specular line, an offset shadow into the ground, and a slowly rotating conic rim. Internal padding 28px.

### Inputs
Recessed glass: darker tint (`rgba(0,0,0,0.22)`), 1px Glass Edge, `sm` radius, Text Faint placeholder. Focus lifts the border to Electric Lime and adds a soft lime bloom — the one exception where lime marks "this is where you are," permitted because it is the active element.

### Drop zone
A dashed Glass Edge boundary at `md` radius over the recessed tint. On drag-over the boundary goes solid lime, the fill brightens, and the panel lifts 2px. It states the accepted formats in `xs` and stays a click target for browsing.

### Piano roll (signature)
Transparent canvas over the console glass, so the blurred aurora reads as the roll's own backdrop. Time runs top-to-bottom; each note's column is pixel-aligned with its key below. Upcoming notes are translucent mint-white bars that gain brightness as they approach; a note switches to solid Electric Lime with a canvas bloom exactly as it crosses the hit line, and an expanding ring marks the impact. The hit line is a 2px lime rule with a glow at the roll/keyboard seam. Faint octave guides mark each C — the only grid the system permits.

### Keyboard (signature, playable)
White keys are near-opaque white glass with a soft vertical gradient; black keys are abyss glass with a specular top edge. Same column math as the roll, so a falling note is always in registration with its key. Pressed → lime fill, a 2px downward travel, and an upward glow. The keyboard is playable directly: pointer down/drag sounds notes through the same sampler as playback, and roving-tabindex arrow-key navigation with Enter/Space gives the same access from the keyboard.

### Note inspector
Hovering a note in the roll raises a small glass readout with its pitch name, start, duration, and a velocity meter, in mono. It is placed on the opposite side of the pointer from the note it describes, clamped inside the roll, and clicking pins it.

### Idle disclosure
Before anything is loaded the roll runs a silent, looping figure so the instrument is visibly alive. It is disclosed in words, in the transport's note-count readout ("idle pattern — not a transcription"), which replaces the note count once a real transcription lands. The disclosure lives in the readout rather than floating on the roll so it can never collide with the source panel or be mistaken for part of the music.

## Do's and Don'ts

### Do
- **Do** keep lime exclusive to "sounding now" plus the single primary action.
- **Do** put something worth refracting behind every glass surface.
- **Do** tint secondary text from the field's green-cyan, never gray.
- **Do** keep the pointer the only light — the background never glows on its own, and nothing else in the field moves.
- **Do** keep the instrument visible and alive before any file is loaded — disclosed as an idle pattern in the transport readout, never presented as a transcription.
- **Do** keep the visual instrument independent of the audio library: keys light and notes fall whether or not the CDN answered.

### Don't
- **Don't** return to warm paper, cream, or the flat hairline "measurement panel" chrome this world replaced.
- **Don't** apply glass to a surface with nothing behind it, or stack more than two glass layers.
- **Don't** use aurora teal/mint as a button, border, icon, or text color — they are light, not UI.
- **Don't** add a second orchestrated entrance animation; the ignition is the one moment.
- **Don't** use gradient text, bounce/overshoot easing, or square corners on a control.
- **Don't** write a one-off translucent value; every one comes from the scrim, film, or edge ramp.
