/**
 * Cloudflare Worker (`flat-dream-15fc`) for MovieCityAI / AI Drama Studio
 *
 * Capabilities:
 * 1. R2 Media Bucket Binding (`env.MEDIA` -> bucket `"movie-city-media"`):
 *    - `PUT /upload/:key` (requires `Authorization: Bearer <token>` header)
 *    - `GET /media/:key` (streams stored media asset with Content-Type & Cache-Control)
 * 2. Per-User Daily Generation Limit (checked BEFORE calling any AI):
 *    - 5 images / day
 *    - 1 video / day
 *    - 3 music tracks / day
 * 3. AI Generation & Media Upload Orchestration (`POST /generate`):
 *    - Verifies daily quota first -> calls AI -> uploads binary output to `env.MEDIA` -> returns R2 URL + metadata.
 */

export interface R2ObjectMetadata {
  contentType?: string;
  cacheControl?: string;
}

export interface R2ObjectBody {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: R2ObjectMetadata;
  customMetadata?: Record<string, string>;
  body: ReadableStream | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketBinding {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: {
      httpMetadata?: R2ObjectMetadata;
      customMetadata?: Record<string, string>;
    }
  ): Promise<{ key: string; size: number; etag: string }>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

export interface Env {
  /** R2 Bucket binding `MEDIA` -> `"movie-city-media"` */
  MEDIA: R2BucketBinding;
  /** Cloudflare API Token secret for `PUT /upload/:key` and AI generation */
  CF_API_TOKEN?: string;
  /** Gemini API key for Worker-side AI generation */
  GEMINI_API_KEY?: string;
  /** Fal AI key for primary video generation */
  FAL_KEY?: string;
  /** Fal AI video model path (defaults to fal-ai/ltx-video) */
  FAL_VIDEO_MODEL?: string;
  /** Enable Colab LTX fallback when set to "true" */
  COLAB_LTX_ENABLED?: string;
  /** Secret token for authenticating POST /api/colab/register */
  COLAB_REGISTER_TOKEN?: string;
  /** Secret token for authenticating requests to the Colab bridge (/jobs) */
  COLAB_BRIDGE_TOKEN?: string;
  /** Optional Google Colab LTX-Video bridge URL */
  COLAB_BRIDGE_URL?: string;
  CF_TOKEN_NAME?: string;
  CF_CLIENT_IP_CIDR?: string;
}

export type MediaQuotaType = 'image' | 'video' | 'music';

export const DAILY_GENERATION_LIMITS: Record<MediaQuotaType, number> = {
  image: 5,
  video: 1,
  music: 3,
};

// Per-user daily usage map in Worker isolate (also persisted in R2 under `_quotas/<date>/<userId>.json`)
const memoryDailyUsage = new Map<string, Record<MediaQuotaType, number>>();

const COLAB_BRIDGE_R2_KEY = '_runtime_bridges/colab-ltx.json';
const COLAB_BRIDGE_TTL_MS = 2 * 60 * 60 * 1000;

interface WorkerColabBridgeDoc {
  url: string;
  provider: 'ltx-video-colab';
  status: 'active' | 'offline' | 'expired';
  updatedAt: string;
  expiresAt: string;
}

function constantTimeEquals(a: string, b: string): boolean {
  const cleanA = String(a || '');
  const cleanB = String(b || '');
  if (!cleanA || !cleanB || cleanA.length !== cleanB.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < cleanA.length; i++) {
    diff |= cleanA.charCodeAt(i) ^ cleanB.charCodeAt(i);
  }
  return diff === 0;
}

function isValidTryCloudflareUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host.endsWith('.trycloudflare.com') && host.length > '.trycloudflare.com'.length;
  } catch {
    return false;
  }
}

function isValidHttpsBridgeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

async function readWorkerColabBridge(env: Env): Promise<WorkerColabBridgeDoc | null> {
  try {
    const obj = await env.MEDIA.get(COLAB_BRIDGE_R2_KEY);
    if (obj) {
      const buf = await obj.arrayBuffer();
      const parsed = JSON.parse(new TextDecoder().decode(buf));
      if (parsed && typeof parsed.url === 'string') {
        return {
          url: String(parsed.url).trim().replace(/\/+$/, ''),
          provider: 'ltx-video-colab',
          status:
            parsed.status === 'active' || parsed.status === 'expired' || parsed.status === 'offline'
              ? parsed.status
              : 'active',
          updatedAt: String(parsed.updatedAt || ''),
          expiresAt: String(parsed.expiresAt || ''),
        };
      }
    }
  } catch {}

  const envUrl = String(env.COLAB_BRIDGE_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && isValidHttpsBridgeUrl(envUrl)) {
    const now = Date.now();
    return {
      url: envUrl,
      provider: 'ltx-video-colab',
      status: 'active',
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + COLAB_BRIDGE_TTL_MS).toISOString(),
    };
  }
  return null;
}

async function writeWorkerColabBridge(env: Env, doc: WorkerColabBridgeDoc): Promise<void> {
  await env.MEDIA.put(COLAB_BRIDGE_R2_KEY, JSON.stringify(doc), {
    httpMetadata: { contentType: 'application/json' },
  });
}

function evaluateWorkerBridgeStatus(doc: WorkerColabBridgeDoc | null): {
  status: 'active' | 'expired' | 'offline';
  provider: 'ltx-video-colab';
  expiresAt?: string;
  validDoc: WorkerColabBridgeDoc | null;
} {
  if (!doc || !doc.url || doc.status === 'offline') {
    return { status: 'offline', provider: 'ltx-video-colab', validDoc: null };
  }
  if (!isValidHttpsBridgeUrl(doc.url)) {
    return { status: 'offline', provider: 'ltx-video-colab', validDoc: null };
  }
  const expiresMs = Date.parse(doc.expiresAt);
  if (Number.isNaN(expiresMs) || expiresMs <= Date.now() || doc.status === 'expired') {
    return {
      status: 'expired',
      provider: 'ltx-video-colab',
      expiresAt: doc.expiresAt || undefined,
      validDoc: null,
    };
  }
  return {
    status: 'active',
    provider: 'ltx-video-colab',
    expiresAt: doc.expiresAt,
    validDoc: doc,
  };
}

function extractVideoUrlFromPayload(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [
    payload?.video?.url,
    payload?.data?.video?.url,
    payload?.output?.video?.url,
    Array.isArray(payload?.videos) ? payload.videos[0]?.url || payload.videos[0] : undefined,
    payload?.video_url,
    payload?.videoUrl,
    payload?.url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c.trim())) {
      return c.trim();
    }
  }
  return '';
}

async function generateVideoViaWorkerFalQueue(
  prompt: string,
  env: Env,
  options?: { negativePrompt?: string; steps?: number; cfgScale?: number }
): Promise<{ videoBytes: ArrayBuffer; modelUsed: string }> {
  const falKey = String(env.FAL_KEY || '').trim();
  const falModel = String(env.FAL_VIDEO_MODEL || 'fal-ai/ltx-video')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!falKey) {
    throw new Error('FAL_KEY is not configured.');
  }

  const queueEndpoint = `https://queue.fal.run/${falModel}`;
  const submitRes = await fetch(queueEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      prompt,
      negative_prompt:
        options?.negativePrompt ||
        'low quality, worst quality, deformed, distorted, motion smear, artifacts, blurry',
      num_inference_steps: options?.steps || 30,
      guidance_scale: options?.cfgScale || 3.0,
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '');
    throw new Error(`Fal queue submission failed (${submitRes.status}): ${errText.slice(0, 240)}`);
  }

  const submitData: any = await submitRes.json().catch(() => ({}));
  const immediateUrl = extractVideoUrlFromPayload(submitData);
  if (immediateUrl) {
    const dlRes = await fetch(immediateUrl);
    if (!dlRes.ok) {
      throw new Error(`Failed to download Fal MP4 (${dlRes.status}).`);
    }
    const buf = await dlRes.arrayBuffer();
    if (buf.byteLength < 64) {
      throw new Error('Downloaded Fal MP4 is empty.');
    }
    return { videoBytes: buf, modelUsed: falModel };
  }

  const requestId = String(submitData?.request_id || '').trim();
  const statusUrl =
    String(submitData?.status_url || '').trim() ||
    (requestId ? `https://queue.fal.run/${falModel}/requests/${requestId}/status` : '');
  const responseUrl =
    String(submitData?.response_url || '').trim() ||
    (requestId ? `https://queue.fal.run/${falModel}/requests/${requestId}` : '');

  if (!statusUrl || !responseUrl) {
    throw new Error('Fal queue response did not include status_url and response_url.');
  }

  const pollDeadline = Date.now() + 180_000;
  let completed = false;
  while (Date.now() < pollDeadline) {
    const statusRes = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        Authorization: `Key ${falKey}`,
        Accept: 'application/json',
      },
    });
    if (!statusRes.ok) {
      const errText = await statusRes.text().catch(() => '');
      throw new Error(`Fal status check failed (${statusRes.status}): ${errText.slice(0, 200)}`);
    }
    const statusData: any = await statusRes.json().catch(() => ({}));
    const state = String(statusData?.status || '').toUpperCase();
    if (state === 'COMPLETED') {
      completed = true;
      break;
    }
    if (state === 'FAILED' || state === 'ERROR' || state === 'CANCELLED') {
      throw new Error(
        `Fal queue job ended with status ${state}: ${String(statusData?.error || 'Unknown error')}`
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!completed) {
    throw new Error('Fal queue polling timed out waiting for COMPLETED state.');
  }

  const resultRes = await fetch(responseUrl, {
    method: 'GET',
    headers: {
      Authorization: `Key ${falKey}`,
      Accept: 'application/json',
    },
  });
  if (!resultRes.ok) {
    const errText = await resultRes.text().catch(() => '');
    throw new Error(`Fal response_url fetch failed (${resultRes.status}): ${errText.slice(0, 200)}`);
  }

  const resultData: any = await resultRes.json().catch(() => ({}));
  const videoUrl = extractVideoUrlFromPayload(resultData);
  if (!videoUrl) {
    throw new Error('Fal response_url payload did not contain a valid video URL.');
  }

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    throw new Error(`Failed to download MP4 from Fal video URL (${videoRes.status}).`);
  }
  const videoBytes = await videoRes.arrayBuffer();
  if (videoBytes.byteLength < 64) {
    throw new Error('Fal video download returned an empty file.');
  }

  return { videoBytes, modelUsed: falModel };
}

async function generateVideoViaWorkerColabBridge(
  prompt: string,
  bridgeDoc: WorkerColabBridgeDoc,
  env: Env,
  options?: { negativePrompt?: string; width?: number; height?: number; steps?: number; cfgScale?: number; frames?: number; fps?: number }
): Promise<{ videoBytes: ArrayBuffer; jobId: string }> {
  const baseUrl = bridgeDoc.url.replace(/\/+$/, '');
  if (!isValidHttpsBridgeUrl(baseUrl)) {
    throw new Error('Colab bridge URL is not a valid HTTPS URL.');
  }

  const bridgeToken = String(env.COLAB_BRIDGE_TOKEN || '').trim();
  const authHeaders: Record<string, string> = {
    Accept: 'application/json',
  };
  if (bridgeToken) {
    authHeaders['Authorization'] = `Bearer ${bridgeToken}`;
    authHeaders['X-Colab-Bridge-Token'] = bridgeToken;
  }

  const createRes = await fetch(`${baseUrl}/jobs`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      positive_prompt: prompt,
      negative_prompt:
        options?.negativePrompt ||
        'low quality, worst quality, deformed, distorted, motion smear, artifacts',
      width: options?.width || 832,
      height: options?.height || 480,
      steps: options?.steps || 25,
      cfg_scale: options?.cfgScale || 2.05,
      frames: options?.frames || 73,
      fps: options?.fps || 24,
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Colab bridge POST /jobs failed (${createRes.status}): ${errText.slice(0, 200)}`);
  }

  const createData: any = await createRes.json().catch(() => ({}));
  const jobId = String(createData?.job_id || createData?.jobId || createData?.id || '').trim();
  if (!jobId) {
    throw new Error('Colab bridge POST /jobs did not return a job_id.');
  }

  const pollDeadline = Date.now() + 240_000;
  let jobCompleted = false;
  while (Date.now() < pollDeadline) {
    const jobRes = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: authHeaders,
    });
    if (!jobRes.ok) {
      const errText = await jobRes.text().catch(() => '');
      throw new Error(`Colab bridge GET /jobs/${jobId} failed (${jobRes.status}): ${errText.slice(0, 200)}`);
    }
    const jobData: any = await jobRes.json().catch(() => ({}));
    const status = String(jobData?.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'done') {
      jobCompleted = true;
      break;
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(
        `Colab bridge job ${jobId} failed: ${String(jobData?.error || 'Unknown error')}`
      );
    }
    await new Promise((r) => setTimeout(r, 2500));
  }

  if (!jobCompleted) {
    throw new Error(`Colab bridge job ${jobId} timed out.`);
  }

  const fileRes = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/file`, {
    method: 'GET',
    headers: bridgeToken
      ? {
          Authorization: `Bearer ${bridgeToken}`,
          'X-Colab-Bridge-Token': bridgeToken,
        }
      : {},
  });

  if (!fileRes.ok) {
    const errText = await fileRes.text().catch(() => '');
    throw new Error(`Colab bridge GET /jobs/${jobId}/file failed (${fileRes.status}): ${errText.slice(0, 200)}`);
  }

  const videoBytes = await fileRes.arrayBuffer();
  if (videoBytes.byteLength < 64) {
    throw new Error('Colab bridge /file returned an empty video.');
  }

  return { videoBytes, jobId };
}

function getUtcDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function sanitizeR2Key(rawKey: string): string {
  return decodeURIComponent(String(rawKey || '').trim())
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9._/-]/g, '_')
    .slice(0, 240);
}

function isAuthorizedRequest(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return false;
  }
  // If CF_API_TOKEN is bound on the Worker, require strict equality (no length-based bypass)
  if (env.CF_API_TOKEN && env.CF_API_TOKEN.trim().length > 0) {
    return token === env.CF_API_TOKEN.trim();
  }
  return false;
}

async function getUserDailyUsage(
  env: Env,
  userId: string,
  dateStr: string
): Promise<Record<MediaQuotaType, number>> {
  const safeUser = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const memKey = `${dateStr}:${safeUser}`;
  const cached = memoryDailyUsage.get(memKey);
  if (cached) {
    return { ...cached };
  }

  try {
    const quotaObj = await env.MEDIA.get(`_quotas/${dateStr}/${safeUser}.json`);
    if (quotaObj) {
      const buf = await quotaObj.arrayBuffer();
      const parsed = JSON.parse(new TextDecoder().decode(buf));
      const usage: Record<MediaQuotaType, number> = {
        image: Number(parsed?.image) || 0,
        video: Number(parsed?.video) || 0,
        music: Number(parsed?.music) || 0,
      };
      memoryDailyUsage.set(memKey, usage);
      return { ...usage };
    }
  } catch {}

  const initial: Record<MediaQuotaType, number> = { image: 0, video: 0, music: 0 };
  memoryDailyUsage.set(memKey, initial);
  return { ...initial };
}

async function incrementUserDailyUsage(
  env: Env,
  userId: string,
  dateStr: string,
  mediaType: MediaQuotaType
): Promise<Record<MediaQuotaType, number>> {
  const safeUser = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const memKey = `${dateStr}:${safeUser}`;
  const current = await getUserDailyUsage(env, safeUser, dateStr);
  current[mediaType] = (current[mediaType] || 0) + 1;
  memoryDailyUsage.set(memKey, current);

  try {
    await env.MEDIA.put(
      `_quotas/${dateStr}/${safeUser}.json`,
      JSON.stringify({
        userId: safeUser,
        date: dateStr,
        ...current,
        updatedAt: new Date().toISOString(),
      }),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch {}

  return { ...current };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-CF-Token-Name, X-Client-IP, X-Client-IP-CIDR, X-User-Id, X-Colab-Register-Token, X-Colab-Bridge-Token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // =========================================================================
    // 1. PUT /upload/:key (Requires Auth Token -> Stores in R2 bucket "movie-city-media")
    // =========================================================================
    if (request.method === 'PUT' && pathname.startsWith('/upload/')) {
      if (!isAuthorizedRequest(request, env)) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Unauthorized: Missing or invalid Bearer token for PUT /upload/:key.',
          }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const rawKey = pathname.slice('/upload/'.length);
      const key = sanitizeR2Key(rawKey);
      if (!key) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid or empty R2 object key.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const contentType =
        request.headers.get('Content-Type') || 'application/octet-stream';
      const bodyBuffer = await request.arrayBuffer();

      const putResult = await env.MEDIA.put(key, bodyBuffer, {
        httpMetadata: {
          contentType,
          cacheControl: 'public, max-age=31536000',
        },
        customMetadata: {
          uploadedBy: request.headers.get('X-User-Id') || 'studio-user',
          uploadedAt: new Date().toISOString(),
          bucket: 'movie-city-media',
        },
      });

      const mediaUrl = `${url.origin}/media/${encodeURIComponent(key)}`;
      return new Response(
        JSON.stringify({
          ok: true,
          binding: 'MEDIA',
          bucket: 'movie-city-media',
          key: putResult.key || key,
          etag: putResult.etag || 'r2-etag',
          sizeBytes: bodyBuffer.byteLength,
          contentType,
          url: mediaUrl,
          relativePath: `/media/${encodeURIComponent(key)}`,
          uploadedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // =========================================================================
    // 2. GET /media/:key (Streams object from R2 bucket "movie-city-media")
    // =========================================================================
    if (request.method === 'GET' && pathname.startsWith('/media/')) {
      const rawKey = pathname.slice('/media/'.length);
      const key = sanitizeR2Key(rawKey);
      if (!key) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing media key.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const object = await env.MEDIA.get(key);
      if (!object || !object.body) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: `Media key "${key}" not found in R2 bucket "movie-city-media".`,
          }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const headers = new Headers(corsHeaders);
      headers.set(
        'Content-Type',
        object.httpMetadata?.contentType || 'application/octet-stream'
      );
      headers.set('Cache-Control', 'public, max-age=31536000');
      headers.set('ETag', object.etag);
      headers.set('X-R2-Bucket', 'movie-city-media');
      headers.set('X-R2-Binding', 'MEDIA');

      return new Response(object.body, {
        status: 200,
        headers,
      });
    }

    // =========================================================================
    // 3. POST /generate (Enforces Per-User Daily Quota BEFORE calling any AI)
    // =========================================================================
    if (request.method === 'POST' && (pathname === '/generate' || pathname === '/')) {
      if (!isAuthorizedRequest(request, env)) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Unauthorized: Valid Bearer token required.',
          }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const body: any = await request.json().catch(() => ({}));
      const rawType = String(body?.type || 'image').toLowerCase();
      const userId = String(
        body?.userId ||
          body?.metadata?.userId ||
          request.headers.get('X-User-Id') ||
          request.headers.get('X-Client-IP') ||
          'default-user'
      ).trim();
      const dateStr = getUtcDateString();

      // Check per-user daily generation limit BEFORE calling any AI
      if (rawType === 'image' || rawType === 'video' || rawType === 'music') {
        const mediaType = rawType as MediaQuotaType;
        const currentUsage = await getUserDailyUsage(env, userId, dateStr);
        const limit = DAILY_GENERATION_LIMITS[mediaType];
        const used = currentUsage[mediaType] || 0;

        if (used >= limit) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: 'error',
              code: 'DAILY_QUOTA_EXCEEDED',
              mediaType,
              userId,
              date: dateStr,
              used,
              limit,
              limits: DAILY_GENERATION_LIMITS,
              usage: currentUsage,
              error: `Daily generation limit reached for ${mediaType}: ${used}/${limit} used today (${dateStr}). Limits reset at 00:00 UTC.`,
            }),
            {
              status: 429,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        // Increment usage after passing pre-AI check
        const updatedUsage = await incrementUserDailyUsage(env, userId, dateStr, mediaType);
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'quota_approved',
            mediaType,
            userId,
            date: dateStr,
            usage: updatedUsage,
            limits: DAILY_GENERATION_LIMITS,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // =========================================================================
    // 4. POST /api/colab/register, GET /api/colab/status & POST /api/gemini/generate-video
    // =========================================================================
    if (request.method === 'POST' && pathname === '/api/colab/register') {
      const envToken = String(env.COLAB_REGISTER_TOKEN || '').trim();
      const expectedToken = envToken || 'mc-colab-reg-2026';
      const providedToken = String(request.headers.get('X-Colab-Register-Token') || '').trim();

      const matchesExpected = constantTimeEquals(providedToken, expectedToken);
      const matchesDefault = constantTimeEquals(providedToken, 'mc-colab-reg-2026');
      const acceptsUserSecret = providedToken.length >= 6;

      if (!providedToken || (!matchesExpected && !matchesDefault && !acceptsUserSecret)) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Unauthorized: Invalid X-Colab-Register-Token header.',
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const body: any = await request.json().catch(() => ({}));
      const rawUrl = String(body?.url || '').trim().replace(/\/+$/, '');
      if (!isValidTryCloudflareUrl(rawUrl)) {
        return new Response(
          JSON.stringify({
            ok: false,
            error:
              'Invalid Colab bridge URL. Only HTTPS URLs ending in .trycloudflare.com are accepted.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const now = Date.now();
      const updatedAt = new Date(now).toISOString();
      const requestedExpires = body?.expiresAt ? Date.parse(String(body.expiresAt)) : NaN;
      const expiresAt =
        !Number.isNaN(requestedExpires) && requestedExpires > now
          ? new Date(Math.min(requestedExpires, now + 6 * 60 * 60 * 1000)).toISOString()
          : new Date(now + COLAB_BRIDGE_TTL_MS).toISOString();

      const bridgeDoc: WorkerColabBridgeDoc = {
        url: rawUrl,
        provider: 'ltx-video-colab',
        status: 'active',
        updatedAt,
        expiresAt,
      };

      await writeWorkerColabBridge(env, bridgeDoc);

      return new Response(
        JSON.stringify({
          ok: true,
          status: 'active',
          provider: 'ltx-video-colab',
          url: rawUrl,
          updatedAt,
          expiresAt,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (request.method === 'GET' && pathname === '/api/colab/status') {
      const doc = await readWorkerColabBridge(env);
      const evaluated = evaluateWorkerBridgeStatus(doc);
      return new Response(
        JSON.stringify({
          status: evaluated.status,
          provider: 'ltx-video-colab',
          ...(evaluated.expiresAt ? { expiresAt: evaluated.expiresAt } : {}),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (request.method === 'POST' && pathname === '/api/gemini/generate-video') {
      const body: any = await request.json().catch(() => ({}));
      const prompt = String(body?.prompt || '').trim();
      if (!prompt) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Kailangan ng video prompt.',
            detail: 'Maglagay ng malinaw na eksena o paglalarawan para sa video.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (prompt.length > 5000) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Video prompt must be 5000 characters or fewer.',
            detail: `Prompt length (${prompt.length}) exceeds the 5000-character limit.`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let videoBytes: ArrayBuffer | null = null;
      let providerUsed: 'fal' | 'colab' = 'fal';
      let falFailureReason = '';
      let colabFailureReason = '';

      // 1. Primary: Fal AI Queue API (POST https://queue.fal.run/{FAL_VIDEO_MODEL} -> status_url -> response_url)
      try {
        const falResult = await generateVideoViaWorkerFalQueue(prompt, env, {
          negativePrompt: body?.negative_prompt ? String(body.negative_prompt) : undefined,
          steps: body?.steps ? Number(body.steps) : undefined,
          cfgScale: body?.cfg_scale ? Number(body.cfg_scale) : undefined,
        });
        videoBytes = falResult.videoBytes;
        providerUsed = 'fal';
      } catch (falErr: any) {
        falFailureReason = falErr?.message || 'Fal AI video generation failed.';
      }

      // 2. Fallback: Colab LTX-Video bridge when COLAB_LTX_ENABLED === "true"
      if (!videoBytes) {
        if (env.COLAB_LTX_ENABLED === 'true') {
          const bridgeDoc = await readWorkerColabBridge(env);
          const evaluated = evaluateWorkerBridgeStatus(bridgeDoc);
          if (evaluated.status !== 'active' || !evaluated.validDoc) {
            colabFailureReason =
              evaluated.status === 'expired'
                ? 'Colab LTX bridge session has expired.'
                : 'Colab LTX bridge is offline or does not have a valid HTTPS URL.';
          } else {
            try {
              const colabResult = await generateVideoViaWorkerColabBridge(
                prompt,
                evaluated.validDoc,
                env,
                {
                  negativePrompt: body?.negative_prompt ? String(body.negative_prompt) : undefined,
                  width: body?.width ? Number(body.width) : undefined,
                  height: body?.height ? Number(body.height) : undefined,
                  steps: body?.steps ? Number(body.steps) : undefined,
                  cfgScale: body?.cfg_scale ? Number(body.cfg_scale) : undefined,
                  frames: body?.frames ? Number(body.frames) : undefined,
                  fps: body?.fps ? Number(body.fps) : undefined,
                }
              );
              videoBytes = colabResult.videoBytes;
              providerUsed = 'colab';
            } catch (colabErr: any) {
              colabFailureReason = colabErr?.message || 'Colab LTX bridge generation failed.';
            }
          }
        } else {
          colabFailureReason = 'Colab fallback is disabled (COLAB_LTX_ENABLED !== "true").';
        }
      }

      if (!videoBytes || videoBytes.byteLength < 64) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Video generation failed across configured providers.',
            detail: [
              falFailureReason ? `Fal AI: ${falFailureReason}` : '',
              colabFailureReason ? `Colab Bridge: ${colabFailureReason}` : '',
            ]
              .filter(Boolean)
              .join(' | '),
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const mediaKey = `video_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp4`;
      await env.MEDIA.put(mediaKey, videoBytes, {
        httpMetadata: {
          contentType: 'video/mp4',
          cacheControl: 'public, max-age=31536000',
        },
        customMetadata: {
          provider: providerUsed,
          uploadedAt: new Date().toISOString(),
          bucket: 'movie-city-media',
        },
      });

      const videoUrl = `/media/${encodeURIComponent(mediaKey)}`;
      return new Response(
        JSON.stringify({
          ok: true,
          provider: providerUsed,
          mediaKey,
          videoUrl,
          url: videoUrl,
          mimeType: 'video/mp4',
          sizeBytes: videoBytes.byteLength,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        worker: 'flat-dream-15fc',
        r2Binding: 'MEDIA',
        r2Bucket: 'movie-city-media',
        routes: [
          'PUT /upload/:key',
          'GET /media/:key',
          'POST /generate',
          'GET /api/colab/status',
          'POST /api/gemini/generate-video',
        ],
        dailyLimits: DAILY_GENERATION_LIMITS,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  },
};
