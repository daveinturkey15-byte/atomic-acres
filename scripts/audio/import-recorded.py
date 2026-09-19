#!/usr/bin/env python3
"""Import recorded CC0 gunshots -> compact game-ready mono WAV canary.

Source: The Free Firearm Sound Library (CC0), recorded by Ben Jaszczak,
Brian Nelson, Kevin Heras, Matthew Nanney.
  Page:    https://opengameart.org/content/the-free-firearm-sound-library
  Archive: https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z
Local archive copy: work/recorded-source/Prepared SFX Library.7z (see manifest
for SHA256). Only the five member files named in SELECTION are read; nothing
else is extracted or touched.

Transform per shot (deterministic):
  1. ffmpeg decode to f32 stereo at native 96 kHz (no mixing in ffmpeg).
  2. Explicit mono (L+R)/2 in numpy (no auto-mix gain surprises).
  3. Trim: 50 ms pre-roll before measured onset + fixed window (see SELECTION).
  4. SoXR resample 96 kHz -> 44.1 kHz via ffmpeg.
  5. 2nd-order Butterworth (RBJ biquad) highpass at 60 Hz, Q=0.7071.
  6. 2 ms raised-cosine attack ramp (avoids new clicks) + 20 ms
     raised-cosine fade tail.
  7. Peak-normalize to -1 dBFS (0.89125094). Normalization sets level only;
     it does NOT repair the brief recorded transient flat-topping documented
     in docs/recorded-audio.md (OPEN item).

Outputs:
  Runtime files under public/audio-recorded/: rec-shot-<family>.wav (x5) + manifest.json
  Audition-only concat under docs/audio-auditions/recorded-guns.wav

Budgets enforced here (non-zero exit on violation):
  each shot <= 1.2 s, peak <= -1 dBFS, 44.1 kHz mono PCM16,
  total of all WAVs <= 4 MB.

CPU: ffmpeg is capped at 2 threads. No other parallelism.
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
SRC_DIR = REPO / "work" / "recorded-source" / "prepared" / "Prepared SFX Library"
OUT_DIR = REPO / "public" / "audio-recorded"
AUDITION_PATH = REPO / "docs" / "audio-auditions" / "recorded-guns.wav"

SR_NATIVE = 96000
SR_OUT = 44100
PEAK_TARGET = 10.0 ** (-1.0 / 20.0)  # -1 dBFS
ATTACK_S = 0.002
FADE_S = 0.020
PREROLL_S = 0.050
HP_FREQ = 60.0
HP_Q = 1.0 / math.sqrt(2.0)
TOTAL_BUDGET = 4 * 1024 * 1024
MAX_SHOT_S = 1.2
FFMPEG_THREADS = "2"  # owner cap: 2 threads max

# family -> (source member path under SRC_DIR, onset_s, window_s, description)
SELECTION = {
    "longhorn": (
        "Model 1894/L_17P.wav", 0.596, 1.10,
        "Winchester Model 1894 lever-action .32WS, mid-distance single shot",
    ),
    "rattler": (
        "Carl Gustav M45/G_20P.wav", 0.348, 1.00,
        "Carl Gustav M45 SMG 9mm, mid-distance single shot",
    ),
    "coachman": (
        "Model 12/K_17P.wav", 0.907, 1.20,
        "Winchester Model 12 pump 12ga, mid-distance single shot",
    ),
    "deadeye": (
        "Mosin Nagant/M_26P.wav", 1.138, 1.20,
        "Mosin Nagant bolt 7.62x54R, mid-distance single shot",
    ),
    "duster": (
        "1911/A_34P.wav", 1.542, 1.20,
        "M1911 .45 pistol, mid-distance single shot",
    ),
}

AUDITION_ORDER = ["longhorn", "rattler", "coachman", "deadeye", "duster"]
AUDITION_GAP_S = 0.35


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
    if rp != root.resolve() and root.resolve() not in rp.parents:
        raise RuntimeError(f"path traversal rejected: {p}")
    return rp


def decode_stereo_f32(src: pathlib.Path) -> bytes:
    contained(src, REPO / "work")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-threads", FFMPEG_THREADS,
         "-i", str(src), "-f", "f32le", "-acodec", "pcm_f32le", "-"],
        capture_output=True, check=False,
    )
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"decode failed for {src}: {r.stderr.decode()[-500:]}")
    return r.stdout


def resample_mono_f32(x: list[float]) -> list[float]:
    import numpy as np

    mono = np.asarray(x, dtype=np.float64)
    pcm = (mono * 2147483647.0).clip(-2147483648, 2147483647).astype("<i4")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-threads", FFMPEG_THREADS,
         "-f", "s32le", "-ar", str(SR_NATIVE), "-ac", "1",
         "-i", "-", "-af", "aresample=44100:resampler=soxr:precision=28",
         "-ar", str(SR_OUT), "-ac", "1",
         "-f", "f32le", "-acodec", "pcm_f32le", "-"],
        input=pcm.tobytes(), capture_output=True, check=False,
    )
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"resample failed: {r.stderr.decode()[-500:]}")
    n = len(r.stdout) // 4
    return list(struct.unpack(f"<{n}f", r.stdout))


def biquad_hp(x: list[float]) -> list[float]:
    # RBJ highpass, direct form I, float64 state. Deterministic.
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
    b0, b1, b2, a1, a2 = (c / a0 for c in (b0, b1, b2, a1, a2))
    y = np.empty(len(x), dtype=np.float64)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        y[i] = o
        x2, x1, y2, y1 = x1, v, y1, o
    return y.tolist()


def apply_ramps(x: list[float]) -> list[float]:
    import numpy as np

    y = np.asarray(x, dtype=np.float64)
    na = max(1, int(round(ATTACK_S * SR_OUT)))
    nf = max(1, int(round(FADE_S * SR_OUT)))
    if na + nf >= len(y):
        raise RuntimeError("window too short for ramps")
    t = np.arange(na) / na
    y[:na] *= 0.5 - 0.5 * np.cos(math.pi * t)  # raised-cosine in, 0 -> 1
    t = np.arange(nf) / (nf - 1) if nf > 1 else np.zeros(1)
    y[-nf:] *= 0.5 + 0.5 * np.cos(math.pi * t)  # raised-cosine out, 1 -> 0
    return y.tolist()


def metrics(x: list[float]) -> dict:
    import numpy as np

    y = np.asarray(x, dtype=np.float64)
    peak = float(np.max(np.abs(y)))
    rms = float(math.sqrt(float(np.mean(y * y))))
    dc = float(np.mean(y))
    return {
        "peak": peak,
        "peak_dbfs": 20.0 * math.log10(peak + 1e-12),
        "rms": rms,
        "rms_dbfs": 20.0 * math.log10(rms + 1e-12),
        "dc": dc,
    }


def write_wav16(p: pathlib.Path, x: list[float]) -> None:
    import numpy as np

    y = np.asarray(x, dtype=np.float64)
    q = np.round(y * 32767.0).clip(-32768, 32767).astype("<i2")
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR_OUT)
        w.writeframes(q.tobytes())


def check_wav16(p: pathlib.Path) -> tuple[int, int]:
    with wave.open(str(p), "rb") as w:
        assert w.getnchannels() == 1, f"{p.name}: not mono"
        assert w.getsampwidth() == 2, f"{p.name}: not PCM16"
        assert w.getframerate() == SR_OUT, f"{p.name}: not 44.1k"
        n = w.getnframes()
    return n, p.stat().st_size


def ffmpeg_version() -> str:
    r = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    return r.stdout.splitlines()[0] if r.returncode == 0 else "unknown"


def main() -> int:
    import numpy as np

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    archive = REPO / "work" / "recorded-source" / "Prepared SFX Library.7z"
    files: dict[str, dict] = {}
    total = 0

    for fam, (member, onset, window, desc) in SELECTION.items():
        src = contained(SRC_DIR / member, REPO / "work")
        if not src.is_file():
            raise RuntimeError(f"missing source member: {member}")
        raw = decode_stereo_f32(src)
        n = len(raw) // 8  # 2ch f32
        stereo = np.frombuffer(raw, dtype=np.float32).reshape(n, 2).astype(np.float64)
        mono = ((stereo[:, 0] + stereo[:, 1]) / 2.0).tolist()

        start = int(round((onset - PREROLL_S) * SR_NATIVE))
        length = int(round(window * SR_NATIVE))
        if start < 0 or start + length > len(mono):
            raise RuntimeError(f"{fam}: trim window out of range")
        seg = mono[start:start + length]

        seg44 = resample_mono_f32(seg)
        seg44 = biquad_hp(seg44)
        seg44 = apply_ramps(seg44)
        m0 = metrics(seg44)
        gain = PEAK_TARGET / max(m0["peak"], 1e-9)
        seg44 = (np.asarray(seg44) * gain).tolist()
        m = metrics(seg44)

        out = OUT_DIR / f"rec-shot-{fam}.wav"
        write_wav16(out, seg44)
        frames, size = check_wav16(out)
        dur = frames / SR_OUT
        if dur > MAX_SHOT_S + 1e-6:
            raise RuntimeError(f"{fam}: {dur:.3f}s exceeds 1.2s budget")
        if m["peak_dbfs"] > -1.0 + 1e-6:
            raise RuntimeError(f"{fam}: peak {m['peak_dbfs']:.2f} dBFS over -1dBFS")
        total += size
        files[fam] = {
            "file": out.name,
            "description": desc,
            "source_member": f"Prepared SFX Library/{member}",
            "source_sha256": sha256_file(src),
            "trim_start_s": round(start / SR_NATIVE, 6),
            "trim_window_s": round(length / SR_NATIVE, 6),
            "onset_s": onset,
            "duration_s": round(dur, 6),
            "peak_dbfs": round(m["peak_dbfs"], 3),
            "rms_dbfs": round(m["rms_dbfs"], 3),
            "dc": round(m["dc"], 8),
            "sha256": sha256_file(out),
            "bytes": size,
        }
        print(f"{fam}: {dur:.3f}s peak {m['peak_dbfs']:.2f} dBFS "
              f"rms {m['rms_dbfs']:.2f} dBFS dc {m['dc']:.2e} {size}B {out.name}")

    # Audition concat (not a game asset): shots in order with silence gaps.
    gap = [0.0] * int(round(AUDITION_GAP_S * SR_OUT))
    seq: list[float] = []
    spans: dict[str, list[float]] = {}
    t = 0.0
    for i, fam in enumerate(AUDITION_ORDER):
        if i:
            seq += gap
            t += AUDITION_GAP_S
        with wave.open(str(OUT_DIR / f"rec-shot-{fam}.wav"), "rb") as w:
            fr = w.readframes(w.getnframes())
        x = (np.frombuffer(fr, dtype="<i2").astype(np.float64) / 32767.0).tolist()
        spans[fam] = [round(t, 3), round(t + len(x) / SR_OUT, 3)]
        seq += x
        t += len(x) / SR_OUT
    AUDITION_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_wav16(AUDITION_PATH, seq)
    frames, size = check_wav16(AUDITION_PATH)
    total += size
    with wave.open(str(AUDITION_PATH), "rb") as w:
        fr = w.readframes(w.getnframes())
    am = metrics((np.frombuffer(fr, dtype="<i2").astype(np.float64) / 32767.0).tolist())
    print(f"audition: {frames / SR_OUT:.3f}s {size}B spans={spans}")

    if total > TOTAL_BUDGET:
        raise RuntimeError(f"total {total}B exceeds 4MB budget")

    manifest = {
        "pack": "recorded-audio-canary",
        "license": "CC0 1.0 Universal (public domain)",
        "attribution": ("Recorded by Ben Jaszczak, Brian Nelson, Kevin Heras, "
                        "Matthew Nanney (The Free Firearm Sound Library)."),
        "source_page": "https://opengameart.org/content/the-free-firearm-sound-library",
        "source_archive": ("https://opengameart.org/sites/default/files/"
                           "Prepared%20SFX%20Library.7z"),
        "source_archive_sha256": sha256_file(archive),
        "source_archive_bytes": archive.stat().st_size,
        "transform": ("mono (L+R)/2 -> trim (50ms pre-roll) -> SoXR 96k>44.1k -> "
                      "biquad HP 60Hz Q0.7071 -> 2ms raised-cosine attack + "
                      "20ms raised-cosine tail -> peak-normalize -1dBFS -> PCM16"),
        "tool_versions": {"ffmpeg": ffmpeg_version()},
        "format": "44100Hz mono PCM16 WAV",
        "budgets": {"each_shot_s_max": MAX_SHOT_S,
                    "peak_dbfs_max": -1.0,
                    "total_bytes_max": TOTAL_BUDGET},
        "files": files,
        "audition": {"file": "docs/audio-auditions/recorded-guns.wav",
                     "spans_s": spans,
                     "duration_s": round(frames / SR_OUT, 6),
                     "peak_dbfs": round(am["peak_dbfs"], 3),
                     "rms_dbfs": round(am["rms_dbfs"], 3),
                     "sha256": sha256_file(AUDITION_PATH),
                     "bytes": size},
        "total_bytes": total,
        "reload_cues": ("OPEN: Prepared SFX Library contains gunshots only "
                        "(master sheet: 57 shot/burst files, 0 mechanical-only "
                        "files); no recorded reload cues shipped in this pass."),
        "note": ("Normalization sets level only; brief recorded transient "
                 "flat-topping at 0dBFS is preserved, not repaired. See "
                 "docs/recorded-audio.md OPEN-CLIP."),
    }
    with open(OUT_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"total {total}B / {TOTAL_BUDGET}B OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
