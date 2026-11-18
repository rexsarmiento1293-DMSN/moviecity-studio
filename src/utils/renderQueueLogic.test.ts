import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSegmentSlices,
  capSegmentsByDuration,
  sanitizeVideoBaseName,
  validateVideoUpload,
  formatPrometheusMetrics,
  selectOptimalEncoder,
  parseProgressLogLine,
  buildQueueCliCommand,
} from './renderQueueLogic.ts';
import {
  sanitizeYouTubeQuery,
  validateYouTubeResourceId,
  validateRegionCode,
  enforceHttpsUrl,
  classifyYouTubeError,
  generatePkcePair,
  SecureTokenVault,
} from './youtubeResilience.ts';
import {
  buildCharacterConsistentPrompt,
  reorderScenes,
  calculateTotalTimelineDuration,
  buildExportJsonStructure,
  generateWithAPI,
  DEFAULT_HF_VIDEO_MODEL,
  buildHfScenePrompts,
  classifyHfInferenceError,
  DEFAULT_LTX_VIDEO_PARAMS,
  validateLtxVideoParams,
  buildFixedLtxColabScript,
  buildFixedLtxColabNotebookJson,
  DramaProject,
  DramaScene,
} from './dramaStudioLogic.ts';
import {
  CINEMATIC_SKILLS,
  buildCinematicPrompt,
  generateCinematicPromptFromAI,
} from '../../skills/cinematicSkill.js';
import {
  EXPO_SDK_COMPATIBILITY_MATRIX,
  EXPO_INSTALL_COMMAND,
  Contact,
  mapGyroscopeToCameraMotion,
  captureCameraViewReferenceFrame,
  validateExpoSdkConfig,
} from './expoDeviceBridge.ts';

describe('renderQueueLogic pure functions', () => {
  it('caps segment count at the floor of video duration in seconds', () => {
    assert.equal(capSegmentsByDuration(24, 20.0), 20);
    assert.equal(capSegmentsByDuration(24, 5.0), 5);
    assert.equal(capSegmentsByDuration(24, 60.0), 24);
    assert.equal(capSegmentsByDuration(24, 0.8), 1);
  });

  it('calculates contiguous segment slices that sum to totalDurationSec', () => {
    const slices = calculateSegmentSlices(24.0, 24);
    assert.equal(slices.length, 24);
    assert.equal(slices[0].startTimeSec, 0);
    assert.equal(slices[23].endTimeSec, 24.0);

    const shortSlices = calculateSegmentSlices(5.0, 24);
    assert.equal(shortSlices.length, 5);
    assert.equal(shortSlices[4].endTimeSec, 5.0);
  });

  it('sanitizes video base names safely and strips _final suffix', () => {
    assert.equal(sanitizeVideoBaseName('My Phone Video (2026)!.mp4'), 'My_Phone_Video_2026');
    assert.equal(sanitizeVideoBaseName('../../etc/passwd.mp4'), 'passwd');
    assert.equal(sanitizeVideoBaseName('pacquiao_final.mp4'), 'pacquiao');
    assert.equal(sanitizeVideoBaseName('   '), 'video');
  });

  it('validates video uploads and returns Filipino errors for invalid inputs', () => {
    const ok = validateVideoUpload({
      fileName: 'phone_clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 5 * 1024 * 1024,
    });
    assert.equal(ok.valid, true);
    assert.equal(ok.baseName, 'phone_clip');

    const badType = validateVideoUpload({
      fileName: 'malware.exe',
      mimeType: 'application/x-msdownload',
      sizeBytes: 1024,
    });
    assert.equal(badType.valid, false);
    assert.ok(badType.errorFilipino?.includes('Hindi valid na video file'));

    const tooBig = validateVideoUpload({
      fileName: 'huge.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 300 * 1024 * 1024,
      maxSizeBytes: 100 * 1024 * 1024,
    });
    assert.equal(tooBig.valid, false);
    assert.ok(tooBig.errorFilipino?.includes('Masyadong malaki'));
  });

  it('selects h264_nvenc when probe succeeds and libx264 when fallback or forced', () => {
    const nvenc = selectOptimalEncoder({ nvencProbeReturnCode: 0, forceCpu: false });
    assert.equal(nvenc.encoder, 'h264_nvenc');
    const fallback = selectOptimalEncoder({ nvencProbeReturnCode: 1, forceCpu: false });
    assert.equal(fallback.encoder, 'libx264');
  });

  it('parses structured progress log lines accurately', () => {
    const parsed = parseProgressLogLine(
      '2026-10-22 20:46:04 | INFO    | [03/20 |  15.0%] Segment #03 rendered in 0.49s (21 KB, libx264)'
    );
    assert.ok(parsed);
    assert.equal(parsed.completedCount, 3);
    assert.equal(parsed.totalSegments, 20);
    assert.equal(parsed.segmentNumber, 3);
    assert.equal(parsed.success, true);
  });

  it('formats Prometheus /metrics output with all 5 required metric names', () => {
    const text = formatPrometheusMetrics({
      queueLength: 1,
      currentProgressRatio: 0.75,
      jobsCompletedTotal: 4,
      jobsFailedTotal: 1,
      lastRenderSeconds: 3.42,
    });
    assert.ok(text.includes('marilag_queue_length 1'));
    assert.ok(text.includes('marilag_current_progress_ratio 0.75'));
    assert.ok(text.includes('marilag_jobs_completed_total 4'));
    assert.ok(text.includes('marilag_jobs_failed_total 1'));
    assert.ok(text.includes('marilag_last_render_seconds 3.42'));
  });

  it('builds CLI command with baseName and flags', () => {
    const cmd = buildQueueCliCommand({
      inputPath: 'uploads/clip.mp4',
      baseName: 'clip',
      segments: 24,
      workers: 4,
      crf: 23,
      forceCpu: false,
      generateTest: false,
    });
    assert.equal(
      cmd,
      'python3 render/queue_cli.py --input uploads/clip.mp4 --name clip --segments 24 --workers 4 --crf 23'
    );
  });
});

describe('youtubeResilience security & stability functions', () => {
  it('sanitizes YouTube queries and validates resource IDs and regions', () => {
    assert.equal(sanitizeYouTubeQuery('<script>alert(1)</script>Pacquiao'), 'scriptalert(1)/scriptPacquiao');
    assert.equal(validateYouTubeResourceId('dQw4w9WgXcQ').valid, true);
    assert.equal(validateYouTubeResourceId('bad id with spaces!').valid, false);
    assert.equal(validateRegionCode('ph'), 'PH');
    assert.equal(validateRegionCode('invalid'), 'PH');
  });

  it('enforces HTTPS on external URLs and blocks cleartext HTTP', () => {
    assert.equal(enforceHttpsUrl('https://www.googleapis.com/youtube/v3/search').valid, true);
    assert.equal(enforceHttpsUrl('/api/youtube/search').valid, true);
    assert.equal(enforceHttpsUrl('http://insecure.example.com/api').valid, false);
  });

  it('classifies 403 quota exceeded, 400 invalid key, and offline states into Filipino messages', () => {
    const q403 = classifyYouTubeError(403, 'quotaExceeded');
    assert.equal(q403.code, 'QUOTA_EXCEEDED');
    assert.equal(q403.retryable, false);

    const k400 = classifyYouTubeError(400, 'API key not valid. Please pass a valid API key.');
    assert.equal(k400.code, 'INVALID_KEY');
    assert.equal(k400.retryable, false);

    const offline = classifyYouTubeError(0, 'Failed to fetch', true);
    assert.equal(offline.code, 'OFFLINE');
    assert.equal(offline.retryable, true);
  });

  it('generates valid PKCE S256 verifier and challenge pairs and stores tokens in AES-GCM vault', async () => {
    const pkce = await generatePkcePair();
    assert.equal(pkce.codeChallengeMethod, 'S256');
    assert.ok(pkce.codeVerifier.length >= 40);
    assert.ok(pkce.codeChallenge.length >= 40);
    assert.notEqual(pkce.codeVerifier, pkce.codeChallenge);

    await SecureTokenVault.setToken('unit_test_tok', 'ya29.test_encrypted_token', 60);
    const decrypted = await SecureTokenVault.getToken('unit_test_tok');
    assert.equal(decrypted, 'ya29.test_encrypted_token');
    await SecureTokenVault.clearToken('unit_test_tok');
    assert.equal(await SecureTokenVault.getToken('unit_test_tok'), null);
  });
});

describe('AI Drama Studio logic functions', () => {
  it('injects character profile consistency lock into every scene prompt', () => {
    const prompt = buildCharacterConsistentPrompt(
      'Naglalakad sa ulan sa Escolta.',
      {
        name: 'Kaelen Reyes',
        appearance: 'Black trench coat, silver glasses',
        style: '90s Manila Neo-Noir',
      },
      'manila-noir'
    );
    assert.ok(prompt.includes('[CONSISTENT CHARACTER LOCK — Character: Kaelen Reyes'));
    assert.ok(prompt.includes('Appearance: Black trench coat, silver glasses'));
    assert.ok(prompt.includes('Style: 90s Manila Neo-Noir'));
    assert.ok(prompt.includes('[FX: Manila Rain Noir]'));
    assert.ok(prompt.includes('Naglalakad sa ulan sa Escolta.'));
  });

  it('reorders timeline scenes and calculates total duration accurately', () => {
    const sampleScenes: DramaScene[] = [
      {
        id: 's1',
        order: 1,
        title: 'Scene 1',
        scriptText: 'Unang eksena',
        visualPrompt: '',
        durationSec: 5,
        thumbnailDataUrl: '',
        effectId: 'none',
        status: 'ready',
      },
      {
        id: 's2',
        order: 2,
        title: 'Scene 2',
        scriptText: 'Pangalawang eksena',
        visualPrompt: '',
        durationSec: 6,
        thumbnailDataUrl: '',
        effectId: 'none',
        status: 'ready',
      },
      {
        id: 's3',
        order: 3,
        title: 'Scene 3',
        scriptText: 'Pangatlong eksena',
        visualPrompt: '',
        durationSec: 6,
        thumbnailDataUrl: '',
        effectId: 'none',
        status: 'ready',
      },
    ];
    assert.equal(calculateTotalTimelineDuration(sampleScenes), 17);
    const reordered = reorderScenes(sampleScenes, 0, 2);
    assert.equal(reordered[2].id, 's1');
    assert.equal(reordered[2].order, 3);
    assert.equal(reordered.length, 3);
  });

  it('builds export-ready JSON structure and runs generateWithAPI simulation', async () => {
    const proj: DramaProject = {
      id: 'proj-test-1',
      title: 'Ang Huling Pahina',
      prompt: 'Isang imbestigador sa Maynila',
      genre: 'Mystery',
      createdAt: '2026-05-12',
      updatedAt: '2026-05-12',
      status: 'Done',
      thumbnailDataUrl: '',
      characterProfile: {
        name: 'Kaelen Reyes',
        appearance: 'Black trench coat',
        style: 'Manila Noir',
      },
      scenes: [],
      selectedEffect: 'manila-noir',
      resolution: '1080p',
      includeAudio: true,
      generationMode: 'simulated',
    };
    const apiRes = await generateWithAPI({
      step: 'script',
      prompt: proj.prompt,
      characterProfile: proj.characterProfile,
      effectId: proj.selectedEffect,
    });
    assert.equal(apiRes.mode, 'real');
    assert.equal(apiRes.scenes.length, 3);

    proj.scenes = apiRes.scenes;
    const jsonStr = buildExportJsonStructure(proj);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.schemaVersion, '2.0.0');
    assert.equal(parsed.project.resolution, '1080p');
    assert.equal(parsed.project.scenes.length, 3);
  });
});

import {
  generateWithAPI as cfGenerateWithAPI,
  normalizeClientIpCidr,
  isIpWithinCidr,
  buildCloudflareRequestHeaders,
  parseHyperdriveConnectionString,
  buildHyperdriveCreatePayload,
  formatWranglerHyperdriveToml,
  formatSupabaseCliSetupCommands,
  verifySupabaseConnection,
  getMovieCityAiBackendArchitecture,
  orchestrateMovieCityAiPipeline,
  MOVIECITY_AI_ENGINE_ID,
  MOVIECITY_AI_PACKAGE_NAME,
  MOVIECITY_AI_GCP_PROJECT_ID,
  MOVIECITY_AI_FIRESTORE_DATABASE_ID,
  DEFAULT_HYPERDRIVE_CONFIG_NAME,
  DEFAULT_HYPERDRIVE_CONNECTION_STRING,
  DEFAULT_SUPABASE_PROJECT_REF,
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING,
  SUPABASE_CLI_SETUP_COMMANDS,
  DEFAULT_R2_BINDING_NAME,
  DEFAULT_R2_BUCKET_NAME,
  DAILY_GENERATION_LIMITS,
  checkDailyGenerationQuota,
  formatWranglerR2Toml,
  uploadMediaToR2Worker,
} from '../services/cloudflareWorkerApi.ts';

describe('Cloudflare Worker generateWithAPI(prompt, type) & Client IP CIDR', () => {
  it('normalizes client IP 112.207.213.158 to CIDR 112.207.213.158/32 and validates CIDR matching', () => {
    const norm = normalizeClientIpCidr('112.207.213.158');
    assert.equal(norm.isValid, true);
    assert.equal(norm.ip, '112.207.213.158');
    assert.equal(norm.cidr, '112.207.213.158/32');
    assert.equal(norm.prefixLength, 32);

    assert.equal(isIpWithinCidr('112.207.213.158', '112.207.213.158/32'), true);
    assert.equal(isIpWithinCidr('112.207.213.99', '112.207.213.0/24'), true);
    assert.equal(isIpWithinCidr('34.96.48.64', '112.207.213.158/32'), false);

    const headers = buildCloudflareRequestHeaders('env_token_val', {
      tokenName: 'flat-dream-15fc',
      clientIp: '112.207.213.158',
    });
    assert.equal(headers['X-CF-Token-Name'], 'flat-dream-15fc');
    assert.equal(headers['X-Client-IP'], '112.207.213.158');
    assert.equal(headers['X-Client-IP-CIDR'], '112.207.213.158/32');
    assert.equal(headers['Authorization'], 'Bearer env_token_val');
  });

  it('sends POST with Content-Type, Authorization Bearer token, flat-dream-15fc, and 112.207.213.158/32 CIDR', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;
    const loadingStates: boolean[] = [];

    const mockFetch = (async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = init.headers;
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          url: 'https://cdn.example.com/generated-scene.mp4',
          content: 'Generated video ready',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await cfGenerateWithAPI('Dramatic rain scene in Manila', 'video', {
      onLoadingChange: (st) => loadingStates.push(st),
      fetchImpl: mockFetch,
      envOverride: {
        CF_WORKER_URL: 'https://flat-dream-15fc.example.workers.dev',
        CF_API_TOKEN: 'env_token_from_process_env',
        CF_TOKEN_NAME: 'flat-dream-15fc',
        CF_CLIENT_IP: '112.207.213.158',
        CF_CLIENT_IP_CIDR: '112.207.213.158/32',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.type, 'video');
    assert.equal(result.url, 'https://cdn.example.com/generated-scene.mp4');
    assert.equal(result.tokenName, 'flat-dream-15fc');
    assert.equal(result.clientIp, '112.207.213.158');
    assert.equal(result.clientIpCidr, '112.207.213.158/32');
    assert.equal(capturedUrl, 'https://flat-dream-15fc.example.workers.dev');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
    assert.equal(capturedHeaders['Authorization'], 'Bearer env_token_from_process_env');
    assert.equal(capturedHeaders['X-CF-Token-Name'], 'flat-dream-15fc');
    assert.equal(capturedHeaders['X-Client-IP'], '112.207.213.158');
    assert.equal(capturedHeaders['X-Client-IP-CIDR'], '112.207.213.158/32');
    assert.equal(capturedBody.prompt, 'Dramatic rain scene in Manila');
    assert.equal(capturedBody.type, 'video');
    assert.equal(capturedBody.tokenName, 'flat-dream-15fc');
    assert.equal(capturedBody.clientIpCidr, '112.207.213.158/32');
    assert.deepEqual(loadingStates, [true, false]);
  });

  it('handles HTTP error and timeout cleanly for Retry UI', async () => {
    const errorFetch = (async () => {
      return new Response(JSON.stringify({ error: 'Worker rate limit reached' }), {
        status: 429,
      });
    }) as typeof fetch;

    const errRes = await cfGenerateWithAPI('Generate poster', 'image', {
      fetchImpl: errorFetch,
      envOverride: {
        CF_WORKER_URL: 'https://flat-dream-15fc.example.workers.dev',
        CF_API_TOKEN: 'env_token_from_process_env',
      },
    });

    assert.equal(errRes.ok, false);
    assert.equal(errRes.status, 'error');
    assert.equal(errRes.retryable, true);
    assert.ok(errRes.error?.includes('Worker rate limit reached'));

    // Test timeout abort via AbortController
    const slowFetch = (async (_url: any, init: any) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    }) as typeof fetch;

    const timeoutRes = await cfGenerateWithAPI('Generate script', 'script', {
      timeoutMs: 50,
      fetchImpl: slowFetch,
      envOverride: {
        CF_WORKER_URL: 'https://flat-dream-15fc.example.workers.dev',
        CF_API_TOKEN: 'env_token_from_process_env',
      },
    });

    assert.equal(timeoutRes.ok, false);
    assert.equal(timeoutRes.retryable, true);
    assert.ok(timeoutRes.error?.includes('Nag-timeout'));
  });

  it('parses Cloudflare Hyperdrive connection string and builds API & wrangler.toml payloads', () => {
    const parsed = parseHyperdriveConnectionString(DEFAULT_HYPERDRIVE_CONNECTION_STRING);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.scheme, 'postgres');
    assert.equal(parsed.user, '321action_admin');
    assert.equal(parsed.host, 'db.flat-dream-15fc.ap-southeast-1.pg.neon.tech');
    assert.equal(parsed.port, 5432);
    assert.equal(parsed.database, 'ai_drama_studio');
    assert.equal(parsed.sslmode, 'require');
    assert.ok(!parsed.maskedConnectionString.includes('[SERVER_ENV_SECRET]'));
    assert.ok(parsed.maskedConnectionString.includes('321action_admin:********@'));

    const localhostParsed = parseHyperdriveConnectionString(
      'postgres://user:pass@localhost:5432/mydb'
    );
    assert.equal(localhostParsed.valid, false);
    assert.ok(localhostParsed.error?.includes('publicly reachable'));

    const built = buildHyperdriveCreatePayload(
      DEFAULT_HYPERDRIVE_CONFIG_NAME,
      DEFAULT_HYPERDRIVE_CONNECTION_STRING
    );
    assert.equal(built.valid, true);
    assert.equal(built.payload?.name, 'flat-dream-15fc-hyperdrive');
    assert.equal(built.payload?.origin.port, 5432);
    assert.equal(built.payload?.origin.database, 'ai_drama_studio');

    const toml = formatWranglerHyperdriveToml(
      'hd_bc80fa9e_flatdream15fc',
      DEFAULT_HYPERDRIVE_CONFIG_NAME,
      parsed.maskedConnectionString
    );
    assert.ok(toml.includes('[[hyperdrive]]'));
    assert.ok(toml.includes('binding = "HYPERDRIVE"'));
    assert.ok(toml.includes('id = "hd_bc80fa9e_flatdream15fc"'));
  });

  it('binds Supabase project opdekwvpzwghxeqkwxlo, direct connection string, and CLI setup commands with server-side credential isolation', async () => {
    assert.equal(DEFAULT_SUPABASE_PROJECT_REF, 'opdekwvpzwghxeqkwxlo');
    assert.equal(DEFAULT_SUPABASE_URL, 'https://opdekwvpzwghxeqkwxlo.supabase.co');
    assert.equal(DEFAULT_SUPABASE_PUBLISHABLE_KEY, '[SERVER_ENV_SECRET]');
    assert.equal(
      DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING,
      'postgresql://postgres:[SERVER_ENV_SECRET]@db.opdekwvpzwghxeqkwxlo.supabase.co:5432/postgres'
    );
    assert.deepEqual(SUPABASE_CLI_SETUP_COMMANDS, [
      'supabase login',
      'supabase init',
      'supabase link --project-ref opdekwvpzwghxeqkwxlo',
    ]);

    const cliSnippet = formatSupabaseCliSetupCommands('opdekwvpzwghxeqkwxlo');
    assert.ok(cliSnippet.includes('supabase login'));
    assert.ok(cliSnippet.includes('supabase init'));
    assert.ok(cliSnippet.includes('supabase link --project-ref opdekwvpzwghxeqkwxlo'));

    const parsedSupabaseDb = parseHyperdriveConnectionString(
      DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING
    );
    assert.equal(parsedSupabaseDb.valid, true);
    assert.equal(parsedSupabaseDb.scheme, 'postgresql');
    assert.equal(parsedSupabaseDb.user, 'postgres');
    assert.equal(parsedSupabaseDb.maskedPassword, '********');
    assert.equal(parsedSupabaseDb.host, 'db.opdekwvpzwghxeqkwxlo.supabase.co');
    assert.equal(parsedSupabaseDb.port, 5432);
    assert.equal(parsedSupabaseDb.database, 'postgres');

    const builtHyperdrive = buildHyperdriveCreatePayload(
      'opdekwvpzwghxeqkwxlo-supabase-hyperdrive',
      DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING
    );
    assert.equal(builtHyperdrive.valid, true);
    assert.equal(builtHyperdrive.payload?.origin.host, 'db.opdekwvpzwghxeqkwxlo.supabase.co');
    assert.equal(builtHyperdrive.payload?.origin.scheme, 'postgres');

    const mockVerifyFetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          projectRef: 'opdekwvpzwghxeqkwxlo',
          projectUrl: DEFAULT_SUPABASE_URL,
          publishableKey: DEFAULT_SUPABASE_PUBLISHABLE_KEY,
          directConnectionString: DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING,
          dbHost: 'db.opdekwvpzwghxeqkwxlo.supabase.co',
          dbPort: 5432,
          dbName: 'postgres',
          dbUser: 'postgres',
          restStatus: 'live_reachable',
          message: 'Supabase project opdekwvpzwghxeqkwxlo verified.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const verifyRes = await verifySupabaseConnection({}, mockVerifyFetch);
    assert.equal(verifyRes.ok, true);
    assert.equal(verifyRes.projectRef, 'opdekwvpzwghxeqkwxlo');
    assert.equal(verifyRes.dbHost, 'db.opdekwvpzwghxeqkwxlo.supabase.co');
  });

  it('unifies all 6 backend subsystems behind moviecityAI while preserving Marilag presets', async () => {
    const arch = getMovieCityAiBackendArchitecture();
    assert.equal(arch.engineId, 'moviecityAI');
    assert.equal(arch.packageName, MOVIECITY_AI_PACKAGE_NAME);
    assert.equal(arch.identityAndCloud.gcpProjectId, MOVIECITY_AI_GCP_PROJECT_ID);
    assert.equal(arch.identityAndCloud.firestoreDatabaseId, MOVIECITY_AI_FIRESTORE_DATABASE_ID);
    assert.equal(arch.identityAndCloud.cloudflareTokenName, 'flat-dream-15fc');
    assert.equal(arch.identityAndCloud.cloudflareClientIpCidr, '112.207.213.158/32');
    assert.equal(arch.identityAndCloud.supabaseProjectRef, 'opdekwvpzwghxeqkwxlo');
    assert.equal(arch.databases.hyperdrivePrimary.dbUser, '321action_admin');
    assert.equal(arch.subsystems.length, 6);
    assert.ok(arch.routes.some((r) => r.path === '/api/moviecityai/architecture'));
    assert.ok(arch.routes.some((r) => r.path === '/api/moviecityai/orchestrate'));
    // Verify Marilag presets remain intact without exposing plaintext passwords
    assert.equal(arch.databases.marilagPreservedPresets.length, 4);
    assert.ok(
      arch.databases.marilagPreservedPresets.every((p) =>
        p.connectionString.includes('[SERVER_ENV_SECRET]')
      )
    );

    const orchRes = await orchestrateMovieCityAiPipeline(
      { id: 'proj-test', title: 'Huling Pangako sa Ulan' },
      (async () => new Response('offline', { status: 503 })) as typeof fetch
    );
    assert.equal(orchRes.ok, true);
    assert.equal(orchRes.engineId, MOVIECITY_AI_ENGINE_ID);
    assert.equal(orchRes.steps.cloudflareEdge.tokenName, 'flat-dream-15fc');
    assert.equal(orchRes.steps.hyperdrivePool.dbUser, '321action_admin');
    assert.equal(orchRes.steps.supabaseSystem.projectRef, 'opdekwvpzwghxeqkwxlo');
  });

  it('configures Cloudflare R2 binding MEDIA to bucket movie-city-media and enforces per-user daily generation limits before AI', async () => {
    assert.equal(DEFAULT_R2_BINDING_NAME, 'MEDIA');
    assert.equal(DEFAULT_R2_BUCKET_NAME, 'movie-city-media');
    assert.deepEqual(DAILY_GENERATION_LIMITS, { image: 5, video: 1, music: 3 });

    const r2Toml = formatWranglerR2Toml();
    assert.ok(r2Toml.includes('[[r2_buckets]]'));
    assert.ok(r2Toml.includes('binding = "MEDIA"'));
    assert.ok(r2Toml.includes('bucket_name = "movie-city-media"'));

    // Check daily limits before AI
    const imgAllowed = checkDailyGenerationQuota(
      { image: 4, video: 0, music: 2 },
      'image',
      'user_123',
      '2026-10-29'
    );
    assert.equal(imgAllowed.allowed, true);
    assert.equal(imgAllowed.remaining, 1);

    const imgBlocked = checkDailyGenerationQuota(
      { image: 5, video: 0, music: 2 },
      'image',
      'user_123',
      '2026-10-29'
    );
    assert.equal(imgBlocked.allowed, false);
    assert.equal(imgBlocked.remaining, 0);
    assert.ok(imgBlocked.error?.includes('5/5'));

    const vidBlocked = checkDailyGenerationQuota(
      { image: 1, video: 1, music: 0 },
      'video',
      'user_123',
      '2026-10-29'
    );
    assert.equal(vidBlocked.allowed, false);
    assert.ok(vidBlocked.error?.includes('1/1'));

    const musicBlocked = checkDailyGenerationQuota(
      { image: 1, video: 0, music: 3 },
      'music',
      'user_123',
      '2026-10-29'
    );
    assert.equal(musicBlocked.allowed, false);
    assert.ok(musicBlocked.error?.includes('3/3'));

    // Verify PUT /upload/:key sends Authorization Bearer token and returns GET /media/:key URL
    let capturedPutUrl = '';
    let capturedPutMethod = '';
    let capturedAuthHeader = '';
    const mockUploadFetch = (async (url: string, init?: RequestInit) => {
      capturedPutUrl = String(url);
      capturedPutMethod = String(init?.method || '');
      capturedAuthHeader = String((init?.headers as any)?.Authorization || '');
      return new Response(
        JSON.stringify({
          ok: true,
          binding: 'MEDIA',
          bucket: 'movie-city-media',
          key: 'test_scene_1.png',
          url: '/media/test_scene_1.png',
          contentType: 'image/png',
          sizeBytes: 68,
          uploadedAt: '2026-10-29T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const uploadRes = await uploadMediaToR2Worker(
      {
        key: 'test_scene_1.png',
        base64OrDataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        authToken: 'flat-dream-15fc',
        userId: 'studio_e2e_user',
      },
      mockUploadFetch
    );
    assert.equal(uploadRes.ok, true);
    assert.equal(capturedPutMethod, 'PUT');
    assert.equal(capturedPutUrl, '/upload/test_scene_1.png');
    assert.equal(capturedAuthHeader, 'Bearer flat-dream-15fc');
    assert.equal(uploadRes.bucket, 'movie-city-media');
    assert.equal(uploadRes.url, '/media/test_scene_1.png');
  });

  it('builds 4K Unreal Engine 5 cinematic prompts via skills/cinematicSkill.js (buildCinematicPrompt)', () => {
    assert.ok(CINEMATIC_SKILLS.IMAGE_SYSTEM_PROMPT.includes('Cinematic Prompt Engine'));
    assert.ok(CINEMATIC_SKILLS.VIDEO_SYSTEM_PROMPT.includes('Cinematic Video Prompt Engine'));

    assert.equal(buildCinematicPrompt('image', ''), '');

    const imgPrompt = buildCinematicPrompt('image', '  A rainy Manila rooftop confrontation  ');
    assert.equal(
      imgPrompt,
      'Generate a 4K cinematic ultra high definition realistic image of A rainy Manila rooftop confrontation. Use Unreal Engine 5 render style, photorealistic lighting, ray-traced shadows, 8k resolution textures, dramatic studio lighting, 35mm lens, f/1.8 aperture, hyper-detailed, ultra sharp focus'
    );

    const vidPrompt = buildCinematicPrompt('video', '  Two estranged siblings reuniting under neon lights  ');
    assert.equal(
      vidPrompt,
      'Generate a 4K cinematic ultra high definition realistic 3D video about Two estranged siblings reuniting under neon lights. Camera movement is smooth cinematic drone shot / slow panning, professional color grading, hyper-realistic textures, 60fps feel, studio-grade visual effects, dramatic lighting, Unreal Engine 5'
    );

    assert.equal(buildCinematicPrompt('script', '  Raw script input  '), 'Raw script input');
  });

  it('calls Gemini with CINEMATIC_SKILLS systemInstruction and temperature 0.7 in generateCinematicPromptFromAI', async () => {
    assert.equal(await generateCinematicPromptFromAI('image', ''), '');

    let capturedArgs: any = null;
    const mockAiClient = {
      models: {
        generateContent: async (args: any) => {
          capturedArgs = args;
          return {
            text: '  "Generate a 4K cinematic ultra high definition realistic image of an intense rainy Manila rooftop standoff. Use Unreal Engine 5 render style, photorealistic lighting, ray-traced shadows, 8k resolution textures, dramatic studio lighting, 35mm lens, f/1.8 aperture, hyper-detailed, ultra sharp focus"  ',
          };
        },
      },
    };

    const aiImgResult = await generateCinematicPromptFromAI(
      'image',
      'Manila rooftop standoff',
      { aiClient: mockAiClient }
    );

    assert.equal(capturedArgs.model, 'gemini-2.5-flash');
    assert.equal(capturedArgs.contents, 'User Subject: Manila rooftop standoff');
    assert.equal(capturedArgs.config.systemInstruction, CINEMATIC_SKILLS.IMAGE_SYSTEM_PROMPT);
    assert.equal(capturedArgs.config.temperature, 0.7);
    assert.ok(aiImgResult.startsWith('Generate a 4K cinematic ultra high definition realistic image of'));
  });

  it('validates Expo SDK 58.0.0 compatibility matrix, Contact.getAll(), Gyroscope motion mapping, and CameraView capture', async () => {
    assert.equal(
      EXPO_INSTALL_COMMAND,
      'npx expo install expo-camera expo-contacts expo-sensors'
    );
    const sdk58 = EXPO_SDK_COMPATIBILITY_MATRIX.find((s) => s.expoSdkVersion === '58.0.0');
    assert.ok(sdk58);
    assert.equal(sdk58.reactNativeVersion, '0.88');
    assert.equal(sdk58.reactVersion, '19.3.0');
    assert.equal(sdk58.compileSdkVersion, 37);
    assert.equal(sdk58.targetSdkVersion, 36);
    assert.equal(sdk58.minSdkVersion, 24);

    const validCheck = validateExpoSdkConfig({
      sdkVersion: '58.0.0',
      compileSdkVersion: 37,
      targetSdkVersion: 36,
      minSdkVersion: 24,
    });
    assert.equal(validCheck.valid, true);
    assert.equal(validCheck.issues.length, 0);

    const invalidCheck = validateExpoSdkConfig({
      sdkVersion: '58.0.0',
      compileSdkVersion: 35,
      targetSdkVersion: 35,
      minSdkVersion: 24,
    });
    assert.equal(invalidCheck.valid, false);
    assert.equal(invalidCheck.issues.length, 2);

    const contacts = await Contact.getAll();
    assert.equal(contacts.length, 3);
    assert.ok(contacts[0].name.includes('Clara Montes'));

    const steady = mapGyroscopeToCameraMotion({ x: 0.05, y: 0.05, z: 0.05 });
    assert.equal(steady.intensityLabel, 'Steady Tripod');
    assert.equal(steady.motionPreset, 'Wide Crane Establishing Shot');

    const handheld = mapGyroscopeToCameraMotion({ x: 0.9, y: 0.9, z: 0.2 });
    assert.equal(handheld.intensityLabel, 'Dynamic Whip Pan');
    assert.equal(handheld.motionPreset, 'Dramatic Handheld Close-Up');

    const frameUrl = captureCameraViewReferenceFrame({
      facing: 'back',
      sceneTitle: 'Huling Pangako sa Ulan',
      gyro: { x: 0.5, y: 0.3, z: 0.1 },
    });
    assert.ok(frameUrl.startsWith('data:image/svg+xml;utf8,'));
    assert.ok(decodeURIComponent(frameUrl).includes('EXPO-CAMERA · BACK'));
  });

  it('builds one prompt per scene with character profile and visual effect preset, classifies HF errors, and calls POST /api/generate-video in generateWithAPI', async () => {
    assert.equal(DEFAULT_HF_VIDEO_MODEL, 'Wan-AI/Wan2.1-T2V-14B');

    const charProfile = {
      name: 'Clara Montes',
      appearance: '26yo Filipina lead, emerald silk dress',
      style: '35mm Manila noir cinematography',
    };
    const scenePrompts = buildHfScenePrompts(
      [
        {
          id: 'sc-1',
          title: 'Eksena 1: Sa Ulan',
          scriptText: 'Nakatayo si Clara sa gitna ng malakas na ulan sa Escolta.',
          effectId: 'manila-noir',
          durationSec: 5,
        },
        {
          id: 'sc-2',
          title: 'Eksena 2: Ang Pagtatapat',
          scriptText: 'Hinarap ni Clara si Mateo sa ilalim ng neon lights.',
          effectId: 'cyber-makati',
          durationSec: 5,
        },
      ],
      charProfile,
      'manila-noir'
    );

    assert.equal(scenePrompts.length, 2);
    assert.ok(scenePrompts[0].prompt.includes('Clara Montes'));
    assert.ok(scenePrompts[0].prompt.includes('emerald silk dress'));
    assert.ok(scenePrompts[0].prompt.includes('Manila Rain Noir'));
    assert.ok(scenePrompts[1].prompt.includes('Neon Cyber Drama'));

    // Verify error classification for missing token, invalid token, rate limit, and unavailable model
    const missingTokenErr = classifyHfInferenceError(401, 'Missing HF_TOKEN on server', DEFAULT_HF_VIDEO_MODEL);
    assert.equal(missingTokenErr.code, 'HF_TOKEN_MISSING');
    assert.equal(missingTokenErr.httpStatus, 401);

    const invalidTokenErr = classifyHfInferenceError(401, 'Invalid credentials in Authorization header', DEFAULT_HF_VIDEO_MODEL);
    assert.equal(invalidTokenErr.code, 'HF_TOKEN_INVALID');
    assert.equal(invalidTokenErr.httpStatus, 401);

    const rateLimitErr = classifyHfInferenceError(429, 'Rate limit reached', DEFAULT_HF_VIDEO_MODEL);
    assert.equal(rateLimitErr.code, 'HF_RATE_LIMIT');
    assert.equal(rateLimitErr.httpStatus, 429);

    const unavailableErr = classifyHfInferenceError(503, 'Model is currently loading', DEFAULT_HF_VIDEO_MODEL);
    assert.equal(unavailableErr.code, 'HF_MODEL_UNAVAILABLE');
    assert.equal(unavailableErr.httpStatus, 503);

    // Verify generateWithAPI(step: 'video') calls POST /api/generate-video and returns videoBlob
    let capturedUrl = '';
    let capturedBody: any = null;
    const fakeMp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const mockVideoFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(fakeMp4Bytes, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'X-HF-Model': 'Wan-AI/Wan2.1-T2V-14B',
          'X-Video-Url': '/api/generate-video/temp/akzyon_hf_test.mp4',
        },
      });
    }) as typeof fetch;

    const apiRes = await generateWithAPI({
      step: 'video',
      prompt: 'Nakatayo si Clara sa gitna ng malakas na ulan sa Escolta.',
      characterProfile: charProfile,
      effectId: 'manila-noir',
      scenes: [
        {
          id: 'sc-1',
          order: 1,
          title: 'Eksena 1',
          scriptText: 'Nakatayo si Clara sa gitna ng malakas na ulan sa Escolta.',
          visualPrompt: '',
          durationSec: 5,
          thumbnailDataUrl: '',
          effectId: 'manila-noir',
          status: 'ready',
        },
      ],
      fetchImpl: mockVideoFetch,
    });

    assert.equal(capturedUrl, '/api/generate-video');
    assert.equal(capturedBody.characterProfile.name, 'Clara Montes');
    assert.equal(capturedBody.effectId, 'manila-noir');
    assert.equal(apiRes.mode, 'real');
    assert.equal(apiRes.modelUsed, 'Wan-AI/Wan2.1-T2V-14B');
    assert.ok(apiRes.videoBlob);
    assert.equal(apiRes.videoBlob?.size, fakeMp4Bytes.byteLength);
  });

  it('validates LTX-Video 2B v0.9.5 parameters, n+1 frame decoding, T4 12.7GB VRAM OOM guard, and Python 3.13 torchsde Colab fix', () => {
    const defVal = validateLtxVideoParams(DEFAULT_LTX_VIDEO_PARAMS);
    assert.equal(defVal.valid, true);
    assert.equal(defVal.normalized.width, 832);
    assert.equal(defVal.normalized.height, 480);
    assert.equal(defVal.normalized.frames, 73);
    assert.equal(defVal.effectiveDecodedFrames, 72);
    assert.equal(defVal.durationSeconds, 3);
    assert.equal(defVal.vramCrashRiskOnT4, false);
    assert.equal(defVal.checkpointFile, 'ltx-video-2b-v0.9.5.safetensors');
    assert.equal(defVal.textEncoderFile, 't5xxl_fp8_e4m3fn_scaled.safetensors');

    // Divisibility by 32 check
    const badRes = validateLtxVideoParams({ width: 800, height: 470 });
    assert.equal(badRes.valid, false);
    assert.equal(badRes.snappedWidth, 800);
    assert.equal(badRes.snappedHeight, 480);

    // T4 12.7GB RAM crash warning at 768x512 @ 121 frames
    const t4Risk = validateLtxVideoParams({
      width: 768,
      height: 512,
      frames: 121,
      use_t5xxl_fp16: true,
    });
    assert.equal(t4Risk.valid, true);
    assert.equal(t4Risk.vramCrashRiskOnT4, true);
    assert.equal(t4Risk.textEncoderFile, 't5xxl_fp16.safetensors');
    assert.ok(t4Risk.warnings[0].includes('T4 12.7GB RAM OOM Warning'));

    // Python 3.13 Colab fix script & notebook JSON
    const colabPy = buildFixedLtxColabScript({ width: 768, height: 512, steps: 30, length: 49 });
    const torchsdeIdx = colabPy.indexOf('!pip install -q torchsde einops diffusers accelerate');
    const xformersIdx = colabPy.indexOf('!pip install -q xformers --no-build-isolation');
    assert.ok(torchsdeIdx >= 0, 'Must install torchsde first');
    assert.ok(xformersIdx > torchsdeIdx, 'Optional xformers must come after torchsde');
    assert.ok(colabPy.includes('length: int = 49'));
    assert.ok(colabPy.includes("load_colab_secret('FAL_KEY', 'FAL_KEY')"));
    assert.ok(colabPy.includes("load_colab_secret('GEMINi_key', 'GEMINI_API_KEY')"));
    assert.ok(colabPy.includes("load_colab_secret('COLAB_REGISTER_TOKEN', 'COLAB_REGISTER_TOKEN')"));
    assert.ok(colabPy.includes("load_colab_secret('COLAB_BRIDGE_TOKEN', 'COLAB_BRIDGE_TOKEN')"));
    assert.ok(colabPy.includes('class ColabLtxBridgeHandler(BaseHTTPRequestHandler):'));
    assert.ok(colabPy.includes('if self.path == "/jobs":'));
    assert.ok(colabPy.includes('parts[0] == "jobs" and parts[2] == "file"'));
    assert.ok(colabPy.includes('/api/colab/register'));
    assert.ok(colabPy.includes('X-Colab-Register-Token'));
    assert.ok(colabPy.includes('trycloudflare'));
    assert.ok(colabPy.includes('display_video(output_path)'));
    assert.ok(colabPy.includes('print("✅ Environment Setup Complete!")'));

    const ipynbJson = JSON.parse(
      buildFixedLtxColabNotebookJson({
        width: 768,
        height: 512,
        steps: 30,
        length: 49,
        app_base_url: 'https://movie-city.ai.studio',
      })
    );
    assert.equal(ipynbJson.nbformat, 4);
    assert.equal(ipynbJson.cells.length, 3);
    assert.ok(ipynbJson.cells[2].source.join('').includes('start_colab_bridge'));
    assert.ok(ipynbJson.cells[2].source.join('').includes('https://movie-city.ai.studio'));
  });
});


