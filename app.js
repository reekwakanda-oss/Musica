const API_BASE = "http://localhost:8000";

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)[\w-]{11}(&\S*)?$/i;

const MIN_PITCH = 21;  // A0
const MAX_PITCH = 108; // C8
const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
const PITCH_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Tone.js comes from a CDN. If it can't be reached the instrument still has to draw
// and respond — only the sound goes away — so every audio call is gated on this.
const hasAudio = typeof Tone !== "undefined";

function isWhite(pitch) {
  return WHITE_PITCH_CLASSES.has(pitch % 12);
}

function pitchName(pitch) {
  return `${PITCH_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

// ---------- state ----------
let allNotes = [];    // [{pitch, start, end, velocity}] — exactly what the model returned
let notes = [];       // allNotes minus whatever cleanup is filtering out: the live set
let duration = 0;     // seconds, derived from notes
let keyInfo = null;   // {tonic, mode, name, pcs, r} detected from allNotes, or null
let synth = null;
let pianoLoaded = false;
let part = null;
let playing = false;
let held = new Set();  // pitches sounding because the visitor is pressing a key
let showNames = true;  // draw pitch names on the falling notes

// Cleanup. Both default to off: the transcription you see is the transcription the
// model produced until you say otherwise.
const filters = { minMs: 0, inKeyOnly: false };

// ---------- key + chord naming ----------
// Krumhansl-Schmuckler key profiles, correlated against how long each pitch class
// actually sounds (duration-weighted, not note counts — a held tonic says more
// about the key than a flurry of passing tones).
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
// Natural minor plus the raised 7th — the leading tone is too common in real music
// to treat as out-of-key, and culling it would delete correct notes.
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11];

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function detectKey(list) {
  if (list.length < 8) return null;

  const weight = new Array(12).fill(0);
  for (const n of list) weight[n.pitch % 12] += Math.max(n.end - n.start, 0.01);
  if (!weight.some((v) => v > 0)) return null;

  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = weight.map((_, i) => weight[(i + tonic) % 12]);
    for (const [profile, mode] of [[KS_MAJOR, "major"], [KS_MINOR, "minor"]]) {
      const r = pearson(rotated, profile);
      if (!best || r > best.r) best = { r, tonic, mode };
    }
  }
  if (!best) return null;

  const scale = best.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  return {
    tonic: best.tonic,
    mode: best.mode,
    r: best.r,
    name: `${PITCH_NAMES[best.tonic]} ${best.mode}`,
    pcs: new Set(scale.map((s) => (s + best.tonic) % 12)),
  };
}

// Interval sets measured up from the root, longest-first within each size so the
// richer spelling wins when both match.
const CHORD_SHAPES = [
  [[0, 7], "5"],
  [[0, 4, 7], ""],
  [[0, 3, 7], "m"],
  [[0, 3, 6], "dim"],
  [[0, 4, 8], "aug"],
  [[0, 5, 7], "sus4"],
  [[0, 2, 7], "sus2"],
  [[0, 4, 7, 11], "maj7"],
  [[0, 4, 7, 10], "7"],
  [[0, 3, 7, 10], "m7"],
  [[0, 3, 6, 10], "m7♭5"],
  [[0, 3, 6, 9], "dim7"],
  [[0, 4, 7, 9], "6"],
  [[0, 3, 7, 9], "m6"],
  [[0, 2, 4, 7], "add9"],
  [[0, 5, 7, 10], "7sus4"],
  [[0, 3, 7, 11], "m(maj7)"],
];

// A chord symbol for a set of sounding pitches, or null when the set isn't a shape
// worth naming — callers fall back to spelling the notes out.
function chordName(pitches) {
  const pcs = [...new Set(pitches.map((p) => p % 12))].sort((a, b) => a - b);
  if (pcs.length < 2) return null;
  const bassPc = pitches[0] % 12;

  for (const rootPc of pcs) {
    const iv = pcs.map((pc) => (pc - rootPc + 12) % 12).sort((a, b) => a - b);
    for (const [shape, suffix] of CHORD_SHAPES) {
      if (shape.length !== iv.length) continue;
      if (shape.every((v, i) => v === iv[i])) {
        const slash = bassPc !== rootPc ? `/${PITCH_NAMES[bassPc]}` : "";
        return `${PITCH_NAMES[rootPc]}${suffix}${slash}`;
      }
    }
  }
  return null;
}

// ---------- piano sampler ----------
// Salamander Grand Piano samples, sampled every major third (Tone.js pitch-shifts
// the gaps), served from Tone.js's own example-audio host.
function createPiano(onReady) {
  return new Tone.Sampler({
    urls: {
      A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
      A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
      A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
      A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
      A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
      A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
      A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
      A7: "A7.mp3", C8: "C8.mp3",
    },
    release: 1,
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    onload: onReady,
  }).toDestination();
}

// ---------- key layout (shared by the DOM keyboard and the falling-note canvas) ----------
// Both the keyboard and the roll read from this single layout so notes land in exact
// horizontal alignment with the key they're about to sound.
const WHITE_PITCHES = [];
for (let p = MIN_PITCH; p <= MAX_PITCH; p++) {
  if (isWhite(p)) WHITE_PITCHES.push(p);
}
const WHITE_INDEX = new Map(WHITE_PITCHES.map((p, i) => [p, i]));
const WHITE_FRAC = 1 / WHITE_PITCHES.length;
const BLACK_FRAC = WHITE_FRAC * 0.62;

// {x, width} as a 0–1 fraction of the full keyboard/roll width for a given pitch's column.
function pitchColumn(pitch) {
  if (isWhite(pitch)) {
    return { x: WHITE_INDEX.get(pitch) * WHITE_FRAC, width: WHITE_FRAC };
  }
  const precedingWhiteIndex = WHITE_INDEX.get(pitch - 1);
  const center = (precedingWhiteIndex + 1) * WHITE_FRAC;
  return { x: center - BLACK_FRAC / 2, width: BLACK_FRAC };
}

// ---------- the idle pattern ----------
// A silent, looping figure so the instrument is visibly alive before anything is
// loaded. It is labelled in the UI and never presented as a transcription.
const IDLE_LOOP = 8; // seconds
const IDLE_NOTES = (() => {
  const chords = [
    [57, 60, 64, 69, 72], // Am
    [53, 57, 60, 65, 69], // F
    [48, 52, 55, 60, 64], // C
    [55, 59, 62, 67, 71], // G
  ];
  const shape = [0, 1, 2, 3, 4, 3, 2, 1];
  const out = [];
  chords.forEach((tones, c) => {
    const t0 = c * 2;
    // a low root, a mid arpeggio, and a high sparkle line — so the figure spans
    // most of the keyboard's width rather than crowding the middle
    out.push({ pitch: tones[0] - 24, start: t0, end: t0 + 1.9, velocity: 0.55 });
    out.push({ pitch: tones[0] - 12, start: t0, end: t0 + 1.9, velocity: 0.5 });
    shape.forEach((step, i) => {
      const start = t0 + i * 0.25;
      out.push({ pitch: tones[step], start, end: start + 0.42, velocity: 0.42 + (i % 3) * 0.08 });
      if (i % 2 === 0) {
        out.push({ pitch: tones[(step + 2) % 5] + 24, start: start + 0.125, end: start + 0.3, velocity: 0.35 });
      }
    });
  });
  return out;
})();

// ---------- elements ----------
const canvas = document.getElementById("roll");
const ctx2d = canvas.getContext("2d");
const keyboardEl = document.getElementById("keyboard");
const consoleShell = document.getElementById("console-shell");
const stageEl = document.getElementById("stage");
const rollWrap = document.querySelector(".roll-wrap");
const stageHint = document.getElementById("stage-hint");
const timeLabel = document.getElementById("time-label");
const noteCountEl = document.getElementById("note-count");
const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const downloadLink = document.getElementById("download-link");
const downloadWavLink = document.getElementById("download-wav-link");
const reopenBtn = document.getElementById("reopen-source-btn");
const sourceLayer = document.getElementById("source-layer");
const statusEl = document.getElementById("status");
const dropZone = document.getElementById("drop-zone");
const dropTitle = document.getElementById("drop-title");
const dropSub = document.getElementById("drop-sub");
const fileInput = document.getElementById("file-input");
const urlInput = document.getElementById("url-input");
const convertFileBtn = document.getElementById("convert-file-btn");
const convertUrlBtn = document.getElementById("convert-url-btn");
const inspector = document.getElementById("inspector");
const inspPitch = document.getElementById("insp-pitch");
const inspStart = document.getElementById("insp-start");
const inspLen = document.getElementById("insp-len");
const inspVel = document.getElementById("insp-vel");
const inspBar = document.getElementById("insp-bar");
const nowNotesEl = document.getElementById("now-notes");
const namesBtn = document.getElementById("names-btn");
const progressEl = document.getElementById("progress");
const progressSteps = document.getElementById("progress-steps");
const progressStage = document.getElementById("progress-stage");
const progressEta = document.getElementById("progress-eta");
const progressTrack = document.getElementById("progress-track");
const progressBar = document.getElementById("progress-bar");
const notesKeyEl = document.getElementById("notes-key");
const noteListEl = document.getElementById("note-list");
const noteListEmpty = document.getElementById("note-list-empty");
const noteListMore = document.getElementById("note-list-more");
const minLenInput = document.getElementById("min-len");
const minLenOut = document.getElementById("min-len-out");
const inKeyBtn = document.getElementById("in-key-btn");

const DROP_SUB_DEFAULT = dropSub.textContent;

// ---------- keyboard ----------
const keyElsByPitch = new Map();
const keysInPitchOrder = [];
let focusIndex = 39; // C4, a sane starting point for arrow-key navigation

function buildKeyboard() {
  const make = (p, cls) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `key ${cls}`;
    el.dataset.pitch = String(p);
    el.setAttribute("aria-label", pitchName(p));
    el.tabIndex = -1;
    keyboardEl.appendChild(el);
    keyElsByPitch.set(p, el);
  };

  for (const p of WHITE_PITCHES) make(p, "white");

  for (let p = MIN_PITCH; p <= MAX_PITCH; p++) {
    if (isWhite(p)) continue;
    make(p, "black");
    const { x, width } = pitchColumn(p);
    const el = keyElsByPitch.get(p);
    el.style.left = `${x * 100}%`;
    el.style.width = `${width * 100}%`;
  }

  for (let p = MIN_PITCH; p <= MAX_PITCH; p++) keysInPitchOrder.push(keyElsByPitch.get(p));
  keysInPitchOrder[focusIndex].tabIndex = 0;
}

function drawKeyboard(activePitches) {
  for (const [pitch, el] of keyElsByPitch) {
    el.classList.toggle("pressed", activePitches.has(pitch));
  }
}

// --- playing the keys directly ---
let audioUnlocked = false;

async function unlockAudio() {
  if (audioUnlocked || !hasAudio) return;
  await Tone.start();
  audioUnlocked = true;
}

// A key lights the moment it is pressed, whether or not the samples are ready —
// the visual instrument never waits on the audio one.
function pressKey(pitch) {
  if (held.has(pitch)) return;
  held.add(pitch);
  if (pianoLoaded) synth.triggerAttack(Tone.Frequency(pitch, "midi").toFrequency(), undefined, 0.8);
}

function releaseKey(pitch) {
  if (!held.has(pitch)) return;
  held.delete(pitch);
  if (pianoLoaded) synth.triggerRelease(Tone.Frequency(pitch, "midi").toFrequency());
}

function releaseAllKeys() {
  for (const p of [...held]) releaseKey(p);
}

let dragging = false;

function pitchFromEvent(e) {
  const el = e.target.closest?.(".key");
  return el ? Number(el.dataset.pitch) : null;
}

keyboardEl.addEventListener("pointerdown", (e) => {
  const pitch = pitchFromEvent(e);
  if (pitch === null) return;
  e.preventDefault();
  // Release implicit capture so a drag can glissando across neighbouring keys.
  if (e.target.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
  dragging = true;
  unlockAudio().then(() => pressKey(pitch));
  const idx = pitch - MIN_PITCH;
  if (keysInPitchOrder[idx]) setFocusIndex(idx);
});

keyboardEl.addEventListener("pointerover", (e) => {
  if (!dragging) return;
  const pitch = pitchFromEvent(e);
  if (pitch === null || held.has(pitch)) return;
  releaseAllKeys();
  pressKey(pitch);
});

const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  releaseAllKeys();
};
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
keyboardEl.addEventListener("pointerleave", () => {
  if (dragging) releaseAllKeys();
});

// --- keyboard access: roving tabindex across the 88 keys ---
function setFocusIndex(idx) {
  keysInPitchOrder[focusIndex].tabIndex = -1;
  focusIndex = Math.max(0, Math.min(keysInPitchOrder.length - 1, idx));
  keysInPitchOrder[focusIndex].tabIndex = 0;
}

keyboardEl.addEventListener("keydown", (e) => {
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 12, ArrowDown: -12 }[e.key];
  if (step) {
    e.preventDefault();
    setFocusIndex(focusIndex + step);
    keysInPitchOrder[focusIndex].focus();
    return;
  }
  if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    setFocusIndex(e.key === "Home" ? 0 : keysInPitchOrder.length - 1);
    keysInPitchOrder[focusIndex].focus();
    return;
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    const pitch = MIN_PITCH + focusIndex;
    unlockAudio().then(() => {
      pressKey(pitch);
      setTimeout(() => releaseKey(pitch), 420);
    });
  }
});

keyboardEl.addEventListener("focusin", (e) => {
  const pitch = pitchFromEvent(e);
  if (pitch !== null) focusIndex = pitch - MIN_PITCH;
});

// ---------- piano roll (falling notes) ----------
// Time runs top-to-bottom: each note is a bar that falls and lands on its key exactly
// when it starts sounding, at the hit line where the roll meets the keyboard.
const PX_PER_SEC = 90;
const view = { w: 0, h: 0 };
let impacts = []; // expanding rings where a note crossed the hit line

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.w = rect.width;
  view.h = rect.height;
}
window.addEventListener("resize", resizeCanvas);

function noteRect(n, now) {
  const { x, width } = pitchColumn(n.pitch);
  const pad = Math.max(width * view.w * 0.12, 1);
  const yBottom = view.h - (n.start - now) * PX_PER_SEC; // reaches the hit line at n.start
  const yTop = view.h - (n.end - now) * PX_PER_SEC;      // clears the hit line at n.end
  return {
    x: x * view.w + pad,
    w: Math.max(width * view.w - pad * 2, 2),
    yTop,
    yBottom,
  };
}

function roundedBar(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx2d.beginPath();
  if (ctx2d.roundRect) ctx2d.roundRect(x, y, w, h, radius);
  else ctx2d.rect(x, y, w, h);
  ctx2d.fill();
}

// Names ride just above each note's leading edge, and only once the note is close
// enough to the keys to be worth reading — labelling the whole column at 16px wide
// would be a wall of overlapping text.
const LABEL_ZONE = 0.52;   // fraction of the roll's height, measured up from the keys
const LABEL_MIN_LEN = 0.1; // seconds; below this the bar is too short to hang a name on

function drawNotes(list, now, activePitches, alpha, withNames = false) {
  const w = view.w;
  const h = view.h;
  const labels = [];
  ctx2d.save();
  ctx2d.globalAlpha = alpha;

  for (const n of list) {
    const r = noteRect(n, now);
    if (r.yTop > h || r.yBottom < 0) continue;

    const by = Math.max(r.yTop, 0);
    const bh = Math.max(Math.min(r.yBottom, h) - by, 2);
    const active = activePitches.has(n.pitch) && n.start <= now && n.end > now;

    if (
      withNames &&
      n.end - n.start >= LABEL_MIN_LEN &&
      r.yBottom > h * (1 - LABEL_ZONE) &&
      r.yBottom < h + 12
    ) {
      labels.push({
        text: pitchName(n.pitch),
        x: r.x + r.w / 2,
        y: Math.min(r.yBottom, h) - 5,
        active,
      });
    }

    if (active) {
      ctx2d.shadowColor = "rgba(201, 255, 77, 0.75)";
      ctx2d.shadowBlur = 22;
      ctx2d.fillStyle = "#c9ff4d";
    } else {
      // brighten as the note approaches the keys, so the roll reads as depth
      const nearness = Math.max(0, Math.min(1, 1 - (h - r.yBottom) / h));
      ctx2d.shadowColor = "rgba(111, 240, 192, 0.5)";
      ctx2d.shadowBlur = 6 + nearness * 10;
      ctx2d.fillStyle = `rgba(198, 255, 232, ${(0.38 + nearness * 0.5).toFixed(3)})`;
    }
    roundedBar(r.x, by, r.w, bh, 4);
    ctx2d.shadowBlur = 0;

    // a lit cap on the leading edge of every note
    if (!active && r.yBottom > 0 && r.yBottom < h) {
      ctx2d.fillStyle = "rgba(255, 255, 255, 0.85)";
      roundedBar(r.x, Math.max(r.yBottom - 2, by), r.w, 2, 1);
    }
  }

  // Labels last, so a name is never painted over by a later note's bar.
  if (labels.length) {
    ctx2d.font = '600 9px "Azeret Mono", ui-monospace, monospace';
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "bottom";
    for (const l of labels) {
      const x = Math.max(12, Math.min(w - 12, l.x));
      ctx2d.lineWidth = 3;
      ctx2d.strokeStyle = "rgba(3, 15, 13, 0.92)";
      ctx2d.strokeText(l.text, x, l.y);
      ctx2d.fillStyle = l.active ? "#0d1a02" : "rgba(236, 255, 248, 0.92)";
      if (l.active) {
        // on a lit note the bar is already lime, so the name inverts to stay legible
        ctx2d.strokeStyle = "rgba(201, 255, 77, 0.95)";
        ctx2d.strokeText(l.text, x, l.y);
      }
      ctx2d.fillText(l.text, x, l.y);
    }
  }

  ctx2d.restore(); // also puts font/textAlign/textBaseline back for the caller
}

function drawRoll(now, activePitches, idleNow) {
  const w = view.w;
  const h = view.h;
  ctx2d.clearRect(0, 0, w, h);

  // octave guides — the only grid the system allows, one hairline per C,
  // labelled so the empty regions of the roll still tell you where you are
  ctx2d.font = '600 9px "Azeret Mono", ui-monospace, monospace';
  ctx2d.textBaseline = "top";
  for (let p = 24; p <= MAX_PITCH; p += 12) {
    const { x } = pitchColumn(p);
    const px = Math.round(x * w);
    ctx2d.fillStyle = "rgba(255, 255, 255, 0.07)";
    ctx2d.fillRect(px, 0, 1, h);
    ctx2d.fillStyle = "rgba(255, 255, 255, 0.24)";
    if (px + 22 < w) ctx2d.fillText(pitchName(p), px + 4, h - 40);
  }

  if (notes.length) {
    drawNotes(notes, now, activePitches, 1, showNames);
  } else {
    // the idle figure is never labelled — labels would read as a transcription
    drawNotes(IDLE_NOTES, idleNow, idleActive(idleNow), 0.55);
  }

  // impact rings: a note landing on its key
  const t = performance.now();
  impacts = impacts.filter((i) => t - i.t0 < 520);
  for (const i of impacts) {
    const k = (t - i.t0) / 520;
    ctx2d.strokeStyle = `rgba(201, 255, 77, ${(0.5 * (1 - k)).toFixed(3)})`;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.ellipse(i.x, h - 1, i.w * (0.6 + k * 2.4), 6 + k * 26, 0, Math.PI, 0);
    ctx2d.stroke();
  }

  // hit line: where falling notes meet the keys
  const grad = ctx2d.createLinearGradient(0, h - 26, 0, h);
  grad.addColorStop(0, "rgba(201, 255, 77, 0)");
  grad.addColorStop(1, "rgba(201, 255, 77, 0.16)");
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, h - 26, w, 26);

  ctx2d.fillStyle = "rgba(201, 255, 77, 0.85)";
  ctx2d.fillRect(0, h - 2, w, 2);
}

function idleActive(idleNow) {
  const set = new Set();
  for (const n of IDLE_NOTES) {
    if (n.start <= idleNow && n.end > idleNow) set.add(n.pitch);
  }
  return set;
}

// ---------- note inspector ----------
let pinnedNote = null;
let hoverNote = null;

function noteAt(px, py, now) {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const r = noteRect(n, now);
    if (px >= r.x - 2 && px <= r.x + r.w + 2 && py >= r.yTop - 2 && py <= r.yBottom + 2) return n;
  }
  return null;
}

function showInspector(n, px, py) {
  inspPitch.textContent = pitchName(n.pitch);
  inspStart.textContent = `${n.start.toFixed(2)}s`;
  inspLen.textContent = `${(n.end - n.start).toFixed(2)}s`;
  inspVel.textContent = n.velocity.toFixed(2);
  inspBar.style.transform = `scaleX(${Math.max(0, Math.min(1, n.velocity))})`;
  inspector.hidden = false;

  const box = inspector.getBoundingClientRect();
  const left = px < view.w / 2 ? px + 18 : px - box.width - 18;
  inspector.style.left = `${Math.max(8, Math.min(view.w - box.width - 8, left))}px`;
  inspector.style.top = `${Math.max(8, Math.min(view.h - box.height - 8, py - box.height / 2))}px`;
}

rollWrap.addEventListener("pointermove", (e) => {
  if (!notes.length || pinnedNote) return;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  hoverNote = noteAt(px, py, currentTime());
  if (hoverNote) showInspector(hoverNote, px, py);
  else inspector.hidden = true;
});

rollWrap.addEventListener("pointerleave", () => {
  if (!pinnedNote) inspector.hidden = true;
});

rollWrap.addEventListener("click", (e) => {
  if (!notes.length) return;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const hit = noteAt(px, py, currentTime());
  if (hit) {
    pinnedNote = pinnedNote === hit ? null : hit;
    if (pinnedNote) showInspector(pinnedNote, px, py);
  } else {
    pinnedNote = null;
    inspector.hidden = true;
  }
});

// ---------- the written answer: notes as text ----------
// Notes that start together are one event to a listener, so they're grouped and
// named as a chord where the shape is nameable. This list is also the roll's
// non-visual equivalent — the canvas cannot be read by itself.
const CLUSTER_WINDOW = 0.075; // seconds; starts within this window read as simultaneous
const MAX_ROWS = 1200;        // beyond this the list stops being scannable anyway

let clusters = [];
let rowEls = [];
let activeRow = -1;
let flashed = new Set();   // pitches lit by auditioning a row, not by playback
let lastUserScroll = 0;

function buildClusters(list) {
  const out = [];
  let cur = null;
  for (const n of list) {
    if (!cur || n.start - cur.start > CLUSTER_WINDOW) {
      cur = { start: n.start, end: n.end, notes: [n] };
      out.push(cur);
    } else {
      cur.notes.push(n);
      cur.end = Math.max(cur.end, n.end);
    }
  }
  return out;
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(2).padStart(5, "0")}`;
}

function describeCluster(c) {
  const pitches = [...new Set(c.notes.map((n) => n.pitch))].sort((a, b) => a - b);
  const spelled = pitches.map(pitchName).join(" ");
  if (pitches.length === 1) return { label: spelled, detail: "" };
  const chord = chordName(pitches);
  return chord ? { label: chord, detail: spelled } : { label: spelled, detail: "" };
}

function auditionCluster(c) {
  for (const n of c.notes) flashed.add(n.pitch);
  setTimeout(() => {
    for (const n of c.notes) flashed.delete(n.pitch);
  }, 420);

  if (!pianoLoaded) return;
  unlockAudio().then(() => {
    for (const n of c.notes) {
      const len = Math.min(Math.max(n.end - n.start, 0.3), 1.5);
      synth.triggerAttackRelease(
        Tone.Frequency(n.pitch, "midi").toFrequency(),
        len,
        undefined,
        Math.max(n.velocity, 0.4)
      );
    }
  });
}

function renderNoteList() {
  clusters = buildClusters(notes);
  rowEls = [];
  activeRow = -1;
  noteListEl.replaceChildren();

  noteListEmpty.hidden = clusters.length > 0;
  if (!clusters.length) {
    // "nothing here" has two very different causes, and cleanup is recoverable
    noteListEmpty.textContent = allNotes.length
      ? `Cleanup is filtering out all ${allNotes.length} detected notes — loosen it to see them.`
      : "Transcribe something and every note lands here as text — named, timed, and grouped into chords.";
    noteListMore.hidden = true;
    return;
  }

  const shown = Math.min(clusters.length, MAX_ROWS);
  const frag = document.createDocumentFragment();

  for (let i = 0; i < shown; i++) {
    const c = clusters[i];
    const { label, detail } = describeCluster(c);

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "note-row";
    btn.dataset.index = String(i);

    const time = document.createElement("span");
    time.className = "note-time";
    time.textContent = fmtClock(c.start);

    const name = document.createElement("span");
    name.className = "note-name";
    name.textContent = label;

    const det = document.createElement("span");
    det.className = "note-detail";
    det.textContent = detail;

    const len = document.createElement("span");
    len.className = "note-len";
    len.textContent = `${(c.end - c.start).toFixed(2)}s`;

    btn.append(time, name, det, len);
    btn.setAttribute(
      "aria-label",
      `${label}${detail ? ` — ${detail}` : ""} at ${fmtClock(c.start)}, ${(c.end - c.start).toFixed(2)} seconds. Play it.`
    );
    li.appendChild(btn);
    frag.appendChild(li);
    rowEls.push(btn);
  }

  noteListEl.appendChild(frag);

  if (clusters.length > shown) {
    noteListMore.textContent = `Showing the first ${shown} of ${clusters.length} events — the MIDI download has all of them.`;
    noteListMore.hidden = false;
  } else {
    noteListMore.hidden = true;
  }
}

noteListEl.addEventListener("click", (e) => {
  const btn = e.target.closest?.(".note-row");
  if (!btn) return;
  const c = clusters[Number(btn.dataset.index)];
  if (c) auditionCluster(c);
});

const noteListWrap = noteListEl.parentElement;
noteListWrap.addEventListener("scroll", () => {
  lastUserScroll = performance.now();
}, { passive: true });

// clusters are ordered by start, so the row for a given instant is a binary search
function clusterIndexAt(now) {
  let lo = 0;
  let hi = clusters.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clusters[mid].start <= now) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return -1;
  return now < clusters[found].end + 0.12 ? found : -1;
}

function updateActiveRow(now) {
  if (!rowEls.length) return;
  const idx = playing ? clusterIndexAt(now) : -1;
  if (idx === activeRow) return;

  if (rowEls[activeRow]) rowEls[activeRow].classList.remove("is-live");
  activeRow = idx;
  const el = rowEls[activeRow];
  if (!el) return;
  el.classList.add("is-live");

  // follow along, unless the visitor is reading somewhere else right now
  if (performance.now() - lastUserScroll > 4000) {
    const target = el.offsetTop - noteListWrap.clientHeight / 2 + el.offsetHeight / 2;
    noteListWrap.scrollTop = Math.max(0, target);
  }
}

function renderKeyReadout() {
  if (!allNotes.length) {
    notesKeyEl.textContent = "Nothing transcribed yet";
    notesKeyEl.classList.remove("is-set");
    return;
  }
  notesKeyEl.classList.add("is-set");
  // The key is read from everything the model heard, so it still holds when cleanup
  // has hidden the notes it was derived from — but say so rather than reporting "0".
  const count = notes.length ? `${notes.length} notes` : `${allNotes.length} notes, all filtered`;
  if (!keyInfo) {
    notesKeyEl.textContent = `${count} · key undetermined`;
    return;
  }
  // The correlation is a fit, not a fact — a weak one gets hedged rather than stated.
  const hedge = keyInfo.r < 0.6 ? "probably " : "";
  notesKeyEl.textContent = `${count} · ${hedge}${keyInfo.name}`;
}

// ---------- MIDI export ----------
// Written here rather than served from the backend's .mid, because cleanup changes
// which notes are real to the visitor — the file has to be the notes on screen.
let midiUrl = null;

function vlq(value) {
  const out = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return out;
}

function encodeMidi(list) {
  const TPQ = 480;
  const TICKS_PER_SEC = TPQ * 2; // 120 BPM, so a quarter note is half a second

  const evts = [];
  for (const n of list) {
    const on = Math.max(0, Math.round(n.start * TICKS_PER_SEC));
    const off = Math.max(on + 1, Math.round(n.end * TICKS_PER_SEC));
    evts.push({ t: on, on: 1, pitch: n.pitch, vel: Math.max(1, Math.min(127, Math.round(n.velocity * 127))) });
    evts.push({ t: off, on: 0, pitch: n.pitch, vel: 0 });
  }
  // note-offs before note-ons at the same tick, so a repeated pitch retriggers
  // instead of having its new attack cut short by the old note's release
  evts.sort((a, b) => a.t - b.t || a.on - b.on);

  const track = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // tempo: 500000µs/quarter
  let prev = 0;
  for (const e of evts) {
    for (const b of vlq(e.t - prev)) track.push(b);
    prev = e.t;
    track.push(e.on ? 0x90 : 0x80, e.pitch & 0x7f, e.vel);
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // end of track

  const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const header = [
    0x4d, 0x54, 0x68, 0x64, ...be32(6),
    0x00, 0x00,             // format 0
    0x00, 0x01,             // one track
    (TPQ >> 8) & 255, TPQ & 255,
    0x4d, 0x54, 0x72, 0x6b, ...be32(track.length),
  ];

  const out = new Uint8Array(header.length + track.length);
  out.set(header, 0);
  out.set(track, header.length);
  return out;
}

function refreshMidiLink() {
  if (midiUrl) {
    URL.revokeObjectURL(midiUrl);
    midiUrl = null;
  }
  if (!notes.length) {
    downloadLink.hidden = true;
    return;
  }
  midiUrl = URL.createObjectURL(new Blob([encodeMidi(notes)], { type: "audio/midi" }));
  downloadLink.href = midiUrl;
  downloadLink.hidden = false;
}

// ---------- cleanup ----------
function applyFilters({ rerender = true } = {}) {
  const minSec = filters.minMs / 1000;
  notes = allNotes.filter((n) => {
    if (n.end - n.start < minSec) return false;
    if (filters.inKeyOnly && keyInfo && !keyInfo.pcs.has(n.pitch % 12)) return false;
    return true;
  });
  duration = notes.length ? Math.max(...notes.map((n) => n.end)) : 0;

  // anything pointing at a note that just left the set has to let go
  if (playing) stopPlayback();
  pinnedNote = null;
  hoverNote = null;
  inspector.hidden = true;

  const cut = allNotes.length - notes.length;
  noteCountEl.textContent = cut
    ? `${notes.length} notes · ${cut} filtered out`
    : `${notes.length} notes`;

  playBtn.disabled = !notes.length || !pianoLoaded || !hasAudio;
  stopBtn.disabled = !notes.length;

  canvas.setAttribute(
    "aria-label",
    notes.length
      ? `Piano roll showing ${notes.length} transcribed notes from ${pitchName(
          Math.min(...notes.map((n) => n.pitch))
        )} to ${pitchName(Math.max(...notes.map((n) => n.pitch)))}, ${duration.toFixed(1)} seconds long. ` +
        `The same notes are listed as text under the console.`
      : "Piano roll, currently showing a looping idle pattern rather than a transcription."
  );

  if (rerender) {
    renderNoteList();
    renderKeyReadout();
    refreshMidiLink();
  }
}

minLenInput.addEventListener("input", () => {
  filters.minMs = Number(minLenInput.value);
  minLenOut.textContent = `${filters.minMs} ms`;
  if (allNotes.length) applyFilters();
});

inKeyBtn.addEventListener("click", () => {
  filters.inKeyOnly = !filters.inKeyOnly;
  inKeyBtn.setAttribute("aria-checked", String(filters.inKeyOnly));
  inKeyBtn.classList.toggle("is-on", filters.inKeyOnly);
  if (allNotes.length) applyFilters();
});

namesBtn.addEventListener("click", () => {
  showNames = !showNames;
  namesBtn.setAttribute("aria-pressed", String(showNames));
  namesBtn.classList.toggle("is-on", showNames);
});

// ---------- the light ----------
// One light source, and it is the pointer. Nothing in the background moves on its
// own; the light trails the cursor slightly so it reads as a lamp rather than a
// cursor decoration. Playback only changes how bright it is.
const light = { x: 0.5, y: 0.42, tx: 0.5, ty: 0.42 };
let bloom = 0;

window.addEventListener(
  "pointermove",
  (e) => {
    light.tx = e.clientX / window.innerWidth;
    light.ty = e.clientY / window.innerHeight;
  },
  { passive: true }
);

function updateField(activePitches) {
  const target = Math.min(1, activePitches.size / 5);
  bloom += (target - bloom) * 0.12;

  const ease = reduceMotion.matches ? 1 : 0.09;
  light.x += (light.tx - light.x) * ease;
  light.y += (light.ty - light.y) * ease;

  const root = document.documentElement.style;
  root.setProperty("--bloom", bloom.toFixed(3));
  root.setProperty("--cx", `${(light.x * 100).toFixed(2)}%`);
  root.setProperty("--cy", `${(light.y * 100).toFixed(2)}%`);
  // the glass rim's bright arc points back at the light
  root.setProperty(
    "--ring-a",
    `${((Math.atan2(light.y - 0.5, light.x - 0.5) * 180) / Math.PI + 90).toFixed(1)}deg`
  );
}

// ---------- transport / animation ----------
function currentTime() {
  return playing && hasAudio ? Tone.Transport.seconds : 0;
}

// "what notes is that playing", answered continuously and in words. Only ever
// speaks for real notes or keys the visitor is pressing — never for the idle figure.
const NOW_NOTES_MAX = 6;
let lastNowNotes = "";

function renderNowNotes(active) {
  let text = "";
  if (active.size && (notes.length || held.size || flashed.size)) {
    const pitches = [...active].sort((a, b) => a - b);
    const shown = pitches.slice(0, NOW_NOTES_MAX).map(pitchName).join("  ");
    const extra = pitches.length - NOW_NOTES_MAX;
    const chord = pitches.length > 1 ? chordName(pitches) : null;
    text = extra > 0 ? `${shown} +${extra}` : shown;
    if (chord) text = `${chord} · ${text}`;
  }
  if (text !== lastNowNotes) {
    nowNotesEl.textContent = text;
    lastNowNotes = text;
  }
}

let lastActive = new Set();
let rafId = null;

function tick() {
  const now = currentTime();
  const idleNow = reduceMotion.matches ? 1.2 : (performance.now() / 1000) % IDLE_LOOP;

  let active;
  if (notes.length) {
    active = new Set(notes.filter((n) => n.start <= now && n.end > now).map((n) => n.pitch));
  } else {
    active = idleActive(idleNow);
  }
  for (const p of held) active.add(p);
  for (const p of flashed) active.add(p);

  // register an impact ring for every note that just crossed the hit line
  if (!reduceMotion.matches) {
    for (const p of active) {
      if (!lastActive.has(p)) {
        const c = pitchColumn(p);
        impacts.push({ x: (c.x + c.width / 2) * view.w, w: c.width * view.w, t0: performance.now() });
      }
    }
  }
  lastActive = active;

  drawKeyboard(active);
  drawRoll(now, active, idleNow);
  updateField(active);
  timeLabel.textContent = `${now.toFixed(2)}s`;
  renderNowNotes(active);
  updateActiveRow(now);

  if (pinnedNote) {
    // keep a pinned readout accurate while the roll scrolls under it
    inspStart.textContent = `${pinnedNote.start.toFixed(2)}s`;
  }

  if (playing && now >= duration + 0.5) {
    stopPlayback();
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopLoop();
  else startLoop();
});

async function startPlayback() {
  if (!hasAudio) return;
  await unlockAudio();
  if (part) part.dispose();

  const events = notes.map((n) => ({
    time: n.start,
    note: Tone.Frequency(n.pitch, "midi").toFrequency(),
    duration: Math.max(n.end - n.start, 0.05),
    velocity: n.velocity,
  }));

  part = new Tone.Part((time, ev) => {
    synth.triggerAttackRelease(ev.note, ev.duration, time, ev.velocity);
  }, events).start(0);

  Tone.Transport.stop();
  Tone.Transport.seconds = 0;
  Tone.Transport.start();
  playing = true;
  playBtn.innerHTML = '<span class="btn-glyph" aria-hidden="true">▶</span> Playing';
  startLoop();
}

function stopPlayback() {
  playing = false;
  if (hasAudio) Tone.Transport.stop();
  if (part) part.dispose();
  playBtn.innerHTML = '<span class="btn-glyph" aria-hidden="true">▶</span> Play';
  timeLabel.textContent = "0.00s";
  startLoop();
}

playBtn.addEventListener("click", () => {
  if (!notes.length) return;
  if (!hasAudio) return setStatus("Playback is unavailable — the Tone.js audio library didn't load. The MIDI download still works.", "error");
  if (!pianoLoaded) return setStatus("Piano samples are still loading — try again in a moment.", "error");
  if (playing) stopPlayback();
  else startPlayback();
});

stopBtn.addEventListener("click", stopPlayback);

// ---------- glass interaction: sheen + ripple ----------
document.querySelectorAll(".glass, .drop").forEach((el) => {
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
});

document.addEventListener("pointerdown", (e) => {
  if (reduceMotion.matches) return;
  const btn = e.target.closest?.(".btn");
  if (!btn || btn.disabled) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.4;
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - r.left}px`;
  ripple.style.top = `${e.clientY - r.top}px`;
  ripple.addEventListener("animationend", () => ripple.remove());
  btn.appendChild(ripple);
});

// ---------- source panel ----------
let wavOnly = false;

document.querySelectorAll(".mode-opt").forEach((opt) => {
  opt.addEventListener("click", () => {
    wavOnly = opt.dataset.wavOnly === "true";
    document.querySelectorAll(".mode-opt").forEach((o) => {
      const on = o === opt;
      o.classList.toggle("is-on", on);
      o.setAttribute("aria-checked", String(on));
    });
    convertFileBtn.textContent = wavOnly ? "Extract WAV" : "Transcribe";
  });
});

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.classList.toggle("is-error", kind === "error");
  statusEl.classList.toggle("is-working", kind === "working");
}

function describeFile(file) {
  const mb = file.size / (1024 * 1024);
  dropZone.classList.add("has-file");
  dropTitle.textContent = file.name;
  dropSub.textContent = `${mb < 0.1 ? "<0.1" : mb.toFixed(1)} MB · ready`;
}

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) describeFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("is-over");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === "dragleave" && dropZone.contains(e.relatedTarget)) return;
    dropZone.classList.remove("is-over");
  })
);

dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  describeFile(file);
});

// keep the browser from opening a file dropped anywhere else on the page
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

function dismissSource() {
  sourceLayer.classList.add("is-dismissed");
  reopenBtn.hidden = false;
}

reopenBtn.addEventListener("click", () => {
  sourceLayer.classList.remove("is-dismissed");
  reopenBtn.hidden = true;
});

// ---------- backend calls ----------
function onResult(data) {
  const hasMidi = Boolean(data.midi_url);

  allNotes = hasMidi ? data.notes : [];
  keyInfo = detectKey(allNotes);

  downloadWavLink.href = `${API_BASE}${data.wav_url}`;
  downloadWavLink.hidden = false;

  // sets notes/duration from allNotes through the cleanup filters, then rebuilds
  // the count, the roll's label, the text list and the MIDI blob from that result
  applyFilters();

  if (hasMidi) {
    stageHint.textContent = "Click a note to inspect it · click the keys to play them";
    ignite();
    const key = keyInfo ? ` Reads as ${keyInfo.name}.` : "";
    setStatus(`Done — ${allNotes.length} notes detected.${key} Press play.`);
  } else {
    noteCountEl.textContent = "wav only";
    setStatus("Done — WAV extracted. The download is in the transport bar.");
  }

  resizeCanvas();
  startLoop();
}

// The one authored moment: the field surges, the source panel dissolves, the roll takes over.
function ignite() {
  dismissSource();
  if (reduceMotion.matches) return;
  bloom = 1;
  document.documentElement.style.setProperty("--bloom", "1");
}

// ---------- progress ----------
// Conversion takes minutes, so the wait is narrated instead of spun. The backend
// reports which stage is running and how long it estimates is left, from the audio's
// real duration and its own measured speed; when it can't estimate, the bar goes
// indeterminate rather than pretending to advance.
const POLL_MS = 900;
const STEP_LABELS = {
  fetching: "Fetch",
  separating: "Strip drums",
  transcribing: "Detect pitch",
};

function fmtLeft(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function showProgress(stages) {
  progressSteps.replaceChildren();
  for (const s of stages) {
    const li = document.createElement("li");
    li.className = "progress-step";
    li.dataset.stage = s;
    li.textContent = STEP_LABELS[s] || s;
    progressSteps.appendChild(li);
  }
  progressStage.textContent = "Starting…";
  progressEta.textContent = "";
  progressBar.style.transform = "scaleX(0)";
  progressTrack.classList.remove("is-indeterminate");
  progressEl.hidden = false;
}

function hideProgress() {
  progressEl.hidden = true;
  progressTrack.classList.remove("is-indeterminate");
}

function updateProgress(p, stages) {
  const order = stages.indexOf(p.stage);
  for (const li of progressSteps.children) {
    const idx = stages.indexOf(li.dataset.stage);
    li.classList.toggle("is-live", li.dataset.stage === p.stage);
    li.classList.toggle("is-done", p.stage === "done" || (order >= 0 && idx < order));
  }

  progressStage.textContent = p.label || "Working…";

  const known = typeof p.percent === "number";
  const indeterminate = !known && p.stage !== "queued";
  progressTrack.classList.toggle("is-indeterminate", indeterminate);
  // The indeterminate fill belongs to the stylesheet — an inline transform here would
  // fight the sweep keyframes and override the reduced-motion static-bar fallback.
  if (indeterminate) progressBar.style.removeProperty("transform");
  else progressBar.style.transform = `scaleX(${(known ? p.percent : 0) / 100})`;
  if (known && !indeterminate) progressTrack.setAttribute("aria-valuenow", String(Math.round(p.percent)));
  else progressTrack.removeAttribute("aria-valuenow");

  if (p.eta_seconds != null) {
    progressEta.textContent = `about ${fmtLeft(p.eta_seconds)} left`;
  } else if (p.stage === "queued") {
    progressEta.textContent = "another conversion is finishing first";
  } else if (p.stage_elapsed != null) {
    progressEta.textContent = `${fmtLeft(p.stage_elapsed)} in — no estimate for this file`;
  } else {
    progressEta.textContent = "";
  }
}

// One spoken update per stage change, not one per poll — a live region that fires
// every 900ms is unusable with a screen reader.
function announceStage(p) {
  const eta = p.eta_seconds != null ? ` — about ${fmtLeft(p.eta_seconds)} left` : "";
  setStatus(`${p.label}${eta}`, "working");
}

async function pollUntilDone(jobId, stages) {
  let lastStage = null;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await fetch(`${API_BASE}/api/progress/${jobId}`);
    if (!res.ok) throw new Error("Lost track of the conversion — the server forgot the job.");
    const p = await res.json();

    updateProgress(p, stages);
    if (p.stage !== lastStage && p.stage !== "done" && p.stage !== "error") {
      announceStage(p);
      lastStage = p.stage;
    }

    if (p.stage === "done") return p.result;
    if (p.stage === "error") throw new Error(p.error || "Conversion failed.");
  }
}

async function runConversion(startRequest, stages, openingMsg) {
  setStatus(openingMsg, "working");
  consoleShell.classList.add("is-working");
  convertUrlBtn.disabled = true;
  convertFileBtn.disabled = true;
  showProgress(stages);
  try {
    const res = await startRequest;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `The server rejected the request (${res.status}).`);
    }
    const { job_id: jobId } = await res.json();
    if (!jobId) throw new Error("The server didn't start a conversion job.");
    const result = await pollUntilDone(jobId, stages);
    hideProgress();
    onResult(result);
  } catch (err) {
    hideProgress();
    const msg = err instanceof TypeError
      ? "Couldn't reach the transcription server. Check that the backend is running, then try again."
      : err.message || String(err);
    setStatus(msg, "error");
  } finally {
    consoleShell.classList.remove("is-working");
    convertUrlBtn.disabled = false;
    convertFileBtn.disabled = false;
  }
}

function stagesFor(withFetch) {
  const out = withFetch ? ["fetching", "separating"] : ["separating"];
  if (!wavOnly) out.push("transcribing");
  return out;
}

convertUrlBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) return setStatus("Paste a YouTube URL first.", "error");
  if (!YOUTUBE_URL_RE.test(url)) {
    return setStatus("Only YouTube links work here — youtube.com/watch?v=… or youtu.be/…", "error");
  }
  const qs = wavOnly ? "?wav_only=true" : "";
  runConversion(
    fetch(`${API_BASE}/api/convert-url${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
    stagesFor(true),
    "Starting — fetching the audio first."
  );
});

convertFileBtn.addEventListener("click", () => {
  const file = fileInput.files[0];
  if (!file) return setStatus("Choose or drop a file first.", "error");
  const form = new FormData();
  form.append("file", file);
  const qs = wavOnly ? "?wav_only=true" : "";
  runConversion(
    fetch(`${API_BASE}/api/convert-upload${qs}`, { method: "POST", body: form }),
    stagesFor(false),
    "Uploading…"
  );
});

// ---------- init ----------
// The visual instrument comes up first and unconditionally; audio is attached after,
// so a failed CDN costs you the sound and nothing else.
buildKeyboard();
resizeCanvas();
playBtn.disabled = true;
stopBtn.disabled = true;
downloadLink.hidden = true;
downloadWavLink.hidden = true;
minLenOut.textContent = `${filters.minMs} ms`;
renderNoteList();
renderKeyReadout();
void DROP_SUB_DEFAULT;
startLoop();

if (hasAudio) {
  synth = createPiano(() => {
    pianoLoaded = true;
    playBtn.disabled = !notes.length;
  });
} else {
  stageHint.textContent = "Audio unavailable — the Tone.js library didn't load. Transcription and MIDI export still work.";
}
