"""
YouTube/Audio -> MIDI backend.

Flow:
  1. Get a WAV (either downloaded from a URL via yt-dlp, or a direct upload).
  2. Strip the drum stem via Demucs so busy full mixes don't mask the melody.
  3. Run it through Spotify's Basic Pitch to get note events + a .mid file.
  4. Hand the frontend a clean JSON note list plus a link to download the raw MIDI.

Steps 2 and 3 each run at a decent fraction of real time on CPU, so a full song
costs minutes. The convert endpoints therefore return a job id immediately and
run the pipeline on a worker thread; the frontend polls /api/progress/{job_id}
for the current stage and an estimated time remaining, so the wait is narrated
instead of being a blank spinner.

Legal note: pulling audio from arbitrary YouTube URLs may violate YouTube's
ToS depending on jurisdiction and use case. The /api/convert-upload endpoint
(user-supplied audio) is the safer default for a real product; /api/convert-url
is provided for local/dev/testing use.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

import yt_dlp
from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import predict
from demucs.api import Separator, save_audio
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="YouTube to MIDI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS_DIR = os.path.join(tempfile.gettempdir(), "yt2midi-jobs")
os.makedirs(JOBS_DIR, exist_ok=True)

# Demucs/torch default to caching downloaded model weights under the user's
# home directory, which isn't guaranteed to be writable in every deployment
# environment. Keep the cache next to the app instead.
os.environ.setdefault("TORCH_HOME", os.path.join(os.path.dirname(__file__), ".torch_cache"))

# Loaded once at process start (model weights are ~80MB) and reused across
# requests. Used to strip drums out of the mix before transcription -- dense
# full-band passages were masking entire melody lines from Basic Pitch, and
# drum transients were contributing to fabricated notes.
_separator = Separator(model="htdemucs")

# job_id -> job record. "wav"/"mid" hold finished artefact paths (mid absent when
# wav_only was requested); the rest is progress state read by /api/progress.
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
JOB_TTL_SECONDS = 2 * 60 * 60

# Both heavy stages hold the process's CPU (and Demucs holds the one shared
# _separator), so running two conversions at once makes both slower and puts two
# torch graphs through the same model object. Serialise them and let waiting jobs
# report a "queued" stage rather than silently contending.
PIPELINE_LOCK = threading.Lock()

# Seconds of wall clock per second of audio, per stage. Seeds are rough
# CPU-build measurements; _observe_rate folds in each real run so the estimate
# converges on whatever this machine actually does.
STAGE_RATES = {"separating": 1.0, "transcribing": 0.2}
RATES_LOCK = threading.Lock()

# Where each stage sits on the 0-100 bar. Fetching only exists on the URL path,
# so the upload path hands its span to separating.
SPANS_WITH_FETCH = {"fetching": (0, 10), "separating": (10, 66), "transcribing": (66, 99)}
SPANS_UPLOAD = {"separating": (0, 66), "transcribing": (66, 99)}

STAGE_LABELS = {
    "queued": "Waiting for the transcriber to free up",
    "fetching": "Fetching the audio",
    "separating": "Separating stems, dropping drums",
    "transcribing": "Listening for notes",
    "done": "Done",
    "error": "Failed",
}


def _observe_rate(stage: str, elapsed: float, audio_seconds: float | None) -> None:
    """Fold a finished stage's real speed into the running estimate."""
    if not audio_seconds or audio_seconds < 5:
        return
    observed = elapsed / audio_seconds
    with RATES_LOCK:
        STAGE_RATES[stage] = STAGE_RATES[stage] * 0.7 + observed * 0.3


def _estimate(stage: str, audio_seconds: float | None) -> float | None:
    """None when the stage has no measured rate (fetching) or duration is unknown."""
    if not audio_seconds or stage not in STAGE_RATES:
        return None
    with RATES_LOCK:
        return audio_seconds * STAGE_RATES[stage]


def _probe_duration(path: str) -> float | None:
    """Audio duration in seconds via ffprobe, or None if it can't be determined.

    ffmpeg is already a hard dependency (yt-dlp's extraction needs it). Without a
    duration there is no honest ETA, so callers fall back to reporting elapsed
    time only rather than inventing a number.
    """
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json", path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            return None
        value = json.loads(proc.stdout)["format"]["duration"]
        seconds = float(value)
        return seconds if seconds > 0 else None
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.SubprocessError):
        return None


def _new_job(spans: dict) -> str:
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {
            "stage": "queued",
            "spans": spans,
            "created": time.time(),
            "stage_started": time.monotonic(),
            "stage_estimate": None,
            "audio_seconds": None,
            "error": None,
            "result": None,
        }
    return job_id


def _set_stage(job_id: str, stage: str, audio_seconds: float | None = None) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return
        if audio_seconds is not None:
            job["audio_seconds"] = audio_seconds
        job["stage"] = stage
        job["stage_started"] = time.monotonic()
        job["stage_estimate"] = _estimate(stage, job["audio_seconds"]) if stage in STAGE_RATES else None


def _prune_jobs() -> None:
    """Drop artefacts from jobs older than the TTL. Called opportunistically."""
    cutoff = time.time() - JOB_TTL_SECONDS
    with JOBS_LOCK:
        stale = [jid for jid, job in JOBS.items() if job.get("created", 0) < cutoff]
        for jid in stale:
            job = JOBS.pop(jid)
            for key in ("wav", "mid"):
                path = job.get(key)
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass

# Only accept real YouTube watch/share/shorts/embed links. Blocks yt-dlp from
# being used as an open fetcher for arbitrary sites.
YOUTUBE_URL_RE = re.compile(
    r"^https?://"
    r"(www\.|m\.)?"
    r"(youtube\.com/(watch\?v=|shorts/|embed/|live/)|youtu\.be/)"
    r"[\w-]{11}"
    r"(&\S*)?$",
    re.IGNORECASE,
)


def _validate_youtube_url(url: str) -> None:
    if not YOUTUBE_URL_RE.match(url.strip()):
        raise HTTPException(
            status_code=400,
            detail="Only YouTube links are supported (youtube.com/watch?v=... or youtu.be/...).",
        )


class ConvertUrlRequest(BaseModel):
    url: str


def _fetch_audio(url: str, dest_dir: str) -> str:
    """Download best audio for a URL and transcode to mono 22050Hz WAV. Returns the WAV path."""
    out_template = os.path.join(dest_dir, "source.%(ext)s")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
            }
        ],
        "postprocessor_args": ["-ar", "22050", "-ac", "1"],
        "quiet": True,
        "noplaylist": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as exc:
        raise HTTPException(status_code=400, detail=f"Could not fetch audio: {exc}") from exc

    wav_path = os.path.join(dest_dir, "source.wav")
    if not os.path.exists(wav_path):
        raise HTTPException(status_code=500, detail="Audio extraction failed")
    return wav_path


def _isolate_melody(wav_path: str, dest_dir: str) -> str:
    """Separate stems via Demucs and mix down everything except drums.

    Drums carry no melodic content and their transients were a source of
    fabricated notes; keeping vocals+bass+other (instead of just vocals) avoids
    misrouting low-register piano/instrument content into a dropped stem.
    Returns the path to the new WAV.
    """
    _, stems = _separator.separate_audio_file(wav_path)
    melody = stems["vocals"] + stems["bass"] + stems["other"]
    melody_path = os.path.join(dest_dir, "melody.wav")
    save_audio(melody, melody_path, samplerate=_separator.samplerate)
    return melody_path


def _run_basic_pitch(wav_path: str, dest_dir: str) -> tuple[list[dict], str]:
    """Run Basic Pitch on a WAV file. Returns (note_events_json, midi_path)."""
    # melodia_trick (monophonic melody-tracking heuristic) suppresses simultaneous
    # lines instead of surfacing them, which was dropping whole melodies on
    # full-mix/polyphonic input. Disabling it recovered those in testing.
    # frame_threshold lowered from the 0.3 default to 0.2 to catch sustained
    # notes that were still being missed after the melodia_trick fix.
    # onset_threshold lowered from the 0.5 default to 0.35 since frame_threshold
    # alone didn't close the gap — onset detection (not sustain) was still
    # dropping note attacks in both failure modes.
    model_output, midi_data, note_events = predict(
        wav_path,
        ICASSP_2022_MODEL_PATH,
        melodia_trick=False,
        frame_threshold=0.2,
        onset_threshold=0.35,
    )

    midi_path = os.path.join(dest_dir, "output.mid")
    midi_data.write(midi_path)

    notes = [
        {
            "pitch": int(pitch_midi),
            "start": round(float(start_time), 4),
            "end": round(float(end_time), 4),
            "velocity": round(float(amplitude), 4),
        }
        for start_time, end_time, pitch_midi, amplitude, *_ in note_events
    ]
    notes.sort(key=lambda n: n["start"])
    return notes, midi_path


def _heavy_stages(job_id: str, dest_dir: str, source_path: str, wav_only: bool) -> dict:
    """Demucs, then Basic Pitch. Serialised across jobs by PIPELINE_LOCK."""
    with PIPELINE_LOCK:
        audio_seconds = _probe_duration(source_path)

        _set_stage(job_id, "separating", audio_seconds=audio_seconds)
        t0 = time.monotonic()
        melody_path = _isolate_melody(source_path, dest_dir)
        _observe_rate("separating", time.monotonic() - t0, audio_seconds)

        job_wav_path = os.path.join(JOBS_DIR, f"{job_id}.wav")
        shutil.move(melody_path, job_wav_path)
        with JOBS_LOCK:
            JOBS[job_id]["wav"] = job_wav_path

        result = {"job_id": job_id, "notes": [], "wav_url": f"/api/download/{job_id}.wav"}

        if not wav_only:
            _set_stage(job_id, "transcribing", audio_seconds=audio_seconds)
            t0 = time.monotonic()
            notes, midi_path = _run_basic_pitch(job_wav_path, dest_dir)
            _observe_rate("transcribing", time.monotonic() - t0, audio_seconds)

            job_midi_path = os.path.join(JOBS_DIR, f"{job_id}.mid")
            shutil.move(midi_path, job_midi_path)
            with JOBS_LOCK:
                JOBS[job_id]["mid"] = job_midi_path
            result["notes"] = notes
            result["midi_url"] = f"/api/download/{job_id}.mid"

        result["audio_seconds"] = round(audio_seconds, 2) if audio_seconds else None
        return result


def _run_pipeline(job_id: str, dest_dir: str, source: dict, wav_only: bool) -> None:
    """Worker body. Records the outcome on the job record either way."""
    try:
        source_path = source["path"]
        if source.get("url"):
            _set_stage(job_id, "fetching")
            source_path = _fetch_audio(source["url"], dest_dir)

        result = _heavy_stages(job_id, dest_dir, source_path, wav_only)
        with JOBS_LOCK:
            JOBS[job_id]["result"] = result
            JOBS[job_id]["stage"] = "done"
    except HTTPException as exc:
        with JOBS_LOCK:
            JOBS[job_id]["stage"] = "error"
            JOBS[job_id]["error"] = str(exc.detail)
    except Exception as exc:  # a worker thread has nowhere to raise
        with JOBS_LOCK:
            JOBS[job_id]["stage"] = "error"
            JOBS[job_id]["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        shutil.rmtree(dest_dir, ignore_errors=True)


def _start_job(source: dict, wav_only: bool, spans: dict) -> dict:
    _prune_jobs()
    job_id = _new_job(spans)
    dest_dir = source["dest_dir"]
    threading.Thread(
        target=_run_pipeline,
        args=(job_id, dest_dir, source, wav_only),
        daemon=True,
    ).start()
    return {"job_id": job_id, "progress_url": f"/api/progress/{job_id}"}


@app.post("/api/convert-url", status_code=202)
def convert_url(req: ConvertUrlRequest, wav_only: bool = False):
    _validate_youtube_url(req.url)
    dest_dir = tempfile.mkdtemp(prefix="yt2midi-src-")
    source = {"dest_dir": dest_dir, "url": req.url.strip(), "path": None}
    return _start_job(source, wav_only, SPANS_WITH_FETCH)


@app.post("/api/convert-upload", status_code=202)
async def convert_upload(file: UploadFile = File(...), wav_only: bool = False):
    # The upload has to land on disk inside the request — file.file is closed
    # once the response goes out, so the worker thread can't read from it.
    dest_dir = tempfile.mkdtemp(prefix="yt2midi-src-")
    try:
        raw_path = os.path.join(dest_dir, os.path.basename(file.filename or "upload.audio"))
        with open(raw_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception:
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise
    source = {"dest_dir": dest_dir, "url": None, "path": raw_path}
    return _start_job(source, wav_only, SPANS_UPLOAD)


@app.get("/api/progress/{job_id}")
def progress(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        stage = job["stage"]
        spans = job["spans"]
        estimate = job["stage_estimate"]
        stage_elapsed = time.monotonic() - job["stage_started"]
        audio_seconds = job["audio_seconds"]
        error = job["error"]
        result = job["result"]

    payload = {
        "job_id": job_id,
        "stage": stage,
        "label": STAGE_LABELS.get(stage, stage),
        "audio_seconds": round(audio_seconds, 2) if audio_seconds else None,
        "percent": None,
        "eta_seconds": None,
    }

    if stage == "done":
        payload["percent"] = 100
        payload["result"] = result
        return payload
    if stage == "error":
        payload["error"] = error or "Conversion failed."
        return payload
    if stage == "queued":
        payload["percent"] = 0
        return payload

    start, end = spans[stage]
    if estimate:
        # Never let a stage's own bar reach its end — only finishing the stage
        # does that, so the bar can't claim completion the work hasn't reached.
        frac = min(stage_elapsed / estimate, 0.99)
        payload["percent"] = round(start + (end - start) * frac, 1)
        remaining = max(estimate - stage_elapsed, 0)
        for later in spans:
            if spans[later][0] > start:
                remaining += _estimate(later, audio_seconds) or 0
        payload["eta_seconds"] = round(remaining)
    else:
        # No duration probe: report the stage and elapsed time, and leave the bar
        # indeterminate rather than animating a number we don't have.
        payload["percent"] = start

    payload["stage_elapsed"] = round(stage_elapsed, 1)
    return payload


@app.get("/api/download/{filename}")
def download_file(filename: str):
    job_id, _, ext = filename.rpartition(".")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        path = job.get(ext) if job else None
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Job not found")
    media_type = "audio/midi" if ext == "mid" else "audio/wav"
    return FileResponse(path, media_type=media_type, filename=f"transcription.{ext}")


@app.get("/api/health")
def health():
    return {"status": "ok"}