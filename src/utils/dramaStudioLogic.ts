import {
  CINEMATIC_SKILLS,
  buildCinematicPrompt,
  generateCinematicPromptFromAI,
} from '../skills/cinematicSkill';

export { CINEMATIC_SKILLS, buildCinematicPrompt, generateCinematicPromptFromAI };

export type ProjectStatus = 'Draft' | 'Generating' | 'Done';

export interface CharacterProfile {
  name: string;
  appearance: string;
  style: string;
}

export interface DramaScene {
  id: string;
  order: number;
  title: string;
  scriptText: string;
  visualPrompt: string;
  durationSec: number;
  thumbnailDataUrl: string;
  effectId: string;
  status: 'pending' | 'generating' | 'ready' | 'error';
}

export interface DramaProject {
  id: string;
  title: string;
  prompt: string;
  genre: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  thumbnailDataUrl: string;
  characterProfile: CharacterProfile;
  scenes: DramaScene[];
  selectedEffect: string;
  resolution: '480p' | '720p' | '1080p';
  includeAudio: boolean;
  generationMode: 'simulated' | 'real';
  combinedVideoIdbKey?: string;
}

export interface VisualEffectPreset {
  id: string;
  name: string;
  nameTl: string;
  description: string;
  descriptionTl: string;
  cssFilter: string;
  overlayColor: string;
  badge: string;
}

export const VISUAL_EFFECT_PRESETS: VisualEffectPreset[] = [
  {
    id: 'none',
    name: 'Natural Cinema',
    nameTl: 'Natural na Sinematograpiya',
    description: 'Clean studio color grading with balanced contrast and natural skin tones.',
    descriptionTl: 'Malinis na kulay at balanseng liwanag para sa natural na eksena.',
    cssFilter: 'contrast(1.04) saturate(1.05)',
    overlayColor: 'rgba(0,0,0,0)',
    badge: 'STD',
  },
  {
    id: 'manila-noir',
    name: 'Manila Rain Noir',
    nameTl: 'Manila Ulan Noir',
    description: 'High-contrast moody shadows with cool cyan rain reflections and dramatic vignette.',
    descriptionTl: 'Madilim at dramatikong anino na may malamig na kulay ng ulan sa gabi.',
    cssFilter: 'contrast(1.28) brightness(0.92) saturate(0.78)',
    overlayColor: 'rgba(14, 116, 144, 0.22)',
    badge: 'NOIR',
  },
  {
    id: 'golden-teleserye',
    name: 'Golden Hour Teleserye',
    nameTl: 'Ginintuang Teleserye',
    description: 'Warm sunset amber glow ideal for emotional confrontations and romantic scenes.',
    descriptionTl: 'Mainit na ginintuang liwanag ng dapithapon para sa emosyonal na eksena.',
    cssFilter: 'sepia(0.22) contrast(1.1) saturate(1.28) brightness(1.03)',
    overlayColor: 'rgba(245, 158, 11, 0.18)',
    badge: 'WARM',
  },
  {
    id: 'cyber-makati',
    name: 'Neon Cyber Drama',
    nameTl: 'Neon Cyber Drama',
    description: 'Vibrant magenta and electric blue rim lighting for modern thriller sequences.',
    descriptionTl: 'Matingkad na neon magenta at asul para sa modernong aksyon at thriller.',
    cssFilter: 'contrast(1.22) saturate(1.45) hue-rotate(-8deg)',
    overlayColor: 'rgba(168, 85, 247, 0.20)',
    badge: 'NEON',
  },
  {
    id: 'vintage-pelikula',
    name: 'Classic 35mm Pelikula',
    nameTl: 'Klasikong 35mm Pelikula',
    description: 'Warm analog film grain and soft highlight roll-off inspired by 80s Pinoy cinema.',
    descriptionTl: 'Klasikong tekstura ng pelikula noong dekada 80 na may malambot na liwanag.',
    cssFilter: 'sepia(0.35) contrast(1.15) brightness(0.96)',
    overlayColor: 'rgba(120, 53, 15, 0.20)',
    badge: '35MM',
  },
];

/**
 * Automatically injects the character profile (name, appearance, style) into a scene prompt
 * so that character visuals stay consistent across all generated scenes.
 */
export function buildCharacterConsistentPrompt(
  sceneText: string,
  character: CharacterProfile,
  effectId: string = 'none'
): string {
  const cleanScene = String(sceneText || '').trim();
  const parts: string[] = [];

  if (character.name.trim() || character.appearance.trim() || character.style.trim()) {
    const charDesc = [
      character.name.trim() ? `Character: ${character.name.trim()}` : '',
      character.appearance.trim() ? `Appearance: ${character.appearance.trim()}` : '',
      character.style.trim() ? `Style: ${character.style.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    parts.push(`[CONSISTENT CHARACTER LOCK — ${charDesc}]`);
  }

  const preset = VISUAL_EFFECT_PRESETS.find((p) => p.id === effectId);
  if (preset && preset.id !== 'none') {
    parts.push(`[FX: ${preset.name}]`);
  }

  parts.push(cleanScene || 'Dramatic close-up shot with cinematic lighting.');
  return parts.join(' ');
}

/**
 * Reorders an array of scenes when dragging/moving from `fromIndex` to `toIndex`,
 * and normalizes the 1-based `order` property.
 */
export function reorderScenes(
  scenes: DramaScene[],
  fromIndex: number,
  toIndex: number
): DramaScene[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= scenes.length ||
    toIndex >= scenes.length ||
    fromIndex === toIndex
  ) {
    return scenes.map((s, idx) => ({ ...s, order: idx + 1 }));
  }
  const clone = [...scenes];
  const [moved] = clone.splice(fromIndex, 1);
  clone.splice(toIndex, 0, moved);
  return clone.map((s, idx) => ({
    ...s,
    order: idx + 1,
  }));
}

/**
 * Calculates total duration in seconds across all scenes in a project.
 */
export function calculateTotalTimelineDuration(scenes: DramaScene[]): number {
  return scenes.reduce((acc, sc) => acc + Math.max(1, Number(sc.durationSec) || 0), 0);
}

/**
 * Builds an export-ready JSON payload for saving/sharing a project without embedding bloated raw video blobs.
 */
export function buildExportJsonStructure(project: DramaProject): string {
  const exportPayload = {
    schemaVersion: '2.0.0',
    exportedAt: new Date().toISOString(),
    application: '3!2!1! Akzyon',
    generationMode: project.generationMode,
    project: {
      id: project.id,
      title: project.title,
      prompt: project.prompt,
      genre: project.genre,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      resolution: project.resolution,
      includeAudio: project.includeAudio,
      selectedEffect: project.selectedEffect,
      characterProfile: project.characterProfile,
      totalDurationSec: calculateTotalTimelineDuration(project.scenes),
      scenes: project.scenes.map((s, idx) => ({
        id: s.id,
        order: idx + 1,
        title: s.title,
        scriptText: s.scriptText,
        consistentPrompt: buildCharacterConsistentPrompt(
          s.scriptText,
          project.characterProfile,
          s.effectId || project.selectedEffect
        ),
        durationSec: s.durationSec,
        effectId: s.effectId,
      })),
    },
  };
  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Generates an SVG data URL thumbnail for a scene or project so thumbnails are crisp,
 * lightweight in localStorage, and reflect the scene's title, character, and visual effect.
 */
export function generateSceneThumbnailDataUrl(params: {
  title: string;
  subtitle?: string;
  sceneNumber?: number;
  effectId?: string;
}): string {
  const safeTitle = String(params.title || '3!2!1! Akzyon Scene')
    .replace(/[<>&"']/g, '')
    .slice(0, 32);
  const safeSub = String(params.subtitle || 'Consistent Character Lock')
    .replace(/[<>&"']/g, '')
    .slice(0, 44);
  const badge = params.sceneNumber ? `SCENE 0${params.sceneNumber}` : '3!2!1! AKZYON';

  const palettes: Record<string, [string, string, string]> = {
    none: ['#0f172a', '#1e293b', '#f43f5e'],
    'manila-noir': ['#090d16', '#0e7490', '#38bdf8'],
    'golden-teleserye': ['#1c1917', '#78350f', '#f59e0b'],
    'cyber-makati': ['#1e1b4b', '#581c87', '#e879f9'],
    'vintage-pelikula': ['#1c1917', '#451a03', '#fb923c'],
  };
  const [c1, c2, accent] = palettes[params.effectId || 'none'] || palettes.none;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#bg)"/>
    <circle cx="520" cy="90" r="110" fill="${accent}" opacity="0.16"/>
    <circle cx="120" cy="290" r="140" fill="${accent}" opacity="0.1"/>
    <rect x="32" y="28" width="140" height="28" rx="6" fill="${accent}"/>
    <text x="102" y="47" fill="#ffffff" font-family="sans-serif" font-size="12" font-weight="bold" text-anchor="middle">${badge}</text>
    <text x="32" y="255" fill="#ffffff" font-family="sans-serif" font-size="28" font-weight="bold">${safeTitle}</text>
    <text x="32" y="288" fill="#cbd5e1" font-family="sans-serif" font-size="15">${safeSub}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const DEFAULT_HF_VIDEO_MODEL = 'Wan-AI/Wan2.1-T2V-14B';

export const RECOMMENDED_HF_VIDEO_MODELS = [
  'Wan-AI/Wan2.1-T2V-14B',
  'Wan-AI/Wan2.1-T2V-1.3B',
  'Lightricks/LTX-Video',
  'THUDM/CogVideoX-5b',
  'ali-vilab/text-to-video-ms-1.7b',
] as const;

export interface HfScenePromptItem {
  sceneIndex: number;
  sceneId: string;
  sceneTitle: string;
  sceneText: string;
  effectId: string;
  effectName: string;
  prompt: string;
}

/**
 * Builds one text-to-video prompt per scene combining scene text,
 * character profile (name, appearance, style), and visual effect preset.
 */
export function buildHfScenePrompts(
  scenes: Array<{
    id?: string;
    title?: string;
    scriptText?: string;
    text?: string;
    effectId?: string;
    durationSec?: number;
  }>,
  character: CharacterProfile,
  defaultEffectId: string = 'none'
): HfScenePromptItem[] {
  const safeScenes =
    Array.isArray(scenes) && scenes.length > 0
      ? scenes
      : [
          {
            id: 'sc-1',
            title: 'Eksena 1',
            scriptText: 'Dramatic Filipino teleserye confrontation in the rain at night.',
            effectId: defaultEffectId,
          },
        ];

  return safeScenes.map((sc, idx) => {
    const rawText = String(sc.scriptText || sc.text || sc.title || 'Dramatic scene').trim();
    const effectKey = sc.effectId || defaultEffectId || 'none';
    const preset =
      VISUAL_EFFECT_PRESETS.find((p) => p.id === effectKey) || VISUAL_EFFECT_PRESETS[0];
    const baseConsistent = buildCharacterConsistentPrompt(rawText, character, effectKey);
    const fullVideoPrompt = buildCinematicPrompt(
      'video',
      `${baseConsistent}. Visual Effect Preset: ${preset.name} (${preset.description})`
    );

    return {
      sceneIndex: idx + 1,
      sceneId: String(sc.id || `sc-${idx + 1}`),
      sceneTitle: String(sc.title || `Eksena ${idx + 1}`),
      sceneText: rawText,
      effectId: preset.id,
      effectName: preset.name,
      prompt: fullVideoPrompt,
    };
  });
}

/**
 * Classifies Hugging Face Inference API HTTP status codes and error payloads
 * into clear, actionable error messages for missing/invalid token, rate limits, and model availability.
 */
export function classifyHfInferenceError(
  status: number,
  rawMessage: string,
  modelName: string = DEFAULT_HF_VIDEO_MODEL
): {
  code: 'HF_TOKEN_MISSING' | 'HF_TOKEN_INVALID' | 'HF_RATE_LIMIT' | 'HF_MODEL_UNAVAILABLE' | 'HF_INFERENCE_ERROR';
  httpStatus: number;
  message: string;
  errorMessage: string;
} {
  const cleanMsg = String(rawMessage || '').trim();
  const lower = cleanMsg.toLowerCase();

  if (status === 401 && (lower.includes('missing') || lower.includes('walang hf_token'))) {
    const msg =
      cleanMsg ||
      `Walang HF_TOKEN sa server environment. I-set ang HF_TOKEN (hal. export HF_TOKEN="hf_xxx") bago patakbuhin ang server.`;
    return {
      code: 'HF_TOKEN_MISSING',
      httpStatus: 401,
      message: msg,
      errorMessage: msg,
    };
  }

  if (status === 401 || status === 403 || lower.includes('invalid username or password') || lower.includes('invalid token') || lower.includes('unauthorized')) {
    const msg = `Invalid o walang pahintulot ang HF_TOKEN para sa model na "${modelName}" (HTTP ${status}). Suriin ang iyong Hugging Face access token.${cleanMsg ? ` Detalye: ${cleanMsg}` : ''}`;
    return {
      code: 'HF_TOKEN_INVALID',
      httpStatus: status === 403 ? 403 : 401,
      message: msg,
      errorMessage: msg,
    };
  }

  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('quota')) {
    const msg = `Naabot na ang Hugging Face Inference API rate limit para sa "${modelName}" (HTTP 429). Maghintay ng ilang minuto o gumamit ng HF PRO token.${cleanMsg ? ` Detalye: ${cleanMsg}` : ''}`;
    return {
      code: 'HF_RATE_LIMIT',
      httpStatus: 429,
      message: msg,
      errorMessage: msg,
    };
  }

  if (
    status === 404 ||
    status === 503 ||
    lower.includes('not found') ||
    lower.includes('currently loading') ||
    lower.includes('model is loading') ||
    lower.includes('not available') ||
    lower.includes('does not exist')
  ) {
    const msg = `Ang Hugging Face text-to-video model na "${modelName}" ay kasalukuyang hindi available o naglo-load pa (HTTP ${status}). Subukan muli pagkalipas ng 30 segundo o palitan ang HF_VIDEO_MODEL.${cleanMsg ? ` Detalye: ${cleanMsg}` : ''}`;
    return {
      code: 'HF_MODEL_UNAVAILABLE',
      httpStatus: status === 404 ? 404 : 503,
      message: msg,
      errorMessage: msg,
    };
  }

  const fallbackMsg =
    cleanMsg ||
    `Nabigo ang Hugging Face text-to-video generation sa model na "${modelName}" (HTTP ${status}).`;
  return {
    code: 'HF_INFERENCE_ERROR',
    httpStatus: status >= 400 && status < 600 ? status : 502,
    message: fallbackMsg,
    errorMessage: fallbackMsg,
  };
}

/**
 * Calls the backend POST /api/generate-video endpoint powered by Hugging Face Inference API
 * (or prepares script/image scene prompts in earlier pipeline steps).
 * Never exposes HF_TOKEN to the browser.
 */
export async function generateWithAPI(params: {
  step: 'script' | 'images' | 'video' | 'finalize';
  prompt: string;
  characterProfile: CharacterProfile;
  effectId: string;
  scenes?: DramaScene[];
  shouldFailForTest?: boolean;
  fallbackOnMissingToken?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{
  mode: 'simulated' | 'real';
  providerLabel: string;
  scenes: DramaScene[];
  videoBlob?: Blob;
  videoUrl?: string;
  modelUsed?: string;
  scenePrompts?: HfScenePromptItem[];
}> {
  if (params.shouldFailForTest) {
    throw new Error(
      'Simulated API error: Naputol ang koneksyon habang ginagawa ang eksena. Pindutin ang Retry.'
    );
  }

  const baseScenes: DramaScene[] =
    params.scenes && params.scenes.length > 0
      ? params.scenes
      : [
          {
            id: `sc-${Date.now()}-1`,
            order: 1,
            title: 'Unang Paghaharap sa Ulan',
            scriptText: `${params.characterProfile.name || 'Bida'} humarap sa kalaban sa gitna ng malakas na ulan: "${params.prompt.slice(0, 70)}"`,
            visualPrompt: buildCharacterConsistentPrompt(
              `Establishing dramatic shot: ${params.prompt}`,
              params.characterProfile,
              params.effectId
            ),
            durationSec: 4,
            thumbnailDataUrl: generateSceneThumbnailDataUrl({
              title: 'Eksena 1: Ang Paghaharap',
              subtitle: params.characterProfile.name || 'Lead Character',
              sceneNumber: 1,
              effectId: params.effectId,
            }),
            effectId: params.effectId,
            status: 'ready',
          },
          {
            id: `sc-${Date.now()}-2`,
            order: 2,
            title: 'Rebelasyon ng Lihim',
            scriptText: `Close-up shot habang binubunyag ang matagal nang lihim ng pamilya.`,
            visualPrompt: buildCharacterConsistentPrompt(
              `Emotional close-up shot revealing the truth`,
              params.characterProfile,
              params.effectId
            ),
            durationSec: 5,
            thumbnailDataUrl: generateSceneThumbnailDataUrl({
              title: 'Eksena 2: Ang Rebelasyon',
              subtitle: params.characterProfile.appearance || 'Consistent Look',
              sceneNumber: 2,
              effectId: params.effectId,
            }),
            effectId: params.effectId,
            status: 'ready',
          },
          {
            id: `sc-${Date.now()}-3`,
            order: 3,
            title: 'Pangwakas na Desisyon',
            scriptText: `Wide cinematic shot habang naglalakad palayo sa ilalim ng ilaw ng siyudad.`,
            visualPrompt: buildCharacterConsistentPrompt(
              `Wide cinematic finale shot walking toward horizon`,
              params.characterProfile,
              params.effectId
            ),
            durationSec: 4,
            thumbnailDataUrl: generateSceneThumbnailDataUrl({
              title: 'Eksena 3: Ang Desisyon',
              subtitle: params.characterProfile.style || 'Cinematic Finale',
              sceneNumber: 3,
              effectId: params.effectId,
            }),
            effectId: params.effectId,
            status: 'ready',
          },
        ];

  const cinematicType =
    params.step === 'images' ? 'image' : params.step === 'video' ? 'video' : 'script';

  const updated = baseScenes.map((sc, idx) => {
    const baseConsistent = buildCharacterConsistentPrompt(
      sc.scriptText,
      params.characterProfile,
      sc.effectId || params.effectId
    );
    return {
      ...sc,
      order: idx + 1,
      visualPrompt:
        cinematicType === 'image' || cinematicType === 'video'
          ? buildCinematicPrompt(cinematicType, baseConsistent)
          : baseConsistent,
      thumbnailDataUrl:
        sc.thumbnailDataUrl ||
        generateSceneThumbnailDataUrl({
          title: sc.title,
          subtitle: params.characterProfile.name,
          sceneNumber: idx + 1,
          effectId: sc.effectId || params.effectId,
        }),
      status: 'ready' as const,
    };
  });

  const scenePrompts = buildHfScenePrompts(
    updated,
    params.characterProfile,
    params.effectId
  );

  // When step === 'video' and we are in a browser (or a custom fetchImpl is provided),
  // call POST /api/generate-video to generate the video via Hugging Face Inference API.
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  if (params.step === 'video' && (isBrowser || params.fetchImpl)) {
    const fetcher = params.fetchImpl || fetch;
    const response = await fetcher('/api/generate-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'video/mp4, application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        sceneText: updated.map((s) => s.scriptText).join(' | '),
        scenes: updated.map((s) => ({
          id: s.id,
          title: s.title,
          scriptText: s.scriptText,
          durationSec: s.durationSec,
          effectId: s.effectId || params.effectId,
        })),
        characterProfile: params.characterProfile,
        effectId: params.effectId,
        fallbackOnMissingToken: Boolean(params.fallbackOnMissingToken),
      }),
    });

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        errMsg = errJson.error || errJson.detail || errJson.message || errMsg;
      } catch {
        try {
          errMsg = (await response.text()) || errMsg;
        } catch {}
      }
      throw new Error(errMsg);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const modelHeader =
      response.headers.get('x-hf-model') || DEFAULT_HF_VIDEO_MODEL;
    const videoUrlHeader = response.headers.get('x-video-url') || undefined;

    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (data.ok === false || data.error) {
        throw new Error(data.error || 'Nabigo ang pag-generate ng video sa /api/generate-video.');
      }
      if (data.videoUrl) {
        const vidRes = await fetcher(data.videoUrl);
        if (!vidRes.ok) {
          throw new Error(`Hindi ma-download ang generated video mula sa ${data.videoUrl}`);
        }
        const blob = await vidRes.blob();
        const videoBlob =
          blob.type === 'video/mp4' ? blob : new Blob([blob], { type: 'video/mp4' });
        return {
          mode: 'real',
          providerLabel: `Hugging Face Inference (${data.model || modelHeader})`,
          scenes: updated,
          videoBlob,
          videoUrl: data.videoUrl,
          modelUsed: data.model || modelHeader,
          scenePrompts,
        };
      }
    }

    const rawBlob = await response.blob();
    const videoBlob =
      rawBlob.type === 'video/mp4'
        ? rawBlob
        : new Blob([rawBlob], { type: 'video/mp4' });

    return {
      mode: 'real',
      providerLabel: `Hugging Face Inference (${modelHeader})`,
      scenes: updated,
      videoBlob,
      videoUrl: videoUrlHeader,
      modelUsed: modelHeader,
      scenePrompts,
    };
  }

  await new Promise((r) => setTimeout(r, 250));
  return {
    mode: 'real',
    providerLabel: `Hugging Face Inference Ready (${DEFAULT_HF_VIDEO_MODEL})`,
    scenes: updated,
    scenePrompts,
  };
}

// ---------------------------------------------------------------------------
// LTX-VIDEO (ltx-video-2b-v0.9.5 / Lightricks/LTX-Video) COMFYUI PIPELINE
// ---------------------------------------------------------------------------

export const LTX_SAMPLERS = [
  'res_multistep',
  'euler',
  'dpmpp_2m',
  'ddim',
  'lms',
] as const;

export type LtxSamplerName = (typeof LTX_SAMPLERS)[number];

export interface LtxVideoParams {
  positive_prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg_scale: number;
  sampler_name: LtxSamplerName;
  frames: number;
  length?: number;
  fps: number;
  use_t5xxl_fp16: boolean;
  always_load_models: boolean;
}

export const DEFAULT_LTX_VIDEO_PARAMS: LtxVideoParams = {
  positive_prompt:
    "A drone quickly rises through a bank of morning fog, revealing a pristine alpine lake surrounded by snow-capped mountains. The camera glides forward over the glassy water, capturing the reflection of the peaks. As it continues, the perspective shifts to reveal a lone wooden cabin with a curl of smoke from its chimney, nestled among tall pines at the lake's edge. The final shot is a high-angle view, looking down at the cabin and the vast wilderness, as the golden light of sunrise begins to kiss the mountain tops.",
  negative_prompt:
    'low quality, worst quality, deformed, distorted, disfigured, motion smear, motion artifacts, fused fingers, bad anatomy, weird hand, ugly',
  width: 832,
  height: 480,
  seed: 0,
  steps: 25,
  cfg_scale: 2.05,
  sampler_name: 'res_multistep',
  frames: 73,
  length: 73,
  fps: 24,
  use_t5xxl_fp16: false,
  always_load_models: false,
};

export interface LtxVideoValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  vramCrashRiskOnT4: boolean;
  snappedWidth: number;
  snappedHeight: number;
  effectiveDecodedFrames: number;
  durationSeconds: number;
  checkpointFile: string;
  textEncoderFile: string;
  normalized: LtxVideoParams;
}

/**
 * Validates LTX-Video 2B v0.9.5 parameters:
 * - Resolution width and height must be divisible by 32
 * - Frames/length follow the (n + 1) rule (e.g. 73 -> 72 decoded frames at 24fps = 3.0s, 49 -> 48 decoded frames = 2.0s)
 * - Flags T4 12.7GB RAM OOM risk when width * height * frames >= 768 * 512 * 121
 */
export function validateLtxVideoParams(
  input: Partial<LtxVideoParams> = {}
): LtxVideoValidationResult {
  const positive_prompt =
    String(input.positive_prompt ?? DEFAULT_LTX_VIDEO_PARAMS.positive_prompt).trim() ||
    DEFAULT_LTX_VIDEO_PARAMS.positive_prompt;
  const negative_prompt =
    String(input.negative_prompt ?? DEFAULT_LTX_VIDEO_PARAMS.negative_prompt).trim() ||
    DEFAULT_LTX_VIDEO_PARAMS.negative_prompt;

  const rawWidth = Number(input.width ?? DEFAULT_LTX_VIDEO_PARAMS.width);
  const rawHeight = Number(input.height ?? DEFAULT_LTX_VIDEO_PARAMS.height);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : 832;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : 480;

  const snappedWidth = Math.max(256, Math.min(1280, Math.round(width / 32) * 32));
  const snappedHeight = Math.max(256, Math.min(1280, Math.round(height / 32) * 32));

  const rawFrames = Number(
    input.frames ?? input.length ?? DEFAULT_LTX_VIDEO_PARAMS.frames
  );
  const frames = Number.isFinite(rawFrames) && rawFrames >= 9 ? Math.round(rawFrames) : 73;

  const rawFps = Number(input.fps ?? DEFAULT_LTX_VIDEO_PARAMS.fps);
  const fps = Number.isFinite(rawFps) && rawFps >= 1 && rawFps <= 60 ? Math.round(rawFps) : 24;

  const rawSteps = Number(input.steps ?? DEFAULT_LTX_VIDEO_PARAMS.steps);
  const steps = Number.isFinite(rawSteps) && rawSteps >= 1 && rawSteps <= 100 ? Math.round(rawSteps) : 25;

  const rawCfg = Number(input.cfg_scale ?? DEFAULT_LTX_VIDEO_PARAMS.cfg_scale);
  const cfg_scale = Number.isFinite(rawCfg) && rawCfg >= 1 && rawCfg <= 20 ? Number(rawCfg.toFixed(2)) : 2.05;

  const rawSeed = Number(input.seed ?? DEFAULT_LTX_VIDEO_PARAMS.seed);
  const seed = Number.isFinite(rawSeed) && rawSeed >= 0 ? Math.floor(rawSeed) : 0;

  const samplerCandidate = String(
    input.sampler_name ?? DEFAULT_LTX_VIDEO_PARAMS.sampler_name
  ) as LtxSamplerName;
  const sampler_name: LtxSamplerName = LTX_SAMPLERS.includes(samplerCandidate)
    ? samplerCandidate
    : 'res_multistep';

  const use_t5xxl_fp16 = Boolean(input.use_t5xxl_fp16 ?? DEFAULT_LTX_VIDEO_PARAMS.use_t5xxl_fp16);
  const always_load_models = Boolean(
    input.always_load_models ?? DEFAULT_LTX_VIDEO_PARAMS.always_load_models
  );

  const errors: string[] = [];
  const warnings: string[] = [];

  if (width % 32 !== 0 || height % 32 !== 0) {
    errors.push(
      `Resolution (${width}x${height}) must be divisible by 32. Recommended: ${snappedWidth}x${snappedHeight}.`
    );
  }

  const t4CrashThreshold = 768 * 512 * 121;
  const vramCrashRiskOnT4 = width * height * frames >= t4CrashThreshold;
  if (vramCrashThresholdReached(width, height, frames)) {
    warnings.push(
      `T4 12.7GB RAM OOM Warning: At ${width}x${height} with ${frames} frames, VAEDecode can exceed free Colab T4 RAM (768x512 @ 121 frames crashes 12.7GB RAM). Consider 832x480 @ 73 frames or 768x512 @ 49 frames.`
    );
  }

  const effectiveDecodedFrames = Math.max(1, frames - 1);
  const durationSeconds = Number((effectiveDecodedFrames / fps).toFixed(2));
  const checkpointFile = 'ltx-video-2b-v0.9.5.safetensors';
  const textEncoderFile = use_t5xxl_fp16
    ? 't5xxl_fp16.safetensors'
    : 't5xxl_fp8_e4m3fn_scaled.safetensors';

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    vramCrashRiskOnT4,
    snappedWidth,
    snappedHeight,
    effectiveDecodedFrames,
    durationSeconds,
    checkpointFile,
    textEncoderFile,
    normalized: {
      positive_prompt,
      negative_prompt,
      width,
      height,
      seed,
      steps,
      cfg_scale,
      sampler_name,
      frames,
      length: frames,
      fps,
      use_t5xxl_fp16,
      always_load_models,
    },
  };
}

function vramCrashThresholdReached(width: number, height: number, frames: number): boolean {
  return width * height * frames >= 768 * 512 * 121;
}

/**
 * Generates the fixed Python 3.13 (cp313) Google Colab `# @title Prepare Environment` script
 * for LTX-Video 2B v0.9.5 matching the exact ComfyUI node pipeline (`empty_latent_video.generate`,
 * `scheduler.get_sigmas`, `conditioning.append`, `sampler.sample`, `vae_decode.decode`,
 * `display_video("/content/output.mp4")`, and `print("✅ Environment Setup Complete!")`).
 *
 * Fixes:
 *   1. Separates core dependencies (`torchsde`, `einops`, `diffusers`, `accelerate`, `av`) from
 *      `xformers==0.0.29.post2` so Python 3.13 (`cp313`) does NOT abort `pip install` and throw
 *      `ModuleNotFoundError: No module named 'torchsde'`.
 *   2. Wraps `clip_encode_positive` and `clip_encode_negative` inside `with torch.inference_mode():`
 *      and honors `Use_t5xxl_fp16` dynamically.
 */
export const SHARED_COLAB_DRIVE_ID = '1y6VBmKBSb8mkxR7ODVycSJjX4cW9N3aA';
export const SHARED_COLAB_NOTEBOOK_URL =
  'https://colab.research.google.com/drive/1y6VBmKBSb8mkxR7ODVycSJjX4cW9N3aA?usp=sharing';
export const DEFAULT_COLAB_REGISTER_TOKEN = 'mc-colab-reg-2026';
export const DEFAULT_COLAB_BRIDGE_TOKEN = 'mc-colab-bridge-2026';
export const DEFAULT_APP_BASE_URL =
  'https://ais-pre-fz666tzjxzt6uyw2issv7t-388006830704.asia-southeast1.run.app';

export const COLAB_SECRETS_SNIPPET = `# Load Private Secrets from Google Colab Secrets Panel (FAL_KEY, GEMINi_key, COLAB_REGISTER_TOKEN, COLAB_BRIDGE_TOKEN)
# Direct Shared Colab Notebook: ${SHARED_COLAB_NOTEBOOK_URL}
import os
from google.colab import userdata

def load_colab_secret(secret_name: str, env_var_name: str = None) -> str:
    target_env = env_var_name or secret_name
    try:
        val = userdata.get(secret_name)
        if val:
            os.environ[target_env] = val.strip()
            print(f"🔑 Loaded secret '{secret_name}' -> os.environ['{target_env}']")
            return val.strip()
    except Exception as e:
        print(f"ℹ️ Secret '{secret_name}' not enabled or not found ({type(e).__name__}). Make sure 'Notebook access' is toggled ON.")
    return os.environ.get(target_env, "")

FAL_KEY = load_colab_secret('FAL_KEY', 'FAL_KEY')
GEMINI_API_KEY = load_colab_secret('GEMINi_key', 'GEMINI_API_KEY') or load_colab_secret('GEMINI_API_KEY', 'GEMINI_API_KEY')
COLAB_REGISTER_TOKEN = load_colab_secret('COLAB_REGISTER_TOKEN', 'COLAB_REGISTER_TOKEN') or "${DEFAULT_COLAB_REGISTER_TOKEN}"
COLAB_BRIDGE_TOKEN = load_colab_secret('COLAB_BRIDGE_TOKEN', 'COLAB_BRIDGE_TOKEN') or "${DEFAULT_COLAB_BRIDGE_TOKEN}"
APP_BASE_URL = load_colab_secret('APP_BASE_URL', 'APP_BASE_URL')`;

export function buildFixedLtxColabScript(
  input: Partial<LtxVideoParams> & { app_base_url?: string } = {}
): string {
  const { normalized, textEncoderFile } = validateLtxVideoParams(input);
  const escapedPos = normalized.positive_prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedNeg = normalized.negative_prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const defaultAppBaseUrl = String(
    input.app_base_url || DEFAULT_APP_BASE_URL
  )
    .trim()
    .replace(/\/+$/, '');

  return `# @title Prepare Environment + LTX-Video 2B v0.9.5 + Cloudflared Bridge (Python 3.13 / cp313)
# Shared Google Colab Link: ${SHARED_COLAB_NOTEBOOK_URL}
!pip install -q torch==2.6.0 torchvision==0.21.0
%cd /content
Always_Load_Models_for_Inference = ${normalized.always_load_models ? 'True' : 'False'}
Use_t5xxl_fp16 = ${normalized.use_t5xxl_fp16 ? 'True' : 'False'}

# 1. Install core dependencies FIRST so torchsde, einops, diffusers, accelerate always install on Python 3.13
!pip install -q torchsde einops diffusers accelerate av imageio imageio-ffmpeg tqdm scipy safetensors google-genai fal-client
# 2. Optional xformers install (non-blocking on Python 3.13 cp313; ComfyUI uses PyTorch 2.6 native SDPA)
!pip install -q xformers --no-build-isolation || echo "Using PyTorch 2.6 native SDPA attention (xformers wheel skipped on cp313)"

!git clone https://github.com/Isi-dev/ComfyUI || true
%cd /content/ComfyUI
!apt -y install -qq aria2 ffmpeg
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# Download required models
!aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Isi99999/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors -d /content/ComfyUI/models/checkpoints -o ltx-video-2b-v0.9.5.safetensors
if Use_t5xxl_fp16:
    !aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Isi99999/LTX-Video/resolve/main/t5xxl_fp16.safetensors -d /content/ComfyUI/models/text_encoders -o t5xxl_fp16.safetensors
else:
    !aria2c --console-log-level=error -c -x 16 -s 16 -k 1M https://huggingface.co/Isi99999/LTX-Video/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors -d /content/ComfyUI/models/text_encoders -o t5xxl_fp8_e4m3fn_scaled.safetensors

# Initial setup & Google Colab Secrets (FAL_KEY, GEMINi_key, COLAB_REGISTER_TOKEN, COLAB_BRIDGE_TOKEN)
import torch
import numpy as np
from PIL import Image
import gc
import sys
import random
import os
import json
import uuid
import time
import hmac
import re
import threading
import subprocess
import imageio
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from google.colab import files, userdata
from IPython.display import display, HTML
sys.path.insert(0, '/content/ComfyUI')

${COLAB_SECRETS_SNIPPET}
if not APP_BASE_URL:
    APP_BASE_URL = "${defaultAppBaseUrl}"

def enhance_prompt_with_gemini(raw_prompt: str) -> str:
    """Uses GEMINi_key from Colab Secrets to expand a brief idea into a detailed 24fps LTX-Video prompt."""
    if not GEMINI_API_KEY:
        return raw_prompt
    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"Rewrite this video idea into a single detailed cinematic 24fps LTX-Video prompt describing camera motion, lighting, atmosphere, and subject details: {raw_prompt}"
        )
        if resp and resp.text:
            enhanced = resp.text.strip()
            print(f"✨ Gemini Enhanced Prompt: {enhanced}")
            return enhanced
    except Exception as e:
        print(f"ℹ️ Gemini prompt enhancement skipped: {e}")
    return raw_prompt

from comfy import model_management

from nodes import (
    CheckpointLoaderSimple,
    CLIPLoader,
    CLIPTextEncode,
    VAEDecode
)

from comfy_extras.nodes_custom_sampler import (
    KSamplerSelect,
    SamplerCustom
)

from comfy_extras.nodes_lt import (
    LTXVConditioning,
    LTXVScheduler,
    EmptyLTXVLatentVideo
)

checkpoint_loader = CheckpointLoaderSimple()
clip_loader = CLIPLoader()
clip_encode_positive = CLIPTextEncode()
clip_encode_negative = CLIPTextEncode()
scheduler = LTXVScheduler()
sampler_select = KSamplerSelect()
conditioning = LTXVConditioning()
empty_latent_video = EmptyLTXVLatentVideo()
sampler = SamplerCustom()
vae_decode = VAEDecode()


def clear_memory():
    """Frees GPU (VRAM) and CPU RAM memory."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
    for obj in list(globals().values()):
        if torch.is_tensor(obj) or (hasattr(obj, "data") and torch.is_tensor(obj.data)):
            del obj
    gc.collect()


def display_video(video_path):
    from IPython.display import HTML
    from base64 import b64encode

    mp4 = open(video_path, 'rb').read()
    data_url = "data:video/mp4;base64," + b64encode(mp4).decode()

    display(HTML(f"""
    <video width=512 controls autoplay loop>
        <source src="{data_url}" type="video/mp4">
    </video>
    """))


def generate_video(
    positive_prompt: str = "${escapedPos}",
    negative_prompt: str = "${escapedNeg}",
    width: int = ${normalized.width},
    height: int = ${normalized.height},
    seed: int = ${normalized.seed},
    steps: int = ${normalized.steps},
    cfg_scale: float = ${normalized.cfg_scale},
    sampler_name: str = "${normalized.sampler_name}",
    length: int = ${normalized.frames},
    fps: int = ${normalized.fps},
    use_gemini_enhancer: bool = False,
    use_fal_cloud: bool = False,
    output_path: str = "/content/output.mp4",
    show_inline: bool = True
):
    try:
        assert width % 32 == 0, "Width must be divisible by 32"
        assert height % 32 == 0, "Height must be divisible by 32"

        if use_gemini_enhancer and GEMINI_API_KEY:
            positive_prompt = enhance_prompt_with_gemini(positive_prompt)

        # Optional fast cloud LTX-Video generation via FAL_KEY if requested
        if use_fal_cloud and FAL_KEY:
            import fal_client
            print("⚡ Generating LTX-Video via fal.ai cloud (FAL_KEY)...")
            fal_res = fal_client.subscribe(
                "fal-ai/ltx-video",
                arguments={
                    "prompt": positive_prompt,
                    "negative_prompt": negative_prompt,
                    "num_inference_steps": steps,
                    "guidance_scale": cfg_scale,
                },
            )
            video_url = fal_res.get("video", {}).get("url")
            if video_url:
                urllib.request.urlretrieve(video_url, output_path)
                if show_inline:
                    display_video(output_path)
                return output_path

        encoder_name = "t5xxl_fp16.safetensors" if Use_t5xxl_fp16 else "${textEncoderFile}"
        with torch.inference_mode():
            print(f"Loading Text_Encoder ({encoder_name})...")
            clip = clip_loader.load_clip(encoder_name, "ltxv", "default")[0]
            print("Loaded Text_Encoder!")
            positive = clip_encode_positive.encode(clip, positive_prompt)[0]
            negative = clip_encode_negative.encode(clip, negative_prompt)[0]

        del clip
        torch.cuda.empty_cache()
        gc.collect()
        print("Text_Encoder removed from memory")

        with torch.inference_mode():
            empty_latent = empty_latent_video.generate(width, height, length)[0]
            sigmas = scheduler.get_sigmas(steps, cfg_scale, 0.95, True, 0.1)[0]
            selected_sampler = sampler_select.get_sampler(sampler_name)[0]
            conditioned = conditioning.append(positive, negative, 25.0)

            print("Loading model & VAE...")
            model, _, vae = checkpoint_loader.load_checkpoint("ltx-video-2b-v0.9.5.safetensors")
            print("Loaded model & VAE!")

            print("Generating video...")
            sampled = sampler.sample(
                model=model,
                add_noise=True,
                noise_seed=seed if seed != 0 else random.randint(0, 2**32),
                cfg=cfg_scale,
                positive=conditioned[0],
                negative=conditioned[1],
                sampler=selected_sampler,
                sigmas=sigmas,
                latent_image=empty_latent
            )[0]

        del model
        torch.cuda.empty_cache()
        gc.collect()
        print("Model removed from memory")

        with torch.no_grad():
            try:
                print("Decoding Latents...")
                decoded = vae_decode.decode(vae, sampled)[0].detach()
                print("Latents Decoded!")
                del vae
                torch.cuda.empty_cache()
                gc.collect()
                print("VAE removed from memory")

                with imageio.get_writer(output_path, fps=fps) as writer:
                    for i, frame in enumerate(decoded):
                        frame_np = (frame.cpu().numpy() * 255).astype(np.uint8)
                        writer.append_data(frame_np)
                        if i % 10 == 0:  # Periodic cleanup
                            torch.cuda.empty_cache()

                print(f"Successfully processed {len(decoded)} frames")
            except Exception as e:
                print(f"Decoding error: {str(e)}")
                raise

        if show_inline:
            print("Displaying Video...")
            display_video(output_path)
        return output_path

    except Exception as e:
        print(f"Video generation failed: {str(e)}")
        raise
    finally:
        clear_memory()


# ==============================================================================
# MOVIE CITY / 3!2!1! AKZYON — SECURE COLAB HTTP BRIDGE + CLOUDFLARED TUNNEL
# Matches server.ts router contract:
#   - POST /jobs           -> starts LTX-Video job, returns { job_id, status }
#   - GET  /jobs/{job_id}  -> returns { job_id, status, error }
#   - GET  /jobs/{job_id}/file -> streams generated MP4 binary (video/mp4)
#   - Registers https://*.trycloudflare.com to POST {APP_BASE_URL}/api/colab/register
#     using header X-Colab-Register-Token: userdata.get('COLAB_REGISTER_TOKEN')
# ==============================================================================
BRIDGE_JOBS = {}
GPU_GENERATION_LOCK = threading.Lock()
BRIDGE_SERVER_INSTANCE = None

def _run_bridge_job(job_id: str, payload: dict):
    BRIDGE_JOBS[job_id]["status"] = "running"
    prompt_text = str(payload.get("prompt") or payload.get("positive_prompt") or "${escapedPos}").strip()
    neg_prompt = str(payload.get("negative_prompt") or "${escapedNeg}").strip()
    width_val = int(payload.get("width") or ${normalized.width})
    height_val = int(payload.get("height") or ${normalized.height})
    steps_val = int(payload.get("steps") or ${normalized.steps})
    cfg_val = float(payload.get("cfg_scale") or ${normalized.cfg_scale})
    frames_val = int(payload.get("frames") or payload.get("length") or ${normalized.frames})
    fps_val = int(payload.get("fps") or ${normalized.fps})
    out_file = f"/content/job_{job_id}.mp4"
    try:
        with GPU_GENERATION_LOCK:
            generate_video(
                positive_prompt=prompt_text,
                negative_prompt=neg_prompt,
                width=(width_val // 32) * 32,
                height=(height_val // 32) * 32,
                steps=steps_val,
                cfg_scale=cfg_val,
                length=frames_val,
                fps=fps_val,
                output_path=out_file,
                show_inline=False,
            )
        BRIDGE_JOBS[job_id]["status"] = "completed"
        BRIDGE_JOBS[job_id]["file_path"] = out_file
    except Exception as exc:
        BRIDGE_JOBS[job_id]["status"] = "failed"
        BRIDGE_JOBS[job_id]["error"] = str(exc)


class ColabLtxBridgeHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, data: dict):
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _check_auth(self) -> bool:
        expected = (COLAB_BRIDGE_TOKEN or os.environ.get("COLAB_BRIDGE_TOKEN") or "${DEFAULT_COLAB_BRIDGE_TOKEN}").strip()
        if not expected:
            return True
        auth_header = self.headers.get("Authorization") or ""
        bearer = auth_header[7:].strip() if auth_header.startswith("Bearer ") else ""
        header_tok = (self.headers.get("X-Colab-Bridge-Token") or "").strip()
        candidate = bearer or header_tok
        if not candidate:
            return False
        return hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))

    def do_POST(self):
        if self.path == "/jobs":
            if not self._check_auth():
                self._send_json(401, {"error": "Unauthorized bridge token"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            try:
                payload = json.loads(raw_body)
            except Exception:
                payload = {}
            job_id = uuid.uuid4().hex[:16]
            BRIDGE_JOBS[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "created_at": time.time(),
                "file_path": None,
                "error": None,
            }
            worker = threading.Thread(target=_run_bridge_job, args=(job_id, payload), daemon=True)
            worker.start()
            self._send_json(200, {"job_id": job_id, "status": "queued"})
            return
        self._send_json(404, {"error": "Not found"})

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "provider": "ltx-video-colab", "notebookId": "${SHARED_COLAB_DRIVE_ID}"})
            return
        if self.path.startswith("/jobs/"):
            if not self._check_auth():
                self._send_json(401, {"error": "Unauthorized bridge token"})
                return
            parts = [p for p in self.path.split("/") if p]
            if len(parts) == 2 and parts[0] == "jobs":
                job_id = parts[1]
                job = BRIDGE_JOBS.get(job_id)
                if not job:
                    self._send_json(404, {"error": "Job not found"})
                    return
                self._send_json(200, {
                    "job_id": job_id,
                    "status": job["status"],
                    "error": job.get("error"),
                })
                return
            if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "file":
                job_id = parts[1]
                job = BRIDGE_JOBS.get(job_id)
                if not job or job.get("status") != "completed" or not job.get("file_path"):
                    self._send_json(404, {"error": "Video file not ready"})
                    return
                file_path = job["file_path"]
                if not os.path.exists(file_path):
                    self._send_json(404, {"error": "Generated MP4 missing on disk"})
                    return
                with open(file_path, "rb") as f:
                    video_bytes = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(video_bytes)))
                self.end_headers()
                self.wfile.write(video_bytes)
                return
        self._send_json(404, {"error": "Not found"})


def start_colab_bridge(app_base_url: str = None, port: int = 8765) -> str:
    """Starts the local HTTP /jobs server, opens a *.trycloudflare.com tunnel, and registers it with Movie City."""
    global BRIDGE_SERVER_INSTANCE
    target_base = (app_base_url or APP_BASE_URL or "${defaultAppBaseUrl}").strip().rstrip("/")
    if BRIDGE_SERVER_INSTANCE is None:
        BRIDGE_SERVER_INSTANCE = ThreadingHTTPServer(("127.0.0.1", port), ColabLtxBridgeHandler)
        srv_thread = threading.Thread(target=BRIDGE_SERVER_INSTANCE.serve_forever, daemon=True)
        srv_thread.start()
        print(f"🚀 Local LTX-Video Bridge listening on http://127.0.0.1:{port}")

    proc = subprocess.Popen(
        ["/usr/local/bin/cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    tunnel_url = None
    deadline = time.time() + 30
    pattern = re.compile(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com")
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.2)
            continue
        match = pattern.search(line)
        if match:
            tunnel_url = match.group(0)
            break

    if not tunnel_url:
        raise RuntimeError("Could not obtain https://*.trycloudflare.com tunnel URL from cloudflared.")

    print(f"🌐 Cloudflared Tunnel Active: {tunnel_url}")
    reg_token = (COLAB_REGISTER_TOKEN or os.environ.get("COLAB_REGISTER_TOKEN") or "${DEFAULT_COLAB_REGISTER_TOKEN}").strip()
    candidate_bases = []
    for base_candidate in [
        target_base,
        "${DEFAULT_APP_BASE_URL}",
        "https://ais-dev-fz666tzjxzt6uyw2issv7t-388006830704.asia-southeast1.run.app",
    ]:
        clean_b = (base_candidate or "").strip().rstrip("/")
        if clean_b and clean_b not in candidate_bases:
            candidate_bases.append(clean_b)

    for base_url in candidate_bases:
        reg_endpoint = f"{base_url}/api/colab/register"
        body_bytes = json.dumps({"url": tunnel_url, "provider": "ltx-video-colab"}).encode("utf-8")
        req = urllib.request.Request(
            reg_endpoint,
            data=body_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Colab-Register-Token": reg_token,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_text = resp.read().decode("utf-8")
                print(f"✅ Registered Colab Bridge with {reg_endpoint}: {resp_text}")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            print(f"⚠️ Registration failed on {reg_endpoint} ({e.code}): {err_body}")
        except Exception as e:
            print(f"⚠️ Could not reach {reg_endpoint}: {e}")
    return tunnel_url


print("✅ Environment Setup Complete!")
`;
}

/**
 * Builds a complete, downloadable `.ipynb` Jupyter Notebook JSON with Cell 1 (`Prepare Environment`)
 * and Cell 2 (`LTX-Video Parameters + Start Movie City Bridge`) synced with the shared notebook
 * `https://colab.research.google.com/drive/1y6VBmKBSb8mkxR7ODVycSJjX4cW9N3aA?usp=sharing`.
 */
export function buildFixedLtxColabNotebookJson(
  input: Partial<LtxVideoParams> & { app_base_url?: string } = {}
): string {
  const { normalized } = validateLtxVideoParams(input);
  const script = buildFixedLtxColabScript({
    ...normalized,
    app_base_url: input.app_base_url,
  });
  const cell1Lines = script
    .split('\n')
    .map((line, idx, arr) => (idx < arr.length - 1 ? `${line}\n` : line));

  const escapedPos = normalized.positive_prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedNeg = normalized.negative_prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const defaultAppBaseUrl = String(
    input.app_base_url || DEFAULT_APP_BASE_URL
  )
    .trim()
    .replace(/\/+$/, '');
  const cell2Code = `# @title LTX-Video Parameters + Start Movie City Bridge
# Shared Notebook: ${SHARED_COLAB_NOTEBOOK_URL}
# ---------------------------------------------------------------------------
# 1) Itakda ang eksena mo dito (o gamitin ang sliders sa kanan)
# ---------------------------------------------------------------------------
positive_prompt = "${escapedPos}" # @param {"type":"string"}
negative_prompt = "${escapedNeg}" # @param {"type":"string"}
width = ${normalized.width} # @param {"type":"number"}
height = ${normalized.height} # @param {"type":"number"}
seed = ${normalized.seed} # @param {"type":"integer"}
steps = ${normalized.steps} # @param {"type":"integer", "min":1, "max":100}
cfg_scale = ${normalized.cfg_scale} # @param {"type":"number", "min":1, "max":20}
sampler_name = "${normalized.sampler_name}" # @param ["res_multistep", "euler", "dpmpp_2m", "ddim", "lms"]
frames = ${normalized.frames} # @param {"type":"integer", "min":1, "max":120}
fps = ${normalized.fps} # @param {"type":"integer", "min":1, "max":60}
use_gemini_enhancer = False # @param {"type":"boolean"}
use_fal_cloud = False # @param {"type":"boolean"}
run_direct_test = False # @param {"type":"boolean"}

# ---------------------------------------------------------------------------
# 2) Simulan ang Cloudflared tunnel + auto-register sa Movie City (/api/colab/register)
# ---------------------------------------------------------------------------
start_colab_bridge(app_base_url=APP_BASE_URL or "${defaultAppBaseUrl}")

# ---------------------------------------------------------------------------
# 3) Opsyonal: direktang test render sa notebook (kapag run_direct_test=True)
# ---------------------------------------------------------------------------
if run_direct_test:
    with torch.inference_mode():
        generate_video(
            positive_prompt=positive_prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            seed=seed,
            steps=steps,
            cfg_scale=cfg_scale,
            sampler_name=sampler_name,
            length=frames,
            fps=fps,
            use_gemini_enhancer=use_gemini_enhancer,
            use_fal_cloud=use_fal_cloud,
            show_inline=True,
        )
    clear_memory()`;
  const cell2Lines = cell2Code
    .split('\n')
    .map((line, idx, arr) => (idx < arr.length - 1 ? `${line}\n` : line));

  const notebook = {
    nbformat: 4,
    nbformat_minor: 0,
    metadata: {
      colab: {
        provenance: [],
        gpuType: 'T4',
      },
      kernelspec: {
        name: 'python3',
        display_name: 'Python 3',
      },
      language_info: {
        name: 'python',
      },
      accelerator: 'GPU',
    },
    cells: [
      {
        cell_type: 'markdown',
        metadata: { id: 'ltx_header_fixed' },
        source: [
          '# **LTX-VIDEO 2B v0.9.5 — Text to Video + Movie City Bridge (PINAG-ISA)**\n',
          `\nShared Google Colab Link: [Open in Google Colab](${SHARED_COLAB_NOTEBOOK_URL})\n\n`,
          'Pinagsamang bersyon: ang ComfyUI pipeline mo + ang Movie City bridge.\n\n',
          '## Paano gamitin\n',
          '1. **Runtime → Change runtime type → T4 GPU** (kailangan ng GPU)\n',
          '2. Idagdag ang Colab Secrets (🔑 panel, i-ON ang **Notebook access**):\n',
          `   - \`COLAB_REGISTER_TOKEN\` (default: \`${DEFAULT_COLAB_REGISTER_TOKEN}\`)\n`,
          `   - \`COLAB_BRIDGE_TOKEN\` (default: \`${DEFAULT_COLAB_BRIDGE_TOKEN}\`)\n`,
          `   - \`APP_BASE_URL\` (default: \`${defaultAppBaseUrl}\`)\n`,
          '   - `FAL_KEY` / `GEMINi_key` (opsyonal, para sa cloud/enhancer)\n',
          '3. Patakbuhin ang **Cell 1** (Prepare Environment) — ~5-10 min (4 GB model)\n',
          '4. Patakbuhin ang **Cell 2** (Parameters + Start Bridge)\n',
        ],
      },
      {
        cell_type: 'code',
        metadata: { id: 'ltx_code_fixed' },
        execution_count: null,
        outputs: [],
        source: cell1Lines,
      },
      {
        cell_type: 'code',
        metadata: { id: 'ltx_run_inference' },
        execution_count: null,
        outputs: [],
        source: cell2Lines,
      },
    ],
  };
  return JSON.stringify(notebook, null, 2);
}




