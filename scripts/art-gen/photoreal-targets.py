#!/usr/bin/env python3
"""photoreal-targets.py - ComfyUI image-to-image client, fidelity gate and measurements
for the photoreal target loop (docs/reference/targets/).

Companion to photoreal-targets.mjs (which captures OUR frames). This file:

  preflight   - server, nodes, weights, slot (queue idle AND >= --min-free-vram MiB free)
  generate    - one source PNG -> one photoreal target through the owner's ComfyUI,
                Qwen-Image-Edit-2511 (fp8 e4m3fn) + qwen_2.5_vl_7b + qwen_image_vae,
                the official `image_qwen_image_edit_2511` template graph (no Lightning
                LoRA branch: the Edit-2511 LoRA is not on disk) with the ONE deviation
                this project makes: KSampler denoise < 1 so the source latent survives
                and the composition is preserved. Output is resized back to the source
                size; a sidecar JSON records every provenance field.
  batch       - all sources in sources/manifest.json (+ the two look variants for the
                three named stations), then the fidelity gate; any pair under the bar
                is regenerated at lower denoise (step -0.10, floor 0.15). Never regenerates
                a pair that already passed.
  fidelity    - edge-map overlap + downscaled SSIM + coarse block-geometry check per pair
  measure     - the gap-note numbers per station (luma percentiles, saturation, colour
                temperature, sunlit:shaded, shadow edge softness, sky gradient, contact)
  free        - POST /free {unload_models, free_memory} so the owner's RAM comes back

Machine courtesy (same rules as comfy_trellis.py): never boots/restarts/reconfigures
ComfyUI; GET /queue must be idle and nvidia-smi >= 8 GB free before EVERY submit; hard
poll cap per prompt; outputs copied out of ComfyUI's output folder at once (it is swept
every 2 h); /free at the end. Nothing here touches src/ or public/.

Boundaries: sources are OUR frames. Targets are comparison aids for critics, never
something to copy pixels from. Nothing may carry the reference game's name, logos or HUD
- the negative prompt refuses text/logos/HUD and the gate rejects on drift.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
UNET = "qwen_image_edit_2511_fp8_e4m3fn.safetensors"
CLIP = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
VAE = "qwen_image_vae.safetensors"
MODEL_ID = "Qwen-Image-Edit-2511 (fp8_e4m3fn) + Qwen2.5-VL-7B fp8_scaled + qwen_image_vae"
ROUTE_ID = "B:comfyui-qwen-image-edit-2511"
UPLOAD_SUBFOLDER = "aa-targets"
REQUIRED_NODES = ["UNETLoader", "CLIPLoader", "VAELoader", "ModelSamplingAuraFlow", "CFGNorm",
                  "LoadImage", "FluxKontextImageScale", "TextEncodeQwenImageEditPlus",
                  "FluxKontextMultiReferenceLatentMethod", "VAEEncode", "KSampler",
                  "VAEDecode", "SaveImage"]

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TARGETS_DIR = os.path.join(ROOT, "docs", "reference", "targets")

# ------------------------------------------------------------------- prompts ---
# One intent, three light slots. The base sentence is the owner's brief (06:30) made
# concrete; the variants are the atmosphere lane's look targets. The subject is never
# named as anything but "this scene" - the model must keep what is in the frame.
PROMPT_BASE = (
    "Re-render this exact scene as a real photograph. Keep the same camera, the same "
    "composition, the same geometry and every object exactly where it is. Make it "
    "hyper-realistic and photorealistic: real-world materials - weathered asphalt with "
    "visible aggregate and tyre-polished bands, cracked concrete kerbs and paving, "
    "painted stucco with subtle grime, streaks and edge wear, real glass reflecting the "
    "sky, painted metal with chrome trim and micro-scratches, dense leafy trees and lawn "
    "with individual grass blades; physically correct hard sunlight and blue sky light, "
    "soft contact shadows and ambient occlusion under every object, subtle volumetric "
    "haze and aerial perspective toward the mountains, dust motes in the sun, natural "
    "film response with fine grain and gentle highlight roll-off. No text, no logos, no "
    "HUD, no watermark."
)
VARIANTS = {
    "golden": (
        "Golden hour: low warm sun raking in from the west, long soft-edged shadows, "
        "warm amber highlights on every sunlit face, cool blue-violet shade, glowing "
        "backlit haze and lens warmth."),
    "overcast": (
        "Overcast with light rain: high flat grey sky, soft shadowless light, wet dark "
        "asphalt with mirror-like puddle reflections, saturated damp surfaces, water "
        "beading on paint and glass, drizzle haze softening the distance."),
}
NEGATIVE = (
    "text, letters, writing, logo, brand, watermark, signage, caption, HUD, crosshair, "
    "user interface, cartoon, anime, illustration, painting, low-poly, flat shading, "
    "plastic look, blurry, out of focus, deformed, warped geometry, extra buildings, "
    "extra vehicles, missing objects, changed layout, different camera angle, tilted horizon"
)


def prompt_for(variant: str | None) -> str:
    if not variant:
        return PROMPT_BASE
    return PROMPT_BASE + " " + VARIANTS[variant]


# --------------------------------------------------------------- HTTP plumbing ---
def _get(path: str, timeout: float = 20):
    with urllib.request.urlopen(f"{COMFY_URL}{path}", timeout=timeout) as resp:
        return json.loads(resp.read())


def _get_bytes(path: str, timeout: float = 300) -> bytes:
    with urllib.request.urlopen(f"{COMFY_URL}{path}", timeout=timeout) as resp:
        return resp.read()


def _post_json(path: str, body: dict, timeout: float = 60):
    req = urllib.request.Request(f"{COMFY_URL}{path}", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw) if raw.strip() else {}


def submit(workflow: dict) -> str:
    try:
        return _post_json("/prompt", {"prompt": workflow, "client_id": str(uuid.uuid4())})["prompt_id"]
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"submit rejected: {e.read().decode()[:4000]}") from e


def wait_for(prompt_id: str, timeout: float, poll: float = 5.0) -> dict:
    """Poll /history until the prompt lands. Hard cap, no spin."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        hist = _get(f"/history/{prompt_id}", timeout=30)
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                raise RuntimeError(f"execution error: {json.dumps(msgs)[:4000]}")
            return entry
        time.sleep(poll)
    raise TimeoutError(f"prompt {prompt_id} unfinished after {timeout}s (HARD CAP)")


def upload_image(path: str, subfolder: str = UPLOAD_SUBFOLDER) -> str:
    """POST /upload/image (multipart, overwrite). Returns 'subfolder/name' for LoadImage."""
    name = os.path.basename(path)
    boundary = "----aatargets" + uuid.uuid4().hex
    with open(path, "rb") as f:
        data = f.read()
    parts = []

    def field(n, v):
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{n}\"\r\n\r\n{v}\r\n".encode())

    field("overwrite", "true")
    field("type", "input")
    if subfolder:
        field("subfolder", subfolder)
    parts.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
                  f"filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(f"{COMFY_URL}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        r = json.loads(resp.read())
    sub = r.get("subfolder") or ""
    return f"{sub}/{r['name']}" if sub else r["name"]


def fetch_output(item: dict) -> bytes:
    q = urllib.parse.urlencode({"filename": item["filename"], "subfolder": item.get("subfolder", ""),
                                "type": item.get("type", "output")})
    return _get_bytes(f"/view?{q}")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ GPU / queue ---
def nvidia_free_mib() -> int | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=20,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def nvidia_used_mib() -> int | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=20,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def queue_is_idle() -> bool:
    q = _get("/queue")
    return not q.get("queue_running") and not q.get("queue_pending")


# VRAM used right after OUR last prompt finished. On WDDM nvidia-smi cannot attribute
# memory per process ([N/A]), so this is how the gate tells "ComfyUI is still holding
# the models WE loaded" (reclaimable by ComfyUI itself, fine to submit) from "someone
# else took the card since" (used grew; wait). Set by generate_one, in-process only.
_USED_AFTER_OURS: int | None = None


def wait_for_slot(min_free_mib: int, poll: float, max_wait: float, cached_ok: bool = False) -> dict:
    """Block until the owner's ComfyUI is idle AND the GPU has headroom. If he is
    generating, we do not. Headroom = free >= min_free_mib, OR the queue is idle and the
    used VRAM has not grown (> 1 GiB) since our own last prompt finished - i.e. what is
    resident is our cached model set, which ComfyUI swaps as needed. `cached_ok` makes a
    separate process trust that rule (used by the calibration sweep between runs)."""
    deadline = time.time() + max_wait
    waited = 0.0
    while True:
        idle = queue_is_idle()
        free = nvidia_free_mib()
        used = nvidia_used_mib()
        ok_free = free is not None and free >= min_free_mib
        ours = (_USED_AFTER_OURS is not None and used is not None and used <= _USED_AFTER_OURS + 1024)
        if idle and (ok_free or ours or (cached_ok and used is not None)):
            return {"idle": True, "vramFreeMiB": free, "vramUsedMiB": used, "waitedSeconds": round(waited, 1),
                    "admittedBy": "free" if ok_free else ("our-cache" if ours else "cached-ok flag")}
        if time.time() >= deadline:
            raise SystemExit(f"[targets] gave up after {waited:.0f}s: queue_idle={idle} "
                             f"vram_free={free} MiB (need >= {min_free_mib}). The owner's ComfyUI "
                             f"is busy; this lane does not pre-empt it.")
        print(f"[targets] waiting for slot: idle={idle} free={free} MiB used={used} (need {min_free_mib} free)", flush=True)
        time.sleep(poll)
        waited += poll


def preflight(min_free_mib: int, poll: float, max_wait: float, require_slot: bool = True) -> dict:
    stats = _get("/system_stats")
    missing = []
    for n in REQUIRED_NODES:
        try:
            info = _get(f"/object_info/{n}", timeout=30)
        except Exception:
            info = {}
        if n not in info:
            missing.append(n)
    if missing:
        raise SystemExit(f"[targets] nodes ABSENT on the running server: {missing}")
    want = {"diffusion_models": UNET, "text_encoders": CLIP, "vae": VAE}
    absent = [f"{k}/{v}" for k, v in want.items() if v not in _get(f"/models/{k}")]
    if absent:
        raise SystemExit(f"[targets] weights the SERVER cannot see: {absent}")
    dev = (stats.get("devices") or [{}])[0]
    out = {"comfyuiVersion": stats["system"]["comfyui_version"],
           "pytorch": stats["system"].get("pytorch_version"), "device": dev.get("name"),
           "vramTotalBytes": dev.get("vram_total"), "vramFreeBytes": dev.get("vram_free"),
           "weights": want, "nodes": REQUIRED_NODES}
    if require_slot:
        out["slot"] = wait_for_slot(min_free_mib, poll, max_wait)
    return out


# ----------------------------------------------------------------- the graph ---
def edit_workflow(image_ref: str, prompt: str, negative: str, seed: int, steps: int, cfg: float,
                  denoise: float, shift: float, prefix: str) -> dict:
    """The official image_qwen_image_edit_2511 template (Comfy-Org, templates 0.11.52),
    subgraph 'Image Edit (Qwen-Image 2511)', LoRA switch OFF, flattened to API form.
    Template values: ModelSamplingAuraFlow shift 3.1, CFGNorm 1.0, KSampler euler/simple,
    cfg 4.0, steps 40 (Qwen) / 20 (Comfy), reference_latents_method index_timestep_zero,
    FluxKontextImageScale on the input. Deviation: `denoise` (template 1.0)."""
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": UNET, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP, "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": shift}},
        "5": {"class_type": "CFGNorm", "inputs": {"model": ["4", 0], "strength": 1.0}},
        "6": {"class_type": "LoadImage", "inputs": {"image": image_ref}},
        "7": {"class_type": "FluxKontextImageScale", "inputs": {"image": ["6", 0]}},
        "8": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {
            "clip": ["2", 0], "vae": ["3", 0], "image1": ["7", 0], "prompt": prompt}},
        "9": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {
            "clip": ["2", 0], "vae": ["3", 0], "image1": ["7", 0], "prompt": negative}},
        "10": {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {
            "conditioning": ["8", 0], "reference_latents_method": "index_timestep_zero"}},
        "11": {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {
            "conditioning": ["9", 0], "reference_latents_method": "index_timestep_zero"}},
        "12": {"class_type": "VAEEncode", "inputs": {"pixels": ["7", 0], "vae": ["3", 0]}},
        "13": {"class_type": "KSampler", "inputs": {
            "model": ["5", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler",
            "scheduler": "simple", "positive": ["10", 0], "negative": ["11", 0],
            "latent_image": ["12", 0], "denoise": denoise}},
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["3", 0]}},
        "15": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["14", 0]}},
    }


def generate_one(source: str, out_png: str, seed: int, steps: int, cfg: float, denoise: float,
                 shift: float, variant: str | None, min_free_mib: int, poll: float,
                 max_wait: float, timeout: float, cached_ok: bool = False) -> dict:
    global _USED_AFTER_OURS
    from PIL import Image
    src_sha = sha256_file(source)
    with Image.open(source) as im:
        src_size = im.size
    prompt = prompt_for(variant)
    slot = wait_for_slot(min_free_mib, poll, max_wait, cached_ok)
    image_ref = upload_image(source)
    prefix = "aa-targets/" + os.path.splitext(os.path.basename(out_png))[0]
    wf = edit_workflow(image_ref, prompt, NEGATIVE, seed, steps, cfg, denoise, shift, prefix)
    t0 = time.time()
    pid = submit(wf)
    print(f"[targets] submitted {pid} for {os.path.basename(source)} denoise={denoise} seed={seed}", flush=True)
    entry = wait_for(pid, timeout=timeout, poll=3.0)
    secs = round(time.time() - t0, 1)
    _USED_AFTER_OURS = nvidia_used_mib()
    images = []
    for node_out in entry.get("outputs", {}).values():
        images += [i for i in node_out.get("images", []) if i.get("type") == "output"]
    if not images:
        raise RuntimeError("prompt finished with no output image")
    raw = fetch_output(images[0])   # copied out at once - ComfyUI's output dir is swept every 2 h
    tmp = out_png + ".comfy.png"
    os.makedirs(os.path.dirname(os.path.abspath(out_png)), exist_ok=True)
    with open(tmp, "wb") as f:
        f.write(raw)
    with Image.open(tmp) as gen:
        gen_size = gen.size
        back = gen.convert("RGB").resize(src_size, Image.LANCZOS)
        back.save(out_png, "PNG")
    os.remove(tmp)
    meta = {
        "file": os.path.relpath(out_png, TARGETS_DIR).replace("\\", "/"),
        "source": os.path.relpath(source, TARGETS_DIR).replace("\\", "/"),
        "sourceSha256": src_sha, "sha256": sha256_file(out_png),
        "route": ROUTE_ID, "model": MODEL_ID, "weights": {"unet": UNET, "clip": CLIP, "vae": VAE},
        "graph": "image_qwen_image_edit_2511 (templates 0.11.52), LoRA switch off, denoise overridden",
        "prompt": prompt, "negative": NEGATIVE, "variant": variant,
        "seed": seed, "steps": steps, "cfg": cfg, "denoise": denoise, "shift": shift,
        "sampler": "euler", "scheduler": "simple", "referenceLatentsMethod": "index_timestep_zero",
        "generatedSize": list(gen_size), "resizedTo": list(src_size), "resample": "LANCZOS",
        "comfyPromptId": pid, "seconds": secs, "slot": slot,
        "date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    with open(os.path.splitext(out_png)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"[targets] {meta['file']}  {gen_size[0]}x{gen_size[1]} -> {src_size[0]}x{src_size[1]}  {secs}s", flush=True)
    return meta


def free_models() -> dict:
    try:
        return {"ok": True, "resp": _post_json("/free", {"unload_models": True, "free_memory": True})}
    except Exception as e:  # never fail the run on the courtesy call; report it
        return {"ok": False, "error": str(e)}


# ------------------------------------------------------------------ fidelity ---
def _gray(path: str, size=(800, 450)):
    import numpy as np
    from PIL import Image
    with Image.open(path) as im:
        g = im.convert("L").resize(size, Image.BOX)
    return np.asarray(g, dtype=np.float64)


def _blur3(a):
    import numpy as np
    k = np.array([1, 2, 1], dtype=np.float64) / 4
    p = np.pad(a, 1, mode="edge")
    h = p[:, :-2] * k[0] + p[:, 1:-1] * k[1] + p[:, 2:] * k[2]
    v = h[:-2] * k[0] + h[1:-1] * k[1] + h[2:] * k[2]
    return v


def _sobel_mag(a):
    import numpy as np
    p = np.pad(a, 1, mode="edge")
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    return np.hypot(gx, gy)


def _dilate(m, r=2):
    import numpy as np
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def edge_overlap(src: str, tgt: str, pct: float = 90.0, tol_px: int = 2) -> dict:
    """Canny-like: blur, Sobel, keep each image's own top-(100-pct)% gradient pixels as its
    edge set, dilate by tol_px, and score the symmetric fraction of one set that lands on
    the other. Exposure- and texture-invariant enough that a photoreal re-render of the
    SAME street scores high and a different street scores low. Also a coarse 8x6 block
    check: a block with real structure in the source whose edges find nothing in the
    target is 'moved geometry'."""
    import numpy as np
    a = _sobel_mag(_blur3(_gray(src)))
    b = _sobel_mag(_blur3(_gray(tgt)))
    A = a >= np.percentile(a, pct)
    B = b >= np.percentile(b, pct)
    dA, dB = _dilate(A, tol_px), _dilate(B, tol_px)
    a_in_b = float((A & dB).sum() / max(1, A.sum()))
    b_in_a = float((B & dA).sum() / max(1, B.sum()))
    overlap = 0.5 * (a_in_b + b_in_a)
    # block geometry check
    H, W = A.shape
    rows, cols = 6, 8
    bh, bw = H // rows, W // cols
    dens = np.zeros((rows, cols))
    hit = np.zeros((rows, cols))
    for r in range(rows):
        for c in range(cols):
            blkA = A[r * bh:(r + 1) * bh, c * bw:(c + 1) * bw]
            blkB = dB[r * bh:(r + 1) * bh, c * bw:(c + 1) * bw]
            dens[r, c] = blkA.mean()
            hit[r, c] = (blkA & blkB).sum() / max(1, blkA.sum())
    structured = dens >= max(np.median(dens), 0.02)
    moved = [(int(r), int(c), round(float(hit[r, c]), 2)) for r in range(rows) for c in range(cols)
             if structured[r, c] and hit[r, c] < 0.35]
    return {"edgeOverlap": round(overlap, 3), "srcEdgesFound": round(a_in_b, 3),
            "tgtEdgesFound": round(b_in_a, 3), "movedBlocks": moved,
            "blockGrid": f"{rows}x{cols}", "method": f"blur3+sobel, top{100 - pct:.0f}% edges, tol {tol_px}px @800x450"}


def ssim_small(src: str, tgt: str, size=(200, 112), win: int = 7) -> float:
    import numpy as np
    x, y = _gray(src, size), _gray(tgt, size)
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2

    def box(a):
        p = np.pad(a, win // 2, mode="reflect")
        c = np.cumsum(np.cumsum(p, 0), 1)
        c = np.pad(c, ((1, 0), (1, 0)))
        s = c[win:, win:] - c[:-win, win:] - c[win:, :-win] + c[:-win, :-win]
        return s / (win * win)
    mx, my = box(x), box(y)
    sxx, syy, sxy = box(x * x) - mx * mx, box(y * y) - my * my, box(x * y) - mx * my
    s = ((2 * mx * my + C1) * (2 * sxy + C2)) / ((mx * mx + my * my + C1) * (sxx + syy + C2))
    return round(float(s.mean()), 3)


def fidelity_pair(src: str, tgt: str, min_overlap: float) -> dict:
    from PIL import Image
    with Image.open(src) as a, Image.open(tgt) as b:
        sa, sb = a.size, b.size
    aspect_off = abs(sa[0] / sa[1] - sb[0] / sb[1]) / (sa[0] / sa[1])
    e = edge_overlap(src, tgt)
    s = ssim_small(src, tgt)
    passed = e["edgeOverlap"] >= min_overlap and len(e["movedBlocks"]) <= 2 and aspect_off <= 0.02
    reason = []
    if aspect_off > 0.02:
        reason.append(f"aspect changed: source {sa[0]}x{sa[1]} vs target {sb[0]}x{sb[1]} (re-composed, not a re-render)")
    if e["edgeOverlap"] < min_overlap:
        reason.append(f"edge overlap {e['edgeOverlap']} < {min_overlap}")
    if len(e["movedBlocks"]) > 2:
        reason.append(f"{len(e['movedBlocks'])} structured blocks lost their edges: {e['movedBlocks']}")
    return {**e, "ssim": s, "sourceSize": list(sa), "targetSize": list(sb), "pass": passed, "reason": "; ".join(reason)}


# ------------------------------------------------------------------- measure ---
def _rgb(path: str):
    import numpy as np
    from PIL import Image
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.float64)


def _luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def _rect(a, r):
    x0, y0, x1, y1 = r
    return a[y0:y1, x0:x1]


def _cct_mccamy(rgb_mean):
    """Correlated colour temperature from mean sRGB via XYZ -> xy -> McCamy. A proxy:
    display-referred pixels, not radiance; useful as ours-vs-target DIRECTION only."""
    import numpy as np
    c = np.clip(np.asarray(rgb_mean) / 255.0, 0, 1)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    X, Y, Z = M @ lin
    s = X + Y + Z
    if s <= 0:
        return None
    x, y = X / s, Y / s
    n = (x - 0.3320) / (0.1858 - y) if abs(0.1858 - y) > 1e-6 else 0
    return int(round(449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33))


def _sat(rgb):
    import numpy as np
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)


def _edge_softness_px(l, line):
    """Shadow edge softness: sample the luma profile 1 px apart along a line drawn ACROSS
    a shadow edge, find the strongest step on it, take the plateaus 10-30 px either
    side of that step, and report the 10-90% transition width in px (a crisp
    shadow-mapped edge reads 2-4 px; a penumbra reads 8-20 px). Returns (px, step)."""
    import numpy as np
    (x0, y0), (x1, y1) = line
    n = max(8, int(round(np.hypot(x1 - x0, y1 - y0))))
    xs, ys = np.linspace(x0, x1, n), np.linspace(y0, y1, n)
    prof = np.array([l[min(l.shape[0] - 1, int(round(y))), min(l.shape[1] - 1, int(round(x)))] for x, y in zip(xs, ys)])
    sm = np.convolve(prof, np.ones(3) / 3, mode="same")
    g = np.gradient(sm)
    i = int(np.argmax(np.abs(g[5:-5]))) + 5
    a = sm[max(0, i - 30):max(1, i - 10)].mean()
    b = sm[i + 10:i + 30].mean() if i + 30 <= n else sm[i + 10:].mean()
    lo, hi = min(a, b), max(a, b)
    if hi - lo < 8:
        return None, round(float(hi - lo), 1)
    t10, t90 = lo + 0.1 * (hi - lo), lo + 0.9 * (hi - lo)
    # walk outward from the step while still inside the transition band
    j0 = i
    while j0 > 0 and t10 < sm[j0 - 1] < t90:
        j0 -= 1
    j1 = i
    while j1 < n - 1 and t10 < sm[j1 + 1] < t90:
        j1 += 1
    return round(float(j1 - j0 + 1), 1), round(float(hi - lo), 1)


def measure_pair(src: str, tgt: str, regions: dict) -> dict:
    import numpy as np
    out = {}
    for tag, path in (("ours", src), ("target", tgt)):
        rgb = _rgb(path)
        l = _luma(rgb)
        m = {"lumaP5": round(float(np.percentile(l, 5)), 1), "lumaP50": round(float(np.percentile(l, 50)), 1),
             "lumaP95": round(float(np.percentile(l, 95)), 1),
             "saturationMean": round(float(_sat(rgb).mean()), 3),
             "cctK": _cct_mccamy(rgb.reshape(-1, 3).mean(0)),
             "belowLuma20pct": round(float((l < 51).mean()), 3), "aboveLuma90pct": round(float((l > 230).mean()), 3)}
        if "sunlit" in regions and "shaded" in regions:
            s, d = _luma(_rect(rgb, regions["sunlit"])).mean(), _luma(_rect(rgb, regions["shaded"])).mean()
            m["sunlit"] = round(float(s), 1)
            m["shaded"] = round(float(d), 1)
            m["sunlitShadedRatio"] = round(float(s / max(d, 1)), 2)
        if "shadowLine" in regions:
            w, span = _edge_softness_px(l, regions["shadowLine"])
            m["shadowEdgePx"] = w
            m["shadowEdgeLumaSpan"] = span
        if "sky" in regions:
            sk = _rect(rgb, regions["sky"])
            top, bot = sk[: max(1, sk.shape[0] // 5)], sk[-max(1, sk.shape[0] // 5):]
            m["skyTopRGB"] = [int(v) for v in top.reshape(-1, 3).mean(0)]
            m["skyHorizonRGB"] = [int(v) for v in bot.reshape(-1, 3).mean(0)]
            m["skyGradientLuma"] = round(float(_luma(bot).mean() - _luma(top).mean()), 1)
        if "contact" in regions and "contactRef" in regions:
            c, r = _luma(_rect(rgb, regions["contact"])).mean(), _luma(_rect(rgb, regions["contactRef"])).mean()
            m["contact"] = round(float(c), 1)
            m["contactRef"] = round(float(r), 1)
            m["contactDarkening"] = round(float(1 - c / max(r, 1)), 3)
        if "facade" in regions:
            f = _rect(rgb, regions["facade"])
            fl = _luma(f)
            hp = _sobel_mag(_blur3(fl))
            m["facadeMicroDetail"] = round(float(hp.mean()), 2)
            m["facadeLumaStd"] = round(float(fl.std()), 2)
        out[tag] = m
    return out


# ------------------------------------------------------------------- batch ---
def cmd_batch(a):
    man_path = os.path.join(TARGETS_DIR, "sources", "manifest.json")
    with open(man_path, encoding="utf-8") as f:
        man = json.load(f)
    out_dir = os.path.join(TARGETS_DIR, "targets")
    os.makedirs(out_dir, exist_ok=True)
    pf = preflight(a.min_free_vram, a.wait_poll, a.wait_max, require_slot=False)
    print(json.dumps({k: pf[k] for k in ("comfyuiVersion", "device", "vramFreeBytes")}), flush=True)
    jobs = []
    for i, fr in enumerate(man["frames"]):
        src = os.path.join(TARGETS_DIR, fr["file"])
        jobs.append((src, fr["id"], None, a.seed_base + i))
        station = fr["id"].split("-", 1)[1]
        if fr["set"] == "station" and station in a.variant_stations:
            for j, v in enumerate(("golden", "overcast")):
                jobs.append((src, f"{fr['id']}-{v}", v, a.seed_base + 100 + 10 * i + j))
    if a.only:
        jobs = [j for j in jobs if j[1] in a.only]
    results = []
    gate_path = os.path.join(TARGETS_DIR, "fidelity.json")
    gate = {}
    if os.path.exists(gate_path):
        with open(gate_path, encoding="utf-8") as f:
            gate = json.load(f).get("pairs", {})
    try:
        for src, tid, variant, seed in jobs:
            out_png = os.path.join(out_dir, tid + ".png")
            meta_path = os.path.splitext(out_png)[0] + ".json"
            if os.path.exists(out_png) and os.path.exists(meta_path) and gate.get(tid, {}).get("pass") and not a.force:
                print(f"[targets] keep {tid} (passed gate)", flush=True)
                continue
            denoise = a.denoise
            attempt = 0
            while True:
                attempt += 1
                meta = generate_one(src, out_png, seed, a.steps, a.cfg, denoise, a.shift, variant,
                                    a.min_free_vram, a.wait_poll, a.wait_max, a.timeout, a.cached_ok)
                fid = fidelity_pair(src, out_png, a.min_overlap)
                meta["fidelity"] = fid
                meta["attempt"] = attempt
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2)
                gate[tid] = {**fid, "denoise": denoise, "seed": seed, "attempt": attempt}
                with open(gate_path, "w", encoding="utf-8") as f:
                    json.dump({"minEdgeOverlap": a.min_overlap, "pairs": gate,
                               "date": datetime.now(timezone.utc).isoformat(timespec="seconds")}, f, indent=2)
                print(f"[targets]   gate {tid}: overlap {fid['edgeOverlap']} ssim {fid['ssim']} moved {len(fid['movedBlocks'])} -> {'PASS' if fid['pass'] else 'REJECT ' + fid['reason']}", flush=True)
                if fid["pass"] or denoise - a.denoise_step < a.denoise_floor - 1e-9 or attempt >= a.max_attempts:
                    break
                denoise = round(denoise - a.denoise_step, 2)
                print(f"[targets]   regenerating {tid} at denoise {denoise}", flush=True)
            results.append(meta)
    finally:
        if not a.keep_loaded:
            print("[targets] /free ->", json.dumps(free_models()), flush=True)
    print(f"[targets] batch done: {len(results)} generated")


def cmd_generate(a):
    preflight(a.min_free_vram, a.wait_poll, a.wait_max, require_slot=False)
    try:
        meta = generate_one(a.source, a.out, a.seed, a.steps, a.cfg, a.denoise, a.shift, a.variant,
                            a.min_free_vram, a.wait_poll, a.wait_max, a.timeout, a.cached_ok)
        fid = fidelity_pair(a.source, a.out, a.min_overlap)
        meta["fidelity"] = fid
        with open(os.path.splitext(a.out)[0] + ".json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        print(json.dumps(fid))
    finally:
        if not a.keep_loaded:
            print("[targets] /free ->", json.dumps(free_models()), flush=True)


def cmd_fidelity(a):
    res = {}
    for pair in a.pairs:
        src, tgt = pair.split("=", 1)
        res[os.path.basename(tgt)] = fidelity_pair(src, tgt, a.min_overlap)
    print(json.dumps(res, indent=2))


def cmd_measure(a):
    with open(a.regions, encoding="utf-8") as f:
        regions = json.load(f)
    res = {}
    for pair in a.pairs:
        src, tgt = pair.split("=", 1)
        key = os.path.splitext(os.path.basename(tgt))[0]
        station = key.split("-", 1)[1] if "-" in key else key
        res[key] = measure_pair(src, tgt, regions.get(station, regions.get(key, {})))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=2)
    print(json.dumps(res, indent=2))


# -------------------------------------------------------------------- report ---
def _short_sha(s):
    return (s or "")[:12]


def cmd_report(a):
    """MANIFEST.md (one row per generated file) + deltas.json (ours vs target numbers per
    pair) from the sidecar JSONs, fidelity results and regions.json. Idempotent."""
    with open(os.path.join(TARGETS_DIR, "sources", "manifest.json"), encoding="utf-8") as f:
        man = json.load(f)
    with open(os.path.join(TARGETS_DIR, "regions.json"), encoding="utf-8") as f:
        regions = json.load(f)
    src_by_id = {fr["id"]: fr for fr in man["frames"]}
    rows, deltas = [], {}
    for sub in ("targets", "alt-b"):
        d = os.path.join(TARGETS_DIR, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json") or name.startswith("_"):
                continue
            with open(os.path.join(d, name), encoding="utf-8") as f:
                m = json.load(f)
            tid = os.path.splitext(name)[0]
            base_id = tid.replace("-golden", "").replace("-overcast", "")
            src = src_by_id.get(base_id)
            tgt_png = os.path.join(d, tid + ".png")
            if not src or not os.path.exists(tgt_png):
                continue
            fid = m.get("fidelity", {})
            station = base_id.split("-", 1)[1]
            reg = regions.get(station, {})
            meas = measure_pair(os.path.join(TARGETS_DIR, src["file"]), tgt_png, reg)
            key = f"{sub}/{tid}"
            deltas[key] = {"source": src["file"], "target": f"{sub}/{tid}.png", "route": m.get("route"),
                           "variant": m.get("variant"), "fidelity": {k: fid.get(k) for k in ("edgeOverlap", "ssim", "movedBlocks", "pass")},
                           **meas}
            o, t = meas["ours"], meas["target"]
            deltas[key]["delta"] = {k: (round(t[k] - o[k], 3) if isinstance(o.get(k), (int, float)) and isinstance(t.get(k), (int, float)) else None)
                                    for k in o if k in t}
            rows.append({
                "file": f"{sub}/{tid}.png", "source": src["file"], "sourceSha": _short_sha(src["sha256"]),
                "sha": _short_sha(m.get("sha256")), "route": m.get("route"), "model": (m.get("model") or "")[:80],
                "prompt": "BASE" + (f"+{m['variant']}" if m.get("variant") else ""),
                "seed": m.get("seed"), "strength": m.get("denoise", m.get("strength")), "steps": m.get("steps"),
                "cfg": m.get("cfg"), "overlap": fid.get("edgeOverlap"), "ssim": fid.get("ssim"),
                "moved": len(fid.get("movedBlocks") or []), "pass": fid.get("pass"), "date": (m.get("date") or "")[:19],
                "seconds": m.get("seconds"),
            })
    with open(os.path.join(TARGETS_DIR, "deltas.json"), "w", encoding="utf-8") as f:
        json.dump({"bundle": man["bundle"], "gitRev": man["gitRev"], "capturedAt": man["capturedAt"],
                   "regions": "regions.json", "pairs": deltas,
                   "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}, f, indent=1)
    lines = ["# Photoreal targets - MANIFEST", "",
             f"Sources: {len(man['frames'])} frames from ONE bundle `{man['bundle']['asset']}` "
             f"(sha256 {man['bundle']['sha256']}), git `{man['gitRev']}`, captured {man['capturedAt']}, "
             f"1600x900, real Chrome over CDP, WebGPU, default post chain, Math.random seeded {man['mathRandomSeed']}.",
             "", "Generated files (one row each). `overlap` is the edge-map overlap of the fidelity gate "
             "(bar >= 0.55, see README), `ssim` the 200x112 grey SSIM, `moved` the count of structured 6x8 "
             "blocks whose source edges found nothing in the target (bar <= 2).", "",
             "| file | source | src sha | sha | route | prompt | seed | strength | steps | cfg | overlap | ssim | moved | pass | date (UTC) | s |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append("| `{file}` | `{source}` | {sourceSha} | {sha} | {route} | {prompt} | {seed} | {strength} | {steps} | {cfg} | {overlap} | {ssim} | {moved} | {p} | {date} | {seconds} |".format(
            p="PASS" if r["pass"] else "FAIL", **{k: ("-" if v is None else v) for k, v in r.items()}))
    lines += ["", "## Sources", "", "| id | file | sha256 | pose | viewmodel | mean luma | draw calls |", "|---|---|---|---|---|---|---|"]
    for fr in man["frames"]:
        pose = fr["pose"]
        lines.append(f"| {fr['id']} | `{fr['file']}` | {_short_sha(fr['sha256'])} | pos {pose['pos']} yaw {round(pose['yaw'], 3)} pitch {round(pose['pitch'], 3)} fov {pose['fov']} | {fr['viewmodel']} | {fr['meanLuma']} | {fr['drawCalls']} |")
    lines += ["", "## Prompts (verbatim)", "", "### Route B positive (BASE)", "", "```", PROMPT_BASE, "```", "",
              "### Route B negative", "", "```", NEGATIVE, "```", ""]
    for k, v in VARIANTS.items():
        lines += [f"### Variant `{k}` (appended to BASE)", "", "```", v, "```", ""]
    lines += ["### Route A", "", "The exact text handed to `agy` is stored in each target's sidecar JSON (`prompt`) and the "
              "verbatim agent transcript beside the scratch output (`agyLog`).", ""]
    with open(os.path.join(TARGETS_DIR, "MANIFEST.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"[targets] MANIFEST.md: {len(rows)} rows; deltas.json: {len(deltas)} pairs")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(q):
        q.add_argument("--min-free-vram", type=int, default=8192)
        q.add_argument("--wait-poll", type=float, default=30.0)
        q.add_argument("--wait-max", type=float, default=1800.0)
        q.add_argument("--timeout", type=float, default=900.0, help="hard poll cap per prompt (s)")
        q.add_argument("--keep-loaded", action="store_true", help="skip POST /free at the end")
        q.add_argument("--cached-ok", action="store_true",
                       help="admit a submit when the queue is idle even if free VRAM < --min-free-vram: "
                            "ONLY when the resident VRAM is known to be our own cached models from the "
                            "previous run of this script (calibration sweeps); the batch command tracks "
                            "this in-process and does not need it")

    def gen_args(q):
        q.add_argument("--steps", type=int, default=20)
        q.add_argument("--cfg", type=float, default=4.0)
        q.add_argument("--denoise", type=float, default=0.35)
        q.add_argument("--shift", type=float, default=3.1)
        q.add_argument("--min-overlap", type=float, default=0.55)

    q = sub.add_parser("preflight"); common(q)
    q.set_defaults(func=lambda a: print(json.dumps(preflight(a.min_free_vram, a.wait_poll, a.wait_max, not a.cached_ok), indent=2)))

    q = sub.add_parser("generate"); common(q); gen_args(q)
    q.add_argument("--source", required=True); q.add_argument("--out", required=True)
    q.add_argument("--seed", type=int, default=20260919); q.add_argument("--variant", choices=list(VARIANTS))
    q.set_defaults(func=cmd_generate)

    q = sub.add_parser("batch"); common(q); gen_args(q)
    q.add_argument("--seed-base", type=int, default=20260919)
    q.add_argument("--denoise-step", type=float, default=0.10)
    q.add_argument("--denoise-floor", type=float, default=0.15)
    q.add_argument("--max-attempts", type=int, default=3)
    q.add_argument("--variant-stations", nargs="*", default=["turningHead", "spawnA", "interiorOrange"])
    q.add_argument("--only", nargs="*", default=None)
    q.add_argument("--force", action="store_true")
    q.set_defaults(func=cmd_batch)

    q = sub.add_parser("fidelity"); q.add_argument("--min-overlap", type=float, default=0.55)
    q.add_argument("pairs", nargs="+", help="source.png=target.png ..."); q.set_defaults(func=cmd_fidelity)

    q = sub.add_parser("measure"); q.add_argument("--regions", required=True); q.add_argument("--out")
    q.add_argument("pairs", nargs="+", help="source.png=target.png ..."); q.set_defaults(func=cmd_measure)

    q = sub.add_parser("free"); q.set_defaults(func=lambda a: print(json.dumps(free_models())))

    q = sub.add_parser("report"); q.set_defaults(func=cmd_report)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
