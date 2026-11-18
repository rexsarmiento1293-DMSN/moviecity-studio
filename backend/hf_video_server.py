#!/usr/bin/env python3
"""
3!2!1! Akzyon — Hugging Face Text-to-Video Backend (Python / FastAPI)
=====================================================================
Uses the official `huggingface_hub` SDK (`InferenceClient.text_to_video`)
to generate Filipino teleserye / short-film scenes from:
- Scene text (`sceneText` or `scenes` list)
- Character profile (`name`, `appearance`, `style`)
- Visual effect preset (`effectId` / `visualEffect`)

Environment Variables:
- HF_TOKEN        (Required) Hugging Face User Access Token (never sent to browser)
- HF_VIDEO_MODEL  (Optional) Hugging Face text-to-video model ID
                  Default: Wan-AI/Wan2.1-T2V-14B
                  Alternatives: Lightricks/LTX-Video, ali-vilab/text-to-video-ms-1.7b
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from huggingface_hub import HfApi, InferenceClient
from huggingface_hub.utils import HfHubHTTPError
from pydantic import BaseModel, Field

load_dotenv()

DEFAULT_HF_VIDEO_MODEL = "Wan-AI/Wan2.1-T2V-14B"
RECOMMENDED_HF_VIDEO_MODELS = [
    "Wan-AI/Wan2.1-T2V-14B",
    "Lightricks/LTX-Video",
    "ali-vilab/text-to-video-ms-1.7b",
]

VISUAL_EFFECT_MODIFIERS: Dict[str, str] = {
    "manila-noir": "Manila rain noir, wet asphalt reflections, high contrast chiaroscuro, 35mm lens",
    "golden-teleserye": "warm golden hour sunset glow, emotional soft focus, cinematic flare",
    "neon-cyber": "cyberpunk Manila neon signs, magenta and cyan rim lighting, anamorphic lens",
    "vintage-pelikula": "1980s classic Filipino cinema, warm sepia grain, halation",
}

TEMP_VIDEO_DIR = Path(tempfile.gettempdir()) / "akzyon_hf_videos"
TEMP_VIDEO_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="3!2!1! Akzyon Hugging Face Video Backend",
    version="1.0.0",
    description="Text-to-video backend powered by huggingface_hub InferenceClient.text_to_video",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-HF-Model", "X-Video-Url", "X-Temp-File", "X-Scene-Count"],
)


class CharacterProfilePayload(BaseModel):
    name: str = Field(default="Clara Montes")
    appearance: str = Field(default="26yo Filipina lead, long wavy dark hair, emerald dress")
    style: str = Field(default="Cinematic moody lighting, 35mm film grain")


class SceneItemPayload(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = None
    scriptText: Optional[str] = None
    text: Optional[str] = None
    effectId: Optional[str] = None
    durationSec: Optional[int] = 5


class GenerateVideoRequest(BaseModel):
    sceneText: Optional[str] = None
    prompt: Optional[str] = None
    scenes: Optional[List[SceneItemPayload]] = None
    characterProfile: Optional[CharacterProfilePayload] = None
    character: Optional[CharacterProfilePayload] = None
    effectId: Optional[str] = "manila-noir"
    visualEffect: Optional[str] = None
    model: Optional[str] = None


def build_scene_prompt(
    scene_text: str,
    character: CharacterProfilePayload,
    effect_id: str,
) -> str:
    effect_mod = VISUAL_EFFECT_MODIFIERS.get(
        effect_id, VISUAL_EFFECT_MODIFIERS["manila-noir"]
    )
    return (
        f"[Character Profile: {character.name}, {character.appearance} | "
        f"Visual Style: {character.style} | FX Preset: {effect_mod}] "
        f"Scene Action: {scene_text.strip()}"
    )


def classify_hf_error(status_code: int, raw_message: str, model_id: str) -> Dict[str, object]:
    lower = (raw_message or "").lower()
    if status_code == 401 or "missing hf_token" in lower:
        if "missing" in lower:
            return {
                "http_status": 401,
                "code": "HF_TOKEN_MISSING",
                "error": (
                    "Walang HF_TOKEN sa server environment. I-set ang HF_TOKEN "
                    "(hal. export HF_TOKEN='hf_xxx') bago patakbuhin ang server."
                ),
            }
        return {
            "http_status": 401,
            "code": "HF_TOKEN_INVALID",
            "error": (
                "Di-wastong Hugging Face token (HTTP 401). Pakisuri kung tama at "
                "aktibo ang HF_TOKEN sa server."
            ),
        }
    if status_code == 403:
        return {
            "http_status": 403,
            "code": "HF_TOKEN_UNAUTHORIZED",
            "error": (
                f"Walang pahintulot ang HF_TOKEN para sa model na '{model_id}' (HTTP 403). "
                "Siguraduhing may 'Make calls to Inference Providers' permission ang token."
            ),
        }
    if status_code == 429 or "rate limit" in lower or "too many requests" in lower:
        return {
            "http_status": 429,
            "code": "HF_RATE_LIMIT",
            "error": (
                f"Naabot na ang Hugging Face Inference rate limit para sa '{model_id}' "
                "(HTTP 429). Maghintay ng ilang sandali at subukan muli."
            ),
        }
    if (
        status_code in (404, 503)
        or "not found" in lower
        or "currently loading" in lower
        or "unavailable" in lower
    ):
        return {
            "http_status": 503 if status_code == 503 else 404,
            "code": "HF_MODEL_UNAVAILABLE",
            "error": (
                f"Ang model na '{model_id}' ay hindi available o kasalukuyang naglo-load "
                f"sa Hugging Face Inference API (HTTP {status_code}). Maaaring palitan ang "
                "HF_VIDEO_MODEL environment variable."
            ),
        }
    return {
        "http_status": status_code if 400 <= status_code < 600 else 502,
        "code": "HF_SERVER_ERROR",
        "error": f"Hugging Face Inference error para sa '{model_id}': {raw_message}",
    }


@app.get("/api/generate-video/status")
async def get_video_backend_status(checkRemote: bool = False):
    hf_token = (os.environ.get("HF_TOKEN") or "").strip()
    hf_video_model = (
        os.environ.get("HF_VIDEO_MODEL") or DEFAULT_HF_VIDEO_MODEL
    ).strip()

    model_available = None
    pipeline_tag = None
    inference_status = "unverified"

    if checkRemote:
        try:
            api = HfApi(token=hf_token or None)
            info = api.model_info(hf_video_model)
            model_available = not getattr(info, "disabled", False)
            pipeline_tag = getattr(info, "pipeline_tag", "text-to-video")
            inference_status = getattr(info, "inference", "available")
        except Exception as exc:
            model_available = False
            inference_status = f"error: {exc}"

    return {
        "ok": True,
        "tokenConfigured": bool(hf_token),
        "tokenEnvVar": "HF_TOKEN",
        "modelEnvVar": "HF_VIDEO_MODEL",
        "activeModel": hf_video_model,
        "defaultModel": DEFAULT_HF_VIDEO_MODEL,
        "recommendedModels": RECOMMENDED_HF_VIDEO_MODELS,
        "modelAvailable": model_available,
        "pipelineTag": pipeline_tag,
        "inferenceStatus": inference_status,
        "howToCheckAvailability": (
            f"curl -s https://huggingface.co/api/models/{hf_video_model} "
            "| jq '{id: .id, pipeline_tag: .pipeline_tag, inference: .inference}'"
        ),
    }


@app.get("/api/generate-video/temp/{file_name}")
async def get_temp_video_file(file_name: str):
    safe_name = Path(file_name).name
    target = TEMP_VIDEO_DIR / safe_name
    if not safe_name.endswith(".mp4") or not target.exists():
        raise HTTPException(status_code=404, detail="Temporary video file not found.")
    return FileResponse(target, media_type="video/mp4")


@app.post("/api/generate-video")
async def generate_video(payload: GenerateVideoRequest, request: Request):
    hf_token = (os.environ.get("HF_TOKEN") or "").strip()
    hf_video_model = (
        payload.model
        or os.environ.get("HF_VIDEO_MODEL")
        or DEFAULT_HF_VIDEO_MODEL
    ).strip()

    character = payload.characterProfile or payload.character or CharacterProfilePayload()
    effect_id = (payload.effectId or payload.visualEffect or "manila-noir").strip()

    # Build list of scenes
    raw_scenes: List[SceneItemPayload] = []
    if payload.scenes and len(payload.scenes) > 0:
        raw_scenes = payload.scenes
    else:
        single_text = (payload.sceneText or payload.prompt or "").strip()
        if not single_text:
            return JSONResponse(
                status_code=400,
                content={
                    "ok": False,
                    "code": "MISSING_SCENE_TEXT",
                    "error": "Maglagay ng sceneText o scenes array bago mag-generate ng video.",
                },
            )
        raw_scenes = [SceneItemPayload(id="sc-1", title="Eksena 1", scriptText=single_text, effectId=effect_id)]

    scene_prompts = []
    for idx, sc in enumerate(raw_scenes):
        text_val = (sc.scriptText or sc.text or payload.sceneText or payload.prompt or "").strip()
        sc_effect = (sc.effectId or effect_id).strip()
        prompt_str = build_scene_prompt(text_val, character, sc_effect)
        scene_prompts.append(
            {
                "sceneId": sc.id or f"sc-{idx + 1}",
                "sceneNumber": idx + 1,
                "title": sc.title or f"Eksena {idx + 1}",
                "prompt": prompt_str,
            }
        )

    if not hf_token:
        classified = classify_hf_error(401, "Missing HF_TOKEN", hf_video_model)
        return JSONResponse(
            status_code=int(classified["http_status"]),
            content={
                "ok": False,
                "code": classified["code"],
                "model": hf_video_model,
                "scenePrompts": scene_prompts,
                "error": classified["error"],
            },
        )

    # Official huggingface_hub InferenceClient with text_to_video task
    client = InferenceClient(api_key=hf_token)
    temp_scene_files: List[Path] = []

    for idx, sp in enumerate(scene_prompts):
        try:
            video_bytes: bytes = client.text_to_video(
                prompt=sp["prompt"],
                model=hf_video_model,
            )
        except HfHubHTTPError as http_err:
            status_code = getattr(http_err.response, "status_code", 502)
            classified = classify_hf_error(status_code, str(http_err), hf_video_model)
            return JSONResponse(
                status_code=int(classified["http_status"]),
                content={
                    "ok": False,
                    "code": classified["code"],
                    "model": hf_video_model,
                    "failedSceneIndex": idx + 1,
                    "scenePrompts": scene_prompts,
                    "error": classified["error"],
                },
            )
        except Exception as exc:
            classified = classify_hf_error(503, str(exc), hf_video_model)
            return JSONResponse(
                status_code=int(classified["http_status"]),
                content={
                    "ok": False,
                    "code": classified["code"],
                    "model": hf_video_model,
                    "failedSceneIndex": idx + 1,
                    "scenePrompts": scene_prompts,
                    "error": classified["error"],
                },
            )

        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=f"_scene_{idx + 1}.mp4",
            prefix="akzyon_hf_",
            dir=TEMP_VIDEO_DIR,
            delete=False,
        ) as tmp_file:
            tmp_file.write(video_bytes)
            temp_scene_files.append(Path(tmp_file.name))

    # Combine or copy into final temporary MP4 file
    with tempfile.NamedTemporaryFile(
        mode="wb",
        suffix=".mp4",
        prefix="akzyon_hf_final_",
        dir=TEMP_VIDEO_DIR,
        delete=False,
    ) as final_tmp:
        final_path = Path(final_tmp.name)

    if len(temp_scene_files) == 1:
        shutil.copyfile(temp_scene_files[0], final_path)
    else:
        concat_list = TEMP_VIDEO_DIR / f"{final_path.stem}_concat.txt"
        concat_list.write_text(
            "\n".join(f"file '{p.as_posix()}'" for p in temp_scene_files),
            encoding="utf-8",
        )
        proc = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_list),
                "-c",
                "copy",
                str(final_path),
            ],
            capture_output=True,
            timeout=20,
        )
        if proc.returncode != 0 or not final_path.exists():
            shutil.copyfile(temp_scene_files[0], final_path)

    video_url = f"/api/generate-video/temp/{final_path.name}"
    headers = {
        "X-HF-Model": hf_video_model,
        "X-Video-Url": video_url,
        "X-Temp-File": str(final_path),
        "X-Scene-Count": str(len(scene_prompts)),
    }

    accept = (request.headers.get("accept") or "").lower()
    if "application/json" in accept and "video/mp4" not in accept:
        return JSONResponse(
            content={
                "ok": True,
                "model": hf_video_model,
                "videoUrl": video_url,
                "tempFile": str(final_path),
                "sceneCount": len(scene_prompts),
                "scenePrompts": scene_prompts,
            },
            headers=headers,
        )

    return FileResponse(
        path=final_path,
        media_type="video/mp4",
        filename=final_path.name,
        headers=headers,
    )


@app.get("/", response_class=HTMLResponse)
async def serve_single_file_html():
    html_path = Path(__file__).resolve().parent.parent / "public" / "ai-drama-studio.html"
    if html_path.exists():
        return HTMLResponse(html_path.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>3!2!1! Akzyon Hugging Face Video Backend Running</h1>")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
