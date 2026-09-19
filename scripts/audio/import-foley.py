#!/usr/bin/env python3
"""Import bounded recorded foley -> compact game-ready mono WAVs.

Sources (CC0 1.0, explicit page-linked downloads only, kept under
work/foley-source/):
  Footsteps: Fantozzi (recordist), submitted/sliced by qubodup.
    Page:    https://opengameart.org/content/fantozzis-footsteps-grasssand-stone
    Archive: https://opengameart.org/sites/default/files/Fantozzi-footsteps.7z
    Members: 12 single steps, 16-bit 44100 Hz FLAC (and OGG). Only the six
      FLAC members named in FOOTSTEPS are read; OGG copies are never touched.
    Mapping (honest, no invented gravel):
      hard  = Stone (page: "Stone could be most hard surfaces").
      grass = Sand ("Sand sounds like grass too" on the page).
      gravel = Stone takes DISTINCT from hard's (APPROXIMATION: pack contains
        zero gravel recordings; manifest + docs label this explicitly).
  Reloads: SpringySpringo, recorded airsoft mechanisms.
    Page: https://opengameart.org/content/gun-reload-sounds
    Files: gunreload1.wav, assaultriflereload1_0.wav, shotguncock_0.wav
      (page-linked names; local basenames preserved).
    Cues are slices of the actual waveforms (regions below); nothing
      synthesized, no hearing claim (author did not audition by ear).

Transform per cue (deterministic, numpy + ffmpeg only, 2 threads max):
  1. ffmpeg decode to f32 (native 44.1 kHz, no mixing in ffmpeg).
  2. Explicit mono (L+R)/2 in float64 (no auto-mix gain surprises).
  3. Trim: onset = first |x| >= 0.02 from anchor; trim_start = onset - 5 ms
     (clamped to 0); footsteps keep full tail, reload-start takes a fixed
     0.60 s window, reload-end takes EOF capped at 0.65 s.
  4. No resample (all sources native 44.1 kHz; asserted).
  5. 2nd-order Butterworth (RBJ biquad) highpass at 80 Hz, Q=0.7071.
  6. 2 ms raised-cosine attack ramp + 20 ms raised-cosine tail fade.
  7. Peak-normalize to -3 dBFS (steps) / -2 dBFS (mechanisms). Level only.

Outputs:
  Runtime files under public/audio-foley/: rec-step-hard-a/b,
  rec-step-grass-a/b, rec-step-gravel-a/b (<=0.6 s each),
  rec-reload-start/end (<=0.7 s each), manifest.json.
  Audition-only concat under docs/audio-auditions/recorded-foley.wav.

Budgets enforced here (non-zero exit on violation):
  each footstep <= 0.6 s, each reload cue <= 0.7 s,
  steps peak <= -3 dBFS, mechanisms peak <= -2 dBFS,
  44.1 kHz mono PCM16, runtime bank total <= 1.5 MB,
  audition-only concat <= 1 MB.

CPU: ffmpeg capped at 2 threads. No other parallelism.
"""
from __future__ import annotations

import hashlib
import json
import math
import pathlib
import struct
import subprocess
import sys
import wave

REPO = pathlib.Path(__file__).resolve().parents[2]
FOLEY_SRC = REPO / "work" / "foley-source"
FLAC_DIR = FOLEY_SRC / "fantozzi" / "flac"
OUT_DIR = REPO / "public" / "audio-foley"
AUDITION_PATH = REPO / "docs" / "audio-auditions" / "recorded-foley.wav"

SR_OUT = 44100
ONSET_THRESH = 0.02
PREROLL_S = 0.005
HP_FREQ = 80.0
HP_Q = 1.0 / math.sqrt(2.0)
ATTACK_S = 0.002
FADE_S = 0.020
STEP_PEAK = 10.0 ** (-3.0 / 20.0)  # -3 dBFS
MECH_PEAK = 10.0 ** (-2.0 / 20.0)  # -2 dBFS
RELOAD_START_WINDOW_S = 0.60
RELOAD_END_MAX_S = 0.65
MAX_STEP_S = 0.6
MAX_MECH_S = 0.7
TOTAL_BUDGET = 1572864  # 1.5 MiB
AUDITION_BUDGET = 1048576  # 1 MiB
AUDITION_GAP_S = 0.25
FFMPEG_THREADS = "2"

FOOTSTEPS: dict[str, tuple[str, str]] = {
    # out-key -> (flac member, role note)
    "rec-step-hard-a": ("Fantozzi-StoneL1.flac", "hard: Stone, generic hard surface per page"),
    "rec-step-hard-b": ("Fantozzi-StoneR1.flac", "hard: Stone, generic hard surface per page"),
    "rec-step-grass-a": ("Fantozzi-SandL1.flac", "grass: Sand-as-grass per page note"),
    "rec-step-grass-b": ("Fantozzi-SandR1.flac", "grass: Sand-as-grass per page note"),
    "rec-step-gravel-a": ("Fantozzi-StoneL2.flac", "APPROXIMATION: Stone for gravel; no true gravel in pack"),
    "rec-step-gravel-b": ("Fantozzi-StoneR2.flac", "APPROXIMATION: Stone for gravel; no true gravel in pack"),
}

RELOADS: dict[str, tuple[str, float, str | None, str]] = {
    # out-key -> (source wav basename, anchor_s, window_s|None=to-EOF-capped, note)
    "rec-reload-start": ("gunreload1.wav", 0.0, RELOAD_START_WINDOW_S,
                         "early mechanism cluster of gunreload1.wav (magazine/mechanism release region)"),
    "rec-reload-end": ("assaultriflereload1_0.wav", 0.90, None,
                       "late double-hit of assaultriflereload1_0.wav (seat/bolt region)"),
}

AUDITION_ORDER = ["rec-step-hard-a", "rec-step-hard-b", "rec-step-grass-a",
                  "rec-step-grass-b", "rec-step-gravel-a", "rec-step-gravel-b",
                  "rec-reload-start", "rec-reload-end"]


def sh(*args: str) -> None:
    r = subprocess.run(list(args), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {r.stderr.strip()[-2000:]}")


def sha256_file(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def contained(p: pathlib.Path, root: pathlib.Path) -> pathlib.Path:
    rp = p.resolve()
    rr = root.resolve()
    if rp != rr and rr not in rp.parents:
        raise RuntimeError(f"path traversal rejected: {p}")
    return rp


def ffprobe_meta(src: pathlib.Path) -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-threads", FFMPEG_THREADS,
         "-show_entries", "stream=sample_rate,channels,bits_per_sample,bits_per_raw_sample,codec_name",
         "-of", "json", str(src)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {src}: {r.stderr.strip()[-500:]}")
    return json.loads(r.stdout)


def decode_stereo_f32(src: pathlib.Path) -> bytes:
    contained(src, REPO / "work")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-threads", FFMPEG_THREADS,
         "-i", str(src), "-f", "f32le", "-acodec", "pcm_f32le", "-"],
        capture_output=True, check=False)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"decode failed for {src}: {r.stderr.decode()[-500:]}")
    return r.stdout


def biquad_hp(x: list[float]) -> list[float]:
    import numpy as np
    w0 = 2.0 * math.pi * HP_FREQ / SR_OUT
    alpha = math.sin(w0) / (2.0 * HP_Q)
    cw = math.cos(w0)
    b0 = (1.0 + cw) / 2.0
    b1 = -(1.0 + cw)
    b2 = (1.0 + cw) / 2.0
    a0 = 1.0 + alpha
    a1 = -2.0 * cw
    a2 = 1.0 - alpha
    xin = np.asarray(x, dtype=np.float64)
    y = np.zeros_like(xin)
    x1 = x2 = y1 = y2 = 0.0
    for i, xv in enumerate(xin):
        yv = (b0 * xv + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, xv, y1, yv
        y[i] = yv
    return y.tolist()


def apply_ramps(x: list[float]) -> list[float]:
    import numpy as np
    y = np.asarray(x, dtype=np.float64)
    na = int(round(ATTACK_S * SR_OUT))
    nf = int(round(FADE_S * SR_OUT))
    if na > 0 and len(y) > na:
        ramp = 0.5 * (1.0 - np.cos(np.pi * np.arange(na) / na))
        y[:na] *= ramp
    if nf > 0 and len(y) > nf:
        fade = 0.5 * (1.0 - np.cos(np.pi * np.arange(nf)[::-1] / nf))
        y[-nf:] *= fade
    return y.tolist()


def metrics(x: list[float]) -> dict:
    import numpy as np
    a = np.asarray(x, dtype=np.float64)
    peak = float(np.max(np.abs(a))) if len(a) else 0.0
    rms = float(np.sqrt(np.mean(a ** 2))) if len(a) else 0.0
    return {
        "peak": peak,
        "peak_dbfs": float(20.0 * np.log10(peak + 1e-12)),
        "rms_dbfs": float(20.0 * np.log10(rms + 1e-12)),
        "dc": float(np.mean(a)) if len(a) else 0.0,
    }


def write_wav16(p: pathlib.Path, x: list[float]) -> None:
    import numpy as np
    a = np.asarray(x, dtype=np.float64)
    q = np.round(a * 32767.0).clip(-32768, 32767).astype("<i2")
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR_OUT)
        w.writeframes(q.tobytes())


def check_wav16(p: pathlib.Path) -> tuple[int, int]:
    with wave.open(str(p), "rb") as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2
        assert w.getframerate() == SR_OUT
        n = w.getnframes()
    return n, p.stat().st_size


def find_onset(mono: list[float], anchor_s: float) -> int:
    import numpy as np
    a = np.asarray(mono, dtype=np.float64)
    start = int(round(anchor_s * SR_OUT))
    idx = int(np.argmax(np.abs(a[start:]) >= ONSET_THRESH)) + start
    if abs(a[idx]) < ONSET_THRESH:
        raise RuntimeError("no onset above threshold in search region")
    return idx


def main() -> int:
    import numpy as np
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    archive = FOLEY_SRC / "Fantozzi-footsteps.7z"
    for need in [archive, FOLEY_SRC / "gunreload1.wav",
                 FOLEY_SRC / "assaultriflereload1_0.wav",
                 FOLEY_SRC / "shotguncock_0.wav"]:
        if not need.is_file():
            raise RuntimeError(f"missing source file: {need.name} (re-download page-linked URL)")

    files: dict[str, dict] = {}
    total = 0
    peak_cap: dict[str, float] = {}

    # --- footsteps: full tail, lead trimmed to ~5 ms ---
    for key, (member, role) in FOOTSTEPS.items():
        src = contained(FLAC_DIR / member, REPO / "work")
        if not src.is_file():
            raise RuntimeError(f"missing FLAC member: {member}")
        meta = ffprobe_meta(src)
        st = meta["streams"][0]
        assert int(st["sample_rate"]) == 44100 and int(st["channels"]) == 2, st
        raw = decode_stereo_f32(src)
        n = len(raw) // 8
        stereo = np.frombuffer(raw, dtype=np.float32).reshape(n, 2).astype(np.float64)
        src_clip = {"L": int(np.sum(np.abs(stereo[:, 0]) >= 0.999969)),
                    "R": int(np.sum(np.abs(stereo[:, 1]) >= 0.999969))}
        mono = ((stereo[:, 0] + stereo[:, 1]) / 2.0).tolist()
        onset = find_onset(mono, 0.0)
        trim_start = max(0, onset - int(round(PREROLL_S * SR_OUT)))
        seg = mono[trim_start:]
        seg = biquad_hp(seg)
        seg = apply_ramps(seg)
        m0 = metrics(seg)
        gain = STEP_PEAK / max(m0["peak"], 1e-9)
        seg = (np.asarray(seg) * gain).tolist()
        m = metrics(seg)
        out = OUT_DIR / f"{key}.wav"
        write_wav16(out, seg)
        frames, size = check_wav16(out)
        dur = frames / SR_OUT
        if dur > MAX_STEP_S + 1e-6:
            raise RuntimeError(f"{key}: {dur:.3f}s exceeds 0.6s budget")
        if m["peak_dbfs"] > -3.0 + 1e-6:
            raise RuntimeError(f"{key}: peak {m['peak_dbfs']:.2f} dBFS over -3dBFS")
        total += size
        peak_cap[key] = -3.0
        files[key] = {
            "file": out.name, "role": role,
            "source_archive": "https://opengameart.org/sites/default/files/Fantozzi-footsteps.7z",
            "source_member": f"Fantozzi-footsteps/flac/{member}",
            "source_sha256": sha256_file(src),
            "source_stream": st,
            "source_clip_ge_fullscale": src_clip,
            "trim_start_s": round(trim_start / SR_OUT, 6),
            "trim_start_samples": trim_start,
            "onset_s": round(onset / SR_OUT, 6),
            "trim_window_s": round(len(seg) / SR_OUT, 6),
            "duration_s": round(dur, 6),
            "peak_dbfs": round(m["peak_dbfs"], 3),
            "rms_dbfs": round(m["rms_dbfs"], 3),
            "dc": round(m["dc"], 8),
            "sha256": sha256_file(out), "bytes": size,
        }
        print(f"{key}: {dur:.3f}s peak {m['peak_dbfs']:.2f} rms {m['rms_dbfs']:.2f} "
              f"dc {m['dc']:.2e} trim@{trim_start / SR_OUT:.4f}s {size}B")

    # --- reload cues: waveform slices ---
    for key, (base, anchor, window, role) in RELOADS.items():
        src = contained(FOLEY_SRC / base, REPO / "work")
        meta = ffprobe_meta(src)
        st = meta["streams"][0]
        assert int(st["sample_rate"]) == 44100 and int(st["channels"]) == 2, st
        raw = decode_stereo_f32(src)
        n = len(raw) // 8
        stereo = np.frombuffer(raw, dtype=np.float32).reshape(n, 2).astype(np.float64)
        src_clip = {"L": int(np.sum(np.abs(stereo[:, 0]) >= 0.999969)),
                    "R": int(np.sum(np.abs(stereo[:, 1]) >= 0.999969))}
        mono = ((stereo[:, 0] + stereo[:, 1]) / 2.0).tolist()
        onset = find_onset(mono, anchor)
        trim_start = max(0, onset - int(round(PREROLL_S * SR_OUT)))
        if window is None:
            seg = mono[trim_start:trim_start + int(round(RELOAD_END_MAX_S * SR_OUT))]
        else:
            length = int(round(window * SR_OUT))
            seg = mono[trim_start:trim_start + length]
            if len(seg) < length:
                raise RuntimeError(f"{key}: window overruns EOF")
        if not seg:
            raise RuntimeError(f"{key}: empty slice")
        seg = biquad_hp(seg)
        seg = apply_ramps(seg)
        m0 = metrics(seg)
        gain = MECH_PEAK / max(m0["peak"], 1e-9)
        seg = (np.asarray(seg) * gain).tolist()
        m = metrics(seg)
        out = OUT_DIR / f"{key}.wav"
        write_wav16(out, seg)
        frames, size = check_wav16(out)
        dur = frames / SR_OUT
        if dur > MAX_MECH_S + 1e-6:
            raise RuntimeError(f"{key}: {dur:.3f}s exceeds 0.7s budget")
        if m["peak_dbfs"] > -2.0 + 1e-6:
            raise RuntimeError(f"{key}: peak {m['peak_dbfs']:.2f} dBFS over -2dBFS")
        total += size
        peak_cap[key] = -2.0
        files[key] = {
            "file": out.name, "role": role,
            "source_file": base,
            "source_sha256": sha256_file(src),
            "source_stream": st,
            "source_clip_ge_fullscale": src_clip,
            "trim_start_s": round(trim_start / SR_OUT, 6),
            "trim_start_samples": trim_start,
            "onset_s": round(onset / SR_OUT, 6),
            "anchor_s": anchor,
            "trim_window_s": round(len(seg) / SR_OUT, 6),
            "duration_s": round(dur, 6),
            "peak_dbfs": round(m["peak_dbfs"], 3),
            "rms_dbfs": round(m["rms_dbfs"], 3),
            "dc": round(m["dc"], 8),
            "sha256": sha256_file(out), "bytes": size,
        }
        print(f"{key}: {dur:.3f}s peak {m['peak_dbfs']:.2f} rms {m['rms_dbfs']:.2f} "
              f"dc {m['dc']:.2e} trim@{trim_start / SR_OUT:.4f}s {size}B")

    if total > TOTAL_BUDGET:
        raise RuntimeError(f"bank total {total}B exceeds 1.5MB budget")

    # --- inspected but not shipped ---
    unused_path = contained(FOLEY_SRC / "shotguncock_0.wav", REPO / "work")
    raw = decode_stereo_f32(unused_path)
    n = len(raw) // 8
    stereo = np.frombuffer(raw, dtype=np.float32).reshape(n, 2).astype(np.float64)
    mono_u = ((stereo[:, 0] + stereo[:, 1]) / 2.0).tolist()
    mu = metrics(mono_u)
    unused = {
        "file": "shotguncock_0.wav",
        "reason_not_shipped": ("single merged cock transient, recorded hot with DC offset; "
                               "the two shipped cues already give distinct start/end mechanics "
                               "without declipping invented data"),
        "source_sha256": sha256_file(unused_path),
        "duration_s": round(len(mono_u) / SR_OUT, 6),
        "peak_dbfs": round(mu["peak_dbfs"], 3),
        "rms_dbfs": round(mu["rms_dbfs"], 3),
        "dc": round(mu["dc"], 6),
        "clip_ge_fullscale": {"L": int(np.sum(np.abs(stereo[:, 0]) >= 0.999969)),
                              "R": int(np.sum(np.abs(stereo[:, 1]) >= 0.999969))},
    }

    # --- audition concat (not a game asset) ---
    gap = [0.0] * int(round(AUDITION_GAP_S * SR_OUT))
    seq: list[float] = []
    spans: dict[str, list[float]] = {}
    t = 0.0
    for i, key in enumerate(AUDITION_ORDER):
        if i:
            seq += gap
            t += AUDITION_GAP_S
        with wave.open(str(OUT_DIR / f"{key}.wav"), "rb") as w:
            fr = w.readframes(w.getnframes())
        x = (np.frombuffer(fr, dtype="<i2").astype(np.float64) / 32767.0).tolist()
        spans[key] = [round(t, 3), round(t + len(x) / SR_OUT, 3)]
        seq += x
        t += len(x) / SR_OUT
    AUDITION_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_wav16(AUDITION_PATH, seq)
    frames, size = check_wav16(AUDITION_PATH)
    if size > AUDITION_BUDGET:
        raise RuntimeError(f"audition {size}B exceeds 1MB budget")
    with wave.open(str(AUDITION_PATH), "rb") as w:
        fr = w.readframes(w.getnframes())
    am = metrics((np.frombuffer(fr, dtype="<i2").astype(np.float64) / 32767.0).tolist())
    print(f"audition: {frames / SR_OUT:.3f}s {size}B spans={spans}")

    manifest = {
        "pack": "recorded-foley",
        "sources": {
            "footsteps_page": "https://opengameart.org/content/fantozzis-footsteps-grasssand-stone",
            "footsteps_archive": "https://opengameart.org/sites/default/files/Fantozzi-footsteps.7z",
            "footsteps_archive_sha256": sha256_file(archive),
            "footsteps_archive_bytes": archive.stat().st_size,
            "footsteps_author": "Fantozzi (recordist), submitted/sliced by qubodup",
            "reloads_page": "https://opengameart.org/content/gun-reload-sounds",
            "reload_files": {
                "gunreload1.wav": {
                    "url": "https://opengameart.org/sites/default/files/gunreload1.wav",
                    "sha256": sha256_file(FOLEY_SRC / "gunreload1.wav"),
                    "bytes": (FOLEY_SRC / "gunreload1.wav").stat().st_size},
                "assaultriflereload1_0.wav": {
                    "url": "https://opengameart.org/sites/default/files/assaultriflereload1_0.wav",
                    "sha256": sha256_file(FOLEY_SRC / "assaultriflereload1_0.wav"),
                    "bytes": (FOLEY_SRC / "assaultriflereload1_0.wav").stat().st_size},
                "shotguncock_0.wav": {
                    "url": "https://opengameart.org/sites/default/files/shotguncock_0.wav",
                    "sha256": sha256_file(FOLEY_SRC / "shotguncock_0.wav"),
                    "bytes": (FOLEY_SRC / "shotguncock_0.wav").stat().st_size},
            },
            "reload_author": "SpringySpringo (recorded airsoft mechanisms)",
            "license": "CC0 1.0 Universal (public domain)",
            "license_url": "http://creativecommons.org/publicdomain/zero/1.0/",
        },
        "transform": ("mono (L+R)/2 -> trim (onset-5ms; steps full tail, "
                      "reload-start 0.60s fixed, reload-end EOF-capped 0.65s) -> "
                      "no resample (native 44.1k) -> biquad HP 80Hz Q0.7071 -> "
                      "2ms raised-cosine attack + 20ms raised-cosine tail -> "
                      "peak-normalize -3dBFS steps / -2dBFS mechanisms -> PCM16"),
        "tool_versions": {"ffmpeg": subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines()[0]
            if subprocess.run(["ffmpeg", "-version"],
                              capture_output=True, text=True).returncode == 0 else "unknown"},
        "format": "44100Hz mono PCM16 WAV",
        "surface_mapping": {
            "hard": "Stone (page: Stone suits most hard surfaces)",
            "grass": "Sand-as-grass (page: Sand sounds like grass too)",
            "gravel": ("APPROXIMATION ONLY: Stone takes distinct from hard's; "
                       "source pack contains no gravel recording"),
        },
        "budgets": {"each_step_s_max": MAX_STEP_S, "each_mech_s_max": MAX_MECH_S,
                    "steps_peak_dbfs_max": -3.0, "mech_peak_dbfs_max": -2.0,
                    "total_bytes_max": TOTAL_BUDGET,
                    "audition_bytes_max": AUDITION_BUDGET},
        "files": files,
        "inspected_not_shipped": unused,
        "audition": {"file": "docs/audio-auditions/recorded-foley.wav", "spans_s": spans,
                     "order": AUDITION_ORDER,
                     "duration_s": round(frames / SR_OUT, 6),
                     "peak_dbfs": round(am["peak_dbfs"], 3),
                     "rms_dbfs": round(am["rms_dbfs"], 3),
                     "sha256": sha256_file(AUDITION_PATH),
                     "bytes": size},
        "total_bank_bytes": total,
        "quality": ("OPEN: author did not audition by ear; metrics only. "
                    "Root listens before wiring."),
    }
    with open(OUT_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"total bank {total}B / {TOTAL_BUDGET}B OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
