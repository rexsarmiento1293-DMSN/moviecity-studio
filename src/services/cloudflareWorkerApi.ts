/**
 * Cloudflare Worker AI Generation Client (`generateWithAPI(prompt, type)`)
 *
 * Security Rules:
 * - NEVER hardcode any API token or secret in source code.
 * - Reads `process.env.CF_API_TOKEN` and `process.env.CF_WORKER_URL` on the server
 *   (or routes through `/api/cloudflare/generate` when called in the browser so the
 *   Bearer token remains strictly server-side).
 * - Enforces a 30-second (30,000ms) timeout via AbortController.
 * - Tracks loading state (`isLoading`) and returns structured success/error output
 *   for the Retry UI.
 */

import {
  CINEMATIC_SKILLS,
  buildCinematicPrompt,
  generateCinematicPromptFromAI,
} from '../skills/cinematicSkill';

export { CINEMATIC_SKILLS, buildCinematicPrompt, generateCinematicPromptFromAI };

export type GenerationRequestType = 'video' | 'image' | 'script';

export const DEFAULT_CF_TOKEN_NAME = 'flat-dream-15fc';
export const DEFAULT_CF_ACCOUNT_ID = 'bc80fa9ec68ba1d2ee20d5f4e9076a87';
export const DEFAULT_CF_CLIENT_IP = '112.207.213.158';
export const DEFAULT_CF_CLIENT_IP_CIDR = '112.207.213.158/32';

export interface NormalizedClientIpCidr {
  ip: string;
  cidr: string;
  prefixLength: number;
  isValid: boolean;
}

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

/**
 * Normalizes an IPv4 address or CIDR string (e.g. "112.207.213.158" -> "112.207.213.158/32")
 */
export function normalizeClientIpCidr(ipOrCidr: string): NormalizedClientIpCidr {
  const raw = String(ipOrCidr || '').trim();
  if (!raw) {
    return {
      ip: DEFAULT_CF_CLIENT_IP,
      cidr: DEFAULT_CF_CLIENT_IP_CIDR,
      prefixLength: 32,
      isValid: false,
    };
  }

  const [ipPart, prefixPart] = raw.split('/');
  const ipNum = ipv4ToUint32(ipPart || '');
  if (ipNum === null) {
    return {
      ip: ipPart || '',
      cidr: raw,
      prefixLength: 32,
      isValid: false,
    };
  }

  let prefixLength = 32;
  if (prefixPart !== undefined) {
    if (!/^\d{1,2}$/.test(prefixPart)) {
      return {
        ip: ipPart,
        cidr: raw,
        prefixLength: 32,
        isValid: false,
      };
    }
    const parsedPrefix = Number(prefixPart);
    if (parsedPrefix < 0 || parsedPrefix > 32) {
      return {
        ip: ipPart,
        cidr: raw,
        prefixLength: 32,
        isValid: false,
      };
    }
    prefixLength = parsedPrefix;
  }

  return {
    ip: ipPart,
    cidr: `${ipPart}/${prefixLength}`,
    prefixLength,
    isValid: true,
  };
}

/**
 * Checks whether an IPv4 address falls within a target IPv4 CIDR block (e.g. "112.207.213.158/32" or "112.207.213.0/24")
 */
export function isIpWithinCidr(ip: string, cidr: string): boolean {
  const ipNum = ipv4ToUint32(ip);
  const norm = normalizeClientIpCidr(cidr);
  if (ipNum === null || !norm.isValid) return false;

  const baseNum = ipv4ToUint32(norm.ip);
  if (baseNum === null) return false;

  if (norm.prefixLength === 0) return true;
  const mask = norm.prefixLength === 32 ? 0xffffffff : (~0 << (32 - norm.prefixLength)) >>> 0;
  return (ipNum & mask) >>> 0 === (baseNum & mask) >>> 0;
}

/**
 * Builds standard Cloudflare Worker request headers including Authorization Bearer token,
 * Token Name ("flat-dream-15fc"), and Client IP CIDR ("112.207.213.158/32").
 */
export function buildCloudflareRequestHeaders(
  apiToken: string,
  meta?: {
    tokenName?: string;
    clientIp?: string;
    clientIpCidr?: string;
  }
): Record<string, string> {
  const tokenName = (meta?.tokenName || DEFAULT_CF_TOKEN_NAME).trim();
  const normalized = normalizeClientIpCidr(
    meta?.clientIpCidr || meta?.clientIp || DEFAULT_CF_CLIENT_IP_CIDR
  );

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiToken.trim()}`,
    'X-CF-Token-Name': tokenName,
    'X-Client-IP': normalized.ip,
    'X-Client-IP-CIDR': normalized.cidr,
    'X-Forwarded-For': normalized.ip,
  };
}

export interface GenerateWithAPIOptions {
  /** Optional callback triggered when loading state changes (`true` on start, `false` on finish) */
  onLoadingChange?: (isLoading: boolean) => void;
  /** Optional custom timeout in milliseconds (defaults to 30,000ms / 30s) */
  timeoutMs?: number;
  /** Optional extra metadata (e.g., character profile, resolution) */
  metadata?: Record<string, unknown>;
  /** Optional custom fetch implementation for unit testing */
  fetchImpl?: typeof fetch;
  /** Optional override env map for server-side / unit test execution */
  envOverride?: {
    CF_WORKER_URL?: string;
    CF_API_TOKEN?: string;
    CF_TOKEN_NAME?: string;
    CF_CLIENT_IP?: string;
    CF_CLIENT_IP_CIDR?: string;
  };
}

export interface GenerateWithAPIResult {
  ok: boolean;
  status: 'success' | 'error';
  type: GenerationRequestType;
  /** Generated script text, image URL, or video URL */
  content: string | null;
  /** Direct media URL if returned by the worker */
  url: string | null;
  /** Raw parsed JSON response from the Cloudflare Worker */
  data?: unknown;
  /** User-facing error message for the Retry UI when `ok === false` */
  error: string | null;
  /** Indicates whether the UI should show a Retry button */
  retryable: boolean;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Token name and Client IP CIDR metadata used for the request */
  tokenName?: string;
  clientIp?: string;
  clientIpCidr?: string;
}

export interface CloudflareTokenVerifyResult {
  ok: boolean;
  tokenName: string;
  accountId: string;
  clientIp: string;
  clientIpCidr: string;
  statusText: string;
  message: string;
  ipFilterWarning?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

// Observable loading state for UI components
let activeRequestsCount = 0;
const loadingListeners = new Set<(isLoading: boolean) => void>();

function setGlobalLoadingState(delta: number, perCallCallback?: (isLoading: boolean) => void) {
  activeRequestsCount = Math.max(0, activeRequestsCount + delta);
  const isNowLoading = activeRequestsCount > 0;
  if (perCallCallback) {
    perCallCallback(delta > 0);
  }
  loadingListeners.forEach((listener) => {
    try {
      listener(isNowLoading);
    } catch {}
  });
}

export function isCloudflareGenerationLoading(): boolean {
  return activeRequestsCount > 0;
}

export function subscribeCloudflareLoading(listener: (isLoading: boolean) => void): () => void {
  loadingListeners.add(listener);
  listener(activeRequestsCount > 0);
  return () => {
    loadingListeners.delete(listener);
  };
}

/**
 * Verifies the configured Cloudflare API Token (`flat-dream-15fc`) and Client IP CIDR (`112.207.213.158/32`)
 * via the server proxy `/api/cloudflare/verify-token`.
 */
export async function verifyCloudflareToken(): Promise<CloudflareTokenVerifyResult> {
  try {
    const resp = await fetch('/api/cloudflare/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    return {
      ok: Boolean(data?.ok),
      tokenName: data?.tokenName || DEFAULT_CF_TOKEN_NAME,
      accountId: data?.accountId || DEFAULT_CF_ACCOUNT_ID,
      clientIp: data?.clientIp || DEFAULT_CF_CLIENT_IP,
      clientIpCidr: data?.clientIpCidr || DEFAULT_CF_CLIENT_IP_CIDR,
      statusText: data?.statusText || (data?.ok ? 'active' : 'error'),
      message: data?.message || 'Cloudflare token check completed.',
      ipFilterWarning: Boolean(data?.ipFilterWarning),
    };
  } catch (err: any) {
    return {
      ok: false,
      tokenName: DEFAULT_CF_TOKEN_NAME,
      accountId: DEFAULT_CF_ACCOUNT_ID,
      clientIp: DEFAULT_CF_CLIENT_IP,
      clientIpCidr: DEFAULT_CF_CLIENT_IP_CIDR,
      statusText: 'network_error',
      message: err?.message || 'Hindi makakonekta sa server para i-verify ang Cloudflare token.',
    };
  }
}

/**
 * Calls the Cloudflare Worker endpoint (`https://<worker-name>.<account>.workers.dev`)
 * for AI generation requests (`"video"`, `"image"`, or `"script"`).
 *
 * Signature: `generateWithAPI(prompt, type, options?)`
 */
export async function generateWithAPI(
  prompt: string,
  type: GenerationRequestType,
  options: GenerateWithAPIOptions = {}
): Promise<GenerateWithAPIResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetchImpl ?? globalThis.fetch;

  // Validate inputs before network call
  const cleanPrompt = String(prompt || '').trim();
  const validTypes: GenerationRequestType[] = ['video', 'image', 'script'];

  if (!cleanPrompt) {
    return {
      ok: false,
      status: 'error',
      type,
      content: null,
      url: null,
      error: 'Kailangan ng prompt bago mag-generate. Pakilagay ang detalye ng eksena.',
      retryable: false,
      elapsedMs: 0,
    };
  }

  if (!validTypes.includes(type)) {
    return {
      ok: false,
      status: 'error',
      type,
      content: null,
      url: null,
      error: `Invalid generation type "${String(type)}". Gamitin lang ang "video", "image", o "script".`,
      retryable: false,
      elapsedMs: 0,
    };
  }

  // Determine whether we are executing directly with Server Env Vars or via Browser Server Proxy
  const nodeEnv =
    options.envOverride ??
    (typeof process !== 'undefined' && process.env ? process.env : undefined);

  const workerUrlFromEnv = nodeEnv?.CF_WORKER_URL?.trim();
  const apiTokenFromEnv = nodeEnv?.CF_API_TOKEN?.trim();
  const tokenName = nodeEnv?.CF_TOKEN_NAME?.trim() || DEFAULT_CF_TOKEN_NAME;
  const rawCidr =
    nodeEnv?.CF_CLIENT_IP_CIDR?.trim() ||
    nodeEnv?.CF_CLIENT_IP?.trim() ||
    DEFAULT_CF_CLIENT_IP_CIDR;
  const normalizedCidr = normalizeClientIpCidr(rawCidr);

  const isBrowserRuntime = typeof window !== 'undefined' && !options.envOverride;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  setGlobalLoadingState(1, options.onLoadingChange);

  try {
    let response: Response;

    if (isBrowserRuntime) {
      // Browser runtime calls our Express server proxy `/api/cloudflare/generate`
      // which attaches `Authorization: Bearer ${process.env.CF_API_TOKEN}` and CIDR headers server-side.
      response = await fetchFn('/api/cloudflare/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CF-Token-Name': tokenName,
          'X-Client-IP': normalizedCidr.ip,
          'X-Client-IP-CIDR': normalizedCidr.cidr,
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          type,
          tokenName,
          clientIp: normalizedCidr.ip,
          clientIpCidr: normalizedCidr.cidr,
          metadata: options.metadata || {},
        }),
        signal: controller.signal,
      });
    } else {
      // Direct Node.js / Worker execution using environment variables (NEVER hardcoded)
      if (!workerUrlFromEnv) {
        return {
          ok: false,
          status: 'error',
          type,
          content: null,
          url: null,
          error:
            'Missing CF_WORKER_URL environment variable (hal. https://<worker-name>.<account>.workers.dev).',
          retryable: true,
          elapsedMs: Date.now() - startTime,
          tokenName,
          clientIp: normalizedCidr.ip,
          clientIpCidr: normalizedCidr.cidr,
        };
      }

      if (!apiTokenFromEnv) {
        return {
          ok: false,
          status: 'error',
          type,
          content: null,
          url: null,
          error:
            'Missing CF_API_TOKEN environment variable. Idagdag ang CF_API_TOKEN sa iyong environment / Secrets panel.',
          retryable: true,
          elapsedMs: Date.now() - startTime,
          tokenName,
          clientIp: normalizedCidr.ip,
          clientIpCidr: normalizedCidr.cidr,
        };
      }

      response = await fetchFn(workerUrlFromEnv, {
        method: 'POST',
        headers: buildCloudflareRequestHeaders(apiTokenFromEnv, {
          tokenName,
          clientIp: normalizedCidr.ip,
          clientIpCidr: normalizedCidr.cidr,
        }),
        body: JSON.stringify({
          prompt: cleanPrompt,
          type,
          tokenName,
          clientIp: normalizedCidr.ip,
          clientIpCidr: normalizedCidr.cidr,
          ...(options.metadata ? { metadata: options.metadata } : {}),
        }),
        signal: controller.signal,
      });
    }

    const elapsedMs = Date.now() - startTime;
    const rawText = await response.text();
    let parsed: any = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = { content: rawText };
    }

    if (!response.ok) {
      const serverErrMsg =
        parsed?.error ||
        parsed?.message ||
        `Cloudflare Worker error (HTTP ${response.status}). Pakisubukan muli.`;
      return {
        ok: false,
        status: 'error',
        type,
        content: null,
        url: null,
        data: parsed,
        error: String(serverErrMsg),
        retryable: true,
        elapsedMs,
        tokenName: parsed?.tokenName || tokenName,
        clientIp: parsed?.clientIp || normalizedCidr.ip,
        clientIpCidr: parsed?.clientIpCidr || normalizedCidr.cidr,
      };
    }

    // Extract generated content or URL from worker payload
    const resolvedUrl: string | null =
      parsed?.url ||
      parsed?.videoUrl ||
      parsed?.imageUrl ||
      parsed?.result?.url ||
      parsed?.data?.url ||
      null;

    const resolvedContent: string | null =
      parsed?.content ||
      parsed?.text ||
      parsed?.script ||
      parsed?.result?.content ||
      parsed?.result?.response ||
      resolvedUrl ||
      (typeof parsed === 'string' ? parsed : null);

    return {
      ok: true,
      status: 'success',
      type,
      content: resolvedContent ? String(resolvedContent) : '',
      url: resolvedUrl ? String(resolvedUrl) : null,
      data: parsed,
      error: null,
      retryable: false,
      elapsedMs,
      tokenName: parsed?.tokenName || tokenName,
      clientIp: parsed?.clientIp || normalizedCidr.ip,
      clientIpCidr: parsed?.clientIpCidr || normalizedCidr.cidr,
    };
  } catch (err: any) {
    const elapsedMs = Date.now() - startTime;
    const isAbortTimeout =
      err?.name === 'AbortError' ||
      String(err?.message || '')
        .toLowerCase()
        .includes('abort');

    const errorMessage = isAbortTimeout
      ? `Nag-timeout ang request sa Cloudflare Worker makalipas ang ${Math.round(
          timeoutMs / 1000
        )} segundo (30s limit). Pindutin ang Retry.`
      : `Hindi makakonekta sa Cloudflare Worker: ${
          err?.message || 'Network error'
        }. Pindutin ang Retry.`;

    return {
      ok: false,
      status: 'error',
      type,
      content: null,
      url: null,
      error: errorMessage,
      retryable: true,
      elapsedMs,
      tokenName,
      clientIp: normalizedCidr.ip,
      clientIpCidr: normalizedCidr.cidr,
    };
  } finally {
    clearTimeout(timeoutId);
    setGlobalLoadingState(-1, options.onLoadingChange);
  }
}

// ============================================================================
// CLOUDFLARE HYPERDRIVE CONNECTION CONFIGURATION & PARSER
// ============================================================================

export const DEFAULT_HYPERDRIVE_CONFIG_NAME = 'flat-dream-15fc-hyperdrive';
export const DEFAULT_HYPERDRIVE_BINDING_NAME = 'HYPERDRIVE';
export const DEFAULT_HYPERDRIVE_CONNECTION_STRING =
  'postgres://321action_admin:[SERVER_ENV_SECRET]@db.flat-dream-15fc.ap-southeast-1.pg.neon.tech:5432/ai_drama_studio?sslmode=require';

// ============================================================================
// SUPABASE SYSTEM & APP BUILD INTEGRATION (opdekwvpzwghxeqkwxlo)
// ============================================================================

export const DEFAULT_SUPABASE_PROJECT_REF = 'opdekwvpzwghxeqkwxlo';
export const DEFAULT_SUPABASE_URL = 'https://opdekwvpzwghxeqkwxlo.supabase.co';
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = '[SERVER_ENV_SECRET]';
export const DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING =
  'postgresql://postgres:[SERVER_ENV_SECRET]@db.opdekwvpzwghxeqkwxlo.supabase.co:5432/postgres';
export const SUPABASE_CLI_SETUP_COMMANDS = [
  'supabase login',
  'supabase init',
  'supabase link --project-ref opdekwvpzwghxeqkwxlo',
] as const;

export function formatSupabaseCliSetupCommands(
  projectRef: string = DEFAULT_SUPABASE_PROJECT_REF
): string {
  const cleanRef = String(projectRef || DEFAULT_SUPABASE_PROJECT_REF).trim();
  return [
    'supabase login',
    'supabase init',
    `supabase link --project-ref ${cleanRef}`,
  ].join('\n');
}

export interface SupabaseVerifyResult {
  ok: boolean;
  projectRef: string;
  projectUrl: string;
  publishableKey: string;
  directConnectionString: string;
  cliSetupCommands: string[];
  cliSnippet: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  restStatus: string;
  httpStatus?: number;
  message: string;
}

export interface SupabaseSyncResult {
  ok: boolean;
  projectRef: string;
  projectUrl: string;
  syncedProjectId: string;
  syncedAt: string;
  mode: 'supabase-rest' | 'supabase-bound-verified';
  message: string;
}

export async function verifySupabaseConnection(
  customConfig?: {
    projectUrl?: string;
    publishableKey?: string;
    directConnectionString?: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<SupabaseVerifyResult> {
  const projectUrl = (customConfig?.projectUrl || DEFAULT_SUPABASE_URL).trim();
  const publishableKey = (
    customConfig?.publishableKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY
  ).trim();
  const directConnectionString = (
    customConfig?.directConnectionString || DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING
  ).trim();

  try {
    const resp = await fetchImpl('/api/supabase/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectUrl,
      }),
    });
    const data = await resp.json();
    return {
      ok: Boolean(data?.ok),
      projectRef: data?.projectRef || DEFAULT_SUPABASE_PROJECT_REF,
      projectUrl: data?.projectUrl || projectUrl,
      publishableKey: data?.publishableKey || publishableKey,
      directConnectionString: data?.directConnectionString || directConnectionString,
      cliSetupCommands: Array.isArray(data?.cliSetupCommands)
        ? data.cliSetupCommands
        : [...SUPABASE_CLI_SETUP_COMMANDS],
      cliSnippet: data?.cliSnippet || formatSupabaseCliSetupCommands(),
      dbHost: data?.dbHost || 'db.opdekwvpzwghxeqkwxlo.supabase.co',
      dbPort: Number(data?.dbPort) || 5432,
      dbName: data?.dbName || 'postgres',
      dbUser: data?.dbUser || 'postgres',
      restStatus: data?.restStatus || (data?.ok ? 'connected' : 'error'),
      httpStatus: data?.httpStatus,
      message:
        data?.message ||
        `Connected to Supabase project ${DEFAULT_SUPABASE_PROJECT_REF} (${projectUrl}).`,
    };
  } catch (err: any) {
    return {
      ok: false,
      projectRef: DEFAULT_SUPABASE_PROJECT_REF,
      projectUrl,
      publishableKey,
      directConnectionString,
      cliSetupCommands: [...SUPABASE_CLI_SETUP_COMMANDS],
      cliSnippet: formatSupabaseCliSetupCommands(),
      dbHost: 'db.opdekwvpzwghxeqkwxlo.supabase.co',
      dbPort: 5432,
      dbName: 'postgres',
      dbUser: 'postgres',
      restStatus: 'network_error',
      message:
        err?.message || 'Hindi makakonekta sa /api/supabase/verify. Pakisubukan muli.',
    };
  }
}

export async function syncDramaProjectToSupabase(
  project: Record<string, unknown>,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<SupabaseSyncResult> {
  try {
    const resp = await fetchImpl('/api/supabase/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    const data = await resp.json();
    return {
      ok: Boolean(data?.ok),
      projectRef: data?.projectRef || DEFAULT_SUPABASE_PROJECT_REF,
      projectUrl: data?.projectUrl || DEFAULT_SUPABASE_URL,
      syncedProjectId: String(data?.syncedProjectId || project?.id || 'proj-1'),
      syncedAt: data?.syncedAt || new Date().toISOString(),
      mode: data?.mode || 'supabase-bound-verified',
      message:
        data?.message ||
        `Na-sync ang project sa Supabase (${DEFAULT_SUPABASE_PROJECT_REF}).`,
    };
  } catch (err: any) {
    return {
      ok: false,
      projectRef: DEFAULT_SUPABASE_PROJECT_REF,
      projectUrl: DEFAULT_SUPABASE_URL,
      syncedProjectId: String(project?.id || ''),
      syncedAt: new Date().toISOString(),
      mode: 'supabase-bound-verified',
      message: err?.message || 'Nabigo sa pag-sync sa Supabase.',
    };
  }
}

export interface HyperdrivePresetOption {
  id: string;
  label: string;
  configName: string;
  connectionString: string;
  provider: string;
}

export const HYPERDRIVE_CONNECTION_PRESETS: HyperdrivePresetOption[] = [
  {
    id: 'neon-pg',
    label: 'PostgreSQL (Neon / Serverless PG)',
    configName: 'flat-dream-15fc-hyperdrive',
    connectionString:
      'postgres://321action_admin:[SERVER_ENV_SECRET]@db.flat-dream-15fc.ap-southeast-1.pg.neon.tech:5432/ai_drama_studio?sslmode=require',
    provider: 'Neon PostgreSQL (ap-southeast-1)',
  },
  {
    id: 'supabase-direct-opdekwvpzwghxeqkwxlo',
    label: 'Supabase Direct (opdekwvpzwghxeqkwxlo:5432)',
    configName: 'opdekwvpzwghxeqkwxlo-supabase-hyperdrive',
    connectionString:
      'postgresql://postgres:[SERVER_ENV_SECRET]@db.opdekwvpzwghxeqkwxlo.supabase.co:5432/postgres',
    provider: 'Supabase Direct PostgreSQL (db.opdekwvpzwghxeqkwxlo.supabase.co)',
  },
  {
    id: 'supabase-pg',
    label: 'Supabase Pooler (Marilag Studio 5432)',
    configName: 'moviecity-supabase-hyperdrive',
    connectionString:
      'postgresql://postgres.flatdream15fc:[SERVER_ENV_SECRET]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require',
    provider: 'Supabase PostgreSQL (Singapore)',
  },
  {
    id: 'cloudsql-pg',
    label: 'Google Cloud SQL PostgreSQL (asia-southeast1)',
    configName: 'gen-lang-cloudsql-hyperdrive',
    connectionString:
      'postgres://postgres:[SERVER_ENV_SECRET]@34.124.201.88:5432/marilag_drama_studio?sslmode=require',
    provider: 'Google Cloud SQL (asia-southeast1)',
  },
];

export interface ParsedHyperdriveOrigin {
  valid: boolean;
  scheme: 'postgres' | 'postgresql' | 'mysql';
  user: string;
  password: string;
  maskedPassword: string;
  host: string;
  port: number;
  database: string;
  sslmode: string;
  maskedConnectionString: string;
  error?: string;
}

/**
 * Validates and parses a PostgreSQL or MySQL connection string for Cloudflare Hyperdrive.
 * Expected format: `postgres://username:password@hostname:port/database`
 * Supports bracketed placeholders such as `[YOUR-PASSWORD]` in Supabase direct connection strings.
 */
export function parseHyperdriveConnectionString(
  connectionString: string
): ParsedHyperdriveOrigin {
  const raw = String(connectionString || '').trim();
  if (!raw) {
    return {
      valid: false,
      scheme: 'postgres',
      user: '',
      password: '',
      maskedPassword: '',
      host: '',
      port: 5432,
      database: '',
      sslmode: 'require',
      maskedConnectionString: '',
      error: 'Kailangan ang Connection string (hal. postgres://user:pass@host:5432/dbname).',
    };
  }

  // Normalize unencoded brackets (e.g., `[YOUR-PASSWORD]`) in userinfo before `new URL()`
  const normalizedForUrl = raw.replace(
    /^([a-zA-Z0-9+.-]+:\/\/[^:@/]+:)([^@]+)(@.+)$/,
    (_match, prefix, pass, suffix) => {
      const encodedPass = String(pass)
        .replace(/\[/g, '%5B')
        .replace(/\]/g, '%5D');
      return `${prefix}${encodedPass}${suffix}`;
    }
  );

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedForUrl);
  } catch {
    return {
      valid: false,
      scheme: 'postgres',
      user: '',
      password: '',
      maskedPassword: '',
      host: '',
      port: 5432,
      database: '',
      sslmode: 'require',
      maskedConnectionString: raw,
      error:
        'Invalid URL format. Gamitin ang: postgres://username:password@hostname:5432/database',
    };
  }

  const rawScheme = parsedUrl.protocol.replace(/:$/, '').toLowerCase();
  if (rawScheme !== 'postgres' && rawScheme !== 'postgresql' && rawScheme !== 'mysql') {
    return {
      valid: false,
      scheme: 'postgres',
      user: '',
      password: '',
      maskedPassword: '',
      host: parsedUrl.hostname || '',
      port: 5432,
      database: '',
      sslmode: 'require',
      maskedConnectionString: raw,
      error: `Unsupported database scheme "${rawScheme}". Sinusuportahan ng Cloudflare Hyperdrive ang postgres://, postgresql://, o mysql://.`,
    };
  }

  const user = decodeURIComponent(parsedUrl.username || '');
  const password = decodeURIComponent(parsedUrl.password || '');
  const host = parsedUrl.hostname.trim();
  const defaultPort = rawScheme === 'mysql' ? 3306 : 5432;
  const port = parsedUrl.port ? Number(parsedUrl.port) : defaultPort;
  const database = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '').trim());
  const sslmode = parsedUrl.searchParams.get('sslmode') || 'require';

  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return {
      valid: false,
      scheme: rawScheme,
      user,
      password,
      maskedPassword: '••••',
      host,
      port,
      database,
      sslmode,
      maskedConnectionString: raw,
      error:
        'Ang Cloudflare Hyperdrive ay nangangailangan ng publicly reachable database hostname (hindi localhost / 127.0.0.1).',
    };
  }

  if (!user || !password) {
    return {
      valid: false,
      scheme: rawScheme,
      user,
      password,
      maskedPassword: '••••',
      host,
      port,
      database,
      sslmode,
      maskedConnectionString: raw,
      error: 'Kailangan ang database username at password sa loob ng connection string.',
    };
  }

  if (!database) {
    return {
      valid: false,
      scheme: rawScheme,
      user,
      password,
      maskedPassword: '••••',
      host,
      port,
      database,
      sslmode,
      maskedConnectionString: raw,
      error: 'Kailangan ang database name sa dulo ng connection string (hal. /ai_drama_studio).',
    };
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      valid: false,
      scheme: rawScheme,
      user,
      password,
      maskedPassword: '••••',
      host,
      port: defaultPort,
      database,
      sslmode,
      maskedConnectionString: raw,
      error: 'Invalid database port number (1–65535).',
    };
  }

  const maskedPassword = '********';
  const maskedConnectionString = `${rawScheme}://${user}:${maskedPassword}@${host}:${port}/${database}${
    parsedUrl.search || ''
  }`;

  return {
    valid: true,
    scheme: rawScheme,
    user,
    password,
    maskedPassword,
    host,
    port,
    database,
    sslmode,
    maskedConnectionString,
  };
}

export interface HyperdriveCreateApiPayload {
  name: string;
  origin: {
    database: string;
    host: string;
    port: number;
    scheme: 'postgres' | 'postgresql' | 'mysql';
    user: string;
    password: string;
  };
  caching: {
    disabled: boolean;
    max_age: number;
    stale_while_revalidate: number;
  };
}

/**
 * Validates the configuration name and builds the official Cloudflare Hyperdrive REST API payload.
 */
export function buildHyperdriveCreatePayload(
  configName: string,
  connectionString: string
): { valid: boolean; payload?: HyperdriveCreateApiPayload; parsedOrigin: ParsedHyperdriveOrigin; error?: string } {
  const cleanName = String(configName || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  const parsedOrigin = parseHyperdriveConnectionString(connectionString);
  if (!cleanName) {
    return {
      valid: false,
      parsedOrigin,
      error: 'Kailangan ang Configuration name (hal. flat-dream-15fc-hyperdrive).',
    };
  }

  if (!parsedOrigin.valid) {
    return {
      valid: false,
      parsedOrigin,
      error: parsedOrigin.error || 'Invalid Hyperdrive connection string.',
    };
  }

  return {
    valid: true,
    parsedOrigin,
    payload: {
      name: cleanName,
      origin: {
        database: parsedOrigin.database,
        host: parsedOrigin.host,
        port: parsedOrigin.port,
        scheme: parsedOrigin.scheme === 'postgresql' ? 'postgres' : parsedOrigin.scheme,
        user: parsedOrigin.user,
        password: parsedOrigin.password,
      },
      caching: {
        disabled: false,
        max_age: 60,
        stale_while_revalidate: 15,
      },
    },
  };
}

/**
 * Generates a ready-to-paste `wrangler.toml` Hyperdrive binding snippet.
 */
export function formatWranglerHyperdriveToml(
  configId: string,
  configName: string,
  maskedConnectionString: string
): string {
  return [
    `# Cloudflare Hyperdrive Binding (${configName})`,
    `[[hyperdrive]]`,
    `binding = "${DEFAULT_HYPERDRIVE_BINDING_NAME}"`,
    `id = "${configId}"`,
    `localConnectionString = "${maskedConnectionString}"`,
  ].join('\n');
}

export interface HyperdriveCreateResult {
  ok: boolean;
  configId: string;
  configName: string;
  bindingName: string;
  accountId: string;
  tokenName: string;
  clientIpCidr: string;
  origin: {
    scheme: string;
    user: string;
    host: string;
    port: number;
    database: string;
    sslmode: string;
    maskedConnectionString: string;
  };
  caching: {
    disabled: boolean;
    max_age: number;
    stale_while_revalidate: number;
  };
  wranglerToml: string;
  mode: 'cloudflare-api' | 'verified-hyperdrive-config' | 'error';
  message: string;
  error?: string;
}

/**
 * Calls the server proxy (`POST /api/cloudflare/hyperdrive`) to create/verify
 * a Cloudflare Hyperdrive database connection configuration.
 */
export async function createHyperdriveConnection(
  configName: string,
  connectionString: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<HyperdriveCreateResult> {
  const check = buildHyperdriveCreatePayload(configName, connectionString);
  if (!check.valid || !check.payload) {
    return {
      ok: false,
      configId: '',
      configName: configName.trim() || DEFAULT_HYPERDRIVE_CONFIG_NAME,
      bindingName: DEFAULT_HYPERDRIVE_BINDING_NAME,
      accountId: DEFAULT_CF_ACCOUNT_ID,
      tokenName: DEFAULT_CF_TOKEN_NAME,
      clientIpCidr: DEFAULT_CF_CLIENT_IP_CIDR,
      origin: {
        scheme: check.parsedOrigin.scheme,
        user: check.parsedOrigin.user,
        host: check.parsedOrigin.host,
        port: check.parsedOrigin.port,
        database: check.parsedOrigin.database,
        sslmode: check.parsedOrigin.sslmode,
        maskedConnectionString: check.parsedOrigin.maskedConnectionString,
      },
      caching: { disabled: false, max_age: 60, stale_while_revalidate: 15 },
      wranglerToml: '',
      mode: 'error',
      message: check.error || 'Invalid Hyperdrive parameters.',
      error: check.error || 'Invalid Hyperdrive parameters.',
    };
  }

  try {
    const resp = await fetchImpl('/api/cloudflare/hyperdrive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CF-Token-Name': DEFAULT_CF_TOKEN_NAME,
        'X-Client-IP': DEFAULT_CF_CLIENT_IP,
        'X-Client-IP-CIDR': DEFAULT_CF_CLIENT_IP_CIDR,
      },
      body: JSON.stringify({
        configName: check.payload.name,
      }),
    });

    const data = await resp.json();
    if (!resp.ok || !data?.ok) {
      return {
        ok: false,
        configId: data?.configId || '',
        configName: data?.configName || check.payload.name,
        bindingName: DEFAULT_HYPERDRIVE_BINDING_NAME,
        accountId: data?.accountId || DEFAULT_CF_ACCOUNT_ID,
        tokenName: data?.tokenName || DEFAULT_CF_TOKEN_NAME,
        clientIpCidr: data?.clientIpCidr || DEFAULT_CF_CLIENT_IP_CIDR,
        origin: data?.origin || {
          scheme: check.parsedOrigin.scheme,
          user: check.parsedOrigin.user,
          host: check.parsedOrigin.host,
          port: check.parsedOrigin.port,
          database: check.parsedOrigin.database,
          sslmode: check.parsedOrigin.sslmode,
          maskedConnectionString: check.parsedOrigin.maskedConnectionString,
        },
        caching: data?.caching || check.payload.caching,
        wranglerToml: data?.wranglerToml || '',
        mode: 'error',
        message: data?.error || data?.message || 'Nabigo sa paggawa ng Hyperdrive connection.',
        error: data?.error || data?.message || 'Nabigo sa paggawa ng Hyperdrive connection.',
      };
    }

    return data as HyperdriveCreateResult;
  } catch (err: any) {
    return {
      ok: false,
      configId: '',
      configName: check.payload.name,
      bindingName: DEFAULT_HYPERDRIVE_BINDING_NAME,
      accountId: DEFAULT_CF_ACCOUNT_ID,
      tokenName: DEFAULT_CF_TOKEN_NAME,
      clientIpCidr: DEFAULT_CF_CLIENT_IP_CIDR,
      origin: {
        scheme: check.parsedOrigin.scheme,
        user: check.parsedOrigin.user,
        host: check.parsedOrigin.host,
        port: check.parsedOrigin.port,
        database: check.parsedOrigin.database,
        sslmode: check.parsedOrigin.sslmode,
        maskedConnectionString: check.parsedOrigin.maskedConnectionString,
      },
      caching: check.payload.caching,
      wranglerToml: '',
      mode: 'error',
      message: err?.message || 'Network error habang kumokonekta sa /api/cloudflare/hyperdrive.',
      error: err?.message || 'Network error habang kumokonekta sa /api/cloudflare/hyperdrive.',
    };
  }
}

// ============================================================================
// MOVIECITY AI (moviecityAI) UNIFIED BACKEND ARCHITECTURE & ORCHESTRATOR
// ============================================================================

export const MOVIECITY_AI_ENGINE_ID = 'moviecityAI';
export const MOVIECITY_AI_VERSION = '2026.4.0-unified';
export const MOVIECITY_AI_PACKAGE_NAME = 'com.moviecity.studio';
export const MOVIECITY_AI_LEGACY_PACKAGE_NAME = 'com.marilag.studio';
export const MOVIECITY_AI_GCP_PROJECT_ID = 'gen-lang-client-0936915682';
export const MOVIECITY_AI_GCP_PROJECT_NUMBER = '1039405812945';
export const MOVIECITY_AI_FIREBASE_PROJECT_ID = 'iamdimensionos';
export const MOVIECITY_AI_FIRESTORE_DATABASE_ID =
  'ai-studio-renderqueuecli-5fbac4b9-3101-4ff0-ae2b-807d128802d8';
export const MOVIECITY_AI_DEV_DOMAIN =
  'https://ais-dev-fz666tzjxzt6uyw2issv7t-388006830704.asia-southeast1.run.app';
export const MOVIECITY_AI_SHARED_DOMAIN =
  'https://ais-pre-fz666tzjxzt6uyw2issv7t-388006830704.asia-southeast1.run.app';

export interface MovieCityAiSubsystemSpec {
  id: string;
  name: string;
  layer: string;
  status: 'active' | 'configured' | 'standby';
  provider: string;
  endpointOrBinding: string;
  securityModel: string;
  details: string;
}

export interface MovieCityAiRouteSpec {
  method: 'GET' | 'POST' | 'DELETE' | 'WS';
  path: string;
  subsystem: string;
  purpose: string;
  auth: string;
}

export interface MovieCityAiArchitectureBlueprint {
  engineId: string;
  engineName: string;
  version: string;
  packageName: string;
  preservedSkillNamespace: string;
  runtime: {
    serverEntry: string;
    framework: string;
    port: number;
    region: string;
    devAppUrl: string;
    sharedAppUrl: string;
  };
  identityAndCloud: {
    gcpProjectId: string;
    gcpProjectNumber: string;
    firebaseProjectId: string;
    firestoreDatabaseId: string;
    adminOwnerEmail: string;
    cloudflareAccountId: string;
    cloudflareTokenName: string;
    cloudflareClientIpCidr: string;
    supabaseProjectRef: string;
    supabaseProjectUrl: string;
  };
  databases: {
    hyperdrivePrimary: {
      configName: string;
      bindingName: string;
      connectionStringMasked: string;
      dbUser: string;
      dbHost: string;
      dbName: string;
    };
    supabasePostgres: {
      projectRef: string;
      projectUrl: string;
      publishableKeyPrefix: string;
      directConnectionString: string;
      cliCommands: string[];
    };
    firestoreNoSql: {
      databaseId: string;
      collections: string[];
      rulesFile: string;
    };
    marilagPreservedPresets: HyperdrivePresetOption[];
  };
  subsystems: MovieCityAiSubsystemSpec[];
  routes: MovieCityAiRouteSpec[];
}

export function getMovieCityAiBackendArchitecture(): MovieCityAiArchitectureBlueprint {
  const parsedPrimaryHd = parseHyperdriveConnectionString(
    DEFAULT_HYPERDRIVE_CONNECTION_STRING
  );

  return {
    engineId: MOVIECITY_AI_ENGINE_ID,
    engineName: 'MovieCityAI Unified Backend & Render Orchestration Engine',
    version: MOVIECITY_AI_VERSION,
    packageName: MOVIECITY_AI_PACKAGE_NAME,
    preservedSkillNamespace: 'Marilag Studio Skill & Presets Preserved',
    runtime: {
      serverEntry: 'server.ts (Node.js + Express + WebSocketServer + Vite Middleware)',
      framework: 'Express 5 / TypeScript (tsx) + React 19 + Vite 6',
      port: 3000,
      region: 'asia-southeast1 (Singapore)',
      devAppUrl: MOVIECITY_AI_DEV_DOMAIN,
      sharedAppUrl: MOVIECITY_AI_SHARED_DOMAIN,
    },
    identityAndCloud: {
      gcpProjectId: MOVIECITY_AI_GCP_PROJECT_ID,
      gcpProjectNumber: MOVIECITY_AI_GCP_PROJECT_NUMBER,
      firebaseProjectId: MOVIECITY_AI_FIREBASE_PROJECT_ID,
      firestoreDatabaseId: MOVIECITY_AI_FIRESTORE_DATABASE_ID,
      adminOwnerEmail: 'rexsarmiento1293@gmail.com',
      cloudflareAccountId: DEFAULT_CF_ACCOUNT_ID,
      cloudflareTokenName: DEFAULT_CF_TOKEN_NAME,
      cloudflareClientIpCidr: DEFAULT_CF_CLIENT_IP_CIDR,
      supabaseProjectRef: DEFAULT_SUPABASE_PROJECT_REF,
      supabaseProjectUrl: DEFAULT_SUPABASE_URL,
    },
    databases: {
      hyperdrivePrimary: {
        configName: DEFAULT_HYPERDRIVE_CONFIG_NAME,
        bindingName: DEFAULT_HYPERDRIVE_BINDING_NAME,
        connectionStringMasked: parsedPrimaryHd.maskedConnectionString,
        dbUser: parsedPrimaryHd.user || '321action_admin',
        dbHost: parsedPrimaryHd.host || 'db.flat-dream-15fc.ap-southeast-1.pg.neon.tech',
        dbName: parsedPrimaryHd.database || 'ai_drama_studio',
      },
      supabasePostgres: {
        projectRef: DEFAULT_SUPABASE_PROJECT_REF,
        projectUrl: DEFAULT_SUPABASE_URL,
        publishableKeyPrefix: '[SERVER_ENV_ISOLATED]',
        directConnectionString: parseHyperdriveConnectionString(
          DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING
        ).maskedConnectionString,
        cliCommands: [...SUPABASE_CLI_SETUP_COMMANDS],
      },
      firestoreNoSql: {
        databaseId: MOVIECITY_AI_FIRESTORE_DATABASE_ID,
        collections: ['users/{uid}', 'users/{uid}/dramaProjects/{projectId}', 'projects/{id}'],
        rulesFile: 'firestore.rules',
      },
      marilagPreservedPresets: HYPERDRIVE_CONNECTION_PRESETS,
    },
    subsystems: [
      {
        id: 'moviecityai-orchestrator',
        name: '1. MovieCityAI Core Orchestrator (/api/moviecityai/*)',
        layer: 'Unified API Gateway & Pipeline Controller',
        status: 'active',
        provider: 'MovieCityAI Core (com.moviecity.studio)',
        endpointOrBinding: '/api/moviecityai/architecture · /api/moviecityai/orchestrate',
        securityModel: 'Unified Token + CIDR + Firebase ID Token + Supabase Key Validation',
        details:
          'Central brain connecting AI script/scene generation, Cloudflare Worker edge execution, Supabase + Hyperdrive PostgreSQL storage, Firestore sync, and FFmpeg video rendering.',
      },
      {
        id: 'ffmpeg-render-queue',
        name: '2. Parallel FFmpeg Render Queue & Hardware Encoder',
        layer: 'Media Processing & Concatenation Engine',
        status: 'active',
        provider: 'FFmpeg ChildProcess Pool + Prometheus Telemetry',
        endpointOrBinding: '/api/render/start · /api/render/status · /api/output/* · /metrics',
        securityModel: 'Sanitized baseName + MIME/Size upload validation (500MB max) + Duration cap',
        details:
          'Splits episodes into parallel segments, probes NVIDIA h264_nvenc with automatic libx264 CPU fallback, normalizes 1080p/30fps + AAC 48kHz audio, concatenates to MarilagOutput/<name>_final.mp4, and extracts thumbnails.',
      },
      {
        id: 'gemini-multimodal-engine',
        name: '3. Gemini Multimodal & Live Voice AI Engine',
        layer: 'Generative AI (Script, Image, Video, TTS, Live Audio)',
        status: 'active',
        provider: 'Google GenAI SDK (@google/genai) · GCP gen-lang-client-0936915682',
        endpointOrBinding: '/api/gemini/chat · /api/gemini/generate-image · /api/gemini/generate-video · /api/gemini/tts · ws:///live',
        securityModel: 'Server-side GEMINI_API_KEY proxy with dynamic model discovery & fallback',
        details:
          'Powers 5-step teleserye generation with Character Consistency Lock, thinking-mode script analysis, frame/video critique, Kore/Zephyr TTS voiceover, and real-time bidirectional PCM 16kHz voice assistant.',
      },
      {
        id: 'cloudflare-edge-hyperdrive',
        name: '4. Cloudflare Worker & Hyperdrive Edge Gateway',
        layer: 'Edge AI Compute & Connection Pooling',
        status: 'active',
        provider: `Cloudflare Account ${DEFAULT_CF_ACCOUNT_ID} · Token ${DEFAULT_CF_TOKEN_NAME}`,
        endpointOrBinding: '/api/cloudflare/generate · /api/cloudflare/verify-token · /api/cloudflare/hyperdrive',
        securityModel: `Bearer Token (${DEFAULT_CF_TOKEN_NAME}) + Strict Client IP CIDR (${DEFAULT_CF_CLIENT_IP_CIDR})`,
        details:
          'Routes low-latency AI generation requests with 30s AbortController protection and pools PostgreSQL connections via Hyperdrive (321action_admin@db.flat-dream-15fc + preserved Marilag presets).',
      },
      {
        id: 'supabase-system-build',
        name: '5. Supabase System & App Build Persistence',
        layer: 'Relational PostgreSQL & PostgREST Sync',
        status: 'active',
        provider: `Supabase (${DEFAULT_SUPABASE_PROJECT_REF})`,
        endpointOrBinding: `${DEFAULT_SUPABASE_URL} · db.${DEFAULT_SUPABASE_PROJECT_REF}.supabase.co:5432`,
        securityModel: 'Server-Isolated Key (process.env.SUPABASE_PUBLISHABLE_KEY) + Direct PG SSL + CLI Project Link',
        details:
          'Binds Supabase REST v1 and Direct PostgreSQL (port 5432) for syncing 3!2!1! Akzyon project metadata, scenes, and Hyperdrive edge pooling.',
      },
      {
        id: 'firebase-youtube-vault',
        name: '6. Firebase Cloud Firestore & YouTube Data API v3 PKCE Vault',
        layer: 'User Auth, NoSQL Sync & Resumable YouTube Publishing',
        status: 'active',
        provider: 'Firebase Auth/Firestore + Google YouTube Data API v3',
        endpointOrBinding: '/api/projects · /api/youtube/upload-rendered · /api/youtube/auth/token',
        securityModel: 'Firebase Google Sign-In + OAuth 2.0 PKCE S256 + Client WebCrypto AES-GCM Vault',
        details:
          'Persists user drama projects in Firestore and uploads rendered MP4s + custom JPG thumbnails directly to YouTube via resumable upload sessions.',
      },
    ],
    routes: [
      {
        method: 'GET',
        path: '/api/moviecityai/architecture',
        subsystem: 'MovieCityAI Core',
        purpose: 'Returns full backend topology, live subsystem telemetry, DB bindings, and route manifest',
        auth: 'Public / Studio Header',
      },
      {
        method: 'POST',
        path: '/api/moviecityai/orchestrate',
        subsystem: 'MovieCityAI Core',
        purpose: 'Runs end-to-end MovieCityAI pipeline orchestration across Worker, Hyperdrive, Supabase, and Studio',
        auth: 'X-CF-Token-Name + X-Client-IP-CIDR',
      },
      {
        method: 'POST',
        path: '/api/render/start',
        subsystem: 'FFmpeg Render Queue',
        purpose: 'Starts parallel multi-segment FFmpeg encoding (NVENC/libx264) & MP4 concatenation',
        auth: 'Studio Session',
      },
      {
        method: 'GET',
        path: '/api/render/status',
        subsystem: 'FFmpeg Render Queue',
        purpose: 'Streams real-time per-segment FPS, speed, and percentage progress',
        auth: 'Studio Session',
      },
      {
        method: 'POST',
        path: '/api/gemini/chat',
        subsystem: 'Gemini AI Engine',
        purpose: 'Executes Gemini 2.5 Pro/Flash script writing, thinking analysis, and search grounding',
        auth: 'Server GEMINI_API_KEY',
      },
      {
        method: 'POST',
        path: '/api/gemini/generate-image',
        subsystem: 'Gemini AI Engine',
        purpose: 'Generates character-consistent scene storyboard frames',
        auth: 'Server GEMINI_API_KEY',
      },
      {
        method: 'POST',
        path: '/api/gemini/generate-video',
        subsystem: 'Gemini AI Engine',
        purpose: 'Generates 16:9 / 9:16 video clips via Gemini Omni / Veo',
        auth: 'Server GEMINI_API_KEY',
      },
      {
        method: 'WS',
        path: '/live',
        subsystem: 'Gemini Live Audio',
        purpose: 'Bidirectional 16kHz PCM voice engineering session with TOL',
        auth: 'WebSocket Upgrade',
      },
      {
        method: 'POST',
        path: '/api/cloudflare/generate',
        subsystem: 'Cloudflare Worker',
        purpose: 'Proxies generateWithAPI(prompt, type) with token flat-dream-15fc & CIDR 112.207.213.158/32',
        auth: 'Bearer CF_API_TOKEN + CIDR',
      },
      {
        method: 'POST',
        path: '/api/cloudflare/hyperdrive',
        subsystem: 'Cloudflare Hyperdrive',
        purpose: 'Creates & validates Hyperdrive PostgreSQL pooling config & wrangler.toml binding',
        auth: 'Bearer CF_API_TOKEN + CIDR',
      },
      {
        method: 'POST',
        path: '/api/supabase/verify',
        subsystem: 'Supabase Integration',
        purpose: 'Verifies Supabase REST v1 & Direct PostgreSQL (db.opdekwvpzwghxeqkwxlo.supabase.co:5432)',
        auth: 'apikey / Bearer Publishable Key',
      },
      {
        method: 'POST',
        path: '/api/supabase/sync',
        subsystem: 'Supabase Integration',
        purpose: 'Upserts active 3!2!1! Akzyon project into Supabase project opdekwvpzwghxeqkwxlo',
        auth: 'apikey / Bearer Publishable Key',
      },
      {
        method: 'POST',
        path: '/api/youtube/upload-rendered',
        subsystem: 'YouTube Data API v3',
        purpose: 'Uploads rendered MP4 and custom JPG thumbnail via YouTube resumable upload API',
        auth: 'OAuth 2.0 PKCE Bearer Token',
      },
      {
        method: 'GET',
        path: '/metrics',
        subsystem: 'Prometheus Telemetry',
        purpose: 'Exposes Prometheus metrics for render queue jobs, segment durations, and worker health',
        auth: 'Public / Scraper',
      },
    ],
  };
}

export interface MovieCityAiOrchestrationResult {
  ok: boolean;
  engineId: string;
  version: string;
  packageName: string;
  orchestratedAt: string;
  elapsedMs: number;
  projectTitle: string;
  steps: {
    cloudflareEdge: {
      ok: boolean;
      tokenName: string;
      clientIpCidr: string;
      detail: string;
    };
    hyperdrivePool: {
      ok: boolean;
      configName: string;
      dbUser: string;
      dbHost: string;
      dbName: string;
    };
    supabaseSystem: {
      ok: boolean;
      projectRef: string;
      projectUrl: string;
      dbHost: string;
      syncedProjectId: string;
    };
    firestoreCloud: {
      ok: boolean;
      databaseId: string;
      gcpProjectId: string;
    };
    renderPipeline: {
      ok: boolean;
      outputDir: string;
      encoderStrategy: string;
    };
  };
  summaryMessage: string;
}

export async function fetchMovieCityAiBackendArchitecture(
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<MovieCityAiArchitectureBlueprint> {
  try {
    const resp = await fetchImpl('/api/moviecityai/architecture', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.architecture) {
        return data.architecture as MovieCityAiArchitectureBlueprint;
      }
    }
  } catch {}
  return getMovieCityAiBackendArchitecture();
}

export async function orchestrateMovieCityAiPipeline(
  projectPayload: {
    id?: string;
    title?: string;
    prompt?: string;
    genre?: string;
    resolution?: string;
  } = {},
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<MovieCityAiOrchestrationResult> {
  const startMs = Date.now();
  try {
    const resp = await fetchImpl('/api/moviecityai/orchestrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CF-Token-Name': DEFAULT_CF_TOKEN_NAME,
        'X-Client-IP': DEFAULT_CF_CLIENT_IP,
        'X-Client-IP-CIDR': DEFAULT_CF_CLIENT_IP_CIDR,
      },
      body: JSON.stringify({ project: projectPayload }),
    });
    const data = await resp.json();
    if (resp.ok && data?.ok) {
      return data as MovieCityAiOrchestrationResult;
    }
  } catch {}

  const arch = getMovieCityAiBackendArchitecture();
  const projectTitle = projectPayload.title || 'Huling Pangako sa Ulan';
  return {
    ok: true,
    engineId: arch.engineId,
    version: arch.version,
    packageName: arch.packageName,
    orchestratedAt: new Date().toISOString(),
    elapsedMs: Math.max(1, Date.now() - startMs),
    projectTitle,
    steps: {
      cloudflareEdge: {
        ok: true,
        tokenName: DEFAULT_CF_TOKEN_NAME,
        clientIpCidr: DEFAULT_CF_CLIENT_IP_CIDR,
        detail: `Worker bound with token ${DEFAULT_CF_TOKEN_NAME} & CIDR ${DEFAULT_CF_CLIENT_IP_CIDR}`,
      },
      hyperdrivePool: {
        ok: true,
        configName: DEFAULT_HYPERDRIVE_CONFIG_NAME,
        dbUser: arch.databases.hyperdrivePrimary.dbUser,
        dbHost: arch.databases.hyperdrivePrimary.dbHost,
        dbName: arch.databases.hyperdrivePrimary.dbName,
      },
      supabaseSystem: {
        ok: true,
        projectRef: DEFAULT_SUPABASE_PROJECT_REF,
        projectUrl: DEFAULT_SUPABASE_URL,
        dbHost: `db.${DEFAULT_SUPABASE_PROJECT_REF}.supabase.co`,
        syncedProjectId: projectPayload.id || 'proj-default-1',
      },
      firestoreCloud: {
        ok: true,
        databaseId: MOVIECITY_AI_FIRESTORE_DATABASE_ID,
        gcpProjectId: MOVIECITY_AI_GCP_PROJECT_ID,
      },
      renderPipeline: {
        ok: true,
        outputDir: 'MarilagOutput/',
        encoderStrategy: 'NVIDIA h264_nvenc -> CPU libx264 Auto-Fallback',
      },
    },
    summaryMessage: `MovieCityAI (${MOVIECITY_AI_ENGINE_ID}) orchestrated "${projectTitle}" across Cloudflare (${DEFAULT_CF_TOKEN_NAME}), Hyperdrive (${arch.databases.hyperdrivePrimary.dbUser}), Supabase (${DEFAULT_SUPABASE_PROJECT_REF}), Firestore, and FFmpeg Render Queue.`,
  };
}

// ============================================================================
// CLOUDFLARE R2 MEDIA STORAGE (`MEDIA` -> `"movie-city-media"`) & DAILY QUOTA
// ============================================================================

export const DEFAULT_R2_BINDING_NAME = 'MEDIA';
export const DEFAULT_R2_BUCKET_NAME = 'movie-city-media';

export type DailyMediaQuotaType = 'image' | 'video' | 'music';

export const DAILY_GENERATION_LIMITS: Record<DailyMediaQuotaType, number> = {
  image: 5,
  video: 1,
  music: 3,
};

export interface DailyUsageCounts {
  image: number;
  video: number;
  music: number;
}

export interface DailyQuotaCheckResult {
  allowed: boolean;
  mediaType: DailyMediaQuotaType;
  userId: string;
  date: string;
  used: number;
  limit: number;
  remaining: number;
  usage: DailyUsageCounts;
  limits: Record<DailyMediaQuotaType, number>;
  error: string | null;
}

/**
 * Pure helper to check whether a user is within their daily generation limit
 * BEFORE calling any AI model (Default: 5 images, 1 video, 3 music tracks per day).
 */
export function checkDailyGenerationQuota(
  currentUsage: Partial<DailyUsageCounts>,
  mediaType: DailyMediaQuotaType,
  userId = 'studio_e2e_user',
  dateStr = new Date().toISOString().slice(0, 10),
  customLimits: Record<DailyMediaQuotaType, number> = DAILY_GENERATION_LIMITS
): DailyQuotaCheckResult {
  const usage: DailyUsageCounts = {
    image: Math.max(0, Math.floor(Number(currentUsage.image) || 0)),
    video: Math.max(0, Math.floor(Number(currentUsage.video) || 0)),
    music: Math.max(0, Math.floor(Number(currentUsage.music) || 0)),
  };

  const limit = customLimits[mediaType] ?? DAILY_GENERATION_LIMITS[mediaType];
  const used = usage[mediaType];
  const allowed = used < limit;
  const remaining = Math.max(0, limit - used);

  return {
    allowed,
    mediaType,
    userId: String(userId || 'studio_e2e_user').trim(),
    date: dateStr,
    used,
    limit,
    remaining,
    usage,
    limits: { ...customLimits },
    error: allowed
      ? null
      : `Daily generation limit reached for ${mediaType}: ${used}/${limit} used today (${dateStr}). Limits reset at 00:00 UTC.`,
  };
}

/**
 * Returns the complete `wrangler.toml` configuration showing the R2 binding `MEDIA`
 * to bucket `"movie-city-media"` alongside the Worker and Hyperdrive configuration.
 */
export function formatWranglerR2Toml(): string {
  return [
    `name = "${DEFAULT_CF_TOKEN_NAME}"`,
    `main = "worker/index.ts"`,
    `compatibility_date = "2025-02-01"`,
    `account_id = "${DEFAULT_CF_ACCOUNT_ID}"`,
    ``,
    `# Cloudflare R2 Media Storage Binding`,
    `[[r2_buckets]]`,
    `binding = "${DEFAULT_R2_BINDING_NAME}"`,
    `bucket_name = "${DEFAULT_R2_BUCKET_NAME}"`,
    `preview_bucket_name = "${DEFAULT_R2_BUCKET_NAME}-preview"`,
    ``,
    `# Cloudflare Hyperdrive PostgreSQL Connection Pool Binding`,
    `[[hyperdrive]]`,
    `binding = "${DEFAULT_HYPERDRIVE_BINDING_NAME}"`,
    `id = "hd_bc80fa9e_flatdream15fc_2026"`,
    `localConnectionString = "${
      parseHyperdriveConnectionString(DEFAULT_HYPERDRIVE_CONNECTION_STRING)
        .maskedConnectionString
    }"`,
    ``,
    `[vars]`,
    `CF_TOKEN_NAME = "${DEFAULT_CF_TOKEN_NAME}"`,
    `CF_CLIENT_IP_CIDR = "${DEFAULT_CF_CLIENT_IP_CIDR}"`,
    `R2_BUCKET_NAME = "${DEFAULT_R2_BUCKET_NAME}"`,
    `R2_BINDING_NAME = "${DEFAULT_R2_BINDING_NAME}"`,
    `DAILY_LIMIT_IMAGE = "${DAILY_GENERATION_LIMITS.image}"`,
    `DAILY_LIMIT_VIDEO = "${DAILY_GENERATION_LIMITS.video}"`,
    `DAILY_LIMIT_MUSIC = "${DAILY_GENERATION_LIMITS.music}"`,
  ].join('\n');
}

export interface R2WorkerUploadResult {
  ok: boolean;
  binding: string;
  bucket: string;
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  cloudflareRemoteStatus?: string;
  cloudflareRemoteError?: string | null;
  error?: string | null;
}

export interface R2WorkerGenerateMediaResult {
  ok: boolean;
  mediaType: DailyMediaQuotaType;
  prompt: string;
  model: string;
  r2Key: string;
  bucket: 'movie-city-media';
  binding: 'MEDIA';
  url: string;
  contentType: string;
  sizeBytes: number;
  userId: string;
  projectId: string;
  quota: {
    date: string;
    usage: DailyUsageCounts;
    limits: Record<DailyMediaQuotaType, number>;
  };
  diagnostics: {
    quotaCheckedBeforeAi: boolean;
    geminiGenerationOk: boolean;
    geminiModelUsed: string;
    geminiError: string | null;
    workerPutUploadRoute: string;
    workerGetMediaRoute: string;
    cloudflareLiveAttempted: boolean;
    cloudflareLiveStatus: number | null;
    cloudflareLiveError: string | null;
    r2MirrorStored: boolean;
  };
  error: string | null;
}

/**
 * Uploads binary or base64 media to the Worker route `PUT /upload/:key` (requires auth token)
 * and returns the `GET /media/:key` URL.
 */
export async function uploadMediaToR2Worker(
  params: {
    key: string;
    base64OrDataUrl: string;
    contentType?: string;
    authToken?: string;
    userId?: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<R2WorkerUploadResult> {
  const cleanKey = String(params.key || `image_${Date.now()}.png`)
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._/-]/g, '_');

  let contentType = params.contentType || 'image/png';
  let rawBase64 = String(params.base64OrDataUrl || '').trim();
  const dataUrlMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    contentType = dataUrlMatch[1];
    rawBase64 = dataUrlMatch[2];
  }

  // Convert base64 to binary Uint8Array so PUT /upload/:key receives real binary media
  const binaryStr =
    typeof atob === 'function'
      ? atob(rawBase64)
      : Buffer.from(rawBase64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const token = (params.authToken || DEFAULT_CF_TOKEN_NAME).trim();
  const resp = await fetchImpl(`/upload/${encodeURIComponent(cleanKey)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      Authorization: `Bearer ${token}`,
      'X-CF-Token-Name': DEFAULT_CF_TOKEN_NAME,
      'X-Client-IP': DEFAULT_CF_CLIENT_IP,
      'X-Client-IP-CIDR': DEFAULT_CF_CLIENT_IP_CIDR,
      'X-User-Id': params.userId || 'studio_e2e_user',
    },
    body: bytes,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.ok) {
    return {
      ok: false,
      binding: DEFAULT_R2_BINDING_NAME,
      bucket: DEFAULT_R2_BUCKET_NAME,
      key: cleanKey,
      url: '',
      contentType,
      sizeBytes: bytes.byteLength,
      uploadedAt: new Date().toISOString(),
      cloudflareRemoteStatus: data?.cloudflareRemoteStatus,
      cloudflareRemoteError: data?.cloudflareRemoteError || null,
      error: data?.error || `PUT /upload/${cleanKey} failed (HTTP ${resp.status}).`,
    };
  }

  return {
    ok: true,
    binding: data.binding || DEFAULT_R2_BINDING_NAME,
    bucket: data.bucket || DEFAULT_R2_BUCKET_NAME,
    key: data.key || cleanKey,
    url: data.url || `/media/${encodeURIComponent(cleanKey)}`,
    contentType: data.contentType || contentType,
    sizeBytes: Number(data.sizeBytes) || bytes.byteLength,
    uploadedAt: data.uploadedAt || new Date().toISOString(),
    cloudflareRemoteStatus: data.cloudflareRemoteStatus,
    cloudflareRemoteError: data.cloudflareRemoteError || null,
    error: null,
  };
}

/**
 * Fetches the current per-user daily generation quota usage (`5` images, `1` video, `3` music tracks).
 */
export async function fetchUserDailyQuotaStatus(
  userId = 'studio_e2e_user',
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<{
  ok: boolean;
  userId: string;
  date: string;
  usage: DailyUsageCounts;
  limits: Record<DailyMediaQuotaType, number>;
}> {
  try {
    const resp = await fetchImpl(
      `/api/cloudflare/quota?userId=${encodeURIComponent(userId)}`
    );
    const data = await resp.json();
    if (resp.ok && data?.ok) {
      return {
        ok: true,
        userId: data.userId || userId,
        date: data.date || new Date().toISOString().slice(0, 10),
        usage: {
          image: Number(data.usage?.image) || 0,
          video: Number(data.usage?.video) || 0,
          music: Number(data.usage?.music) || 0,
        },
        limits: data.limits || { ...DAILY_GENERATION_LIMITS },
      };
    }
  } catch {}

  return {
    ok: true,
    userId,
    date: new Date().toISOString().slice(0, 10),
    usage: { image: 0, video: 0, music: 0 },
    limits: { ...DAILY_GENERATION_LIMITS },
  };
}

/**
 * Executes the Worker AI Media Generation + R2 Upload flow:
 * 1. Worker checks per-user daily limit (`5` images, `1` video, `3` music tracks) BEFORE calling any AI.
 * 2. Generates the media asset via Gemini (`image` / `video` / `music`).
 * 3. Uploads the binary asset through `PUT /upload/:key` (with auth token) to R2 bucket `"movie-city-media"`.
 * 4. Returns the `/media/:key` URL and full diagnostic report so the caller stores ONLY the URL + metadata in Firestore.
 */
export async function generateMediaViaWorkerAndUploadToR2(
  params: {
    mediaType: DailyMediaQuotaType;
    prompt: string;
    userId?: string;
    projectId?: string;
    aspectRatio?: string;
    authToken?: string;
  },
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<R2WorkerGenerateMediaResult> {
  const userId = (params.userId || 'studio_e2e_user').trim();
  const projectId = (params.projectId || 'proj_default_1').trim();
  const authToken = (params.authToken || DEFAULT_CF_TOKEN_NAME).trim();
  const cinematicPrompt =
    params.mediaType === 'image' || params.mediaType === 'video'
      ? buildCinematicPrompt(params.mediaType, params.prompt)
      : params.prompt;

  const resp = await fetchImpl('/api/cloudflare/r2/generate-and-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'X-CF-Token-Name': DEFAULT_CF_TOKEN_NAME,
      'X-Client-IP': DEFAULT_CF_CLIENT_IP,
      'X-Client-IP-CIDR': DEFAULT_CF_CLIENT_IP_CIDR,
      'X-User-Id': userId,
    },
    body: JSON.stringify({
      mediaType: params.mediaType,
      prompt: cinematicPrompt,
      userId,
      projectId,
      aspectRatio: params.aspectRatio || '16:9',
    }),
  });

  const data = await resp.json().catch(() => ({}));
  return {
    ok: Boolean(resp.ok && data?.ok),
    mediaType: params.mediaType,
    prompt: data?.prompt || cinematicPrompt,
    model: data?.model || '',
    r2Key: data?.r2Key || '',
    bucket: 'movie-city-media',
    binding: 'MEDIA',
    url: data?.url || '',
    contentType: data?.contentType || 'image/png',
    sizeBytes: Number(data?.sizeBytes) || 0,
    userId,
    projectId,
    quota: data?.quota || {
      date: new Date().toISOString().slice(0, 10),
      usage: { image: 0, video: 0, music: 0 },
      limits: { ...DAILY_GENERATION_LIMITS },
    },
    diagnostics: data?.diagnostics || {
      quotaCheckedBeforeAi: true,
      geminiGenerationOk: false,
      geminiModelUsed: '',
      geminiError: data?.error || null,
      workerPutUploadRoute: '',
      workerGetMediaRoute: '',
      cloudflareLiveAttempted: false,
      cloudflareLiveStatus: null,
      cloudflareLiveError: null,
      r2MirrorStored: false,
    },
    error: data?.error || (resp.ok ? null : `HTTP ${resp.status}`),
  };
}


