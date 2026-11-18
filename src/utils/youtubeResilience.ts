/**
 * src/utils/youtubeResilience.ts
 * Security, OAuth 2.0 PKCE, Android Keystore Token Vault, Offline Cache,
 * Input Sanitization, and Exponential Backoff Retry for YouTube Data API v3.
 */

export interface YouTubeApiErrorInfo {
  status: number;
  code: 'QUOTA_EXCEEDED' | 'INVALID_KEY' | 'UNAUTHORIZED' | 'OFFLINE' | 'TIMEOUT' | 'UPSTREAM_ERROR';
  messageFilipino: string;
  retryable: boolean;
}

/**
 * Sanitizes search queries or text inputs by stripping control characters and HTML tags.
 */
export function sanitizeYouTubeQuery(raw: unknown, maxLength: number = 120): string {
  const str = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .trim();
  return str.slice(0, maxLength);
}

/**
 * Validates a YouTube video, channel, playlist, or comment ID.
 */
export function validateYouTubeResourceId(rawId: unknown): {
  valid: boolean;
  sanitizedId: string;
  errorFilipino?: string;
} {
  const cleaned = String(rawId ?? '').trim();
  if (!cleaned) {
    return {
      valid: false,
      sanitizedId: '',
      errorFilipino: 'Kinakailangan ang YouTube Resource ID (videoId, channelId, o playlistId).',
    };
  }
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(cleaned)) {
    return {
      valid: false,
      sanitizedId: '',
      errorFilipino: 'Hindi valid ang format ng YouTube ID. Gumamit lamang ng titik, numero, gitling (-), o underscore (_).',
    };
  }
  return { valid: true, sanitizedId: cleaned };
}

/**
 * Validates an ISO 3166-1 alpha-2 region code (e.g., PH, US, JP).
 */
export function validateRegionCode(rawRegion: unknown): string {
  const cleaned = String(rawRegion ?? 'PH').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cleaned) ? cleaned : 'PH';
}

/**
 * Enforces HTTPS on external endpoints (allows relative paths starting with /).
 */
export function enforceHttpsUrl(rawUrl: string): { valid: boolean; url: string; errorFilipino?: string } {
  const trimmed = String(rawUrl ?? '').trim();
  if (trimmed.startsWith('/')) {
    return { valid: true, url: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        url: '',
        errorFilipino: 'Seguridad: HTTPS lamang ang pinapayagan para sa YouTube API at OAuth requests.',
      };
    }
    return { valid: true, url: parsed.toString() };
  } catch {
    return {
      valid: false,
      url: '',
      errorFilipino: 'Hindi valid na URL format.',
    };
  }
}

/**
 * Classifies HTTP status codes and network/offline errors into user-friendly Filipino messages
 * without crashing the app.
 */
export function classifyYouTubeError(status: number, rawMessage?: string, isOffline?: boolean): YouTubeApiErrorInfo {
  const msgLower = String(rawMessage ?? '').toLowerCase();

  if (isOffline || status === 0 || msgLower.includes('failed to fetch') || msgLower.includes('network')) {
    return {
      status: 0,
      code: 'OFFLINE',
      messageFilipino:
        'Walang koneksyon sa internet (Offline). Ipinapakita ang naka-cache na huling matagumpay na data.',
      retryable: true,
    };
  }

  if (status === 408 || msgLower.includes('abort') || msgLower.includes('timeout')) {
    return {
      status: 408,
      code: 'TIMEOUT',
      messageFilipino:
        'Nag-timeout ang request sa YouTube Data API v3. Pakisubukan muli.',
      retryable: true,
    };
  }

  if (
    status === 403 &&
    (msgLower.includes('quota') ||
      msgLower.includes('dailylimitexceeded') ||
      msgLower.includes('ratelimitexceeded'))
  ) {
    return {
      status: 403,
      code: 'QUOTA_EXCEEDED',
      messageFilipino:
        'Naabot na ang arawang YouTube API Quota (HTTP 403 Quota Exceeded). Ipinapakita ang naka-cache na data kung mayroon, o subukan muli bukas.',
      retryable: false,
    };
  }

  if (status === 403) {
    return {
      status: 403,
      code: 'QUOTA_EXCEEDED',
      messageFilipino:
        'Tinanggihan ng YouTube API (HTTP 403): Maaaring naubos ang quota o naka-restrict ang API key sa Android package name / SHA-1.',
      retryable: false,
    };
  }

  if (
    status === 400 &&
    (msgLower.includes('keyinvalid') ||
      msgLower.includes('api key not valid') ||
      msgLower.includes('bad_request') ||
      msgLower.includes('key'))
  ) {
    return {
      status: 400,
      code: 'INVALID_KEY',
      messageFilipino:
        'Hindi valid ang YOUTUBE_API_KEY o kulang sa parameter (HTTP 400). Pakisuri ang YOUTUBE_API_KEY sa iyong .env / Secrets panel.',
      retryable: false,
    };
  }

  if (status === 400) {
    return {
      status: 400,
      code: 'INVALID_KEY',
      messageFilipino: `Di-wastong YouTube API request (HTTP 400): ${rawMessage || 'Suriin ang iyong input at YOUTUBE_API_KEY.'}`,
      retryable: false,
    };
  }

  if (status === 401) {
    return {
      status: 401,
      code: 'UNAUTHORIZED',
      messageFilipino:
        'Kailangan ng OAuth 2.0 (PKCE) authorization para sa aksyon na ito (upload, playlist, o comment). Mag-sign in muna sa YouTube OAuth.',
      retryable: false,
    };
  }

  return {
    status: status || 500,
    code: 'UPSTREAM_ERROR',
    messageFilipino:
      rawMessage || 'Nagkaroon ng pansamantalang problema sa YouTube Data API v3. Pakisubukan muli.',
    retryable: status >= 500 || status === 429,
  };
}

// ============================================================================
// OAuth 2.0 PKCE (Proof Key for Code Exchange - RFC 7636)
// ============================================================================
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}> {
  const randomBytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 32; i++) randomBytes[i] = Math.floor(Math.random() * 256);
  }
  const codeVerifier = base64UrlEncode(randomBytes);

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const codeChallenge = base64UrlEncode(new Uint8Array(digestBuffer));

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

// ============================================================================
// Secure Token Storage (Android Keystore Native Bridge + WebCrypto AES-GCM)
// NEVER stores OAuth tokens in localStorage or sessionStorage!
// ============================================================================
interface EncryptedPayload {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  expiresAtMs: number;
}

class KeystoreAndWebCryptoVault {
  private memoryKeyPromise: Promise<CryptoKey> | null = null;
  private encryptedStore = new Map<string, EncryptedPayload>();

  private getNativeKeystorePlugin(): any {
    const win = typeof window !== 'undefined' ? (window as any) : null;
    return win?.Capacitor?.Plugins?.SecureStoragePlugin || null;
  }

  private async getCryptoKey(): Promise<CryptoKey> {
    if (!this.memoryKeyPromise) {
      this.memoryKeyPromise = globalThis.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable key
        ['encrypt', 'decrypt']
      );
    }
    return this.memoryKeyPromise;
  }

  async setToken(key: string, tokenValue: string, ttlSeconds: number = 3500): Promise<void> {
    const nativePlugin = this.getNativeKeystorePlugin();
    if (nativePlugin && typeof nativePlugin.set === 'function') {
      await nativePlugin.set({
        key: `marilag_keystore_${key}`,
        value: JSON.stringify({
          token: tokenValue,
          expiresAtMs: Date.now() + ttlSeconds * 1000,
        }),
      });
      return;
    }

    const cryptoKey = await this.getCryptoKey();
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    const encoded = new TextEncoder().encode(tokenValue);
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoded
    );
    this.encryptedStore.set(key, {
      iv,
      ciphertext,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
  }

  async getToken(key: string): Promise<string | null> {
    const nativePlugin = this.getNativeKeystorePlugin();
    if (nativePlugin && typeof nativePlugin.get === 'function') {
      try {
        const res = await nativePlugin.get({ key: `marilag_keystore_${key}` });
        if (!res?.value) return null;
        const parsed = JSON.parse(res.value);
        if (Date.now() > parsed.expiresAtMs) {
          await this.clearToken(key);
          return null;
        }
        return parsed.token || null;
      } catch {
        return null;
      }
    }

    const entry = this.encryptedStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAtMs) {
      this.encryptedStore.delete(key);
      return null;
    }

    try {
      const cryptoKey = await this.getCryptoKey();
      const plainBuffer = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: entry.iv as unknown as BufferSource },
        cryptoKey,
        entry.ciphertext
      );
      return new TextDecoder().decode(plainBuffer);
    } catch {
      return null;
    }
  }

  async clearToken(key: string): Promise<void> {
    const nativePlugin = this.getNativeKeystorePlugin();
    if (nativePlugin && typeof nativePlugin.remove === 'function') {
      try {
        await nativePlugin.remove({ key: `marilag_keystore_${key}` });
      } catch {}
    }
    this.encryptedStore.delete(key);
  }
}

export const SecureTokenVault = new KeystoreAndWebCryptoVault();

// ============================================================================
// Offline Cache for Last Successful Public YouTube Data (Cache API + Memory)
// ============================================================================
const CACHE_NAME = 'marilag-youtube-offline-v1';
const memoryResponseCache = new Map<string, { data: any; savedAt: string }>();

export async function saveOfflineCache(cacheKey: string, data: any): Promise<void> {
  const entry = { data, savedAt: new Date().toISOString() };
  memoryResponseCache.set(cacheKey, entry);
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      const fakeUrl = `https://offline.marilag.local/${encodeURIComponent(cacheKey)}`;
      await cache.put(
        fakeUrl,
        new Response(JSON.stringify(entry), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    } catch {}
  }
}

export async function loadOfflineCache<T = any>(
  cacheKey: string
): Promise<{ data: T; savedAt: string } | null> {
  if (memoryResponseCache.has(cacheKey)) {
    return memoryResponseCache.get(cacheKey) as { data: T; savedAt: string };
  }
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      const fakeUrl = `https://offline.marilag.local/${encodeURIComponent(cacheKey)}`;
      const match = await cache.match(fakeUrl);
      if (match) {
        const parsed = await match.json();
        memoryResponseCache.set(cacheKey, parsed);
        return parsed;
      }
    } catch {}
  }
  return null;
}

// ============================================================================
// Resilient Fetch with Timeout, Exponential Backoff Retry & Offline Fallback
// ============================================================================
export interface ResilientFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  accessToken?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  cacheKey?: string;
}

export async function fetchYouTubeProxyWithRetry<T = any>(
  endpointPath: string,
  options: ResilientFetchOptions = {}
): Promise<{
  ok: boolean;
  data: T | null;
  fromOfflineCache: boolean;
  cachedAt?: string;
  error?: YouTubeApiErrorInfo;
}> {
  const {
    method = 'GET',
    body,
    accessToken,
    timeoutMs = 12000,
    maxRetries = 2,
    cacheKey,
  } = options;

  const baseUrl =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) || '';
  const fullUrl = `${baseUrl.replace(/\/$/, '')}${endpointPath}`;
  const urlCheck = enforceHttpsUrl(fullUrl);
  if (!urlCheck.valid) {
    return {
      ok: false,
      data: null,
      fromOfflineCache: false,
      error: {
        status: 400,
        code: 'INVALID_KEY',
        messageFilipino: urlCheck.errorFilipino || 'HTTPS required',
        retryable: false,
      },
    };
  }

  // If browser reports offline immediately, attempt cache recovery for GET requests
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (method === 'GET' && cacheKey) {
      const cached = await loadOfflineCache<T>(cacheKey);
      if (cached) {
        return {
          ok: true,
          data: cached.data,
          fromOfflineCache: true,
          cachedAt: cached.savedAt,
          error: classifyYouTubeError(0, 'Offline', true),
        };
      }
    }
    return {
      ok: false,
      data: null,
      fromOfflineCache: false,
      error: classifyYouTubeError(0, 'Offline', true),
    };
  }

  let lastError: YouTubeApiErrorInfo | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const res = await fetch(urlCheck.url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (res.ok) {
        if (method === 'GET' && cacheKey && payload) {
          await saveOfflineCache(cacheKey, payload);
        }
        return {
          ok: true,
          data: payload as T,
          fromOfflineCache: false,
        };
      }

      const upstreamMessage =
        payload?.error?.message ||
        payload?.error ||
        payload?.message ||
        `HTTP ${res.status}`;
      lastError = classifyYouTubeError(res.status, upstreamMessage, false);

      if (!lastError.retryable || attempt === maxRetries) {
        break;
      }
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === 'AbortError';
      lastError = classifyYouTubeError(
        isTimeout ? 408 : 0,
        err?.message || 'Network error',
        !isTimeout
      );
      if (!lastError.retryable || attempt === maxRetries) {
        break;
      }
    }

    // Exponential backoff with jitter: 400ms * 2^attempt + [0..150ms]
    const delayMs = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Fallback to last cached response if available on GET
  if (method === 'GET' && cacheKey) {
    const cached = await loadOfflineCache<T>(cacheKey);
    if (cached) {
      return {
        ok: true,
        data: cached.data,
        fromOfflineCache: true,
        cachedAt: cached.savedAt,
        error: lastError,
      };
    }
  }

  return {
    ok: false,
    data: null,
    fromOfflineCache: false,
    error:
      lastError ||
      classifyYouTubeError(500, 'Hindi makakonekta sa YouTube backend proxy.'),
  };
}
