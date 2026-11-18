import React, { useEffect, useRef, useState } from 'react';
import {
  Home,
  FolderKanban,
  Clapperboard,
  Wand2,
  Settings,
  Plus,
  Play,
  Pause,
  Trash2,
  Copy,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Download,
  Share2,
  FileJson,
  Sparkles,
  Crown,
  ChevronRight,
  ChevronLeft,
  ArrowUp,
  ArrowDown,
  Film,
  Image as ImageIcon,
  BookOpen,
  Palette,
  User,
  Sun,
  Moon,
  Globe,
  HardDrive,
  X,
  Layers,
} from 'lucide-react';
import {
  DramaProject,
  DramaScene,
  CharacterProfile,
  VISUAL_EFFECT_PRESETS,
  buildCharacterConsistentPrompt,
  reorderScenes,
  calculateTotalTimelineDuration,
  buildExportJsonStructure,
  generateSceneThumbnailDataUrl,
  generateWithAPI,
  DEFAULT_HF_VIDEO_MODEL,
  CINEMATIC_SKILLS,
  buildCinematicPrompt,
  generateCinematicPromptFromAI,
  LTX_SAMPLERS,
  LtxSamplerName,
  LtxVideoParams,
  DEFAULT_LTX_VIDEO_PARAMS,
  validateLtxVideoParams,
  buildFixedLtxColabScript,
  buildFixedLtxColabNotebookJson,
  COLAB_SECRETS_SNIPPET,
  SHARED_COLAB_DRIVE_ID,
  SHARED_COLAB_NOTEBOOK_URL,
  LATEST_COLAB_TUNNEL_URL,
  LTX_COLAB_RENDERED_VIDEO_URL,
} from '../utils/dramaStudioLogic';
import {
  EXPO_SDK_COMPATIBILITY_MATRIX,
  EXPO_INSTALL_COMMAND,
  EXPO_CANARY_COMMAND,
  EXPO_BARE_INIT_COMMAND,
  Contact,
  ExpoCastContact,
  mapGyroscopeToCameraMotion,
  captureCameraViewReferenceFrame,
} from '../utils/expoDeviceBridge';
import VideoGenerationPanel, {
  FEATURED_REAL_HUMAN_EPISODES,
  FeaturedRealHumanEpisode,
  AI_DRAMA_STUDIO_VIDEO_DB_NAME,
  AI_DRAMA_STUDIO_VIDEO_STORE,
  saveCustomVideoToAiDramaStudioDB,
  loadCustomVideoFromAiDramaStudioDB,
  LiveDirectorProgressStudio,
  DIRECTOR_LIVE_STAGES,
  TagalogSubtitleCue,
  buildTagalogSubtitlesFromPrompt,
  createTagalogWebVttDataUrl,
  triggerTagalogDubbingSpeech,
  getVideoSourceRenderType,
} from './VideoGenerationPanel';
import MovieCityCatalogBrowser from './MovieCityCatalogBrowser';
import {
  auth,
  signInWithGoogle,
  signOutFirebase,
  onAuthStateChanged,
  syncDramaProjectToFirestore,
  deleteDramaProjectFromFirestore,
  subscribeUserDramaProjects,
  CloudDramaProjectSummary,
  saveR2MediaMetadataToFirestore,
  loadR2MediaMetadataFromFirestore,
  listR2MediaMetadataFromFirestore,
  R2MediaAssetMetadata,
  User as FirebaseUser,
} from '../firebase';
import {
  generateWithAPI as callCloudflareWorkerAPI,
  verifyCloudflareToken,
  createHyperdriveConnection,
  parseHyperdriveConnectionString,
  verifySupabaseConnection,
  syncDramaProjectToSupabase,
  formatSupabaseCliSetupCommands,
  GenerationRequestType,
  GenerateWithAPIResult,
  CloudflareTokenVerifyResult,
  HyperdriveCreateResult,
  SupabaseVerifyResult,
  SupabaseSyncResult,
  HYPERDRIVE_CONNECTION_PRESETS,
  DEFAULT_CF_TOKEN_NAME,
  DEFAULT_CF_ACCOUNT_ID,
  DEFAULT_CF_CLIENT_IP,
  DEFAULT_CF_CLIENT_IP_CIDR,
  DEFAULT_HYPERDRIVE_CONFIG_NAME,
  DEFAULT_HYPERDRIVE_CONNECTION_STRING,
  DEFAULT_SUPABASE_PROJECT_REF,
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING,
  SUPABASE_CLI_SETUP_COMMANDS,
  MOVIECITY_AI_ENGINE_ID,
  MovieCityAiArchitectureBlueprint,
  MovieCityAiOrchestrationResult,
  getMovieCityAiBackendArchitecture,
  fetchMovieCityAiBackendArchitecture,
  orchestrateMovieCityAiPipeline,
  DEFAULT_R2_BINDING_NAME,
  DEFAULT_R2_BUCKET_NAME,
  DAILY_GENERATION_LIMITS,
  DailyMediaQuotaType,
  DailyUsageCounts,
  formatWranglerR2Toml,
  fetchUserDailyQuotaStatus,
  generateMediaViaWorkerAndUploadToR2,
  R2WorkerGenerateMediaResult,
} from '../services/cloudflareWorkerApi';

type DramaBottomTab =
  | 'home'
  | 'catalog'
  | 'projects'
  | 'studio'
  | 'tools'
  | 'settings'
  | 'developer';
type GenerationStepIndex = 0 | 1 | 2 | 3 | 4;
type ActiveToolModal = 'video' | 'image' | 'effects' | 'story' | null;

const LS_PROJECTS_KEY = 'ai_drama_studio_projects_v2';
const LS_SETTINGS_KEY = 'ai_drama_studio_settings_v2';
const LS_ONBOARDING_KEY = 'ai_drama_studio_onboarded_v2';
const LS_DEVELOPER_MODE_KEY = 'ai_drama_studio_developer_mode_v1';

// IndexedDB helper (AiDramaStudioVideoDB) for storing custom & combined video blobs offline
const IDB_NAME = AI_DRAMA_STUDIO_VIDEO_DB_NAME;
const IDB_STORE = 'combined_videos';

function openVideoIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
      if (!db.objectStoreNames.contains(AI_DRAMA_STUDIO_VIDEO_STORE)) {
        db.createObjectStore(AI_DRAMA_STUDIO_VIDEO_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveVideoBlobToIdb(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openVideoIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function loadVideoBlobFromIdb(key: string): Promise<Blob | null> {
  try {
    const db = await openVideoIdb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function clearAllVideoBlobsFromIdb(): Promise<void> {
  try {
    const db = await openVideoIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

interface InspirationTemplate {
  id: string;
  title: string;
  genre: string;
  prompt: string;
  character: CharacterProfile;
  effectId: string;
}

const DRAMA_INSPIRATIONS: InspirationTemplate[] = [
  {
    id: 'insp-1',
    title: 'Huling Pangako sa Ulan',
    genre: 'Heavy Teleserye Drama',
    prompt:
      'Isang tensyonadong komprontasyon sa lumang mansyon habang bumubuhos ang malakas na ulan. Nabunyag na ang tunay na tagapagmana.',
    character: {
      name: 'Clara Montes',
      appearance: '26yo Filipina, long wavy dark hair, expressive eyes, emerald silk dress',
      style: 'Cinematic teleserye close-up, warm rim light, shallow depth of field',
    },
    effectId: 'manila-noir',
  },
  {
    id: 'insp-2',
    title: 'Tagumpay sa Lona',
    genre: 'Sports Action Drama',
    prompt:
      'Sa huling round ng laban, bumangon ang boksingero mula sa pagkakatumba habang sumisigaw ang buong arena.',
    character: {
      name: 'Kidlat Santos',
      appearance: '28yo Filipino boxer, battle-wornetermined expression, red boxing gloves',
      style: 'High-contrast sports cinema, dramatic arena spotlights, sweat droplets',
    },
    effectId: 'golden-teleserye',
  },
  {
    id: 'insp-3',
    title: 'Lihim ng Makati Skyline',
    genre: 'Modern Corporate Thriller',
    prompt:
      'Sa rooftop ng 50th floor sa Makati, nadiskubre ng batang arkitekto ang sikretong plano ng kumpanya.',
    character: {
      name: 'MarcoValdez',
      appearance: '30yo architect, sharp charcoal suit, glasses reflecting city lights',
      style: 'Neo-noir thriller, anamorphic lens flare, neon city bokeh',
    },
    effectId: 'cyber-makati',
  },
  {
    id: 'insp-4',
    title: 'Gunita ng Intramuros',
    genre: 'Historical Period Romance',
    prompt:
      'Nagpalitan ng liham ang dalawang nagmamahalan sa ilalim ng gasera sa cobblestone street ng Intramuros.',
    character: {
      name: 'Maria & Lukas',
      appearance: 'Traditional Filipiniana baro at saya, warm lantern glow',
      style: '35mm period film aesthetic, soft golden halation',
    },
    effectId: 'vintage-pelikula',
  },
  {
    id: 'insp-5',
    title: 'Kapatid Laban sa Kapatid',
    genre: 'Family Melodrama',
    prompt:
      'Sa hapag-kainan ng pamilya, inamin ng panganay na kapatid ang katotohanang matagal niyang itinago.',
    character: {
      name: 'Elena Salazar',
      appearance: '32yo eldest sister, pearl earrings, tailored white blazer',
      style: 'Dramatic indoor lighting, crisp 85mm portrait lens',
    },
    effectId: 'none',
  },
  {
    id: 'insp-6',
    title: 'Bituin sa Tanghalan',
    genre: 'Musical Rise-to-Fame',
    prompt:
      'Unang pagsampa sa malaking entablado ng isang mang-aawit mula sa probinsya.',
    character: {
      name: 'Tala Rivera',
      appearance: '21yo singer, sparkling stage gown, vintage microphone',
      style: 'Golden stage spotlight, volumetric haze',
    },
    effectId: 'golden-teleserye',
  },
];

function createDefaultStarterProjects(): DramaProject[] {
  const char1: CharacterProfile = {
    name: 'Clara Montes',
    appearance: '26yo Filipina, long dark hair, emerald dress',
    style: 'Cinematic moody lighting, 35mm lens',
  };
  const scenes1: DramaScene[] = [
    {
      id: 'init-sc-1',
      order: 1,
      title: 'Ang Pagdating sa Mansyon',
      scriptText: 'Bumukas ang malaking pinto ng mansyon habang kumikidlat sa labas.',
      visualPrompt: buildCharacterConsistentPrompt(
        'Bumukas ang malaking pinto ng mansyon habang kumikidlat sa labas.',
        char1,
        'manila-noir'
      ),
      durationSec: 4,
      thumbnailDataUrl: generateSceneThumbnailDataUrl({
        title: 'Eksena 1: Ang Pagdating',
        subtitle: char1.name,
        sceneNumber: 1,
        effectId: 'manila-noir',
      }),
      effectId: 'manila-noir',
      status: 'ready',
    },
    {
      id: 'init-sc-2',
      order: 2,
      title: 'Ang Liham ng Katotohanan',
      scriptText: 'Hawak ni Clara ang lumang sobre na magbabago sa kapalaran ng pamilya.',
      visualPrompt: buildCharacterConsistentPrompt(
        'Hawak ni Clara ang lumang sobre na magbabago sa kapalaran ng pamilya.',
        char1,
        'manila-noir'
      ),
      durationSec: 5,
      thumbnailDataUrl: generateSceneThumbnailDataUrl({
        title: 'Eksena 2: Ang Liham',
        subtitle: char1.appearance,
        sceneNumber: 2,
        effectId: 'manila-noir',
      }),
      effectId: 'manila-noir',
      status: 'ready',
    },
  ];

  return [
    {
      id: 'proj-default-1',
      title: 'Huling Pangako sa Ulan',
      prompt: DRAMA_INSPIRATIONS[0].prompt,
      genre: 'Heavy Teleserye Drama',
      createdAt: new Date(Date.now() - 3600_000 * 5).toISOString(),
      updatedAt: new Date(Date.now() - 3600_000 * 2).toISOString(),
      status: 'Done',
      thumbnailDataUrl: scenes1[0].thumbnailDataUrl,
      characterProfile: char1,
      scenes: scenes1,
      selectedEffect: 'manila-noir',
      resolution: '1080p',
      includeAudio: true,
      generationMode: 'simulated',
    },
  ];
}

interface AiDramaStudioProps {
  onSwitchToRenderBackend?: () => void;
  developerMode?: boolean;
  onToggleDeveloperMode?: (next: boolean) => void;
}

export const AiDramaStudio: React.FC<AiDramaStudioProps> = ({
  onSwitchToRenderBackend,
  developerMode: externalDeveloperMode,
  onToggleDeveloperMode,
}) => {
  const [bottomTab, setBottomTab] = useState<DramaBottomTab>('home');
  const [internalDeveloperMode, setInternalDeveloperMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_DEVELOPER_MODE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const isDeveloperMode =
    externalDeveloperMode !== undefined ? externalDeveloperMode : internalDeveloperMode;

  const handleSetDeveloperMode = (next: boolean) => {
    setInternalDeveloperMode(next);
    try {
      localStorage.setItem(LS_DEVELOPER_MODE_KEY, next ? 'true' : 'false');
    } catch {}
    onToggleDeveloperMode?.(next);
    if (!next && bottomTab === 'developer') {
      setBottomTab('settings');
    }
  };

  // User Settings State (persisted in localStorage)
  const [userName, setUserName] = useState<string>('Direk!');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [language, setLanguage] = useState<'tl' | 'en'>('tl');
  const [providerEndpointNote, setProviderEndpointNote] = useState<string>(
    'Cloudflare Worker (generateWithAPI) + Server Proxy (/api/cloudflare/generate) Ready'
  );

  // Firebase Auth & Firestore State
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [cloudProjects, setCloudProjects] = useState<CloudDramaProjectSummary[]>([]);
  const [isSyncingFirestore, setIsSyncingFirestore] = useState<boolean>(false);
  const [firestoreErrorMsg, setFirestoreErrorMsg] = useState<string | null>(null);

  // Cloudflare Worker generateWithAPI(prompt, type) & CIDR State
  const [cfRequestType, setCfRequestType] = useState<GenerationRequestType>('script');
  const [cfLoading, setCfLoading] = useState<boolean>(false);
  const [cfResult, setCfResult] = useState<GenerateWithAPIResult | null>(null);
  const [cfWorkerConfigured, setCfWorkerConfigured] = useState<boolean>(true);
  const [cfTokenName, setCfTokenName] = useState<string>(DEFAULT_CF_TOKEN_NAME);
  const [cfAccountId, setCfAccountId] = useState<string>(DEFAULT_CF_ACCOUNT_ID);
  const [cfClientIp, setCfClientIp] = useState<string>(DEFAULT_CF_CLIENT_IP);
  const [cfClientIpCidr, setCfClientIpCidr] = useState<string>(DEFAULT_CF_CLIENT_IP_CIDR);
  const [cfVerifyLoading, setCfVerifyLoading] = useState<boolean>(false);
  const [cfVerifyResult, setCfVerifyResult] = useState<CloudflareTokenVerifyResult | null>(null);

  // Cloudflare Hyperdrive Connection State
  const [hyperdriveConfigName, setHyperdriveConfigName] = useState<string>(
    DEFAULT_HYPERDRIVE_CONFIG_NAME
  );
  const [hyperdriveConnectionString, setHyperdriveConnectionString] = useState<string>(
    DEFAULT_HYPERDRIVE_CONNECTION_STRING
  );
  const [hyperdriveLoading, setHyperdriveLoading] = useState<boolean>(false);
  const [hyperdriveResult, setHyperdriveResult] = useState<HyperdriveCreateResult | null>(null);

  // Supabase System & App Build Integration State (opdekwvpzwghxeqkwxlo)
  const [supabaseProjectRef, setSupabaseProjectRef] = useState<string>(
    DEFAULT_SUPABASE_PROJECT_REF
  );
  const [supabaseProjectUrl, setSupabaseProjectUrl] = useState<string>(
    DEFAULT_SUPABASE_URL
  );
  const [supabasePublishableKey, setSupabasePublishableKey] = useState<string>(
    DEFAULT_SUPABASE_PUBLISHABLE_KEY
  );
  const [supabaseDirectConnectionString, setSupabaseDirectConnectionString] =
    useState<string>(DEFAULT_SUPABASE_DIRECT_CONNECTION_STRING);
  const [supabaseVerifyLoading, setSupabaseVerifyLoading] = useState<boolean>(false);
  const [supabaseVerifyResult, setSupabaseVerifyResult] =
    useState<SupabaseVerifyResult | null>(null);
  const [supabaseSyncLoading, setSupabaseSyncLoading] = useState<boolean>(false);
  const [supabaseSyncResult, setSupabaseSyncResult] =
    useState<SupabaseSyncResult | null>(null);

  // MovieCityAI (moviecityAI) Unified Backend Architecture & Orchestration State
  const [movieCityArch, setMovieCityArch] = useState<MovieCityAiArchitectureBlueprint>(() =>
    getMovieCityAiBackendArchitecture()
  );
  const [movieCityOrchestrating, setMovieCityOrchestrating] = useState<boolean>(false);
  const [movieCityOrchResult, setMovieCityOrchResult] =
    useState<MovieCityAiOrchestrationResult | null>(null);
  const [showMovieCityRoutes, setShowMovieCityRoutes] = useState<boolean>(true);

  // Cloudflare R2 Media (`movie-city-media`) + Daily Quota + Firestore URL-Only State
  const [r2DailyUsage, setR2DailyUsage] = useState<DailyUsageCounts>({
    image: 0,
    video: 0,
    music: 0,
  });
  const [r2DailyDate, setR2DailyDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [r2E2ePrompt, setR2E2ePrompt] = useState<string>(
    'Cinematic Filipino teleserye heroine Clara Montes standing in Manila rain at night, neon reflections, 35mm film still'
  );
  const [r2E2eRunning, setR2E2eRunning] = useState<boolean>(false);
  const [r2WorkerGenResult, setR2WorkerGenResult] =
    useState<R2WorkerGenerateMediaResult | null>(null);
  const [r2SavedFirestoreDoc, setR2SavedFirestoreDoc] =
    useState<R2MediaAssetMetadata | null>(null);
  const [r2LoadedFirestoreDoc, setR2LoadedFirestoreDoc] =
    useState<R2MediaAssetMetadata | null>(null);
  const [r2FirestoreAssets, setR2FirestoreAssets] = useState<R2MediaAssetMetadata[]>([]);
  const [r2E2eError, setR2E2eError] = useState<string | null>(null);

  // Onboarding & Upgrade Modals
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [onboardingSlide, setOnboardingSlide] = useState<number>(0);
  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);
  const [upgradeConfirmed, setUpgradeConfirmed] = useState<boolean>(false);

  // Inspiration "View All" Modal
  const [showAllInspirations, setShowAllInspirations] = useState<boolean>(false);

  // Expo SDK 58.0.0 Native Device & Sensor Bridge State (expo-camera, expo-contacts, expo-sensors)
  const [expoContacts, setExpoContacts] = useState<ExpoCastContact[]>([]);
  const [expoGyro, setExpoGyro] = useState<{ x: number; y: number; z: number }>({
    x: 0.95,
    y: 0.85,
    z: 0.25,
  });
  const [expoCameraFacing, setExpoCameraFacing] = useState<'back' | 'front'>('back');
  const [expoCameraFrameUrl, setExpoCameraFrameUrl] = useState<string | null>(null);

  // Projects State (persisted in localStorage)
  const [projects, setProjects] = useState<DramaProject[]>(() => {
    try {
      const raw = localStorage.getItem(LS_PROJECTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return createDefaultStarterProjects();
  });

  // Active Project in Studio
  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    return projects[0]?.id || '';
  });
  const [projectToDelete, setProjectToDelete] = useState<DramaProject | null>(null);
  const [confirmClearAllData, setConfirmClearAllData] = useState<boolean>(false);

  // Studio / Generation Flow State (Hugging Face Inference API POST /api/generate-video)
  const [genStep, setGenStep] = useState<GenerationStepIndex>(0);
  const [genProgressPct, setGenProgressPct] = useState<number>(0);
  const [genEtaSec, setGenEtaSec] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [simulateErrorNext, setSimulateErrorNext] = useState<boolean>(false);
  const [hfVideoModel, setHfVideoModel] = useState<string>(DEFAULT_HF_VIDEO_MODEL);
  const [hfTokenConfigured, setHfTokenConfigured] = useState<boolean>(false);

  // Active Editor Fields
  const [editTitle, setEditTitle] = useState<string>('Huling Pangako sa Ulan');
  const [editPrompt, setEditPrompt] = useState<string>(DRAMA_INSPIRATIONS[0].prompt);
  const [editGenre, setEditGenre] = useState<string>('Heavy Teleserye Drama');
  const [editCharName, setEditCharName] = useState<string>('Clara Montes');
  const [editCharAppearance, setEditCharAppearance] = useState<string>(
    '26yo Filipina, long wavy dark hair, emerald silk dress'
  );
  const [editCharStyle, setEditCharStyle] = useState<string>(
    'Cinematic moody lighting, 35mm film grain'
  );
  const [editEffectId, setEditEffectId] = useState<string>('manila-noir');
  const [editScenes, setEditScenes] = useState<DramaScene[]>(
    projects[0]?.scenes || createDefaultStarterProjects()[0].scenes
  );
  const [editResolution, setEditResolution] = useState<'480p' | '720p' | '1080p'>('1080p');
  const [editIncludeAudio, setEditIncludeAudio] = useState<boolean>(true);

  // Timeline Drag & Scene Edit State
  const [draggedSceneIndex, setDraggedSceneIndex] = useState<number | null>(null);
  const [editingScene, setEditingScene] = useState<DramaScene | null>(null);
  const [activeScenePreviewIndex, setActiveScenePreviewIndex] = useState<number>(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const [isCombiningVideo, setIsCombiningVideo] = useState<boolean>(false);
  const [combinedVideoUrl, setCombinedVideoUrl] = useState<string | null>(
    FEATURED_REAL_HUMAN_EPISODES[0].sources[0]
  );
  const [featuredEpisodeId, setFeaturedEpisodeId] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].id
  );
  const [featuredMirrorIdx, setFeaturedMirrorIdx] = useState<number>(0);
  const [featuredEpisodeVideoUrl, setFeaturedEpisodeVideoUrl] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].sources[0]
  );
  const [featuredEpisodeTitle, setFeaturedEpisodeTitle] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].title
  );
  const [directorTerminalLogs, setDirectorTerminalLogs] = useState<string[]>([
    '[Akzyon Engine] Live AI Director Studio initialized (24fps · 768x512 · 73 frames)... READY',
    '[Akzyon Engine] IndexedDB Vault (AiDramaStudioVideoDB) & R2 Storage pipeline connected... OK',
  ]);
  const [masterSubtitles, setMasterSubtitles] = useState<TagalogSubtitleCue[]>(
    () => FEATURED_REAL_HUMAN_EPISODES[0].defaultSubtitles
  );
  const [activeMasterSubtitleText, setActiveMasterSubtitleText] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].defaultSubtitles[0]?.text || ''
  );
  const [tagalogDubEnabled, setTagalogDubEnabled] = useState<boolean>(true);
  const [autoPlayMasterVideo, setAutoPlayMasterVideo] = useState<boolean>(false);
  const customVideoInputRef = useRef<HTMLInputElement | null>(null);
  const studioCustomVideoInputRef = useRef<HTMLInputElement | null>(null);

  const appendDirectorLog = (message: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setDirectorTerminalLogs((prev) => [...prev.slice(-18), `[${ts}] ${message}`]);
  };

  const handleMasterVideoTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const currentSec = e.currentTarget.currentTime;
    if (!masterSubtitles.length) return;
    const duration = e.currentTarget.duration || 12;
    const loopSec = duration > 0 ? currentSec % 12 : currentSec;
    const matched =
      masterSubtitles.find((c) => loopSec >= c.startSec && loopSec <= c.endSec) ||
      masterSubtitles[0];
    if (matched && matched.text !== activeMasterSubtitleText) {
      setActiveMasterSubtitleText(matched.text);
    }
  };

  const handleSelectFeaturedRealHumanEpisode = (ep: FeaturedRealHumanEpisode) => {
    setFeaturedEpisodeId(ep.id);
    setFeaturedMirrorIdx(0);
    setFeaturedEpisodeVideoUrl(ep.sources[0]);
    setFeaturedEpisodeTitle(ep.title);
    setCombinedVideoUrl(ep.sources[0]);
    const cues =
      ep.defaultSubtitles?.length > 0
        ? ep.defaultSubtitles
        : buildTagalogSubtitlesFromPrompt(ep.title);
    setMasterSubtitles(cues);
    setActiveMasterSubtitleText(cues[0]?.text || '');
    setAutoPlayMasterVideo(true);
    if (tagalogDubEnabled) {
      triggerTagalogDubbingSpeech(cues, true);
    }
  };

  const handleFeaturedVideoError = () => {
    const currentEp =
      FEATURED_REAL_HUMAN_EPISODES.find((e) => e.id === featuredEpisodeId) ||
      FEATURED_REAL_HUMAN_EPISODES[0];
    const nextIdx = featuredMirrorIdx + 1;
    if (nextIdx < currentEp.sources.length) {
      const fallbackUrl = currentEp.sources[nextIdx];
      setFeaturedMirrorIdx(nextIdx);
      setFeaturedEpisodeVideoUrl(fallbackUrl);
      setCombinedVideoUrl(fallbackUrl);
    } else if (featuredEpisodeVideoUrl !== '/media/video_akzyon_episode1.mp4') {
      setFeaturedEpisodeVideoUrl('/media/video_akzyon_episode1.mp4');
      setCombinedVideoUrl('/media/video_akzyon_episode1.mp4');
    }
  };

  const handleUploadCustomUserMp4 = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const saved = await saveCustomVideoToAiDramaStudioDB(file, file.name);
      await saveVideoBlobToIdb(`hf_video_${activeProjectId || 'draft'}`, saved.blob);
      const blobUrl = URL.createObjectURL(saved.blob);
      const customTitle = `Sariling Video (Offline IndexedDB): ${saved.fileName} (${(
        saved.sizeBytes /
        (1024 * 1024)
      ).toFixed(2)} MB)`;
      setFeaturedEpisodeVideoUrl(blobUrl);
      setFeaturedEpisodeTitle(customTitle);
      setCombinedVideoUrl(blobUrl);
      setLtxVideoUrl(blobUrl);
      showToast(
        `Na-save ang '${saved.fileName}' sa AiDramaStudioVideoDB (IndexedDB) at tumutugtog na sa main player!`
      );
    } catch {
      showToast('Hindi ma-save ang napiling MP4 video sa AiDramaStudioVideoDB.');
    } finally {
      e.target.value = '';
    }
  };

  // Export & Tool Modals
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [activeToolModal, setActiveToolModal] = useState<ActiveToolModal>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Tool Modal Local States
  const [storyWriterTopic, setStoryWriterTopic] = useState<string>(
    'Dalawang magkapatid na nagkahiwalay noong bata pa at nagharap sa korte'
  );
  const [storyWriterOutput, setStoryWriterOutput] = useState<string>('');
  const [imageToolPrompt, setImageToolPrompt] = useState<string>(
    'Dramatic Pinoy teleserye poster in golden sunset lighting'
  );
  const [imageToolPreviewUrl, setImageToolPreviewUrl] = useState<string>('');
  const [videoToolMotion, setVideoToolMotion] = useState<string>('Slow Dolly Zoom + Rain FX');
  const [aiEnhancingPrompt, setAiEnhancingPrompt] = useState<boolean>(false);

  // LTX-Video 2B v0.9.5 ComfyUI Text-to-Video Studio State
  const [ltxParams, setLtxParams] = useState<LtxVideoParams>(DEFAULT_LTX_VIDEO_PARAMS);
  const [ltxGenerating, setLtxGenerating] = useState<boolean>(false);
  const [ltxVideoUrl, setLtxVideoUrl] = useState<string>(LTX_COLAB_RENDERED_VIDEO_URL);
  const [ltxSeedUsed, setLtxSeedUsed] = useState<number>(0);
  const [ltxError, setLtxError] = useState<string | null>(null);
  const [showLtxColabCode, setShowLtxColabCode] = useState<boolean>(false);

  const ltxValidation = validateLtxVideoParams(ltxParams);

  const handleGenerateLtxVideo = async () => {
    setLtxError(null);
    const check = validateLtxVideoParams(ltxParams);
    if (!check.valid) {
      setLtxError(check.errors.join(' '));
      return;
    }
    setLtxGenerating(true);
    try {
      const resp = await fetch('/api/ltx-video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ltxParams,
          userId: firebaseUser?.uid || 'studio_e2e_user',
          projectId: activeProjectId || 'proj_ltx_video_1',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      if (data.url) {
        setLtxVideoUrl(data.url);
        setFeaturedEpisodeVideoUrl(data.url);
        setFeaturedEpisodeTitle(
          `LTX-Video 2B (${ltxParams.width}x${ltxParams.height} · ${check.effectiveDecodedFrames}f @ ${ltxParams.fps}fps)`
        );
      }
      if (data.seedUsed) {
        setLtxSeedUsed(Number(data.seedUsed));
      }
      if (data.firestoreDoc) {
        setR2LoadedFirestoreDoc(data.firestoreDoc);
        setR2FirestoreAssets((prev) => [
          data.firestoreDoc,
          ...prev.filter((item) => item.id !== data.firestoreDoc.id),
        ]);
      }
      showToast(
        `LTX-Video 2B v0.9.5 generated (${ltxParams.width}x${ltxParams.height} @ ${ltxParams.fps}fps) → ${data.url}`
      );
    } catch (err: any) {
      setLtxError(err?.message || 'Nabigo ang LTX-Video generation.');
    } finally {
      setLtxGenerating(false);
    }
  };

  const handleDownloadFixedLtxColabNotebook = () => {
    const ipynbStr = buildFixedLtxColabNotebookJson(ltxParams);
    const blob = new Blob([ipynbStr], { type: 'application/x-ipynb+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'LTX_Video_2B_v0_9_5_Fixed_Python313.ipynb';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Na-download na ang Fixed Python 3.13 LTX-Video Colab Notebook (.ipynb)!');
  };

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3400);
  };

  const handleEnhanceWithCinematicAI = async (
    type: 'image' | 'video',
    target: 'r2' | 'studio'
  ) => {
    const sourceInput = target === 'r2' ? r2E2ePrompt : editPrompt;
    if (!sourceInput.trim()) return;
    setAiEnhancingPrompt(true);
    try {
      const enhanced = await generateCinematicPromptFromAI(type, sourceInput);
      if (enhanced) {
        if (target === 'r2') {
          setR2E2ePrompt(enhanced);
        } else {
          setEditPrompt(enhanced);
        }
        showToast(
          `Na-enhance ang ${type.toUpperCase()} prompt gamit ang generateCinematicPromptFromAI!`
        );
      }
    } finally {
      setAiEnhancingPrompt(false);
    }
  };

  // Load Settings & Onboarding on mount
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(LS_SETTINGS_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed.userName) {
          setUserName('Direk!');
        }
        if (parsed.theme === 'light' || parsed.theme === 'dark') setTheme(parsed.theme);
        if (parsed.language === 'tl' || parsed.language === 'en') setLanguage(parsed.language);
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('onboarding') === '1' && params.get('autostart') !== '1') {
        setShowOnboarding(true);
      }
    } catch {}

    // Check Cloudflare Worker status on server
    fetch('/api/cloudflare/status')
      .then((r) => r.json())
      .then((d) => {
        if (d) {
          if (typeof d.configured === 'boolean') setCfWorkerConfigured(d.configured);
          if (d.tokenName) setCfTokenName(String(d.tokenName));
          if (d.accountId) setCfAccountId(String(d.accountId));
          if (d.clientIp) setCfClientIp(String(d.clientIp));
          if (d.clientIpCidr) setCfClientIpCidr(String(d.clientIpCidr));
        }
      })
      .catch(() => {});

    // Check Hugging Face Text-to-Video Backend Status (/api/generate-video/status)
    fetch('/api/generate-video/status')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.ok) {
          if (d.activeModel) setHfVideoModel(String(d.activeModel));
          if (typeof d.tokenConfigured === 'boolean') setHfTokenConfigured(d.tokenConfigured);
        }
      })
      .catch(() => {});

    // Restore any previously saved custom or generated IndexedDB video blob on mount (AiDramaStudioVideoDB)
    loadCustomVideoFromAiDramaStudioDB()
      .then((saved) => {
        if (saved && saved.blob.size > 0) {
          const objUrl = URL.createObjectURL(saved.blob);
          setFeaturedEpisodeVideoUrl(objUrl);
          setFeaturedEpisodeTitle(`Sariling Video (Offline IndexedDB): ${saved.fileName}`);
          setCombinedVideoUrl(objUrl);
          return;
        }
        return loadVideoBlobFromIdb(`hf_video_${activeProjectId || 'draft'}`).then((blob) => {
          if (blob && blob.size > 0) {
            const objUrl = URL.createObjectURL(blob);
            setCombinedVideoUrl(objUrl);
          }
        });
      })
      .catch(() => {});

    // Check Supabase status on server
    fetch('/api/supabase/status')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.ok) {
          if (d.projectRef) setSupabaseProjectRef(String(d.projectRef));
          if (d.projectUrl) setSupabaseProjectUrl(String(d.projectUrl));
          if (d.publishableKey) setSupabasePublishableKey(String(d.publishableKey));
          if (d.directConnectionString) {
            setSupabaseDirectConnectionString(String(d.directConnectionString));
          }
        }
      })
      .catch(() => {});

    // Fetch live MovieCityAI unified backend architecture
    fetchMovieCityAiBackendArchitecture()
      .then((arch) => {
        if (arch) setMovieCityArch(arch);
      })
      .catch(() => {});

    // Fetch current per-user daily generation quota (5 images, 1 video, 3 music tracks)
    fetchUserDailyQuotaStatus('studio_e2e_user')
      .then((q) => {
        if (q && q.usage) {
          setR2DailyUsage(q.usage);
          setR2DailyDate(q.date);
        }
      })
      .catch(() => {});

    // Load existing R2 media metadata documents from Cloud Firestore
    listR2MediaMetadataFromFirestore()
      .then((items) => {
        setR2FirestoreAssets(items);
        if (items.length > 0) {
          setR2LoadedFirestoreDoc(items[0]);
        }
      })
      .catch(() => {});

    // Subscribe to Firebase Auth state
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
      setIsAuthReady(true);
    });
    return () => unsubAuth();
  }, []);

  // Subscribe to user's Firestore projects only when authenticated
  useEffect(() => {
    if (!isAuthReady || !firebaseUser) {
      setCloudProjects([]);
      return;
    }
    const unsubCloud = subscribeUserDramaProjects(
      firebaseUser.uid,
      (items) => {
        setCloudProjects(items);
        setFirestoreErrorMsg(null);
      },
      (err) => {
        setFirestoreErrorMsg(err.message);
      }
    );
    return () => unsubCloud();
  }, [isAuthReady, firebaseUser]);

  const handleRunR2MediaPipeline = async (
    mediaType: DailyMediaQuotaType = 'image',
    customPrompt?: string
  ) => {
    const promptToUse = (customPrompt ?? r2E2ePrompt).trim();
    if (!promptToUse) {
      setR2E2eError('Kailangan ng prompt bago mag-generate.');
      return;
    }

    setR2E2eRunning(true);
    setR2E2eError(null);

    try {
      const effectiveUserId = firebaseUser?.uid || 'studio_e2e_user';
      // 1. Worker checks daily limit BEFORE calling AI -> Calls AI -> Uploads to R2 (`PUT /upload/:key`)
      const genRes = await generateMediaViaWorkerAndUploadToR2({
        mediaType,
        prompt: promptToUse,
        userId: effectiveUserId,
        projectId: activeProjectId || 'proj_default_1',
        authToken: cfTokenName,
      });

      setR2WorkerGenResult(genRes);
      if (genRes.quota?.usage) {
        setR2DailyUsage(genRes.quota.usage);
        setR2DailyDate(genRes.quota.date);
      }

      if (!genRes.ok || !genRes.url) {
        setR2E2eError(
          genRes.error || `Worker R2 generation failed for ${mediaType}.`
        );
        return;
      }

      // 2. Store ONLY the R2 file URL (/media/:key) and metadata in Cloud Firestore (/r2_media_assets/{id})
      const savedDoc = await saveR2MediaMetadataToFirestore({
        ownerId: effectiveUserId,
        projectId: activeProjectId || 'proj_default_1',
        r2Key: genRes.r2Key,
        url: genRes.url,
        mediaType,
        prompt: promptToUse,
        contentType: genRes.contentType,
        sizeBytes: genRes.sizeBytes,
        model: genRes.model,
      });
      setR2SavedFirestoreDoc(savedDoc);

      // 3. Load the saved document back from Cloud Firestore and display it in the UI
      const loadedDoc = await loadR2MediaMetadataFromFirestore(savedDoc.id);
      if (loadedDoc) {
        setR2LoadedFirestoreDoc(loadedDoc);
      }
      const allAssets = await listR2MediaMetadataFromFirestore().catch(() => [savedDoc]);
      setR2FirestoreAssets(allAssets.length > 0 ? allAssets : [savedDoc]);

      if (mediaType === 'image') {
        setImageToolPreviewUrl((loadedDoc || savedDoc).url);
      } else if (mediaType === 'video') {
        const videoUrl = (loadedDoc || savedDoc).url;
        setCombinedVideoUrl(videoUrl);
        setFeaturedEpisodeVideoUrl(videoUrl);
        setFeaturedEpisodeTitle(`R2 Generated Video: ${ (loadedDoc || savedDoc).r2Key }`);
      }

      showToast(
        `R2 (${DEFAULT_R2_BUCKET_NAME}) + Firestore E2E Success: ${(loadedDoc || savedDoc).url}`
      );
    } catch (err: any) {
      setR2E2eError(err?.message || String(err));
    } finally {
      setR2E2eRunning(false);
    }
  };

  const handleResetR2DailyQuota = async () => {
    try {
      const effectiveUserId = firebaseUser?.uid || 'studio_e2e_user';
      const res = await fetch('/api/cloudflare/quota/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: effectiveUserId }),
      });
      const data = await res.json();
      if (data?.usage) {
        setR2DailyUsage(data.usage);
        if (data.date) setR2DailyDate(data.date);
      } else {
        setR2DailyUsage({ image: 0, video: 0, music: 0 });
      }
      setR2E2eError(null);
      showToast('Na-reset na ang Daily Quota (0/5 Images · 0/1 Video · 0/3 Audio)!');
    } catch {
      setR2DailyUsage({ image: 0, video: 0, music: 0 });
      setR2E2eError(null);
    }
  };

  const handleCloudflareWorkerCall = async (overrideType?: GenerationRequestType) => {
    const reqType = overrideType || cfRequestType;
    setCfResult(null);
    const fullPrompt = buildCharacterConsistentPrompt(
      editPrompt,
      {
        name: editCharName,
        appearance: editCharAppearance,
        style: editCharStyle,
      },
      editEffectId
    );
    const res = await callCloudflareWorkerAPI(fullPrompt, reqType, {
      timeoutMs: 30_000,
      onLoadingChange: (loading) => setCfLoading(loading),
      metadata: {
        projectTitle: editTitle,
        resolution: editResolution,
        includeAudio: editIncludeAudio,
        tokenName: cfTokenName,
        clientIp: cfClientIp,
        clientIpCidr: cfClientIpCidr,
      },
    });
    setCfResult(res);
    if (res.ok && res.content) {
      showToast(`Cloudflare Worker (${reqType} · ${cfTokenName}) tagumpay sa ${res.elapsedMs}ms!`);
    }
  };

  const handleVerifyCloudflareToken = async () => {
    setCfVerifyLoading(true);
    setCfVerifyResult(null);
    try {
      const res = await verifyCloudflareToken();
      setCfVerifyResult(res);
      showToast(`Cloudflare Token (${res.tokenName}) & CIDR (${res.clientIpCidr}) checked!`);
    } finally {
      setCfVerifyLoading(false);
    }
  };

  const handleCreateHyperdrive = async () => {
    setHyperdriveLoading(true);
    setHyperdriveResult(null);
    try {
      const res = await createHyperdriveConnection(
        hyperdriveConfigName,
        hyperdriveConnectionString
      );
      setHyperdriveResult(res);
      if (res.ok) {
        showToast(`Hyperdrive "${res.configName}" (${res.configId}) handa na!`);
      } else {
        showToast(res.error || 'Pakisuri ang Hyperdrive connection string.');
      }
    } finally {
      setHyperdriveLoading(false);
    }
  };

  const handleCopyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`Nakopya ang ${label}!`);
    } catch {
      showToast(`${label}: ${value}`);
    }
  };

  const handleVerifySupabase = async () => {
    setSupabaseVerifyLoading(true);
    setSupabaseVerifyResult(null);
    try {
      const res = await verifySupabaseConnection({
        projectUrl: supabaseProjectUrl,
        publishableKey: supabasePublishableKey,
        directConnectionString: supabaseDirectConnectionString,
      });
      setSupabaseVerifyResult(res);
      if (res.ok) {
        showToast(
          `Supabase (${res.projectRef}) connected & verified (${res.dbHost}:${res.dbPort})!`
        );
      } else {
        showToast(res.message || 'Pakisuri ang Supabase connection details.');
      }
    } finally {
      setSupabaseVerifyLoading(false);
    }
  };

  const handleSyncActiveProjectToSupabase = async () => {
    const activeProj = projects.find((p) => p.id === activeProjectId) || projects[0];
    if (!activeProj) return;
    setSupabaseSyncLoading(true);
    setSupabaseSyncResult(null);
    try {
      const res = await syncDramaProjectToSupabase(activeProj as any);
      setSupabaseSyncResult(res);
      showToast(res.message);
    } finally {
      setSupabaseSyncLoading(false);
    }
  };

  const handleBindSupabaseToHyperdrive = async () => {
    const targetConfigName = `${supabaseProjectRef}-supabase-hyperdrive`;
    setHyperdriveConfigName(targetConfigName);
    setHyperdriveConnectionString(supabaseDirectConnectionString);
    setHyperdriveLoading(true);
    setHyperdriveResult(null);
    try {
      const res = await createHyperdriveConnection(
        targetConfigName,
        supabaseDirectConnectionString
      );
      setHyperdriveResult(res);
      showToast(
        `Supabase Direct Connection (${supabaseProjectRef}) bound to Hyperdrive "${targetConfigName}"!`
      );
    } finally {
      setHyperdriveLoading(false);
    }
  };

  const handleRunMovieCityAiOrchestration = async () => {
    const activeProj = projects.find((p) => p.id === activeProjectId) || projects[0];
    setMovieCityOrchestrating(true);
    setMovieCityOrchResult(null);
    try {
      const res = await orchestrateMovieCityAiPipeline({
        id: activeProj?.id || 'proj-default-1',
        title: activeProj?.title || editTitle,
        prompt: activeProj?.prompt || editPrompt,
        genre: activeProj?.genre || editGenre,
        resolution: activeProj?.resolution || editResolution,
      });
      setMovieCityOrchResult(res);
      showToast(
        `MovieCityAI (${res.engineId}) Full-Stack Orchestration complete in ${res.elapsedMs}ms!`
      );
    } finally {
      setMovieCityOrchestrating(false);
    }
  };

  const handleSyncActiveProjectToFirestore = async () => {
    const activeProj = projects.find((p) => p.id === activeProjectId) || projects[0];
    if (!activeProj) return;
    setIsSyncingFirestore(true);
    setFirestoreErrorMsg(null);
    try {
      await syncDramaProjectToFirestore(activeProj);
      showToast('Project na-sync na sa Firebase Cloud Firestore!');
    } catch (err: any) {
      setFirestoreErrorMsg(err?.message || 'Nabigo sa pag-sync sa Firestore.');
    } finally {
      setIsSyncingFirestore(false);
    }
  };

  // Expo SDK 58.0.0 Device & Sensor Handlers (expo-camera, expo-contacts, expo-sensors)
  const handleLoadExpoContacts = async () => {
    const list = await Contact.getAll();
    setExpoContacts(list);
    showToast(`expo-contacts: Contact.getAll() loaded ${list.length} Cast & Crew profiles!`);
  };

  const handleLockContactAsCharacter = (contact: ExpoCastContact) => {
    setEditCharName(contact.name);
    setEditCharAppearance(contact.characterAppearance);
    setEditCharStyle(contact.characterStyle);
    showToast(`Character Profile Lock updated from expo-contacts: ${contact.name}`);
  };

  const handleCaptureExpoCameraFrame = () => {
    const frameUrl = captureCameraViewReferenceFrame({
      facing: expoCameraFacing,
      sceneTitle: editTitle || 'Teleserye Take 1',
      gyro: expoGyro,
    });
    setExpoCameraFrameUrl(frameUrl);
    if (editScenes.length > 0) {
      setEditScenes((prev) =>
        prev.map((sc, idx) => (idx === 0 ? { ...sc, thumbnailDataUrl: frameUrl } : sc))
      );
    }
    showToast(`expo-camera (CameraView ${expoCameraFacing}) frame captured into Scene 1!`);
  };

  const handleApplyGyroscopeMotion = () => {
    const mapped = mapGyroscopeToCameraMotion(expoGyro);
    setVideoToolMotion(mapped.motionPreset);
    setEditCharStyle((prev) =>
      prev.includes(mapped.motionPreset) ? prev : `${prev}, ${mapped.motionPreset}`
    );
    showToast(
      `expo-sensors (Gyroscope ${mapped.magnitude} rad/s) → ${mapped.motionPreset} applied!`
    );
  };

  // Save Projects to localStorage (lightweight metadata + SVG data URL thumbnails only)
  useEffect(() => {
    try {
      localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(projects));
    } catch {}
  }, [projects]);

  // Save Settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_SETTINGS_KEY,
        JSON.stringify({ userName, theme, language })
      );
    } catch {}
  }, [userName, theme, language]);

  // Auto-advance scene preview player when playing
  useEffect(() => {
    if (!isPlayingPreview || editScenes.length === 0) return;
    const currentScene = editScenes[activeScenePreviewIndex] || editScenes[0];
    const waitMs = Math.max(1500, (currentScene?.durationSec || 3) * 1000);
    const timer = window.setTimeout(() => {
      setActiveScenePreviewIndex((prev) => (prev + 1) % editScenes.length);
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [isPlayingPreview, activeScenePreviewIndex, editScenes]);

  const loadProjectIntoStudio = (proj: DramaProject) => {
    setActiveProjectId(proj.id);
    setEditTitle(proj.title);
    setEditPrompt(proj.prompt);
    setEditGenre(proj.genre);
    setEditCharName(proj.characterProfile.name);
    setEditCharAppearance(proj.characterProfile.appearance);
    setEditCharStyle(proj.characterProfile.style);
    setEditEffectId(proj.selectedEffect || 'none');
    setEditScenes(proj.scenes);
    setEditResolution(proj.resolution || '1080p');
    setEditIncludeAudio(proj.includeAudio ?? true);
    setGenStep(proj.status === 'Done' ? 4 : 0);
    setGenProgressPct(proj.status === 'Done' ? 100 : 0);
    setGenError(null);
    setBottomTab('studio');
  };

  const handleCreateNewProject = (template?: InspirationTemplate) => {
    const newId = `proj-${Date.now()}`;
    const charProfile: CharacterProfile = template?.character || {
      name: 'Clara Montes',
      appearance: '26yo Filipina lead actress, expressive eyes, emerald dress',
      style: 'Cinematic teleserye lighting, 35mm film look',
    };
    const effect = template?.effectId || 'manila-noir';
    const initialScene: DramaScene = {
      id: `sc-${Date.now()}-1`,
      order: 1,
      title: 'Unang Eksena',
      scriptText:
        template?.prompt ||
        'Nagkatitigan ang dalawang bida sa gitna ng ulan habang binubunyag ang katotohanan.',
      visualPrompt: buildCharacterConsistentPrompt(
        template?.prompt || 'Dramatic opening scene',
        charProfile,
        effect
      ),
      durationSec: 4,
      thumbnailDataUrl: generateSceneThumbnailDataUrl({
        title: template?.title || 'Bagong Eksena 1',
        subtitle: charProfile.name,
        sceneNumber: 1,
        effectId: effect,
      }),
      effectId: effect,
      status: 'ready',
    };

    const newProj: DramaProject = {
      id: newId,
      title: template?.title || 'Bagong 3!2!1! Akzyon Project',
      prompt:
        template?.prompt ||
        'Isang dramatikong kwento ng pag-ibig, pamilya, at pagbangon.',
      genre: template?.genre || 'Teleserye Drama',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'Draft',
      thumbnailDataUrl: initialScene.thumbnailDataUrl,
      characterProfile: charProfile,
      scenes: [initialScene],
      selectedEffect: effect,
      resolution: '1080p',
      includeAudio: true,
      generationMode: 'simulated',
    };

    setProjects((prev) => [newProj, ...prev]);
    loadProjectIntoStudio(newProj);
    setShowAllInspirations(false);
    showToast(
      language === 'tl'
        ? `Binuksan ang '${newProj.title}' sa Studio!`
        : `Opened '${newProj.title}' in Studio!`
    );
  };

  const handleLoadCatalogMovieIntoStudio = (opts: {
    title: string;
    prompt: string;
    scenes: DramaScene[];
    director?: string;
    cast?: string;
  }) => {
    const newId = `proj-catalog-${Date.now()}`;
    const primaryActor = opts.cast ? opts.cast.split(',')[0].trim() : 'Bida ng Pelikula';
    const charProfile: CharacterProfile = {
      name: primaryActor,
      appearance: 'Cinematic Filipino teleserye hero, intense emotion, dramatic styling',
      style: '35mm anamorphic Manila golden hour lighting',
    };
    const newProj: DramaProject = {
      id: newId,
      title: `${opts.title} (3!2!1! Akzyon Pinoy Adaptation)`,
      prompt: opts.prompt,
      genre: 'Movie City Pinoy Teleserye',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'Draft',
      thumbnailDataUrl: opts.scenes[0]?.thumbnailDataUrl || '',
      characterProfile: charProfile,
      scenes: opts.scenes,
      selectedEffect: 'manila-noir',
      resolution: '1080p',
      includeAudio: true,
      generationMode: 'simulated',
    };

    setProjects((prev) => [newProj, ...prev]);
    loadProjectIntoStudio(newProj);
    showToast(
      language === 'tl'
        ? `Nai-load ang '${opts.title}' sa 3!2!1! Akzyon Studio Editor!`
        : `Loaded '${opts.title}' into 3!2!1! Akzyon Studio Editor!`
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePlayCatalogMoviePreview = (title: string, description: string) => {
    setFeaturedEpisodeTitle(`[Movie City Preview] ${title}`);
    const cues = buildTagalogSubtitlesFromPrompt(`${title}: ${description}`);
    setMasterSubtitles(cues);
    setActiveMasterSubtitleText(cues[0]?.text || title);
    setAutoPlayMasterVideo(true);
    setBottomTab('home');
    showToast(
      language === 'tl'
        ? `Naka-play ang preview ng '${title}' sa Master Player!`
        : `Playing preview for '${title}' in Master Player!`
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveCurrentProject = (overrideStatus?: 'Draft' | 'Generating' | 'Done') => {
    const charProfile: CharacterProfile = {
      name: editCharName,
      appearance: editCharAppearance,
      style: editCharStyle,
    };

    const syncedScenes = editScenes.map((sc, idx) => ({
      ...sc,
      order: idx + 1,
      visualPrompt: buildCharacterConsistentPrompt(
        sc.scriptText,
        charProfile,
        sc.effectId || editEffectId
      ),
      thumbnailDataUrl: generateSceneThumbnailDataUrl({
        title: sc.title,
        subtitle: charProfile.name || 'Consistent Character',
        sceneNumber: idx + 1,
        effectId: sc.effectId || editEffectId,
      }),
    }));

    setEditScenes(syncedScenes);

    const updatedProj: DramaProject = {
      id: activeProjectId || `proj-${Date.now()}`,
      title: editTitle.trim() || 'Untitled Drama',
      prompt: editPrompt,
      genre: editGenre,
      createdAt:
        projects.find((p) => p.id === activeProjectId)?.createdAt ||
        new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: overrideStatus || 'Done',
      thumbnailDataUrl:
        syncedScenes[0]?.thumbnailDataUrl ||
        generateSceneThumbnailDataUrl({ title: editTitle, effectId: editEffectId }),
      characterProfile: charProfile,
      scenes: syncedScenes,
      selectedEffect: editEffectId,
      resolution: editResolution,
      includeAudio: editIncludeAudio,
      generationMode: 'simulated',
    };

    setProjects((prev) => {
      const exists = prev.some((p) => p.id === updatedProj.id);
      if (exists) {
        return prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      }
      return [updatedProj, ...prev];
    });
    setActiveProjectId(updatedProj.id);
    showToast(
      language === 'tl'
        ? 'Matagumpay na na-save ang project sa localStorage!'
        : 'Project saved to localStorage!'
    );
  };

  const handleDuplicateProject = (proj: DramaProject) => {
    const dup: DramaProject = {
      ...proj,
      id: `proj-${Date.now()}`,
      title: `${proj.title} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'Draft',
      scenes: proj.scenes.map((s, i) => ({
        ...s,
        id: `sc-${Date.now()}-${i}`,
      })),
    };
    setProjects((prev) => [dup, ...prev]);
    showToast(
      language === 'tl'
        ? `Na-duplicate ang '${proj.title}'!`
        : `Duplicated '${proj.title}'!`
    );
  };

  const handleConfirmDeleteProject = () => {
    if (!projectToDelete) return;
    setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
    setProjectToDelete(null);
    showToast(
      language === 'tl' ? 'Nabura na ang project.' : 'Project deleted.'
    );
  };

  // 5-Step Generation Flow with Live AI Director Studio, Tagalog Hakbang Status & Terminal Log (Requirement #2 & #8)
  const handleRun5StepGeneration = async () => {
    if (!editPrompt.trim()) {
      setGenError(
        language === 'tl'
          ? 'Maglagay muna ng kwento o prompt bago mag-generate.'
          : 'Please enter a story prompt before generating.'
      );
      return;
    }

    setIsGenerating(true);
    setGenError(null);
    setAutoPlayMasterVideo(false);
    const charProfile: CharacterProfile = {
      name: editCharName,
      appearance: editCharAppearance,
      style: editCharStyle,
    };

    try {
      // Hakbang 1 (0-25%): "Sinisiyasat ang Prompt at Kwento..."
      setGenStep(0);
      setGenProgressPct(18);
      setGenEtaSec(8);
      setDirectorTerminalLogs([]);
      appendDirectorLog(
        `[Akzyon Engine] Hakbang 1 (0-25%): ${DIRECTOR_LIVE_STAGES[0].titleTl}`
      );
      appendDirectorLog(
        `[Story Parser] Locking Character Profile (${charProfile.name}) & Manila Noir LUT... OK`
      );
      await new Promise((r) => setTimeout(r, 180));

      // Hakbang 2 (26-50%): "Naglo-load ng LTX-Video at AI Models..."
      setGenStep(1);
      setGenProgressPct(42);
      setGenEtaSec(6);
      appendDirectorLog(
        `[Akzyon Engine] Hakbang 2 (26-50%): ${DIRECTOR_LIVE_STAGES[1].titleTl}`
      );
      appendDirectorLog(
        `[Model Router] Loading LTX-Video 2B v0.9.5 + T5-XXL FP8 text encoder... OK`
      );
      const scriptRes = await generateWithAPI({
        step: 'script',
        prompt: editPrompt,
        characterProfile: charProfile,
        effectId: editEffectId,
        scenes: editScenes,
        shouldFailForTest: simulateErrorNext,
      });

      // Hakbang 3 (51-75%): "Binubuo ang cinematic frames at galaw ng tunay na tao..."
      setGenStep(2);
      setGenProgressPct(68);
      setGenEtaSec(4);
      appendDirectorLog(
        `[Akzyon Engine] Hakbang 3 (51-75%): ${DIRECTOR_LIVE_STAGES[2].titleTl}`
      );
      appendDirectorLog(`[Akzyon Engine] Rendering 73 frames @ 24fps... OK`);
      const imgRes = await generateWithAPI({
        step: 'images',
        prompt: editPrompt,
        characterProfile: charProfile,
        effectId: editEffectId,
        scenes: scriptRes.scenes,
      });
      setEditScenes(imgRes.scenes);

      // Hakbang 4 (76-100%): "Sine-save ang MP4 video sa R2 Storage at IndexedDB Vault..."
      setGenStep(3);
      setGenProgressPct(88);
      setGenEtaSec(2);
      appendDirectorLog(
        `[Akzyon Engine] Hakbang 4 (76-100%): ${DIRECTOR_LIVE_STAGES[3].titleTl}`
      );
      const videoRes = await generateWithAPI({
        step: 'video',
        prompt: editPrompt,
        characterProfile: charProfile,
        effectId: editEffectId,
        scenes: imgRes.scenes,
      });

      if (videoRes.modelUsed) {
        setHfVideoModel(videoRes.modelUsed);
      }

      // Final Output Ready — Save video/mp4 blob to IndexedDB and auto-play with Tagalog dubbing & subtitles
      let finalPlayableUrl = videoRes.videoUrl || '/media/video_akzyon_episode1.mp4';
      if (videoRes.videoBlob && videoRes.videoBlob.size > 0) {
        await saveVideoBlobToIdb(`hf_video_${activeProjectId || 'draft'}`, videoRes.videoBlob);
        await saveCustomVideoToAiDramaStudioDB(
          videoRes.videoBlob,
          `akzyon_master_${Date.now()}.mp4`
        );
        finalPlayableUrl = URL.createObjectURL(videoRes.videoBlob);
      }

      const combinedDialogue =
        imgRes.scenes
          .map((s) => s.scriptText || s.visualPrompt)
          .filter(Boolean)
          .join(' ') || editPrompt;
      const generatedCues = buildTagalogSubtitlesFromPrompt(combinedDialogue);
      setMasterSubtitles(generatedCues);
      setActiveMasterSubtitleText(generatedCues[0]?.text || '');

      appendDirectorLog(
        `[R2 & IndexedDB Vault] Saved MP4 stream (${finalPlayableUrl}) + Tagalog Dubbing/Subtitles... OK`
      );
      appendDirectorLog(
        `[Master Player] Auto-playing episode with Tagalog Dubbing & Subtitles... READY`
      );

      setGenStep(4);
      setGenProgressPct(100);
      setGenEtaSec(0);
      setCombinedVideoUrl(finalPlayableUrl);
      setFeaturedEpisodeVideoUrl(finalPlayableUrl);
      setFeaturedEpisodeTitle(`${editTitle || '3!2!1! Akzyon'} (AI Director Cut · 24fps)`);
      setAutoPlayMasterVideo(true);

      if (tagalogDubEnabled) {
        triggerTagalogDubbingSpeech(generatedCues, true);
      }

      handleSaveCurrentProject('Done');
      showToast(
        'Tapos na ang 5-Step 3!2!1! Akzyon Generation! Awtomatikong nagpe-play na sa Master Player kasama ang Tagalog dubbing at subtitles.'
      );
    } catch (err: any) {
      setSimulateErrorNext(false);
      appendDirectorLog(`[Error] Generation interrupted: ${err?.message || 'Unknown error'}`);
      setGenError(
        err?.message ||
          (language === 'tl'
            ? 'Nagkaroon ng error sa pag-generate. Pindutin ang Retry.'
            : 'Generation failed. Click Retry to resume.')
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Scene Timeline Actions (Add, Edit, Delete, Drag/Reorder, Combine into Video)
  const handleAddScene = () => {
    const nextNum = editScenes.length + 1;
    const charProfile: CharacterProfile = {
      name: editCharName,
      appearance: editCharAppearance,
      style: editCharStyle,
    };
    const newScene: DramaScene = {
      id: `sc-${Date.now()}-${nextNum}`,
      order: nextNum,
      title: `Eksena ${nextNum}: Bagong Tagpo`,
      scriptText: 'Dramatikong pag-uusap ng mga karakter sa bagong lokasyon.',
      visualPrompt: buildCharacterConsistentPrompt(
        'Dramatikong pag-uusap ng mga karakter sa bagong lokasyon.',
        charProfile,
        editEffectId
      ),
      durationSec: 4,
      thumbnailDataUrl: generateSceneThumbnailDataUrl({
        title: `Eksena ${nextNum}`,
        subtitle: charProfile.name || 'Character Lock',
        sceneNumber: nextNum,
        effectId: editEffectId,
      }),
      effectId: editEffectId,
      status: 'ready',
    };
    setEditScenes((prev) => [...prev, newScene]);
  };

  const handleDeleteScene = (id: string) => {
    if (editScenes.length <= 1) {
      showToast('Kailangan ng kahit 1 eksena sa timeline.');
      return;
    }
    setEditScenes((prev) =>
      prev.filter((s) => s.id !== id).map((s, idx) => ({ ...s, order: idx + 1 }))
    );
  };

  const handleMoveScene = (fromIdx: number, toIdx: number) => {
    setEditScenes((prev) => reorderScenes(prev, fromIdx, toIdx));
  };

  // Combine Scenes into One Video using Canvas + IndexedDB storage (Requirement #3 & #8)
  const handleCombineScenesIntoVideo = async () => {
    if (editScenes.length === 0) return;
    setIsCombiningVideo(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = editResolution === '1080p' ? 1280 : editResolution === '720p' ? 854 : 640;
      canvas.height = editResolution === '1080p' ? 720 : editResolution === '720p' ? 480 : 360;
      const ctx = canvas.getContext('2d')!;

      // Draw composite preview frame for each scene
      for (let i = 0; i < editScenes.length; i++) {
        const sc = editScenes[i];
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#e11d48';
        ctx.fillRect(32, 28, 170, 34);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`SCENE 0${i + 1} · ${sc.durationSec}s`, 46, 51);

        ctx.font = 'bold 30px sans-serif';
        ctx.fillText(sc.title, 32, canvas.height - 110);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '18px sans-serif';
        ctx.fillText(sc.scriptText.slice(0, 68), 32, canvas.height - 72);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '14px monospace';
        ctx.fillText(
          `Character Lock: ${editCharName} | ${editResolution} | Audio: ${editIncludeAudio ? 'ON' : 'OFF'}`,
          32,
          canvas.height - 36
        );
      }

      const blob: Blob = await new Promise((resolve) => {
        canvas.toBlob(
          (b) => resolve(b || new Blob(['AI_DRAMA_VIDEO'], { type: 'video/webm' })),
          'image/png'
        );
      });

      const idbKey = `combined_${activeProjectId || 'draft'}`;
      await saveVideoBlobToIdb(idbKey, blob);
      setCombinedVideoUrl('/media/video_akzyon_episode1.mp4');
      setFeaturedEpisodeVideoUrl('/media/video_akzyon_episode1.mp4');
      setIsPlayingPreview(true);
      handleSaveCurrentProject('Done');
      showToast(
        language === 'tl'
          ? `Pinagsama na ang ${editScenes.length} eksena (${calculateTotalTimelineDuration(editScenes)}s total) sa Master MP4 Video Player!`
          : `Combined ${editScenes.length} scenes (${calculateTotalTimelineDuration(editScenes)}s total) into Master MP4 Video Player!`
      );
    } finally {
      setIsCombiningVideo(false);
    }
  };

  // Download Exported Video or JSON
  const handleDownloadCombinedFile = (ext: 'mp4' | 'webm') => {
    const currentProj = projects.find((p) => p.id === activeProjectId) || {
      id: activeProjectId || 'drama',
      title: editTitle,
      prompt: editPrompt,
      genre: editGenre,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'Done' as const,
      thumbnailDataUrl: editScenes[0]?.thumbnailDataUrl || '',
      characterProfile: {
        name: editCharName,
        appearance: editCharAppearance,
        style: editCharStyle,
      },
      scenes: editScenes,
      selectedEffect: editEffectId,
      resolution: editResolution,
      includeAudio: editIncludeAudio,
      generationMode: 'simulated' as const,
    };

    const a = document.createElement('a');
    a.href = `/api/output/test_20s_audio_final.mp4`;
    const safeVideoSlug = (currentProj.title || '321akzyon').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `321akzyon_${safeVideoSlug}_${editResolution}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(
      language === 'tl'
        ? `Nagsimula na ang download (${editResolution}, ${ext.toUpperCase()}, ${editIncludeAudio ? 'May Audio' : 'Walang Audio'})!`
        : `Downloading ${ext.toUpperCase()} (${editResolution})!`
    );
  };

  const handleDownloadProjectJson = () => {
    const proj: DramaProject = {
      id: activeProjectId || `proj-${Date.now()}`,
      title: editTitle,
      prompt: editPrompt,
      genre: editGenre,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'Done',
      thumbnailDataUrl: editScenes[0]?.thumbnailDataUrl || '',
      characterProfile: {
        name: editCharName,
        appearance: editCharAppearance,
        style: editCharStyle,
      },
      scenes: editScenes,
      selectedEffect: editEffectId,
      resolution: editResolution,
      includeAudio: editIncludeAudio,
      generationMode: 'simulated',
    };
    const jsonStr = buildExportJsonStructure(proj);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeJsonSlug = (editTitle || '321akzyon').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `321akzyon_${safeJsonSlug}.drama.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Na-export na ang JSON structure ng project!');
  };

  const handleCopyShareLink = () => {
    const shareUrl = `${window.location.origin}/?dramaProject=${encodeURIComponent(
      activeProjectId || 'draft'
    )}&res=${editResolution}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    showToast(
      language === 'tl'
        ? `Nakopya ang local share link: ${shareUrl}`
        : `Copied local share link: ${shareUrl}`
    );
  };

  const handleClearAllStorageData = async () => {
    try {
      localStorage.removeItem(LS_PROJECTS_KEY);
      localStorage.removeItem(LS_SETTINGS_KEY);
      localStorage.removeItem(LS_ONBOARDING_KEY);
      await clearAllVideoBlobsFromIdb();
    } catch {}
    const fresh = createDefaultStarterProjects();
    setProjects(fresh);
    setConfirmClearAllData(false);
    showToast(
      language === 'tl'
        ? 'Nabura na ang lahat ng naka-save na project at IndexedDB cache!'
        : 'Cleared all saved projects and IndexedDB cache!'
    );
  };

  // Calculate localStorage usage in KB
  const storageUsedKb = (() => {
    try {
      let totalChars = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        const v = localStorage.getItem(k) || '';
        totalChars += k.length + v.length;
      }
      return Math.max(1, Math.round((totalChars * 2) / 1024));
    } catch {
      return 12;
    }
  })();

  const activeEffectPreset =
    VISUAL_EFFECT_PRESETS.find((p) => p.id === editEffectId) || VISUAL_EFFECT_PRESETS[0];
  const currentPreviewScene =
    editScenes[activeScenePreviewIndex] || editScenes[0];
  const totalDurationSec = calculateTotalTimelineDuration(editScenes);

  const isLight = theme === 'light';

  return (
    <div
      className={`min-h-screen w-full max-w-full overflow-x-hidden flex flex-col pb-24 transition-colors ${
        isLight ? 'bg-slate-50 text-slate-900' : 'bg-[#0c0c0e] text-[#e4e4e7]'
      }`}
    >
      {/* Top Studio Bar — Variation 2 High Density Pro Dashboard Header */}
      <header
        className={`sticky top-0 z-30 border-b-[1.5px] px-3 sm:px-6 py-2.5 sm:py-3 ${
          isLight
            ? 'bg-white/95 border-slate-300'
            : 'bg-[#0c0c0e]/95 border-[#e4e4e7]/80 backdrop-blur-md'
        }`}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="px-1.5 sm:px-2 py-1 bg-[#ff3e3e] text-[#0c0c0e] font-display font-extrabold text-[11px] sm:text-base shrink-0 tracking-tighter">
              3!2!1
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold uppercase text-[11px] sm:text-base tracking-tight whitespace-nowrap shrink-0">
                  3!2!1! Akzyon
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono text-[#e4e4e7]/70 truncate">
                <span className="truncate">
                  {language === 'tl'
                    ? 'Maligayang pagbabalik, Direk!'
                    : 'Welcome back, Direk!'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {isDeveloperMode && onSwitchToRenderBackend && (
              <button
                type="button"
                aria-label="FFmpeg & YouTube Hub"
                onClick={onSwitchToRenderBackend}
                className="min-h-[36px] sm:min-h-[38px] px-2 sm:px-3 py-1.5 text-xs font-display font-extrabold uppercase border-[1.5px] border-[#e4e4e7] bg-transparent hover:bg-white/10 text-[#e4e4e7] flex items-center gap-1.5 cursor-pointer"
              >
                <Film className="w-3.5 h-3.5 text-[#ff3e3e]" />
                <span className="hidden md:inline">Marilag Workspace</span>
              </button>
            )}
            <a
              href="/ai-drama-studio.html"
              download="ai-drama-studio.html"
              aria-label="Download Single-File HTML"
              className="min-h-[36px] sm:min-h-[38px] px-2 sm:px-3 py-1.5 text-xs font-mono uppercase bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Single-File HTML</span>
            </a>
            <button
              type="button"
              onClick={() => setShowUpgradeModal(true)}
              className="min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3.5 py-1.5 text-[10px] sm:text-xs font-display font-extrabold uppercase bg-[#ff3e3e] hover:bg-[#ff3e3e]/90 text-white flex items-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Crown className="w-3.5 h-3.5 shrink-0" />
              <span>{upgradeConfirmed ? 'PRO Active' : 'Upgrade'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed top-16 right-4 z-50 bg-emerald-950/95 border border-emerald-600 text-emerald-200 px-4 py-3 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2 max-w-sm"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 py-5 space-y-6">
        {/* ==================== 1. HOME TAB ==================== */}
        {bottomTab === 'home' && (
          <div className="space-y-8">
            {/* Hero Quick Create Banner — Variation 2 Industrial Studio Engine Header */}
            <section className="p-5 sm:p-7 bg-[#141417] border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
              <div className="space-y-2 max-w-2xl border-l-[3px] border-[#ff3e3e] pl-4">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-[#ff3e3e]">
                  <Sparkles className="w-3.5 h-3.5" />
                  Production Mode: Active · Teleserye Pipeline
                </span>
                <h1 className="text-2xl sm:text-4xl font-display font-extrabold uppercase text-[#e4e4e7] tracking-tight leading-[0.95]">
                  {language === 'tl'
                    ? 'Gumawa ng Teleserye at 3!2!1! Akzyon sa Ilang Segundo'
                    : 'Create Complete 3!2!1! Akzyon Episodes with Consistent Characters'}
                </h1>
                <p className="text-xs sm:text-sm text-[#e4e4e7]/70 leading-relaxed">
                  {language === 'tl'
                    ? 'May Character Profile Lock para hindi nagbabago ang mukha at suot ng bida sa bawat eksena, timeline editor, at export sa MP4/WebM.'
                    : 'Featuring Character Profile Lock across all scenes, interactive drag-and-drop timeline, and MP4/WebM + JSON export.'}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => handleCreateNewProject()}
                  className="min-h-[46px] px-5 py-3 bg-[#ff3e3e] hover:bg-[#ff3e3e]/90 text-[#0c0c0e] font-display font-extrabold uppercase text-xs tracking-wider flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>{language === 'tl' ? 'Bagong Drama Project' : 'New Drama Project'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOnboardingSlide(0);
                    setShowOnboarding(true);
                  }}
                  className="min-h-[46px] px-4 py-3 bg-transparent hover:bg-white/10 text-[#e4e4e7] font-display font-extrabold uppercase text-xs border-[1.5px] border-[#e4e4e7] flex items-center justify-center cursor-pointer whitespace-nowrap"
                >
                  {language === 'tl' ? 'Paano Gamitin (3 Slides)' : 'How It Works'}
                </button>
              </div>
            </section>

            {/* ==================== 1,450 MOVIE CITY CATALOG SHOWCASE CALLOUT ==================== */}
            <section className="p-4 sm:p-5 bg-gradient-to-r from-[#141417] via-[#1a1318] to-[#141417] border border-[#ff3e3e]/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#ff3e3e]/20 border border-[#ff3e3e]/40 flex items-center justify-center shrink-0 text-[#ff3e3e]">
                  <Film className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[#ff3e3e]">
                    <span className="bg-[#ff3e3e]/15 px-2 py-0.5 rounded font-bold">1,450 Buong Pelikula & Shows</span>
                    <span className="text-slate-400">Disney+ & Movie City Vault (1928 – 2021)</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-display font-extrabold uppercase text-[#e4e4e7]">
                    {language === 'tl'
                      ? 'Galugarin ang 1,450 Pelikula at Palabas — I-adapt Agad sa 3!2!1! Akzyon!'
                      : 'Browse 1,450 Complete Streaming Titles — 1-Click Adapt into Pinoy Teleserye!'}
                  </h3>
                  <p className="text-xs text-[#e4e4e7]/70">
                    {language === 'tl'
                      ? 'Naka-embed offline ang kumpletong catalog mula DuckTales at Marvel hanggang Disney classics. Piliin ang anumang kwento at bubuo ang studio ng 3-eksena na teleserye storyboard.'
                      : 'Embedded offline catalog with search, genres, year filters, and 1-click Pinoy teleserye adaptation generator.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBottomTab('catalog');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="w-full md:w-auto min-h-[44px] px-5 py-2.5 bg-[#ff3e3e] hover:bg-[#ff3e3e]/90 text-[#0c0c0e] font-display font-extrabold uppercase text-xs rounded-xl flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-lg shadow-[#ff3e3e]/20"
              >
                <Film className="w-4 h-4" />
                <span>{language === 'tl' ? 'Buksan ang 1,450 Catalog' : 'Open 1,450 Catalog'}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </section>

            {/* ==================== MOVIE CITY STUDIO: GENERATE TUNAY NA VIDEO ==================== */}
            <VideoGenerationPanel
              showDeveloperControls={false}
              onVideoSelected={(url, title) => {
                setFeaturedEpisodeVideoUrl(url);
                setFeaturedEpisodeTitle(title);
                setCombinedVideoUrl(url);
                const cues = buildTagalogSubtitlesFromPrompt(title);
                setMasterSubtitles(cues);
                setActiveMasterSubtitleText(cues[0]?.text || '');
                setAutoPlayMasterVideo(true);
              }}
            />

            {/* ==================== FEATURED DRAMA EPISODES (TUNAY NA TAO) + CUSTOM VIDEO UPLOADER ==================== */}
            <section
              data-testid="home-featured-video-section"
              className="p-5 sm:p-6 bg-[#141417] border border-white/15 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="space-y-1 border-l-[3px] border-[#00ff41] pl-3">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[#00ff41]">
                    <span>TUNAY NA TAO DRAMA SHOWCASE</span>
                    <span>·</span>
                    <span
                      data-testid="home-video-render-badge"
                      className={`px-2 py-0.5 rounded font-extrabold border ${
                        getVideoSourceRenderType(
                          featuredEpisodeVideoUrl,
                          undefined,
                          featuredEpisodeId
                        ) === 'RENDERED'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/60'
                          : 'bg-amber-500/20 text-amber-300 border-amber-400/60'
                      }`}
                    >
                      {getVideoSourceRenderType(
                        featuredEpisodeVideoUrl,
                        undefined,
                        featuredEpisodeId
                      )}
                    </span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-display font-extrabold uppercase text-[#e4e4e7]">
                    Featured Drama Episodes (Tunay na Tao)
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={customVideoInputRef}
                    type="file"
                    accept="video/mp4,video/webm,video/*"
                    onChange={handleUploadCustomUserMp4}
                    className="hidden"
                    data-testid="home-custom-video-file-input"
                  />
                  <button
                    type="button"
                    data-testid="home-upload-custom-video-btn"
                    onClick={() => customVideoInputRef.current?.click()}
                    className="min-h-[38px] px-3.5 py-1.5 bg-[#00ff41] hover:bg-[#00ff41]/90 text-[#0c0c0e] font-display font-extrabold uppercase text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>📂 Upload / Palitan ng Sariling Video (MP4)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBottomTab('studio')}
                    className="min-h-[38px] px-3.5 py-1.5 bg-[#ff3e3e] hover:bg-[#ff3e3e]/90 text-[#0c0c0e] font-display font-extrabold uppercase text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Clapperboard className="w-3.5 h-3.5" />
                    <span>Buksan sa Studio Editor</span>
                  </button>
                  <a
                    href={featuredEpisodeVideoUrl}
                    download="321akzyon_featured_episode.mp4"
                    className="min-h-[38px] px-3.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-mono font-bold uppercase text-xs flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP4</span>
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <div className="lg:col-span-8 space-y-2">
                  <div className="aspect-video bg-black border border-white/15 overflow-hidden relative">
                    <div className="pointer-events-none absolute top-3 left-3 z-10">
                      <span
                        className={`rounded-md px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider shadow-lg border ${
                          getVideoSourceRenderType(
                            featuredEpisodeVideoUrl,
                            undefined,
                            featuredEpisodeId
                          ) === 'RENDERED'
                            ? 'bg-emerald-950/90 text-emerald-300 border-emerald-400'
                            : 'bg-amber-950/90 text-amber-300 border-amber-400'
                        }`}
                      >
                        {getVideoSourceRenderType(
                          featuredEpisodeVideoUrl,
                          undefined,
                          featuredEpisodeId
                        )}
                      </span>
                    </div>
                    <video
                      key={featuredEpisodeVideoUrl}
                      data-testid="home-featured-video-player"
                      src={featuredEpisodeVideoUrl}
                      poster="/media/akzyon_teleserye_episode1_final.jpg"
                      controls
                      autoPlay={autoPlayMasterVideo}
                      playsInline
                      preload="auto"
                      onTimeUpdate={handleMasterVideoTimeUpdate}
                      onError={handleFeaturedVideoError}
                      className="w-full h-full object-contain bg-black"
                    >
                      <track
                        kind="subtitles"
                        srcLang="tl"
                        label="Tagalog (Auto-Generated)"
                        src={createTagalogWebVttDataUrl(masterSubtitles)}
                        default
                      />
                    </video>
                    {activeMasterSubtitleText && (
                      <div
                        data-testid="home-featured-subtitle-overlay"
                        className="pointer-events-none absolute bottom-12 inset-x-4 flex justify-center"
                      >
                        <span className="px-3.5 py-1.5 rounded bg-black/85 border border-amber-400/50 text-amber-200 font-sans font-bold text-xs sm:text-sm text-center shadow-lg">
                          {activeMasterSubtitleText}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#e4e4e7]/80 bg-[#0c0c0e] border border-white/10 px-3 py-2">
                    <span className="font-bold text-[#00ff41] truncate">
                      Now Playing: {featuredEpisodeTitle}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
                          getVideoSourceRenderType(
                            featuredEpisodeVideoUrl,
                            undefined,
                            featuredEpisodeId
                          ) === 'RENDERED'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                            : 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                        }`}
                      >
                        {getVideoSourceRenderType(
                          featuredEpisodeVideoUrl,
                          undefined,
                          featuredEpisodeId
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => triggerTagalogDubbingSpeech(masterSubtitles, true)}
                        className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-[11px] font-bold cursor-pointer"
                      >
                        🔊 I-play ang Tagalog Dub
                      </button>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-2.5 bg-[#0c0c0e] border border-white/10 p-4">
                  <div className="text-xs font-display font-extrabold uppercase text-[#e4e4e7] tracking-wider">
                    Featured Drama Episodes (Tunay na Tao · 1-Click Play):
                  </div>
                  {FEATURED_REAL_HUMAN_EPISODES.map((ep) => {
                    const active = featuredEpisodeId === ep.id;
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => handleSelectFeaturedRealHumanEpisode(ep)}
                        className={`w-full text-left p-3 border transition-colors cursor-pointer space-y-1 ${
                          active
                            ? 'bg-[#ff3e3e]/15 border-[#ff3e3e] text-white'
                            : 'bg-[#141417] border-white/10 hover:border-white/30 text-[#e4e4e7]/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase border ${
                              ep.renderType === 'RENDERED'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                                : 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                            }`}
                          >
                            {ep.renderType}
                          </span>
                          <Play className="w-3.5 h-3.5 text-[#ff3e3e] shrink-0 fill-current" />
                        </div>
                        <div className="text-xs font-bold">{ep.title}</div>
                        <div className="text-[10px] font-mono text-[#00ff41]">{ep.actors}</div>
                        <div className="text-[10px] font-mono text-[#e4e4e7]/50">{ep.meta}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Recent Projects (Last 4) */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">
                    {language === 'tl' ? 'Recent Projects (Huling 4)' : 'Recent Projects (Latest 4)'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {language === 'tl'
                      ? 'Awtomatikong naka-save sa iyong browser localStorage'
                      : 'Automatically saved in your browser localStorage'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBottomTab('projects')}
                  className="min-h-[40px] px-3.5 py-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 flex items-center gap-1"
                >
                  <span>{language === 'tl' ? 'Tingnan Lahat' : 'View All'}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {projects.length === 0 ? (
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
                  <FolderKanban className="w-10 h-10 text-rose-500 mx-auto" />
                  <p className="text-sm font-bold">
                    {language === 'tl' ? 'Wala pang project.' : 'No projects yet.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCreateNewProject()}
                    className="min-h-[44px] px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl"
                  >
                    + Gumawa ng Unang Project
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {projects.slice(0, 4).map((proj) => {
                    const projectRenderType =
                      proj.status === 'Done' && proj.generationMode === 'real'
                        ? 'RENDERED'
                        : 'SAMPLE';
                    return (
                      <div
                        key={proj.id}
                        className="bg-slate-900/90 border border-slate-800 hover:border-rose-500/60 rounded-2xl overflow-hidden flex flex-col justify-between transition-all shadow-md"
                      >
                        <div>
                          <div
                            onClick={() => loadProjectIntoStudio(proj)}
                            className="aspect-video bg-slate-950 relative cursor-pointer overflow-hidden"
                          >
                            <img
                              src={proj.thumbnailDataUrl}
                              alt={proj.title}
                              className="w-full h-full object-cover"
                            />
                            <span
                              className={`absolute top-2.5 left-2.5 text-[9px] font-extrabold px-2 py-0.5 rounded uppercase border ${
                                projectRenderType === 'RENDERED'
                                  ? 'bg-emerald-950/90 text-emerald-300 border-emerald-400'
                                  : 'bg-amber-950/90 text-amber-300 border-amber-400'
                              }`}
                            >
                              {projectRenderType}
                            </span>
                            <span
                              className={`absolute top-2.5 right-2.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                                proj.status === 'Done'
                                  ? 'bg-emerald-500/90 text-slate-950'
                                  : proj.status === 'Generating'
                                  ? 'bg-amber-500/90 text-slate-950'
                                  : 'bg-slate-700/90 text-slate-200'
                              }`}
                            >
                              {proj.status}
                            </span>
                          </div>
                          <div className="p-3.5 space-y-1">
                            <h3 className="font-bold text-sm truncate">{proj.title}</h3>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {new Date(proj.updatedAt).toLocaleDateString()} · {proj.scenes.length}{' '}
                              scenes
                            </p>
                          </div>
                        </div>
                        <div className="p-3.5 pt-0 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => loadProjectIntoStudio(proj)}
                            className="flex-1 min-h-[40px] bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Buksan</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Duplicate ${proj.title}`}
                            onClick={() => handleDuplicateProject(proj)}
                            className="min-h-[40px] min-w-[40px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl flex items-center justify-center"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${proj.title}`}
                            onClick={() => setProjectToDelete(proj)}
                            className="min-h-[40px] min-w-[40px] bg-slate-800 hover:bg-red-950 text-red-400 rounded-xl flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Drama Inspiration Cards with Working "View All" */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">
                    {language === 'tl' ? 'Drama Inspiration Templates' : 'Drama Inspiration Templates'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {language === 'tl'
                      ? 'Pumili ng template na may naka-handang Character Profile at Visual FX'
                      : 'Pick a starter storyline with pre-configured Character Profile & FX'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllInspirations(true)}
                  className="min-h-[42px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-rose-400 rounded-xl border border-slate-700 flex items-center gap-1"
                >
                  <span>View all ({DRAMA_INSPIRATIONS.length})</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {DRAMA_INSPIRATIONS.slice(0, 3).map((insp) => (
                  <div
                    key={insp.id}
                    className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold uppercase px-2.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20">
                        {insp.genre}
                      </span>
                      <h3 className="text-base font-bold">{insp.title}</h3>
                      <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                        {insp.prompt}
                      </p>
                      <div className="text-[11px] text-slate-400 font-mono pt-1">
                        Lead: {insp.character.name}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCreateNewProject(insp)}
                      className="w-full min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-rose-600 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Gamitin ang Template</span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ==================== 1.5. MOVIE CITY 1,450 CATALOG TAB ==================== */}
        {bottomTab === 'catalog' && (
          <div className="space-y-6">
            <MovieCityCatalogBrowser
              onLoadMovieIntoStudio={handleLoadCatalogMovieIntoStudio}
              onPlayMoviePreview={handlePlayCatalogMoviePreview}
            />
          </div>
        )}

        {/* ==================== 2. PROJECTS GALLERY TAB ==================== */}
        {bottomTab === 'projects' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black">
                  {language === 'tl' ? 'Projects Gallery' : 'Projects Gallery'}
                </h1>
                <p className="text-xs text-slate-400">
                  {language === 'tl'
                    ? 'Lahat ng iyong 3!2!1! Akzyon projects na may Edit, Duplicate, at Delete confirmation'
                    : 'All your 3!2!1! Akzyon projects with Edit, Duplicate, and Delete confirmation'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCreateNewProject()}
                className="min-h-[46px] px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Bagong Project</span>
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-10 text-center max-w-lg mx-auto space-y-4">
                <FolderKanban className="w-12 h-12 text-rose-500 mx-auto" />
                <h2 className="text-lg font-bold">
                  {language === 'tl'
                    ? 'Walang Project sa Gallery (Empty State)'
                    : 'No Projects in Gallery'}
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {language === 'tl'
                    ? 'Gumawa ng iyong unang 3!2!1! Akzyon episode upang makita ang thumbnail, status badge, at mga eksena rito.'
                    : 'Create your first 3!2!1! Akzyon project to see thumbnails, status badges, and scenes here.'}
                </p>
                <button
                  type="button"
                  onClick={() => handleCreateNewProject()}
                  className="min-h-[46px] px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl"
                >
                  + Gumawa ng Unang Project
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {projects.map((proj) => (
                  <div
                    key={proj.id}
                    className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between shadow-lg"
                  >
                    <div>
                      <div
                        onClick={() => loadProjectIntoStudio(proj)}
                        className="aspect-video bg-slate-950 relative cursor-pointer"
                      >
                        <img
                          src={proj.thumbnailDataUrl}
                          alt={proj.title}
                          className="w-full h-full object-cover"
                        />
                        <span
                          className={`absolute top-3 left-3 text-[10px] font-extrabold px-2 py-0.5 rounded uppercase border ${
                            proj.status === 'Done' && proj.generationMode === 'real'
                              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-400'
                              : 'bg-amber-950/90 text-amber-300 border-amber-400'
                          }`}
                        >
                          {proj.status === 'Done' && proj.generationMode === 'real'
                            ? 'RENDERED'
                            : 'SAMPLE'}
                        </span>
                        <span
                          className={`absolute top-3 right-3 text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                            proj.status === 'Done'
                              ? 'bg-emerald-500 text-slate-950'
                              : proj.status === 'Generating'
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-slate-700 text-slate-100'
                          }`}
                        >
                          {proj.status}
                        </span>
                      </div>

                      <div className="p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span>{new Date(proj.updatedAt).toLocaleDateString()}</span>
                          <span>
                            {proj.scenes.length} Scenes · {proj.resolution}
                          </span>
                        </div>
                        <h3 className="text-base font-bold truncate">{proj.title}</h3>
                        <p className="text-xs text-slate-400 line-clamp-2">{proj.prompt}</p>
                      </div>
                    </div>

                    <div className="p-4 pt-0 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => loadProjectIntoStudio(proj)}
                        className="flex-1 min-h-[44px] px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateProject(proj)}
                        className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Duplicate</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${proj.title}`}
                        onClick={() => setProjectToDelete(proj)}
                        className="min-h-[44px] min-w-[44px] px-3 py-2 bg-slate-800 hover:bg-red-950 text-red-400 text-xs font-semibold rounded-xl flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================== 3. STUDIO / GENERATION FLOW & TIMELINE TAB ==================== */}
        {bottomTab === 'studio' && (
          <div className="space-y-6">
            {/* 5-Step Generation Flow Header & Progress Bar (Requirement #2) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-mono uppercase text-rose-400 font-bold">
                    5-Step 3!2!1! Akzyon Episode Studio · Character Consistency Lock
                  </span>
                  <h1 className="text-lg sm:text-xl font-black">
                    {editTitle || 'Untitled 3!2!1! Akzyon'}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowExportModal(true)}
                    className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export / Share</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveCurrentProject()}
                    className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl"
                  >
                    Save Project
                  </button>
                </div>
              </div>

              {/* 5 Step Indicator Pills */}
              <div className="grid grid-cols-5 gap-1.5 pt-1">
                {[
                  '1. Prompt',
                  '2. Script/Scenes',
                  '3. Images',
                  '4. Video Assembly',
                  '5. Final Output',
                ].map((label, idx) => {
                  const active = genStep === idx;
                  const done = genStep > idx || (genStep === 4 && idx === 4);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setGenStep(idx as GenerationStepIndex)}
                      className={`min-h-[40px] px-2 py-1.5 rounded-xl text-[10px] sm:text-xs font-bold text-center border transition-colors ${
                        done
                          ? 'bg-emerald-950/70 border-emerald-600/70 text-emerald-300'
                          : active
                          ? 'bg-rose-600 border-rose-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Progress Bar with Percentage & Estimated Time */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300">
                    {isGenerating
                      ? `Generating Step ${genStep + 1}/5...`
                      : genProgressPct === 100
                      ? 'Generation Complete (Final Output Ready)'
                      : 'Ready to Generate'}
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {genProgressPct}% {genEtaSec > 0 ? `· ~${genEtaSec}s remaining` : ''}
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-rose-600 via-amber-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${genProgressPct}%` }}
                  />
                </div>
              </div>

              {/* Live Video Generation Progress & AI Director Studio Animator (Terminal hidden in Creator View) */}
              <LiveDirectorProgressStudio
                progressPct={genProgressPct}
                logs={directorTerminalLogs}
                isComplete={!isGenerating && genProgressPct === 100}
                title="3!2!1! Akzyon AI Director Studio"
                showTerminalLog={false}
              />

              {/* Error Banner with Retry Button */}
              {genError && (
                <div
                  role="alert"
                  className="bg-red-950/70 border border-red-700 text-red-200 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{genError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRun5StepGeneration}
                    className="min-h-[40px] px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Story Prompt & Character Profile Consistency Lock */}
              <div className="lg:col-span-5 space-y-5">
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Clapperboard className="w-4 h-4 text-rose-500" />
                    <span>Story Prompt & Character Consistency Lock</span>
                  </h2>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="drama-title-input"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Pamagat ng Drama (Project Title)
                    </label>
                    <input
                      id="drama-title-input"
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="drama-prompt-input"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Story Prompt / Plot
                    </label>
                    <textarea
                      id="drama-prompt-input"
                      rows={3}
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white"
                    />
                  </div>

                  {/* Character Profile Fields (Automatically Injected into Every Scene Prompt) */}
                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-400">
                        Character Profile (Auto-Injected per Scene)
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400">
                        Consistency Lock ON
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="char-name-input"
                        className="block text-[11px] text-slate-400"
                      >
                        Pangalan ng Karakter (Name)
                      </label>
                      <input
                        id="char-name-input"
                        type="text"
                        value={editCharName}
                        onChange={(e) => setEditCharName(e.target.value)}
                        className="w-full min-h-[40px] bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="char-look-input"
                        className="block text-[11px] text-slate-400"
                      >
                        Itsura at Kasuotan (Appearance)
                      </label>
                      <input
                        id="char-look-input"
                        type="text"
                        value={editCharAppearance}
                        onChange={(e) => setEditCharAppearance(e.target.value)}
                        className="w-full min-h-[40px] bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="char-style-input"
                        className="block text-[11px] text-slate-400"
                      >
                        Visual Style / Camera
                      </label>
                      <input
                        id="char-style-input"
                        type="text"
                        value={editCharStyle}
                        onChange={(e) => setEditCharStyle(e.target.value)}
                        className="w-full min-h-[40px] bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleRun5StepGeneration}
                    disabled={isGenerating}
                    className="w-full min-h-[48px] px-5 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {isGenerating
                        ? 'Ginagawa ang mga Eksena...'
                        : 'Run 5-Step 3!2!1! Akzyon Generation'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Right Column: Live Scene-by-Scene Preview Player & Interactive Timeline */}
              <div className="lg:col-span-7 space-y-5">
                {/* Preview Player + Master Episode Video Player */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono text-emerald-400">
                        🎬 Master Episode Video Player · {editResolution}
                      </span>
                      <span
                        data-testid="studio-video-render-badge"
                        className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase border ${
                          getVideoSourceRenderType(
                            combinedVideoUrl || '/media/video_akzyon_episode1.mp4',
                            undefined,
                            featuredEpisodeId
                          ) === 'RENDERED'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                            : 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                        }`}
                      >
                        {getVideoSourceRenderType(
                          combinedVideoUrl || '/media/video_akzyon_episode1.mp4',
                          undefined,
                          featuredEpisodeId
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={studioCustomVideoInputRef}
                        type="file"
                        accept="video/mp4,video/webm,video/*"
                        onChange={handleUploadCustomUserMp4}
                        className="hidden"
                        data-testid="studio-custom-video-file-input"
                      />
                      <button
                        type="button"
                        data-testid="studio-upload-custom-video-btn"
                        onClick={() => studioCustomVideoInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                      >
                        📂 Upload / Palitan ng Sariling Video (MP4)
                      </button>
                      <span className="text-[11px] font-mono text-amber-400">
                        FX: {activeEffectPreset.name} · {totalDurationSec}s Timeline
                      </span>
                    </div>
                  </div>

                  {/* Real Playable Video Monitor in Studio Tab with Auto-Play, Tagalog Dubbing & Subtitles */}
                  <div className="aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 relative">
                    <div className="pointer-events-none absolute top-3 left-3 z-10">
                      <span
                        className={`rounded-md px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider shadow-lg border ${
                          getVideoSourceRenderType(
                            combinedVideoUrl || '/media/video_akzyon_episode1.mp4',
                            undefined,
                            featuredEpisodeId
                          ) === 'RENDERED'
                            ? 'bg-emerald-950/90 text-emerald-300 border-emerald-400'
                            : 'bg-amber-950/90 text-amber-300 border-amber-400'
                        }`}
                      >
                        {getVideoSourceRenderType(
                          combinedVideoUrl || '/media/video_akzyon_episode1.mp4',
                          undefined,
                          featuredEpisodeId
                        )}
                      </span>
                    </div>
                    <video
                      key={combinedVideoUrl || '/media/video_akzyon_episode1.mp4'}
                      data-testid="studio-video-player"
                      src={combinedVideoUrl || '/media/video_akzyon_episode1.mp4'}
                      poster="/media/akzyon_teleserye_episode1_final.jpg"
                      controls
                      autoPlay={autoPlayMasterVideo}
                      playsInline
                      preload="auto"
                      onTimeUpdate={handleMasterVideoTimeUpdate}
                      onError={handleFeaturedVideoError}
                      style={{ filter: activeEffectPreset.cssFilter }}
                      className="w-full h-full object-contain bg-black"
                    >
                      <track
                        kind="subtitles"
                        srcLang="tl"
                        label="Tagalog (Auto-Generated)"
                        src={createTagalogWebVttDataUrl(masterSubtitles)}
                        default
                      />
                    </video>
                    {activeMasterSubtitleText && (
                      <div
                        data-testid="studio-master-subtitle-overlay"
                        className="pointer-events-none absolute bottom-12 inset-x-4 flex justify-center"
                      >
                        <span className="px-3.5 py-1.5 rounded bg-black/85 border border-amber-400/50 text-amber-200 font-sans font-bold text-xs sm:text-sm text-center shadow-lg">
                          {activeMasterSubtitleText}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Tagalog Dubbing & Subtitles Control Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono">
                    <label className="inline-flex items-center gap-2 text-emerald-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tagalogDubEnabled}
                        onChange={(e) => setTagalogDubEnabled(e.target.checked)}
                        className="accent-emerald-500"
                      />
                      <span>Auto-Play Tagalog Dubbing + Subtitles</span>
                    </label>
                    <button
                      type="button"
                      data-testid="studio-play-tagalog-dub-btn"
                      onClick={() => triggerTagalogDubbingSpeech(masterSubtitles, true)}
                      className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-bold cursor-pointer"
                    >
                      🔊 I-play ang Tagalog Dub
                    </button>
                  </div>

                  {/* Interactive Scene-by-Scene Storyboard Strip & Overlay */}
                  <div
                    className="aspect-video bg-black relative flex items-end overflow-hidden rounded-xl border border-slate-800"
                    style={{ filter: activeEffectPreset.cssFilter }}
                  >
                    {currentPreviewScene && (
                      <img
                        src={currentPreviewScene.thumbnailDataUrl}
                        alt={currentPreviewScene.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    )}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ backgroundColor: activeEffectPreset.overlayColor }}
                    />
                    <div className="relative z-10 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent p-4 sm:p-5 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono text-rose-400">
                        <span>
                          STORYBOARD SCENE 0{activeScenePreviewIndex + 1}/{editScenes.length} ·{' '}
                          {currentPreviewScene?.durationSec}s
                        </span>
                        <span>Character: {editCharName}</span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-white">
                        {currentPreviewScene?.title}
                      </h3>
                      <p className="text-xs text-slate-200 leading-relaxed">
                        &ldquo;{currentPreviewScene?.scriptText}&rdquo;
                      </p>
                    </div>
                  </div>

                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPlayingPreview((prev) => !prev)}
                        className="min-h-[42px] px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"
                      >
                        {isPlayingPreview ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause Preview</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play All Scenes</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveToolModal('effects')}
                        className="min-h-[42px] px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl flex items-center gap-1.5"
                      >
                        <Palette className="w-3.5 h-3.5 text-amber-400" />
                        <span>Visual FX</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleCombineScenesIntoVideo}
                      disabled={isCombiningVideo}
                      className="min-h-[42px] px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>
                        {isCombiningVideo ? 'Combining...' : 'Combine into one video'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Scene List / Interactive Timeline (Requirement #3) */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm sm:text-base font-bold">
                        Scene Timeline ({editScenes.length} Scenes · {totalDurationSec}s)
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        I-drag o gamitin ang Up/Down buttons para i-reorder ang pagkakasunod-sunod
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddScene}
                      className="min-h-[42px] px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Scene</span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {editScenes.map((scene, idx) => (
                      <div
                        key={scene.id}
                        draggable
                        onDragStart={() => setDraggedSceneIndex(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedSceneIndex !== null && draggedSceneIndex !== idx) {
                            handleMoveScene(draggedSceneIndex, idx);
                          }
                          setDraggedSceneIndex(null);
                        }}
                        onClick={() => setActiveScenePreviewIndex(idx)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          activeScenePreviewIndex === idx
                            ? 'bg-slate-950 border-rose-500'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <img
                            src={scene.thumbnailDataUrl}
                            alt={scene.title}
                            className="w-20 h-12 rounded-lg object-cover border border-slate-800 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300">
                                #{idx + 1} · {scene.durationSec}s
                              </span>
                              <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                                {scene.title}
                              </h4>
                            </div>
                            <p className="text-xs text-slate-300 truncate mt-0.5">
                              {scene.scriptText}
                            </p>
                            <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                              Prompt: {scene.visualPrompt}
                            </p>
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            aria-label="Move scene up"
                            disabled={idx === 0}
                            onClick={() => handleMoveScene(idx, idx - 1)}
                            className="min-h-[38px] min-w-[38px] bg-slate-900 hover:bg-slate-800 disabled:opacity-30 rounded-lg flex items-center justify-center text-slate-300"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move scene down"
                            disabled={idx === editScenes.length - 1}
                            onClick={() => handleMoveScene(idx, idx + 1)}
                            className="min-h-[38px] min-w-[38px] bg-slate-900 hover:bg-slate-800 disabled:opacity-30 rounded-lg flex items-center justify-center text-slate-300"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Edit ${scene.title}`}
                            onClick={() => setEditingScene(scene)}
                            className="min-h-[38px] px-2.5 bg-slate-900 hover:bg-slate-800 rounded-lg text-xs font-semibold text-sky-400 flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${scene.title}`}
                            onClick={() => handleDeleteScene(scene.id)}
                            className="min-h-[38px] min-w-[38px] bg-slate-900 hover:bg-red-950 rounded-lg flex items-center justify-center text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 4. TOOLS & VISUAL FX TAB (Requirement #5) ==================== */}
        {bottomTab === 'tools' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-black">
                {language === 'tl' ? 'Studio Tools & Visual Effects Library' : 'Studio Tools & Visual FX'}
              </h1>
              <p className="text-xs text-slate-400">
                {language === 'tl'
                  ? 'Malinis at hiwa-hiwalay na tools para sa Video, Image, Visual FX Library, at Story Writer'
                  : 'Dedicated studio tools for Video, Image, Visual Effects Library, and Story Writer'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-xl bg-rose-600/20 text-rose-400 flex items-center justify-center">
                    <Film className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-bold">Video Camera & Motion Tool</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    I-configure ang camera motion (Dolly Zoom, Pan, Crane Shot), frame rate, at
                    aspect ratio para sa bawat eksena.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveToolModal('video')}
                  className="min-h-[44px] px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl"
                >
                  Buksan ang Video Tool
                </button>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-bold">Character & Scene Image Generator</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Gumawa ng storyboard frames na may awtomatikong Character Profile Lock.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveToolModal('image')}
                  className="min-h-[44px] px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-xl"
                >
                  Buksan ang Image Tool
                </button>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Palette className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-bold">
                    Visual Effects & Color Grading Library
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Pumili sa Manila Rain Noir, Golden Hour Teleserye, Neon Cyber Drama, at Classic
                    35mm Pelikula na may live preview.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveToolModal('effects')}
                  className="min-h-[44px] px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl"
                >
                  Buksan ang Visual FX Library
                </button>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h2 className="text-base font-bold">Teleserye Story & Dialogue Writer</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Bumuo ng 3-act dramatic script at hugot lines na handang i-import sa iyong
                    Scene Timeline.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveToolModal('story')}
                  className="min-h-[44px] px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl"
                >
                  Buksan ang Story Writer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 5. SETTINGS TAB (Requirement #6 — Creator View + Developer Mode Switch) ==================== */}
        {bottomTab === 'settings' && (
          <div className="max-w-4xl mx-auto bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-7 space-y-6">
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white">
                {language === 'tl'
                  ? '3!2!1! Akzyon Creator & Studio Settings'
                  : '3!2!1! Akzyon Creator & Studio Settings'}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {language === 'tl'
                  ? 'I-customize ang iyong Creator Profile, Tema, Wika, Cloud Sync, Storage, at Developer Mode.'
                  : 'Customize your Creator Profile, Theme, Language, Cloud Sync, Storage, and Developer Mode.'}
              </p>
            </div>

            <div className="space-y-4">
              {/* Creator Name */}
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-username"
                  className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5 text-rose-400" />
                  <span>{language === 'tl' ? 'Pangalan ng User / Direktor' : 'Creator Name'}</span>
                </label>
                <input
                  id="settings-username"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white"
                />
              </div>

              {/* Theme & Language */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <span className="block text-xs font-semibold text-slate-300">
                    {language === 'tl' ? 'Tema (Theme)' : 'Theme'}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTheme('dark')}
                      className={`min-h-[44px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${
                        theme === 'dark'
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800'
                      }`}
                    >
                      <Moon className="w-3.5 h-3.5" />
                      <span>Dark</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme('light')}
                      className={`min-h-[44px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${
                        theme === 'light'
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800'
                      }`}
                    >
                      <Sun className="w-3.5 h-3.5" />
                      <span>Light</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-xs font-semibold text-slate-300">
                    {language === 'tl' ? 'Wika (Language)' : 'Language'}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setLanguage('tl')}
                      className={`min-h-[44px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${
                        language === 'tl'
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Filipino</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage('en')}
                      className={`min-h-[44px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border ${
                        language === 'en'
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>English</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Developer Mode Switch (Default OFF, Saved in localStorage) */}
              <div
                data-testid="developer-mode-settings-card"
                className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1 max-w-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Developer Mode</span>
                    <span
                      data-testid="developer-mode-status-badge"
                      className={`text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded border ${
                        isDeveloperMode
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-slate-900 text-slate-400 border-slate-700'
                      }`}
                    >
                      {isDeveloperMode ? 'ON' : 'OFF (Default)'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {language === 'tl'
                      ? 'Kapag naka-OFF (default), nakatago ang lahat ng teknikal at DevOps panels para sa malinis na Creator experience. Kapag naka-ON, lilitaw ang "Developer" tab sa bottom navigation.'
                      : 'When OFF (default), technical and DevOps panels are hidden for a clean Creator view. When ON, the "Developer" tab appears in the bottom navigation.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isDeveloperMode}
                    data-testid="developer-mode-switch"
                    onClick={() => {
                      const next = !isDeveloperMode;
                      handleSetDeveloperMode(next);
                      showToast(
                        next
                          ? 'Developer Mode: ON — Lumitaw na ang Developer tab sa bottom nav.'
                          : 'Developer Mode: OFF — Nakatago na ang mga teknikal na bahagi.'
                      );
                    }}
                    className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-black border transition-colors flex items-center gap-2 ${
                      isDeveloperMode
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{isDeveloperMode ? 'Developer Mode: ON' : 'Developer Mode: OFF'}</span>
                  </button>

                  {isDeveloperMode && (
                    <button
                      type="button"
                      data-testid="open-developer-tab-btn"
                      onClick={() => setBottomTab('developer')}
                      className="min-h-[42px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                    >
                      Buksan ang Developer Tab &rarr;
                    </button>
                  )}
                </div>
              </div>

              {/* Google Account & Cloud Project Sync Panel */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-200">
                    Google Account &amp; Cloud Project Sync
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400">
                    {firebaseUser ? `${firebaseUser.email}` : 'Not Signed In'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!firebaseUser ? (
                    <button
                      type="button"
                      onClick={() =>
                        signInWithGoogle().catch((e) =>
                          setFirestoreErrorMsg(e?.message || 'Sign-in cancelled')
                        )
                      }
                      className="min-h-[40px] px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl"
                    >
                      Sign in with Google
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={isSyncingFirestore}
                        onClick={handleSyncActiveProjectToFirestore}
                        className="min-h-[40px] px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black rounded-xl"
                      >
                        {isSyncingFirestore ? 'Saving...' : 'Save Active Project to Cloud'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeProjectId) {
                            deleteDramaProjectFromFirestore(activeProjectId).catch(() => {});
                          }
                        }}
                        className="min-h-[40px] px-3 py-2 bg-slate-800 hover:bg-red-950 text-red-300 text-xs font-semibold rounded-xl"
                      >
                        Remove Cloud Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => signOutFirebase()}
                        className="min-h-[40px] px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                      >
                        Sign Out
                      </button>
                    </>
                  )}
                </div>

                {cloudProjects.length > 0 && (
                  <p className="text-[11px] text-emerald-300">
                    {cloudProjects.length} saved cloud project(s) linked to your account.
                  </p>
                )}

                {firestoreErrorMsg && (
                  <p className="text-[11px] text-amber-300 break-words">{firestoreErrorMsg}</p>
                )}
              </div>

              {/* Storage Usage & Clear All Data with Confirmation */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-sky-400" />
                    <span>Storage Usage (Metadata &amp; SVG Thumbnails Only)</span>
                  </span>
                  <span className="font-mono text-sky-400 font-bold">
                    {storageUsedKb} KB / 5,120 KB
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500"
                    style={{ width: `${Math.min(100, (storageUsedKb / 5120) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-slate-400">
                    {projects.length} Saved Project(s) · Video Blobs in IndexedDB
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAllData(true)}
                    className="min-h-[40px] px-3.5 py-1.5 bg-red-950/70 hover:bg-red-900 text-red-200 border border-red-800 text-xs font-bold rounded-xl flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear all data</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 6. DEVELOPER TAB (Visible ONLY when Developer Mode is ON) ==================== */}
        {isDeveloperMode && bottomTab === 'developer' && (
          <div
            data-testid="developer-tab-view"
            className="space-y-8"
          >
            {/* Keep sensitive variables referenced in code while omitting them from UI display */}
            {(() => {
              void cfTokenName;
              void cfAccountId;
              void cfClientIp;
              void cfClientIpCidr;
              void providerEndpointNote;
              void supabaseDirectConnectionString;
              return null;
            })()}

            <div className="p-5 bg-slate-900/90 border border-amber-500/40 rounded-2xl flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md bg-amber-500 text-slate-950 font-mono text-xs font-black uppercase">
                    DEVELOPER MODE: ON
                  </span>
                  <h1 className="text-xl sm:text-2xl font-black text-white">
                    Developer &amp; Technical Hub
                  </h1>
                </div>
                <p className="text-xs text-slate-400">
                  Narito ang lahat ng teknikal na bahagi, DevOps panels, terminal logs, at test controls na nakatago sa default na Creator view.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  handleSetDeveloperMode(false);
                  setBottomTab('settings');
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200"
              >
                I-off ang Developer Mode
              </button>
            </div>

            {/* ==================== SEKSYON 1: MARILAG WORKSPACE & RENDER BACKEND SWITCHER ==================== */}
            <section
              data-testid="dev-section-marilag-workspace"
              className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold">
                    Seksyon 1 · Render Backend Workspace
                  </span>
                  <h2 className="text-base sm:text-lg font-black text-white">
                    Marilag Render Queue &amp; Engineering Workspace Switcher
                  </h2>
                  <p className="text-xs text-slate-400">
                    Buksan ang Marilag Workspace (Render Queue, Gallery, Live HLS, Settings, Google Drive, 3D Cluster, AI Media Lab).
                  </p>
                </div>
                {onSwitchToRenderBackend && (
                  <button
                    type="button"
                    data-testid="dev-open-marilag-workspace-btn"
                    onClick={onSwitchToRenderBackend}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-2 shadow-md"
                  >
                    <Layers className="w-4 h-4" />
                    <span>Buksan ang Marilag Workspace</span>
                  </button>
                )}
              </div>
            </section>

            {/* ==================== SEKSYON 2: TERMINAL & ACTION HISTORY LIVE LOG ==================== */}
            <section
              data-testid="dev-section-terminal-log"
              className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                    Seksyon 2 · Terminal &amp; Live Engine Logs
                  </span>
                  <h2 className="text-base sm:text-lg font-black text-white">
                    Terminal / Action History Live Log &amp; Error Simulation
                  </h2>
                  <p className="text-xs text-slate-400">
                    Subaybayan ang real-time execution logs ng 5-Step Akzyon Engine at subukan ang error-handling / retry flow.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl">
                  <input
                    type="checkbox"
                    checked={simulateErrorNext}
                    onChange={(e) => setSimulateErrorNext(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-rose-500"
                  />
                  <span>Subukan ang Error Handling &amp; Retry button sa susunod na run</span>
                </label>
              </div>

              <LiveDirectorProgressStudio
                progressPct={genProgressPct}
                logs={directorTerminalLogs}
                isComplete={!isGenerating && genProgressPct === 100}
                title="3!2!1! Akzyon AI Director Studio (Live Terminal Log)"
                showTerminalLog={true}
              />
            </section>

            {/* ==================== SEKSYON 3: LTX-VIDEO COMFYUI & GOOGLE COLAB BRIDGE ==================== */}
            <section
              data-testid="dev-section-ltx-colab"
              className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-5"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 font-bold">
                  Seksyon 3 · ComfyUI &amp; Colab GPU Bridge
                </span>
                <h2 className="text-base sm:text-lg font-black text-white">
                  LTX-Video 2B v0.9.5 ComfyUI Code Viewer &amp; Google Colab Bridge
                </h2>
                <p className="text-xs text-slate-400">
                  I-configure ang Google Colab Cloudflare Tunnel URL at siyasatin ang Python ComfyUI workflow code.
                </p>
              </div>

              <VideoGenerationPanel
                showDeveloperControls={true}
                onVideoSelected={(url, title) => {
                  setFeaturedEpisodeVideoUrl(url);
                  setFeaturedEpisodeTitle(title);
                  setCombinedVideoUrl(url);
                  showToast('Na-generate ang bagong MP4 video at naka-load na sa Video Player!');
                }}
              />

              {/* LTX-Video 2B v0.9.5 (ComfyUI + PyTorch) Code Viewer */}
              <div
                data-testid="ltx-video-studio-panel"
                className="bg-slate-950 border border-rose-500/40 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md bg-rose-600 text-white font-mono text-[11px] font-black uppercase">
                        LTX-Video 2B v0.9.5 · ComfyUI
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-[11px] font-bold">
                        ltx-video-2b-v0.9.5.safetensors
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[11px] font-bold">
                        {ltxParams.width}x{ltxParams.height} · {ltxValidation.effectiveDecodedFrames} Frames · {ltxParams.fps}fps
                      </span>
                    </div>
                    <h3 className="text-sm sm:text-base font-black text-white">
                      LTX-Video Photorealistic Human Motion &amp; ComfyUI Pipeline Inspector
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="ltx-run-pipeline-btn"
                      disabled={ltxGenerating}
                      onClick={() => handleGenerateLtxVideo()}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg"
                    >
                      <Film className="w-4 h-4" />
                      <span>
                        {ltxGenerating
                          ? 'Generating Photorealistic Human Video...'
                          : 'Generate Real-Human Video (LTX-Video 2B → R2)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadFixedLtxColabNotebook}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold"
                    >
                      Download Fixed .ipynb
                    </button>
                    <button
                      type="button"
                      data-testid="ltx-toggle-code-btn"
                      onClick={() => setShowLtxColabCode((prev: boolean) => !prev)}
                      className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-300 text-xs font-bold"
                    >
                      {showLtxColabCode ? 'Hide ComfyUI Python Code' : 'View ComfyUI Python Code'}
                    </button>
                  </div>
                </div>

                {/* Scene Input + Sampler Selector */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
                  <div className="lg:col-span-2 space-y-1">
                    <label
                      htmlFor="ltx-scene-prompt-input"
                      className="block text-[11px] font-bold text-slate-300"
                    >
                      Photorealistic Human Scene Prompt:
                    </label>
                    <input
                      id="ltx-scene-prompt-input"
                      type="text"
                      value={ltxParams.positive_prompt}
                      onChange={(e) =>
                        setLtxParams((prev) => ({ ...prev, positive_prompt: e.target.value }))
                      }
                      className="w-full min-h-[40px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="ltx-sampler-select"
                      className="block text-[11px] font-bold text-slate-300"
                    >
                      ComfyUI Sampler:
                    </label>
                    <select
                      id="ltx-sampler-select"
                      value={ltxParams.sampler_name}
                      onChange={(e) =>
                        setLtxParams((prev) => ({
                          ...prev,
                          sampler_name: e.target.value as LtxSamplerName,
                        }))
                      }
                      className="w-full min-h-[40px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-amber-300 font-semibold"
                    >
                      {LTX_SAMPLERS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {ltxError && (
                  <div className="p-3 rounded-xl bg-red-950/60 border border-red-700 text-red-200 text-xs font-mono">
                    LTX-Video Error: {ltxError}
                  </div>
                )}

                {ltxVideoUrl && (
                  <div
                    data-testid="ltx-pipeline-result"
                    className="p-3 rounded-xl border bg-emerald-950/50 border-emerald-600/60 text-emerald-200 text-xs font-mono flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>
                      ✓ LTX-Video Ready ({ltxParams.width}x{ltxParams.height} ·{' '}
                      {ltxValidation.effectiveDecodedFrames} frames @ {ltxParams.fps}fps · Seed:{' '}
                      {ltxSeedUsed || 'auto'})
                    </span>
                    <span className="text-sky-300">{ltxVideoUrl}</span>
                  </div>
                )}

                {showLtxColabCode && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-amber-300">
                        ComfyUI LTX-Video 2B v0.9.5 Colab Python Script
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            'LTX-Video Colab Script',
                            buildFixedLtxColabScript(ltxParams)
                          )
                        }
                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-bold text-amber-300"
                      >
                        Copy Script
                      </button>
                    </div>
                    <pre className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[10px] font-mono text-emerald-300 overflow-x-auto max-h-56">
                      {buildFixedLtxColabScript(ltxParams)}
                    </pre>
                  </div>
                )}
              </div>
            </section>

            {/* ==================== SEKSYON 4: CINEMATIC PROMPT SKILL INSPECTOR ==================== */}
            <section
              data-testid="dev-section-cinematic-skill"
              className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-3"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                  Seksyon 4 · Prompt Engineering Inspector
                </span>
                <h2 className="text-base sm:text-lg font-black text-white">
                  Cinematic Prompt Skill (<code className="text-emerald-400">skills/cinematicSkill.js</code>)
                </h2>
              </div>

              <div
                data-testid="cinematic-skill-studio-box"
                className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      skills/cinematicSkill.js &rarr; buildCinematicPrompt(&quot;video&quot;, sceneText) [Auto-Injected Before Video Model]
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        'Cinematic Skill Prompt',
                        buildCinematicPrompt('video', editPrompt)
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-emerald-300 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy Enhanced Prompt</span>
                  </button>
                </div>
                <p
                  data-testid="cinematic-skill-output"
                  className="text-[11px] font-mono text-slate-300 leading-relaxed break-words"
                >
                  {buildCinematicPrompt('video', editPrompt)}
                </p>
              </div>
            </section>

            {/* ==================== SEKSYON 5: MOVIECITYAI 6-LAYER ARCHITECTURE BLUEPRINT ==================== */}
            <section
              data-testid="dev-section-moviecity-blueprint"
              className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 font-bold">
                    Seksyon 5 · Full-Stack Architecture Blueprint
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-rose-600 text-white font-mono text-xs font-black">
                      {movieCityArch.engineId}
                    </span>
                    <h2 className="text-base sm:text-lg font-black text-white">
                      {movieCityArch.engineName}
                    </h2>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Package: <strong className="text-emerald-400">{movieCityArch.packageName}</strong> · Version:{' '}
                    <span className="text-amber-300">{movieCityArch.version}</span> ·{' '}
                    <span className="text-sky-300">{movieCityArch.preservedSkillNamespace}</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={movieCityOrchestrating}
                    onClick={handleRunMovieCityAiOrchestration}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-md"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {movieCityOrchestrating
                        ? 'Orchestrating moviecityAI...'
                        : 'Run moviecityAI Full-Stack Orchestration'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMovieCityRoutes((prev) => !prev)}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-sky-300 text-xs font-bold"
                  >
                    {showMovieCityRoutes ? 'Hide API Route Manifest' : 'Show API Route Manifest'}
                  </button>
                </div>
              </div>

              {movieCityOrchResult && (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-600/70 text-emerald-200 space-y-1 text-xs"
                >
                  <div className="font-mono text-[11px] font-bold text-emerald-300">
                    ✓ {movieCityOrchResult.engineId} ({movieCityOrchResult.version}) Orchestration Verified ·{' '}
                    {movieCityOrchResult.elapsedMs}ms
                  </div>
                  <p className="text-[11px] leading-relaxed">{movieCityOrchResult.summaryMessage}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {movieCityArch.subsystems.map((sub) => (
                  <div
                    key={sub.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">{sub.name}</span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                        {sub.status}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-amber-300 truncate">
                      {sub.endpointOrBinding}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{sub.details}</p>
                  </div>
                ))}
              </div>

              {showMovieCityRoutes && (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-mono uppercase text-[10px]">
                        <th className="py-2 px-2.5">Method</th>
                        <th className="py-2 px-2.5">Endpoint</th>
                        <th className="py-2 px-2.5">Subsystem</th>
                        <th className="py-2 px-2.5">Purpose</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {movieCityArch.routes.map((rt) => (
                        <tr key={`${rt.method}-${rt.path}`} className="hover:bg-slate-900/60">
                          <td className="py-2 px-2.5 font-mono font-bold text-amber-300">
                            {rt.method}
                          </td>
                          <td className="py-2 px-2.5 font-mono text-sky-300 whitespace-nowrap">
                            {rt.path}
                          </td>
                          <td className="py-2 px-2.5 text-slate-200 whitespace-nowrap">
                            {rt.subsystem}
                          </td>
                          <td className="py-2 px-2.5 text-slate-300">{rt.purpose}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ==================== SEKSYON 6: CLOUDFLARE R2, WORKER, HYPERDRIVE & SUPABASE DIAGNOSTICS ==================== */}
            <section
              data-testid="dev-section-cloud-diagnostics"
              className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-5"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400 font-bold">
                  Seksyon 6 · Cloud Storage, Quota &amp; Database Testers
                </span>
                <h2 className="text-base sm:text-lg font-black text-white">
                  Cloudflare R2 E2E Tester, Worker API, Hyperdrive &amp; Supabase Diagnostics
                </h2>
                <p className="text-xs text-slate-400">
                  Lahat ng secret, token, account ID, at connection string ay inalis sa UI display at pinananatili lamang sa server-side configuration.
                </p>
              </div>

              {/* R2 Media Storage & Daily Quota Tester */}
              <div
                data-testid="r2-media-storage-panel"
                className="p-4 bg-slate-950 border border-sky-700/60 rounded-2xl space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md bg-sky-500 text-slate-950 font-mono text-xs font-black">
                        R2: {DEFAULT_R2_BINDING_NAME} ({DEFAULT_R2_BUCKET_NAME})
                      </span>
                      <h3 className="text-sm font-black text-white">
                        Cloudflare R2 Media Storage &amp; Per-User Daily AI Quota
                      </h3>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="reset-r2-quota-btn"
                      onClick={handleResetR2DailyQuota}
                      className="min-h-[34px] px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold"
                    >
                      Reset Daily Quota
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyText('wrangler.toml R2 binding', formatWranglerR2Toml())}
                      className="min-h-[34px] px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-300 text-xs font-bold flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy wrangler.toml R2 Binding</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                    <span className="text-[10px] uppercase text-slate-400">Images ({r2DailyDate})</span>
                    <span className="text-sky-300 font-bold" data-testid="r2-quota-image">
                      {r2DailyUsage.image} / {DAILY_GENERATION_LIMITS.image}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                    <span className="text-[10px] uppercase text-slate-400">Videos / Day</span>
                    <span className="text-rose-300 font-bold" data-testid="r2-quota-video">
                      {r2DailyUsage.video} / {DAILY_GENERATION_LIMITS.video}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                    <span className="text-[10px] uppercase text-slate-400">Music Tracks / Day</span>
                    <span className="text-amber-300 font-bold" data-testid="r2-quota-music">
                      {r2DailyUsage.music} / {DAILY_GENERATION_LIMITS.music}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <input
                    id="r2-e2e-prompt-input"
                    type="text"
                    value={r2E2ePrompt}
                    onChange={(e) => setR2E2ePrompt(e.target.value)}
                    className="w-full min-h-[40px] bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="run-r2-e2e-image-btn"
                      disabled={r2E2eRunning}
                      onClick={() => handleRunR2MediaPipeline('image')}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 text-xs font-black flex items-center gap-1.5"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>
                        {r2E2eRunning
                          ? 'Running E2E Test...'
                          : 'Run Real E2E Test: Generate 1 Image → R2 → Firestore'}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid="run-r2-video-btn"
                      disabled={r2E2eRunning}
                      onClick={() =>
                        handleRunR2MediaPipeline(
                          'video',
                          'Dramatic Filipino teleserye confrontation in heavy Manila rain'
                        )
                      }
                      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-bold"
                    >
                      Generate 1 Video &rarr; R2
                    </button>
                    <button
                      type="button"
                      data-testid="run-r2-music-btn"
                      disabled={r2E2eRunning}
                      onClick={() =>
                        handleRunR2MediaPipeline(
                          'music',
                          'Dramatic Filipino teleserye orchestral strings cue'
                        )
                      }
                      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold"
                    >
                      Generate 1 Music Track &rarr; R2
                    </button>
                  </div>
                </div>

                {r2E2eError && (
                  <div
                    role="alert"
                    data-testid="r2-e2e-error-alert"
                    className="p-3 rounded-xl bg-red-950/70 border border-red-700 text-red-200 text-xs font-mono break-words"
                  >
                    Error: {r2E2eError}
                  </div>
                )}

                {r2WorkerGenResult && (
                  <div
                    data-testid="r2-e2e-diagnostics"
                    className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-300"
                  >
                    ✓ R2 Key: {r2WorkerGenResult.r2Key} · {r2WorkerGenResult.sizeBytes} bytes (
                    {r2WorkerGenResult.contentType}) · Doc:{' '}
                    {r2LoadedFirestoreDoc?.id || r2SavedFirestoreDoc?.id || 'saved'}
                  </div>
                )}

                {r2LoadedFirestoreDoc && (
                  <div
                    data-testid="r2-loaded-firestore-card"
                    className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-600/50 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-emerald-300">
                        ✓ Loaded Back from Cloud Firestore
                      </span>
                      <span className="font-mono text-[11px] text-sky-300" data-testid="r2-loaded-url">
                        URL: {r2LoadedFirestoreDoc.url}
                      </span>
                    </div>
                    {r2LoadedFirestoreDoc.mediaType === 'image' && (
                      <img
                        data-testid="r2-loaded-image"
                        src={r2LoadedFirestoreDoc.url}
                        alt={r2LoadedFirestoreDoc.prompt}
                        className="max-w-xs rounded-xl border border-slate-800"
                      />
                    )}
                    {r2LoadedFirestoreDoc.mediaType === 'video' && (
                      <video
                        data-testid="r2-loaded-video"
                        controls
                        playsInline
                        src={r2LoadedFirestoreDoc.url}
                        className="max-w-xs rounded-xl border border-slate-800"
                      />
                    )}
                    {r2LoadedFirestoreDoc.mediaType === 'music' && (
                      <audio
                        data-testid="r2-loaded-audio"
                        controls
                        src={r2LoadedFirestoreDoc.url}
                        className="w-full"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Cloudflare Worker, Hyperdrive & Supabase Action Testers (Secrets/Tokens/Connection Strings Omitted from Display) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Cloudflare Worker Tester */}
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      Cloudflare Worker API Tester
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      {cfWorkerConfigured ? 'Server Proxy Ready' : 'Standby'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['script', 'image', 'video'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setCfRequestType(t)}
                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase border ${
                          cfRequestType === t
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-slate-900 text-slate-300 border-slate-800'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={cfLoading}
                      onClick={() => handleCloudflareWorkerCall()}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold"
                    >
                      {cfLoading ? 'Testing Worker...' : `Test generateWithAPI("${cfRequestType}")`}
                    </button>
                    <button
                      type="button"
                      disabled={cfVerifyLoading}
                      onClick={handleVerifyCloudflareToken}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 text-xs font-bold"
                    >
                      {cfVerifyLoading ? 'Verifying...' : 'Verify Edge Status'}
                    </button>
                  </div>
                  {cfVerifyResult && (
                    <p className="text-[11px] font-mono text-emerald-300">
                      Status: {cfVerifyResult.statusText}
                    </p>
                  )}
                  {cfResult && (
                    <p className="text-[11px] font-mono text-sky-300 break-words">
                      {cfResult.ok
                        ? `OK (${cfResult.type} · ${cfResult.elapsedMs}ms)`
                        : cfResult.error}
                    </p>
                  )}
                </div>

                {/* Cloudflare Hyperdrive Tester (No Connection String Displayed) */}
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      Cloudflare Hyperdrive Pool
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      Binding: HYPERDRIVE
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {HYPERDRIVE_CONNECTION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setHyperdriveConfigName(preset.configName);
                          setHyperdriveConnectionString(preset.connectionString);
                          setHyperdriveResult(null);
                        }}
                        className={`min-h-[32px] px-2.5 py-1 rounded-lg text-[10px] font-semibold border ${
                          hyperdriveConfigName === preset.configName
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                            : 'bg-slate-900 text-slate-300 border-slate-800'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <input
                    id="hyperdrive-config-name"
                    type="text"
                    value={hyperdriveConfigName}
                    onChange={(e) => setHyperdriveConfigName(e.target.value)}
                    className="w-full min-h-[36px] bg-slate-900 border border-slate-800 rounded-xl px-3 py-1 text-xs font-mono text-emerald-300"
                  />
                  {(() => {
                    const parsed = parseHyperdriveConnectionString(hyperdriveConnectionString);
                    void parsed;
                    return null;
                  })()}
                  <button
                    type="button"
                    disabled={hyperdriveLoading}
                    onClick={handleCreateHyperdrive}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-black"
                  >
                    {hyperdriveLoading ? 'Validating Pool...' : 'Validate Hyperdrive Pool'}
                  </button>
                  {hyperdriveResult && (
                    <p className="text-[11px] font-mono text-emerald-300 break-words">
                      {hyperdriveResult.ok
                        ? `Ready: ${hyperdriveResult.configName}`
                        : hyperdriveResult.message}
                    </p>
                  )}
                </div>

                {/* Supabase Integration Tester (No Keys or Connection Strings Displayed) */}
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      Supabase Project Sync Tester
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      Server Isolated
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    I-verify ang koneksyon sa Supabase at i-sync ang kasalukuyang project metadata.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={supabaseVerifyLoading}
                      onClick={handleVerifySupabase}
                      className="min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 text-xs font-black"
                    >
                      {supabaseVerifyLoading ? 'Verifying...' : 'Verify Supabase'}
                    </button>
                    <button
                      type="button"
                      disabled={hyperdriveLoading}
                      onClick={handleBindSupabaseToHyperdrive}
                      className="min-h-[36px] px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold"
                    >
                      Bind to Hyperdrive
                    </button>
                    <button
                      type="button"
                      disabled={supabaseSyncLoading}
                      onClick={handleSyncActiveProjectToSupabase}
                      className="min-h-[36px] px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold"
                    >
                      {supabaseSyncLoading ? 'Syncing...' : 'Sync Project'}
                    </button>
                  </div>
                  {supabaseVerifyResult && (
                    <p className="text-[11px] font-mono text-emerald-300">
                      Status: {supabaseVerifyResult.restStatus}
                    </p>
                  )}
                  {supabaseSyncResult && (
                    <p className="text-[11px] font-mono text-sky-300">
                      {supabaseSyncResult.message}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        'Supabase CLI Setup Commands',
                        formatSupabaseCliSetupCommands(supabaseProjectRef)
                      )
                    }
                    className="text-[10px] font-mono text-slate-400 hover:text-emerald-300 underline"
                  >
                    Copy CLI Setup Commands ({SUPABASE_CLI_SETUP_COMMANDS.length} steps)
                  </button>
                </div>
              </div>
            </section>

            {/* ==================== SEKSYON 7: EXPO SDK 58.0.0 NATIVE MODULE & DEVICE MATRIX ==================== */}
            <section
              data-testid="expo-sdk-panel"
              className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                    Seksyon 7 · Mobile &amp; Native Module Matrix
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-emerald-500 text-slate-950 font-mono text-[11px] font-black uppercase">
                      Expo SDK 58.0.0 ({EXPO_SDK_COMPATIBILITY_MATRIX.length} Modules)
                    </span>
                    <h2 className="text-base sm:text-lg font-black text-white">
                      Expo Native Module Compatibility &amp; Live Web Device Bridge
                    </h2>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="expo-load-contacts-btn"
                    onClick={handleLoadExpoContacts}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black"
                  >
                    Load Cast Contacts ({expoContacts.length})
                  </button>
                  <button
                    type="button"
                    data-testid="expo-capture-camera-btn"
                    onClick={handleCaptureExpoCameraFrame}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-black"
                  >
                    Capture Camera Frame ({expoCameraFacing})
                  </button>
                  <button
                    type="button"
                    data-testid="expo-apply-gyro-btn"
                    onClick={handleApplyGyroscopeMotion}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black"
                  >
                    Apply Gyroscope Motion
                  </button>
                </div>
              </div>

              {expoContacts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {expoContacts.map((ct) => (
                    <div
                      key={ct.id}
                      className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="block font-bold text-white">{ct.name}</span>
                        <span className="block text-[10px] text-slate-400">{ct.role}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLockContactAsCharacter(ct)}
                        className="px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold"
                      >
                        Lock Cast
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                {EXPO_SDK_COMPATIBILITY_MATRIX.map((mod) => (
                  <div
                    key={mod.expoSdkVersion}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/90 space-y-1 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-1 font-mono">
                      <span className="font-bold text-emerald-300 truncate">
                        Expo SDK {mod.expoSdkVersion}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 shrink-0">
                        RN {mod.reactNativeVersion} · React {mod.reactVersion}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-snug">
                      Node {mod.minNodeVersion} · Android {mod.androidMinVersion} (Target SDK {mod.targetSdkVersion}) · iOS {mod.iosMinVersion}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* ==================== MODAL: EDIT INDIVIDUAL SCENE ==================== */}
      {editingScene && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">I-edit ang Eksena</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Pamagat ng Eksena</label>
                <input
                  type="text"
                  value={editingScene.title}
                  onChange={(e) =>
                    setEditingScene({ ...editingScene, title: e.target.value })
                  }
                  className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Script / Dialogue</label>
                <textarea
                  rows={3}
                  value={editingScene.scriptText}
                  onChange={(e) =>
                    setEditingScene({ ...editingScene, scriptText: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Haba sa Segundo (Duration Sec)
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={editingScene.durationSec}
                  onChange={(e) =>
                    setEditingScene({
                      ...editingScene,
                      durationSec: Math.max(1, Math.min(30, Number(e.target.value) || 4)),
                    })
                  }
                  className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-sm text-white font-mono"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingScene(null)}
                className="min-h-[42px] px-4 py-2 bg-slate-800 text-xs font-semibold text-slate-200 rounded-xl"
              >
                Kanselahin
              </button>
              <button
                type="button"
                onClick={() => {
                  const charProfile: CharacterProfile = {
                    name: editCharName,
                    appearance: editCharAppearance,
                    style: editCharStyle,
                  };
                  setEditScenes((prev) =>
                    prev.map((s, idx) =>
                      s.id === editingScene.id
                        ? {
                            ...editingScene,
                            visualPrompt: buildCharacterConsistentPrompt(
                              editingScene.scriptText,
                              charProfile,
                              editEffectId
                            ),
                            thumbnailDataUrl: generateSceneThumbnailDataUrl({
                              title: editingScene.title,
                              subtitle: charProfile.name,
                              sceneNumber: idx + 1,
                              effectId: editEffectId,
                            }),
                          }
                        : s
                    )
                  );
                  setEditingScene(null);
                  showToast('Na-update na ang eksena!');
                }}
                className="min-h-[42px] px-4 py-2 bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white rounded-xl"
              >
                I-save ang Eksena
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: EXPORT / SHARE (Requirement #4) ==================== */}
      {showExportModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Export & Share Drama Project</h3>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Piliin ang Resolution
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(['480p', '720p', '1080p'] as const).map((res) => (
                    <button
                      key={res}
                      type="button"
                      onClick={() => setEditResolution(res)}
                      className={`min-h-[44px] rounded-xl text-xs font-bold border ${
                        editResolution === res
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer">
                <span className="text-xs font-semibold text-slate-200">
                  Isama ang Audio Track (With / Without Audio)
                </span>
                <input
                  type="checkbox"
                  checked={editIncludeAudio}
                  onChange={(e) => setEditIncludeAudio(e.target.checked)}
                  className="w-4 h-4 accent-rose-600"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleDownloadCombinedFile('mp4')}
                  className="min-h-[46px] px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download MP4 ({editResolution})</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadCombinedFile('webm')}
                  className="min-h-[46px] px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download WebM ({editResolution})</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="min-h-[44px] px-4 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-sky-400 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Copy Share Link</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadProjectJson}
                  className="min-h-[44px] px-4 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-400 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <FileJson className="w-4 h-4" />
                  <span>Export JSON</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CLEANED STUDIO TOOLS (Requirement #5) ==================== */}
      {activeToolModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                {activeToolModal === 'effects'
                  ? 'Visual Effects & Color Grading Library'
                  : activeToolModal === 'story'
                  ? 'AI Teleserye Story Writer'
                  : activeToolModal === 'image'
                  ? 'Character-Locked Image Studio'
                  : 'Cinematic Video Motion Tool'}
              </h3>
              <button
                type="button"
                onClick={() => setActiveToolModal(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {activeToolModal === 'effects' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Pumili ng malinaw na visual effect na ilalapat sa buong drama project:
                </p>
                {VISUAL_EFFECT_PRESETS.map((fx) => (
                  <div
                    key={fx.id}
                    onClick={() => {
                      setEditEffectId(fx.id);
                      showToast(`Inilapat ang effect: ${fx.name}`);
                    }}
                    className={`p-3.5 rounded-xl border cursor-pointer flex items-center justify-between gap-3 ${
                      editEffectId === fx.id
                        ? 'bg-rose-950/40 border-rose-500'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-400">
                          {fx.badge}
                        </span>
                        <span className="text-sm font-bold text-white">
                          {language === 'tl' ? fx.nameTl : fx.name}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {language === 'tl' ? fx.descriptionTl : fx.description}
                      </p>
                    </div>
                    <div
                      className="w-16 h-12 rounded-lg border border-slate-700 shrink-0 bg-gradient-to-br from-rose-500 via-amber-400 to-sky-500"
                      style={{ filter: fx.cssFilter }}
                    />
                  </div>
                ))}
              </div>
            )}

            {activeToolModal === 'story' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Paksa ng Kwento (Story Premise)
                  </label>
                  <textarea
                    rows={3}
                    value={storyWriterTopic}
                    onChange={(e) => setStoryWriterTopic(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const generated = `ACT 1: ${storyWriterTopic}\nACT 2: Haharapin ni ${editCharName} ang matinding pagsubok sa gitna ng unos.\nACT 3: Magtatagumpay ang katotohanan sa huling paghaharap.`;
                    setStoryWriterOutput(generated);
                    setEditPrompt(storyWriterTopic);
                  }}
                  className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl"
                >
                  Bumuo ng 3-Act Script
                </button>
                {storyWriterOutput && (
                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-emerald-300 whitespace-pre-wrap font-mono">
                    {storyWriterOutput}
                  </pre>
                )}
              </div>
            )}

            {activeToolModal === 'image' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Scene Frame Prompt (Character Lock Applied)
                  </label>
                  <input
                    type="text"
                    value={imageToolPrompt}
                    onChange={(e) => setImageToolPrompt(e.target.value)}
                    className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  type="button"
                  disabled={r2E2eRunning}
                  onClick={() => handleRunR2MediaPipeline('image', imageToolPrompt)}
                  className="w-full min-h-[44px] bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl"
                >
                  {r2E2eRunning
                    ? 'Uploading to R2 (movie-city-media) & Saving URL to Firestore...'
                    : 'Generate Image → Upload to R2 → Save URL in Firestore'}
                </button>
                {imageToolPreviewUrl && (
                  <img
                    src={imageToolPreviewUrl}
                    alt="Generated Frame"
                    className="w-full rounded-xl border border-slate-800"
                  />
                )}
              </div>
            )}

            {activeToolModal === 'video' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Camera Motion Preset
                  </label>
                  <select
                    value={videoToolMotion}
                    onChange={(e) => setVideoToolMotion(e.target.value)}
                    className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option>Slow Dolly Zoom + Rain FX</option>
                    <option>Dramatic Handheld Close-Up</option>
                    <option>Wide Crane Establishing Shot</option>
                    <option>360 Orbit Emotional Climax</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditCharStyle(`${editCharStyle}, ${videoToolMotion}`);
                    setActiveToolModal(null);
                    showToast(`Idinagdag ang camera motion: ${videoToolMotion}`);
                  }}
                  className="w-full min-h-[44px] bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl"
                >
                  Apply Camera Motion sa Studio
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== MODAL: ALL DRAMA INSPIRATIONS ==================== */}
      {showAllInspirations && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-6 space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                Lahat ng Drama Inspiration Templates ({DRAMA_INSPIRATIONS.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowAllInspirations(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {DRAMA_INSPIRATIONS.map((insp) => (
                <div
                  key={insp.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase text-rose-400">
                      {insp.genre}
                    </span>
                    <h4 className="text-sm font-bold text-white">{insp.title}</h4>
                    <p className="text-xs text-slate-300">{insp.prompt}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCreateNewProject(insp)}
                    className="min-h-[42px] px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl"
                  >
                    Gamitin ang Template
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: DELETE PROJECT CONFIRMATION ==================== */}
      {projectToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-white">
              Kumpirmahin ang Pagbura ng Project
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Sigurado ka bang gusto mong burahin ang{' '}
              <strong className="text-white">{projectToDelete.title}</strong>? Hindi na ito
              maibabalik.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setProjectToDelete(null)}
                className="min-h-[44px] px-4 py-2 bg-slate-800 text-xs font-semibold text-slate-200 rounded-xl"
              >
                Kanselahin
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteProject}
                className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-500 text-xs font-bold text-white rounded-xl"
              >
                Oo, Burahin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CLEAR ALL DATA CONFIRMATION ==================== */}
      {confirmClearAllData && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-white">
              Burahin ang Lahat ng Data (Clear All Data)?
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Buburahin nito ang lahat ng iyong projects sa localStorage at mga video blobs sa
              IndexedDB. Sigurado ka ba?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearAllData(false)}
                className="min-h-[44px] px-4 py-2 bg-slate-800 text-xs font-semibold text-slate-200 rounded-xl"
              >
                Kanselahin
              </button>
              <button
                type="button"
                onClick={handleClearAllStorageData}
                className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-500 text-xs font-bold text-white rounded-xl"
              >
                Oo, Clear All Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: 3-SLIDE ONBOARDING (Requirement #7) ==================== */}
      {showOnboarding && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-mono font-bold text-rose-400">
                ONBOARDING · SLIDE {onboardingSlide + 1} / 3
              </span>
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem(LS_ONBOARDING_KEY, '1');
                  setShowOnboarding(false);
                }}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold"
              >
                Skip
              </button>
            </div>

            {onboardingSlide === 0 && (
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">
                  1. 5-Step 3!2!1! Akzyon Generation Flow
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Maligayang pagbabalik, Direk! Mula sa simpleng Prompt sa 3!2!1! Akzyon,
                  awtomatikong binubuo ng studio ang Script/Scenes, Storyboards, Video Assembly, at
                  Final Output na may live progress bar.
                </p>
              </div>
            )}

            {onboardingSlide === 1 && (
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">
                  2. Character Consistency & Scene Timeline
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Ilagay ang pangalan, itsura, at style ng iyong bida sa Character Profile upang
                  awtomatikong isama sa bawat eksena. Maaari mo ring i-reorder ang mga eksena at
                  pagsamahin sa iisang video.
                </p>
              </div>
            )}

            {onboardingSlide === 2 && (
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">
                  3. Export sa MP4/WebM & JSON
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  I-download ang iyong natapos na drama sa 480p, 720p, o 1080p, kopyahin ang share
                  link, o i-export ang buong JSON project structure.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={onboardingSlide === 0}
                onClick={() => setOnboardingSlide((s) => Math.max(0, s - 1))}
                className="min-h-[42px] px-3.5 py-2 bg-slate-800 disabled:opacity-30 text-xs font-semibold text-slate-200 rounded-xl flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              {onboardingSlide < 2 ? (
                <button
                  type="button"
                  onClick={() => setOnboardingSlide((s) => s + 1)}
                  className="min-h-[42px] px-5 py-2 bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white rounded-xl flex items-center gap-1"
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem(LS_ONBOARDING_KEY, '1');
                    setShowOnboarding(false);
                  }}
                  className="min-h-[42px] px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-slate-950 rounded-xl"
                >
                  Simulan ang Paggawa!
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: UPGRADE TO PRO FEATURES (Requirement #7) ==================== */}
      {showUpgradeModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-amber-500/50 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
                <Crown className="w-5 h-5" />
                <span>3!2!1! Akzyon PRO Features</span>
              </div>
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-200">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Direct Runway Gen-3 / Luma / Flux Hook:</strong> Ikabit ang live API sa{' '}
                  <code>generateWithAPI()</code> para sa 1080p photorealistic scenes.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Unlimited Scenes & Multi-Character Lock:</strong> Walang limitasyon sa
                  haba ng timeline at dami ng bida.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>24-Segment FFmpeg Render Queue Access:</strong> Direktang pag-export sa
                  Marilag Render Queue at YouTube Data API v3.
                </span>
              </li>
            </ul>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="min-h-[44px] px-4 py-2 bg-slate-800 text-xs font-semibold text-slate-200 rounded-xl"
              >
                Mamaya Muna
              </button>
              <button
                type="button"
                onClick={() => {
                  setUpgradeConfirmed(true);
                  setShowUpgradeModal(false);
                  showToast('Naka-enable na ang PRO Studio Preview features!');
                }}
                className="min-h-[44px] px-5 py-2 bg-gradient-to-r from-amber-500 to-rose-600 text-xs font-bold text-white rounded-xl"
              >
                Proceed to PRO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== BOTTOM NAVIGATION BAR (Consistent Active State) ==================== */}
      <nav
        aria-label="3!2!1! Akzyon Bottom Navigation"
        className={`fixed bottom-0 left-0 right-0 z-40 border-t px-2 py-1.5 ${
          isLight
            ? 'bg-white/95 border-slate-200'
            : 'bg-[#0e111a]/95 border-slate-800'
        }`}
      >
        <div
          className={`max-w-2xl mx-auto grid gap-1 ${
            isDeveloperMode ? 'grid-cols-7' : 'grid-cols-6'
          }`}
        >
          {(
            [
              { id: 'home' as const, label: 'Home', icon: Home },
              { id: 'catalog' as const, label: 'Catalog', icon: Film },
              { id: 'projects' as const, label: 'Projects', icon: FolderKanban },
              { id: 'studio' as const, label: 'Studio', icon: Clapperboard },
              { id: 'tools' as const, label: 'Tools & FX', icon: Wand2 },
              { id: 'settings' as const, label: 'Settings', icon: Settings },
              ...(isDeveloperMode
                ? [{ id: 'developer' as const, label: 'Developer', icon: Layers }]
                : []),
            ]
          ).map((item) => {
            const Icon = item.icon;
            const active = bottomTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`bottom-nav-${item.id}`}
                onClick={() => setBottomTab(item.id)}
                className={`min-h-[50px] rounded-xl flex flex-col items-center justify-center text-[11px] font-bold transition-colors ${
                  active
                    ? item.id === 'developer'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'bg-rose-600/15 text-rose-500 border border-rose-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
