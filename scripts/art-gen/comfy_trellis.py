#!/usr/bin/env python3
"""Local image -> textured game-ready GLB through the owner's ComfyUI (Trellis.2).

This is the reusable client for the "AI-generated hero prop" supply route described
by the `comfyui-3d-native-pipeline` skill. It drives ONLY core ComfyUI nodes - no
custom node pack, no paid API, nothing installed. It never boots, restarts,
updates or reconfigures the owner's ComfyUI: if the server is down, or busy, or
short of VRAM, this script waits or refuses.

Two stages, each its own subcommand so a failed stage can be retried alone:

  concept   Qwen-Image-2512 fp8 + Lightning-4step LoRA text-to-image (the exact
            stack `scripts/art-gen/comfy_generate.py` already drives on this
            machine), 1024x1024, saved locally with prompt/seed/steps recorded.

  mesh      BiRefNet background removal -> ImageCropToMask -> Trellis2Conditioning
            (DINOv3 clip_vision) -> structure/shape/upsample/texture KSamplers ->
            VoxelToMesh -> RemeshMesh -> DecimateMesh -> MeshSmoothNormals ->
            UnwrapMesh -> BakeTextureFromVoxel -> BakeNormalMapFromMesh ->
            BakeAmbientOcclusion -> ApplyTextureToMesh -> MeshToFile3D -> SaveGLB.
            Emits TWO GLBs in one submit: a sculpt-budget vertex-coloured export
            and a game-budget textured export, so "before / after decimation" is
            measured from two real files rather than from a node's target number.

Every parameter is taken from the shipped template
`comfyui_workflow_templates_json/templates/3d_pixal3d_trellis2_image_to_model.json`
(Trellis.2 branch of its boolean switch) unless `--` flags override it; the
deviations this project makes are the two decimation targets and a 2048 atlas
instead of the template's 4096.

Machine courtesy, non-negotiable, all enforced below:
  * `GET /queue` must show queue_running AND queue_pending empty before a submit.
  * `nvidia-smi` must report >= --min-free-vram MiB free before a submit.
  * If either fails we poll every --wait-poll seconds up to --wait-max seconds
    and then give up. We never pre-empt the owner's own generation.
  * Weights are confirmed by asking the SERVER (`GET /models/<folder>`), never by
    stat-ing a guessed models path - the running process may have been launched
    with `--models-directory`.

Usage:
  python comfy_trellis.py preflight
  python comfy_trellis.py concept --prompt "..." --out concept.png [--seed N]
  python comfy_trellis.py mesh --image concept.png --out-dir DIR --name crate \
      [--sculpt-faces 700000] [--game-faces 3000] [--atlas 2048]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")

# ---- the Trellis.2 weight set, by the folder the SERVER resolves ------------------
REQUIRED_WEIGHTS = {
    "diffusion_models": ["trellis_2_int8_convrot.safetensors"],
    "vae": ["trellis_2_shape_vae_bf16.safetensors", "trellis_2_texture_vae_bf16.safetensors"],
    "clip_vision": ["dino_v3_vit_l.safetensors"],
    "background_removal": ["birefnet.safetensors"],
}
REQUIRED_NODES = [
    "Trellis2Conditioning", "EmptyTrellis2LatentStructure", "VaeDecodeStructureTrellis2",
    "Trellis2ShapeStage", "Trellis2UpsampleStage", "VaeDecodeShapeTrellis",
    "Trellis2TextureStage", "VaeDecodeTextureTrellis", "VoxelToMesh", "RemeshMesh",
    "DecimateMesh", "MeshSmoothNormals", "UnwrapMesh", "GetMeshInfo",
    "BakeTextureFromVoxel", "PaintMesh", "ApplyTextureToMesh",
    "BakeNormalMapFromMesh", "BakeAmbientOcclusion", "MeshToFile3D", "SaveGLB", "RenderUVAtlas", "SaveImage",
    "LoadBackgroundRemovalModel", "RemoveBackground", "ImageCropToMask",
    "CLIPVisionLoader", "UNETLoader", "VAELoader", "KSampler", "PreviewAny",
]

# ---- concept-image stack (identical to comfy_generate.py, which is proven here) ---
CONCEPT_CLIP = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
CONCEPT_UNET = "qwen_image_2512_fp8_e4m3fn.safetensors"
CONCEPT_VAE = "qwen_image_vae.safetensors"
CONCEPT_LORA = "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors"


# ---------------------------------------------------------------- HTTP plumbing ---
def _get(path: str, timeout: float = 20):
    with urllib.request.urlopen(f"{COMFY_URL}{path}", timeout=timeout) as resp:
        return json.loads(resp.read())


def _get_bytes(path: str, timeout: float = 300) -> bytes:
    with urllib.request.urlopen(f"{COMFY_URL}{path}", timeout=timeout) as resp:
        return resp.read()


def submit(workflow: dict) -> str:
    body = json.dumps({"prompt": workflow, "client_id": str(uuid.uuid4())}).encode()
    req = urllib.request.Request(f"{COMFY_URL}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())["prompt_id"]
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"submit rejected: {e.read().decode()[:4000]}") from e


def wait_for(prompt_id: str, timeout: float, poll: float = 5.0,
             on_tick=None) -> dict:
    """Poll /history until the prompt lands. Generous ceiling, hard cap, no spin."""
    deadline = time.time() + timeout
    t0 = time.time()
    while time.time() < deadline:
        hist = _get(f"/history/{prompt_id}", timeout=30)
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                raise RuntimeError(f"execution error: {json.dumps(msgs)[:4000]}")
            return entry
        if on_tick:
            on_tick(time.time() - t0)
        time.sleep(poll)
    raise TimeoutError(f"prompt {prompt_id} unfinished after {timeout}s (HARD CAP)")


def upload_image(path: str, subfolder: str = "") -> str:
    """POST /upload/image as multipart. Returns the server-side filename."""
    name = os.path.basename(path)
    boundary = "----comfytrellis" + uuid.uuid4().hex
    with open(path, "rb") as f:
        payload = f.read()
    parts = []
    def field(n, v):
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{n}\"\r\n\r\n{v}\r\n".encode())
    field("type", "input")
    field("overwrite", "true")
    if subfolder:
        field("subfolder", subfolder)
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
        f"Content-Type: image/png\r\n\r\n".encode() + payload + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(f"{COMFY_URL}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        got = json.loads(resp.read())
    return (got.get("subfolder") + "/" if got.get("subfolder") else "") + got["name"]


def fetch_output(item: dict, dest: str) -> str:
    q = urllib.parse.urlencode({"filename": item["filename"],
                                "subfolder": item.get("subfolder", ""),
                                "type": item.get("type", "output")})
    data = _get_bytes(f"/view?{q}")
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return dest


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------- GPU / queue ---
def nvidia_free_mib() -> int | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


def nvidia_used_mib() -> int | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


class VramSampler(threading.Thread):
    """Samples nvidia-smi used-MiB while a prompt runs. The skill says no honest
    VRAM figure exists for this route; this is how one gets recorded."""

    def __init__(self, interval: float = 5.0):
        super().__init__(daemon=True)
        self.interval = interval
        self._stop = threading.Event()
        self.samples: list[tuple[float, int]] = []

    def run(self):
        t0 = time.time()
        while not self._stop.is_set():
            u = nvidia_used_mib()
            if u is not None:
                self.samples.append((round(time.time() - t0, 1), u))
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()
        self.join(timeout=self.interval + 5)

    @property
    def peak(self) -> int | None:
        return max((v for _, v in self.samples), default=None)


def queue_is_idle() -> bool:
    q = _get("/queue")
    return not q.get("queue_running") and not q.get("queue_pending")


def wait_for_slot(min_free_mib: int, poll: float, max_wait: float) -> dict:
    """Block until the owner's ComfyUI is idle AND the GPU has headroom.

    This is the machine-courtesy gate. If he is generating, we do not."""
    deadline = time.time() + max_wait
    waited = 0.0
    while True:
        idle = queue_is_idle()
        free = nvidia_free_mib()
        ok_vram = free is not None and free >= min_free_mib
        if idle and ok_vram:
            return {"idle": True, "vramFreeMiB": free, "waitedSeconds": round(waited, 1)}
        if time.time() >= deadline:
            raise SystemExit(
                f"[trellis] gave up after {waited:.0f}s: queue_idle={idle} "
                f"vram_free={free} MiB (need >= {min_free_mib}). The owner's "
                f"ComfyUI is busy; this lane does not pre-empt it.")
        print(f"[trellis] waiting: queue_idle={idle} vram_free={free} MiB "
              f"(need >= {min_free_mib}); re-check in {poll:.0f}s", flush=True)
        time.sleep(poll)
        waited += poll


# ---------------------------------------------------------------------- preflight ---
def preflight(min_free_mib: int = 8192, poll: float = 60.0, max_wait: float = 1200.0,
              require_slot: bool = True) -> dict:
    stats = _get("/system_stats")
    version = stats["system"]["comfyui_version"]
    argv = stats["system"].get("argv", [])
    models_dir = None
    if "--models-directory" in argv:
        models_dir = argv[argv.index("--models-directory") + 1]
    dev = (stats.get("devices") or [{}])[0]

    missing_nodes = []
    for chunk_start in range(0, len(REQUIRED_NODES), 1):
        n = REQUIRED_NODES[chunk_start]
        try:
            info = _get(f"/object_info/{n}", timeout=30)
        except Exception:
            info = {}
        if n not in info:
            missing_nodes.append(n)
    if missing_nodes:
        raise SystemExit(f"[trellis] nodes ABSENT on the running server: {missing_nodes}")

    weights = {}
    missing_weights = []
    for folder, wanted in REQUIRED_WEIGHTS.items():
        listed = _get(f"/models/{folder}")
        weights[folder] = listed
        for w in wanted:
            if w not in listed:
                missing_weights.append(f"{folder}/{w}")
    if missing_weights:
        raise SystemExit(f"[trellis] weights the SERVER cannot see: {missing_weights}")

    out = {
        "comfyuiVersion": version,
        "pythonVersion": stats["system"].get("python_version"),
        "pytorchVersion": stats["system"].get("pytorch_version"),
        "argv": argv,
        "modelsDirectoryFlag": models_dir,
        "device": dev.get("name"),
        "vramTotalBytes": dev.get("vram_total"),
        "vramFreeBytesAtPreflight": dev.get("vram_free"),
        "nodesConfirmed": REQUIRED_NODES,
        "weightsListedByServer": {k: [w for w in v if w in REQUIRED_WEIGHTS[k]]
                                  for k, v in weights.items()},
    }
    if require_slot:
        out["slot"] = wait_for_slot(min_free_mib, poll, max_wait)
    print(json.dumps(out, indent=2))
    return out


# --------------------------------------------------------------- concept workflow ---
def concept_workflow(prompt: str, width: int, height: int,
                     seed: int, prefix: str) -> dict:
    """Qwen-Image-2512 fp8 + Lightning 4-step LoRA - the stack comfy_generate.py drives."""
    return {
        "1": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": CONCEPT_CLIP, "type": "qwen_image", "device": "default"}},
        "2": {"class_type": "VAELoader", "inputs": {"vae_name": CONCEPT_VAE}},
        "3": {"class_type": "UNETLoader", "inputs": {
            "unet_name": CONCEPT_UNET, "weight_dtype": "default"}},
        "4": {"class_type": "LoraLoader", "inputs": {
            "model": ["3", 0], "clip": ["1", 0], "lora_name": CONCEPT_LORA,
            "strength_model": 1.0, "strength_clip": 0.0}},
        "5": {"class_type": "ModelSamplingFlux", "inputs": {
            "model": ["4", 0], "max_shift": 1.15, "base_shift": 0.5,
            "width": width, "height": height}},
        "6": {"class_type": "TextEncodeQwenImageEdit", "inputs": {
            "clip": ["1", 0], "prompt": prompt}},
        "7": {"class_type": "FluxGuidance", "inputs": {
            "conditioning": ["6", 0], "guidance": 3.5}},
        "8": {"class_type": "EmptyQwenImageLayeredLatentImage", "inputs": {
            "width": width, "height": height, "layers": 3, "batch_size": 1}},
        # cfg is 1.0 (Lightning 4-step), so the negative branch is inert; the proven
        # comfy_generate.py graph wires positive into both and this mirrors it.
        "9": {"class_type": "KSampler", "inputs": {
            "model": ["5", 0], "seed": seed, "steps": 4, "cfg": 1.0,
            "sampler_name": "euler", "scheduler": "simple",
            "positive": ["7", 0], "negative": ["7", 0],
            "latent_image": ["8", 0], "denoise": 1.0}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["2", 0]}},
        "11": {"class_type": "SaveImage", "inputs": {
            "filename_prefix": prefix, "images": ["10", 0]}},
    }


# --------------------------------------------------------------- Trellis workflow ---
# Every default below is the shipped template's value for the Trellis.2 branch.
TPL = {
    "crop": {"width": 1024, "height": 1024, "pad_factor": 1.1, "grow_mask": 0,
             "background": "#000000"},
    "structure": {"seed": 56, "steps": 12, "cfg": 7.5, "sampler": "euler",
                  "scheduler": "normal", "cfg_override": 0.667, "rescale": 0.7,
                  "model_shift": 5.0, "resolution": "32"},
    "shape": {"seed": 42, "steps": 20, "cfg": 7.5, "sampler": "euler",
              "scheduler": "normal", "cfg_override": 0.769, "rescale": 0.5},
    "upsample": {"seed": 42, "steps": 12, "cfg": 7.5, "sampler": "euler",
                 "scheduler": "simple", "target_resolution": 1536},
    "texture": {"seed": 43, "steps": 12, "cfg": 1.0, "sampler": "euler",
                "scheduler": "normal"},
    "voxel_to_mesh": {"algorithm": "basic", "threshold": 0.6},
    "remesh": {"resolution": 768, "sign_mode": "udf", "qef": False,
               "drop_inverted_components": False, "drop_enclosed_components": False,
               "band": 1.0, "project_back": 0.0, "fix_poles": False,
               "smooth_iters": 20, "drop_small_components": 0.01,
               "precluster_max_verts": 20000000},
    "smooth_normals": {"crease_angle": 180.0},
    "unwrap": {"segmenter": "pec", "padding": 1, "weld_distance": 0.0002},
    "normal_bake": {"cage_distance": 0.05, "ignore_backfaces": True},
    # max_distance 0.71 is the SHIPPED template value and it is wrong for anything
    # smaller than the axe it was authored against - see --ao-distance.
    "ao_bake": {"resolution": 1024, "samples": 64, "max_distance": 0.71,
                "strength": 1.0, "bias": 0.01},
}


def trellis_workflow(image_name: str, name: str, sculpt_faces: int, game_faces: int,
                     atlas: int, seed_offset: int = 0, ao_distance: float | None = None,
                     cage_distance: float | None = None) -> dict:
    s = json.loads(json.dumps(TPL))          # per-call copy; TPL stays the record
    if ao_distance is not None:
        s["ao_bake"]["max_distance"] = ao_distance
    if cage_distance is not None:
        s["normal_bake"]["cage_distance"] = cage_distance
    sd = lambda stage: s[stage]["seed"] + seed_offset  # noqa: E731
    wf: dict = {
        # ---- input conditioning
        "10": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "11": {"class_type": "LoadBackgroundRemovalModel",
               "inputs": {"bg_removal_name": "birefnet.safetensors"}},
        "12": {"class_type": "RemoveBackground",
               "inputs": {"bg_removal_model": ["11", 0], "image": ["10", 0]}},
        "13": {"class_type": "ImageCropToMask", "inputs": {
            "images": ["10", 0], "masks": ["12", 0], **s["crop"]}},
        "14": {"class_type": "CLIPVisionLoader",
               "inputs": {"clip_name": "dino_v3_vit_l.safetensors"}},
        "15": {"class_type": "Trellis2Conditioning",
               "inputs": {"clip_vision_model": ["14", 0], "image": ["13", 0]}},
        # ---- model + the template's CFG shaping (two distinct branches)
        "20": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "trellis_2_int8_convrot.safetensors", "weight_dtype": "default"}},
        "21": {"class_type": "CFGOverride", "inputs": {
            "model": ["20", 0], "cfg": 1.0,
            "start_percent": s["structure"]["cfg_override"], "end_percent": 1.0}},
        "22": {"class_type": "RescaleCFG", "inputs": {
            "model": ["21", 0], "multiplier": s["structure"]["rescale"]}},
        "23": {"class_type": "ModelSamplingSD3", "inputs": {
            "model": ["22", 0], "shift": s["structure"]["model_shift"]}},
        "24": {"class_type": "CFGOverride", "inputs": {
            "model": ["20", 0], "cfg": 1.0,
            "start_percent": s["shape"]["cfg_override"], "end_percent": 1.0}},
        "25": {"class_type": "RescaleCFG", "inputs": {
            "model": ["24", 0], "multiplier": s["shape"]["rescale"]}},
        # ---- VAEs
        "30": {"class_type": "VAELoader",
               "inputs": {"vae_name": "trellis_2_shape_vae_bf16.safetensors"}},
        "31": {"class_type": "VAELoader",
               "inputs": {"vae_name": "trellis_2_texture_vae_bf16.safetensors"}},
        # ---- structure stage
        "40": {"class_type": "EmptyTrellis2LatentStructure", "inputs": {"batch_size": 1}},
        "41": {"class_type": "KSampler", "inputs": {
            "model": ["23", 0], "seed": sd("structure"), "steps": s["structure"]["steps"],
            "cfg": s["structure"]["cfg"], "sampler_name": s["structure"]["sampler"],
            "scheduler": s["structure"]["scheduler"], "positive": ["15", 0],
            "negative": ["15", 1], "latent_image": ["40", 0], "denoise": 1.0}},
        "42": {"class_type": "VaeDecodeStructureTrellis2", "inputs": {
            "samples": ["41", 0], "vae": ["30", 0],
            "resolution": s["structure"]["resolution"]}},
        # ---- shape stage
        "50": {"class_type": "Trellis2ShapeStage", "inputs": {
            "positive": ["15", 0], "negative": ["15", 1], "voxel": ["42", 0]}},
        "51": {"class_type": "KSampler", "inputs": {
            "model": ["25", 0], "seed": sd("shape"), "steps": s["shape"]["steps"],
            "cfg": s["shape"]["cfg"], "sampler_name": s["shape"]["sampler"],
            "scheduler": s["shape"]["scheduler"], "positive": ["50", 0],
            "negative": ["50", 1], "latent_image": ["50", 2], "denoise": 1.0}},
        # ---- upsample stage
        "60": {"class_type": "Trellis2UpsampleStage", "inputs": {
            "positive": ["50", 0], "negative": ["50", 1], "shape_latent": ["51", 0],
            "vae": ["30", 0], "target_resolution": s["upsample"]["target_resolution"]}},
        "61": {"class_type": "KSampler", "inputs": {
            "model": ["25", 0], "seed": sd("upsample"), "steps": s["upsample"]["steps"],
            "cfg": s["upsample"]["cfg"], "sampler_name": s["upsample"]["sampler"],
            "scheduler": s["upsample"]["scheduler"], "positive": ["60", 0],
            "negative": ["60", 1], "latent_image": ["60", 2], "denoise": 1.0}},
        "62": {"class_type": "VaeDecodeShapeTrellis",
               "inputs": {"samples": ["61", 0], "vae": ["30", 0]}},
        # ---- texture stage
        "70": {"class_type": "Trellis2TextureStage", "inputs": {
            "positive": ["60", 0], "negative": ["60", 1], "shape_latent": ["61", 0]}},
        "71": {"class_type": "KSampler", "inputs": {
            "model": ["20", 0], "seed": sd("texture"), "steps": s["texture"]["steps"],
            "cfg": s["texture"]["cfg"], "sampler_name": s["texture"]["sampler"],
            "scheduler": s["texture"]["scheduler"], "positive": ["70", 0],
            "negative": ["70", 1], "latent_image": ["70", 2], "denoise": 1.0}},
        "72": {"class_type": "VaeDecodeTextureTrellis", "inputs": {
            "samples": ["71", 0], "vae": ["31", 0], "shape_subdivides": ["62", 1]}},
        # ---- mesh post-processing (shared trunk)
        "80": {"class_type": "GetMeshInfo", "inputs": {"mesh": ["62", 0]}},
        "81": {"class_type": "RemeshMesh", "inputs": {
            "mesh": ["80", 0],
            "resolution": s["remesh"]["resolution"],
            "sign_mode": s["remesh"]["sign_mode"],
            "sign_mode.qef": s["remesh"]["qef"],
            "sign_mode.drop_inverted_components": s["remesh"]["drop_inverted_components"],
            "sign_mode.drop_enclosed_components": s["remesh"]["drop_enclosed_components"],
            "band": s["remesh"]["band"], "project_back": s["remesh"]["project_back"],
            "fix_poles": s["remesh"]["fix_poles"],
            "smooth_iters": s["remesh"]["smooth_iters"],
            "drop_small_components": s["remesh"]["drop_small_components"],
            "precluster_max_verts": s["remesh"]["precluster_max_verts"]}},

        # ---- branch A: sculpt budget, vertex colours, no atlas (the "raw" file)
        "90": {"class_type": "DecimateMesh", "inputs": {
            "mesh": ["81", 0], "target_face_count": sculpt_faces,
            "placement_mode": "midpoint"}},
        "91": {"class_type": "GetMeshInfo", "inputs": {"mesh": ["90", 0]}},
        "92": {"class_type": "PreviewAny", "inputs": {"source": ["91", 1]}},
        "93": {"class_type": "MeshSmoothNormals", "inputs": {
            "mesh": ["91", 0], "crease_angle": s["smooth_normals"]["crease_angle"]}},
        "94": {"class_type": "PaintMesh", "inputs": {"mesh": ["93", 0], "voxel_colors": ["72", 0]}},
        "95": {"class_type": "MeshToFile3D", "inputs": {"mesh": ["94", 0]}},
        "96": {"class_type": "SaveGLB", "inputs": {
            "mesh": ["95", 0], "filename_prefix": f"3d/{name}-sculpt"}},

        # ---- branch B: game budget, unwrapped and PBR-baked (the shippable file)
        "100": {"class_type": "DecimateMesh", "inputs": {
            "mesh": ["81", 0], "target_face_count": game_faces,
            "placement_mode": "midpoint"}},
        "101": {"class_type": "GetMeshInfo", "inputs": {"mesh": ["100", 0]}},
        "102": {"class_type": "PreviewAny", "inputs": {"source": ["101", 1]}},
        "103": {"class_type": "MeshSmoothNormals", "inputs": {
            "mesh": ["101", 0], "crease_angle": s["smooth_normals"]["crease_angle"]}},
        "104": {"class_type": "UnwrapMesh", "inputs": {
            "mesh": ["103", 0], "segmenter": s["unwrap"]["segmenter"],
            "resolution": atlas, "padding": s["unwrap"]["padding"],
            "weld_distance": s["unwrap"]["weld_distance"]}},
        "105": {"class_type": "BakeTextureFromVoxel", "inputs": {
            "mesh": ["104", 0], "voxel_colors": ["72", 0], "texture_size": atlas,
            "reference_mesh": ["62", 0]}},
        "106": {"class_type": "BakeNormalMapFromMesh", "inputs": {
            "low_poly": ["104", 0], "high_poly": ["81", 0], "resolution": atlas,
            "cage_distance": s["normal_bake"]["cage_distance"],
            "ignore_backfaces": s["normal_bake"]["ignore_backfaces"]}},
        "107": {"class_type": "BakeAmbientOcclusion", "inputs": {
            "low_poly": ["104", 0], "high_poly": ["81", 0], **s["ao_bake"]}},
        "108": {"class_type": "ApplyTextureToMesh", "inputs": {
            "mesh": ["104", 0], "base_color": ["105", 0], "metallic": ["105", 1],
            "roughness": ["105", 2], "occlusion": ["107", 0], "normal_map": ["106", 0]}},
        "109": {"class_type": "MeshSmoothNormals", "inputs": {
            "mesh": ["108", 0], "crease_angle": s["smooth_normals"]["crease_angle"]}},
        "110": {"class_type": "MeshToFile3D", "inputs": {"mesh": ["109", 0]}},
        "111": {"class_type": "SaveGLB", "inputs": {
            "mesh": ["110", 0], "filename_prefix": f"3d/{name}-game"}},
        # maps out as images so the atlas can be inspected without the GLB
        "112": {"class_type": "SaveImage", "inputs": {
            "images": ["105", 0], "filename_prefix": f"{name}-basecolor"}},
        "113": {"class_type": "SaveImage", "inputs": {
            "images": ["106", 0], "filename_prefix": f"{name}-normal"}},
        "114": {"class_type": "SaveImage", "inputs": {
            "images": ["107", 0], "filename_prefix": f"{name}-ao"}},
        "115": {"class_type": "RenderUVAtlas", "inputs": {
            "mesh": ["104", 0], "resolution": 1024}},
        "116": {"class_type": "SaveImage", "inputs": {
            "images": ["115", 0], "filename_prefix": f"{name}-uvatlas"}},
        "117": {"class_type": "SaveImage", "inputs": {
            "images": ["13", 0], "filename_prefix": f"{name}-cropinput"}},
    }
    return wf


# ------------------------------------------------------------------- subcommands ---
def cmd_concept(a) -> None:
    pf = preflight(a.min_free_vram, a.wait_poll, a.wait_max)
    seed = a.seed if a.seed is not None else int.from_bytes(
        hashlib.sha256(a.prompt.encode()).digest()[:6], "big")
    wf = concept_workflow(a.prompt, a.width, a.height, seed, a.prefix)
    sampler = VramSampler(2.0)
    sampler.start()
    t0 = time.time()
    pid = submit(wf)
    entry = wait_for(pid, timeout=a.timeout, poll=2.0)
    sampler.stop()
    dt = time.time() - t0
    saved = None
    for out in entry.get("outputs", {}).values():
        for img in out.get("images", []):
            saved = fetch_output(img, a.out)
    if not saved:
        raise SystemExit("[trellis] concept finished but produced no image")
    receipt = {
        "stage": "concept", "route": "comfyui-local", "generator": "qwen-image-2512",
        "comfyuiVersion": pf["comfyuiVersion"], "promptId": pid,
        "prompt": a.prompt, "negativePrompt": "(none - cfg 1.0, Lightning 4-step)",
        "width": a.width, "height": a.height, "seed": seed, "steps": 4, "cfg": 1.0,
        "sampler": "euler", "scheduler": "simple", "guidance": 3.5,
        "unet": CONCEPT_UNET, "clip": CONCEPT_CLIP, "vae": CONCEPT_VAE, "lora": CONCEPT_LORA,
        "output": saved.replace("\\", "/"), "sha256": sha256_file(saved),
        "wallSeconds": round(dt, 1), "peakVramMiB": sampler.peak,
        "vramSamplesMiB": sampler.samples,
    }
    if a.receipt:
        with open(a.receipt, "w", encoding="utf-8", newline="\n") as f:
            json.dump(receipt, f, indent=2)
    print(json.dumps({k: v for k, v in receipt.items() if k != "vramSamplesMiB"}, indent=2))


def cmd_mesh(a) -> None:
    pf = preflight(a.min_free_vram, a.wait_poll, a.wait_max)
    server_name = upload_image(a.image)
    wf = trellis_workflow(server_name, a.name, a.sculpt_faces, a.game_faces,
                          a.atlas, a.seed_offset, a.ao_distance, a.cage_distance)
    os.makedirs(a.out_dir, exist_ok=True)
    with open(os.path.join(a.out_dir, f"{a.name}-graph.json"), "w",
              encoding="utf-8", newline="\n") as f:
        json.dump(wf, f, indent=2)

    sampler = VramSampler(a.vram_interval)
    sampler.start()
    t0 = time.time()
    pid = submit(wf)
    print(f"[trellis] submitted {pid}; hard cap {a.timeout}s", flush=True)

    def tick(elapsed):
        print(f"[trellis] {elapsed:6.0f}s  vram_used={nvidia_used_mib()} MiB  "
              f"peak={sampler.peak} MiB", flush=True)

    try:
        entry = wait_for(pid, timeout=a.timeout, poll=a.poll, on_tick=tick)
    finally:
        sampler.stop()
    dt = time.time() - t0

    # Collect EVERYTHING in the same step it is produced: the owner's output
    # folder is swept every two hours.
    collected = {"glb": [], "images": [], "text": []}
    for node_id, out in entry.get("outputs", {}).items():
        for item in out.get("3d", []):
            dest = os.path.join(a.out_dir, item["filename"])
            fetch_output(item, dest)
            collected["glb"].append({"node": node_id, "path": dest.replace("\\", "/"),
                                     "bytes": os.path.getsize(dest),
                                     "sha256": sha256_file(dest)})
        for item in out.get("images", []):
            dest = os.path.join(a.out_dir, item["filename"])
            fetch_output(item, dest)
            collected["images"].append({"node": node_id, "path": dest.replace("\\", "/"),
                                        "bytes": os.path.getsize(dest)})
        if out.get("text"):
            collected["text"].append({"node": node_id, "text": out["text"]})

    receipt = {
        "stage": "mesh", "route": "comfyui-native-3d", "generator": "trellis2",
        "comfyuiVersion": pf["comfyuiVersion"], "device": pf["device"],
        "modelsDirectoryFlag": pf["modelsDirectoryFlag"],
        "promptId": pid, "conceptImage": a.image.replace("\\", "/"),
        "conceptImageSha256": sha256_file(a.image),
        "serverInputName": server_name,
        "weights": pf["weightsListedByServer"],
        "parameters": TPL, "seedOffset": a.seed_offset,
        "aoMaxDistanceOverride": a.ao_distance, "cageDistanceOverride": a.cage_distance,
        "sculptFaceTarget": a.sculpt_faces, "gameFaceTarget": a.game_faces,
        "atlasResolution": a.atlas,
        "wallSeconds": round(dt, 1),
        "peakVramMiB": sampler.peak, "vramSamplesMiB": sampler.samples,
        "collected": collected,
    }
    rec = a.receipt or os.path.join(a.out_dir, f"{a.name}-receipt.json")
    with open(rec, "w", encoding="utf-8", newline="\n") as f:
        json.dump(receipt, f, indent=2)
    print(json.dumps({k: v for k, v in receipt.items()
                      if k not in ("vramSamplesMiB", "parameters", "weights")}, indent=2))
    print(f"[trellis] receipt -> {rec}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--min-free-vram", type=int, default=8192,
                       help="MiB of free VRAM required before submitting (default 8192)")
        p.add_argument("--wait-poll", type=float, default=60.0)
        p.add_argument("--wait-max", type=float, default=1200.0)

    p = sub.add_parser("preflight")
    common(p)
    p.set_defaults(func=lambda a: preflight(a.min_free_vram, a.wait_poll, a.wait_max))

    p = sub.add_parser("concept")
    common(p)
    p.add_argument("--prompt", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--prefix", default="heroprop_concept")
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=1024)
    p.add_argument("--seed", type=int)
    p.add_argument("--timeout", type=float, default=600.0)
    p.add_argument("--receipt")
    p.set_defaults(func=cmd_concept)

    p = sub.add_parser("mesh")
    common(p)
    p.add_argument("--image", required=True, help="local concept PNG")
    p.add_argument("--name", default="heroprop")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--sculpt-faces", type=int, default=700000,
                   help="template default; the SCULPT budget, not a game budget")
    p.add_argument("--game-faces", type=int, default=3000)
    p.add_argument("--atlas", type=int, default=2048)
    p.add_argument("--seed-offset", type=int, default=0)
    p.add_argument("--ao-distance", type=float,
                   help="BakeAmbientOcclusion max_distance. The template ships 0.71, "
                        "which is 71%% of a unit-scale object: every ray reaches the far "
                        "side and the atlas bakes almost solid black. Use ~0.03 for a "
                        "crate-sized prop and LOOK at the atlas.")
    p.add_argument("--cage-distance", type=float,
                   help="BakeNormalMapFromMesh cage_distance (template 0.05).")
    p.add_argument("--poll", type=float, default=15.0)
    p.add_argument("--vram-interval", type=float, default=5.0)
    p.add_argument("--timeout", type=float, default=1800.0, help="HARD CAP, seconds")
    p.add_argument("--receipt")
    p.set_defaults(func=cmd_mesh)

    a = ap.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
