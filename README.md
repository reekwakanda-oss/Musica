# Musica
# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

General hobbyists and curious listeners — someone hears a song, riff, or melody and wants to know "what notes is that actually playing," without any production or DAW workflow downstream. Casual use, not a professional transcription tool for musicians/producers.

## Product Purpose

Converts audio (a YouTube URL or an uploaded file) into MIDI note data, then visualizes it as a synced piano roll and 88-key keyboard, playable in-browser and exportable as a `.mid` file. Success is a fast, low-friction "paste/drop audio → watch notes fall → hear it play back" loop.

## Positioning

Runs Spotify's open-source Basic Pitch ML model server-side to transcribe audio to note events, then drives a canvas piano roll and keyboard from the same clock as in-browser playback (Tone.js) — free, install-free, and immediate, versus paid desktop transcription software (e.g. Melodyne, AnthemScore) or manual by-ear transcription.

## Operating Context

Single-page flow: paste a YouTube URL or choose a local audio/video file → convert → piano roll and keyboard populate and animate in sync with playback → play/stop transport → download the `.mid` file. No accounts, no saved history — each visit is a fresh, one-off conversion.

## Capabilities and Constraints

- Backend: FastAPI; pulls audio via yt-dlp (URL path) or accepts a direct upload, converts to mono 22050Hz WAV, runs Basic Pitch, returns note JSON + a MIDI download link.
- Frontend: static HTML/JS, canvas-based piano roll, DOM-based keyboard, Tone.js for playback synthesis (Salamander grand piano samples loaded from Tone.js's CDN) and MIDI export.
- Deployment: intended to be shared/deployed publicly (not just local/dev use). This makes the upload path (`/api/convert-upload`) the primary, load-bearing flow; the YouTube URL path (`/api/convert-url`) is secondary, since server-side YouTube audio extraction carries ToS/legal exposure per jurisdiction. Design should frame upload as the default, not bury the legal caveat but not treat it as a dominant warning either.
- Undecided: hosting target, rate limiting, and file-size/duration limits for public deployment are not yet defined.

## Brand Commitments

None binding. "Audio → MIDI" is the current working name/wordmark with no logo — free to adjust as part of the redesign.

## Evidence on Hand

None. No testimonials, case studies, usage numbers, or press exist — future work must not fabricate any.

## Product Principles

1. Zero-friction entry: no signup, no config — paste or drop, then convert.
2. Two input paths, one clearly primary: upload is the dependable default; URL convert is convenience, not the star.
3. Playback and visualization are the payoff — the piano roll + keyboard sync is the moment the product exists to deliver, and should read as premium and precise, not as a debug view.
4. One-shot, stateless use — no persistence across visits; each session is self-contained.
5. Public-facing polish — since this is meant to be shared, the interface must read as a finished product, not a local dev tool.

## Accessibility & Inclusion

No product-specific requirement established yet. Note for future work: the piano roll (canvas) and pressed-key state currently have no non-visual equivalent (no captions/labels for note events), which will need attention as the design matures — not a blocking constraint for this redesign.
