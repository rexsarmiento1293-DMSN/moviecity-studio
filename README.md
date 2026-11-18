# 3!2!1! Akzyon — Filipino Teleserye & Short Film Generator (Hugging Face Text-to-Video Backend)

This project replaces the simulated `generateWithAPI()` in **3!2!1! Akzyon** with a real backend that calls the **Hugging Face Inference API** for text-to-video generation (`POST /api/generate-video`), saves each generated video to a temporary `.mp4` file, streams it back as `video/mp4`, stores the blob in **IndexedDB**, and plays it in the `<video>` element via `URL.createObjectURL`.

---

## 1. Chosen Open-Source Text-to-Video Model & How to Check Availability

- **Default Model (`HF_VIDEO_MODEL`)**: `Wan-AI/Wan2.1-T2V-14B`
  - Open-source Apache-2.0 text-to-video foundation model served on Hugging Face Inference Providers (`text-to-video` pipeline).
- **Supported Alternative Open-Source Models** (switchable at any time via `export HF_VIDEO_MODEL=...` without code changes):
  - `Lightricks/LTX-Video`
  - `ali-vilab/text-to-video-ms-1.7b`

### How to Check Model Availability on Hugging Face

1. **Via the Hugging Face Model Hub API (`curl`)**:
   ```bash
   curl -s https://huggingface.co/api/models/Wan-AI/Wan2.1-T2V-14B \
     | jq '{id: .id, pipeline_tag: .pipeline_tag, disabled: .disabled, inference: .inference}'
   ```
2. **Via the Backend Status Endpoint**:
   ```bash
   curl -s "http://localhost:3000/api/generate-video/status?checkRemote=1" | jq .
   ```

---

## 2. Local Setup Steps

You can run either the **Python / FastAPI** backend (`backend/hf_video_server.py`, using the official `huggingface_hub` `InferenceClient.text_to_video` SDK) or the integrated **Node.js / Express** server (`server.ts`).

### Option A: Python / FastAPI Backend (`huggingface_hub` `InferenceClient`)

```bash
# 1. Install Python dependencies
pip install -r backend/requirements.txt
# (or: pip install fastapi "uvicorn[standard]" huggingface_hub pydantic python-dotenv)

# 2. Export your Hugging Face token (NEVER put this in HTML or frontend code)
export HF_TOKEN="hf_your_access_token_here"

# 3. (Optional) Configure the open-source text-to-video model
export HF_VIDEO_MODEL="Wan-AI/Wan2.1-T2V-14B"

# 4. Run the FastAPI server (serves both POST /api/generate-video and the HTML app at /)
python3 backend/hf_video_server.py
```

### Option B: Node.js / Express Full-Stack Server

```bash
# 1. Install Node dependencies
npm install

# 2. Export your Hugging Face token and desired model
export HF_TOKEN="hf_your_access_token_here"
export HF_VIDEO_MODEL="Wan-AI/Wan2.1-T2V-14B"

# 3. Start the server on http://localhost:3000
npm run dev
```

---

## 3. Test Commands Using `curl`

### A. Check Backend & Model Configuration Status
```bash
curl -s http://localhost:3000/api/generate-video/status | jq .
```

### B. Generate an MP4 Video from Scene Text, Character Profile & Visual FX Preset
```bash
curl -X POST http://localhost:3000/api/generate-video \
  -H "Content-Type: application/json" \
  -H "Accept: video/mp4" \
  -d '{
    "sceneText": "Nakatayo si Clara sa gitna ng malakas na ulan sa Escolta habang hawak ang liham.",
    "characterProfile": {
      "name": "Clara Montes",
      "appearance": "26yo Filipina lead, long wavy dark hair, emerald silk dress",
      "style": "Cinematic moody lighting, 35mm film grain"
    },
    "effectId": "manila-noir"
  }' \
  --output test_akzyon_scene.mp4 -D -
```

- When `HF_TOKEN` is valid and the model is available, `test_akzyon_scene.mp4` is saved as a playable `video/mp4` file, and response headers include `X-HF-Model`, `X-Video-Url`, `X-Temp-File`, and `X-Scene-Count`.
- If `HF_TOKEN` is missing or invalid (`401`/`403`), the model is unavailable/loading (`404`/`503`), or the rate limit is reached (`429`), the endpoint returns a structured JSON error message explaining the exact issue.
