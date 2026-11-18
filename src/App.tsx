import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Film,
  Upload,
  Play,
  Square,
  RotateCcw,
  Trash2,
  Download,
  Search,
  Radio,
  Settings as SettingsIcon,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Box,
  Sparkles,
  Cloud,
  X,
  RefreshCw,
  Sliders,
  Youtube,
} from 'lucide-react';
import {
  ParsedSegmentProgress,
  validateVideoUpload,
  sanitizeVideoBaseName,
  capSegmentsByDuration,
} from './utils/renderQueueLogic';
import { RenderCluster3D } from './components/RenderCluster3D';
import { AiMultimediaLab } from './components/AiMultimediaLab';
import { GoogleDriveSync } from './components/GoogleDriveSync';
import { YouTubeStudioHub } from './components/YouTubeStudioHub';
import { AiDramaStudio } from './components/AiDramaStudio';

type AppTab =
  | 'render'
  | 'gallery'
  | 'live'
  | 'settings'
  | 'youtube'
  | 'cluster3d'
  | 'ailab'
  | 'drive';

interface GalleryVideo {
  baseName: string;
  title: string;
  fileName: string;
  thumbnailFileName: string;
  videoUrl: string;
  thumbnailUrl: string;
  hasThumbnail: boolean;
  sizeBytes: number;
  durationSec: number;
  segments: number;
  encoder: string;
  hasAudio: boolean;
  totalElapsedSec: number;
  completedAt: string;
}

interface ActiveJobState {
  id: string;
  baseName: string;
  inputPath: string;
  requestedSegments: number;
  totalSegments: number;
  isRunning: boolean;
  wasCanceled: boolean;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  command: string;
  logs: string[];
  parsedSegments: Record<number, ParsedSegmentProgress>;
  error: string | null;
}

interface MetricsSnapshot {
  queueLength: number;
  currentProgressRatio: number;
  jobsCompletedTotal: number;
  jobsFailedTotal: number;
  lastRenderSeconds: number;
}

const DEFAULT_HLS_URL = 'http://localhost:8082/hls/marilag.m3u8';
const DEFAULT_GRAFANA_URL = 'http://localhost:3000';

class OptionalTabErrorBoundary extends React.Component<
  { children: React.ReactNode; tabTitle: string },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode; tabTitle: string }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || 'Unexpected error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-xl mx-auto my-8 p-6 bg-slate-900 border border-amber-700/60 rounded-2xl text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
          <h2 className="text-base font-bold text-white">
            Hindi ma-load ang opsyonal na tab ({this.props.tabTitle})
          </h2>
          <p className="text-xs text-slate-300">
            Hindi apektado ang core Render Queue at Netflix Gallery. Detalye: {this.state.errorMsg}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMsg: '' })}
            className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-xl"
          >
            Subukan Muli
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '00:00';
  const totalSec = Math.round(sec);
  const mins = Math.floor(totalSec / 60);
  const rem = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export default function App() {
  const [studioWorkspace, setStudioWorkspace] = useState<'drama' | 'marilag'>('drama');
  const [activeTab, setActiveTab] = useState<AppTab>('render');

  // Configurable URLs (persisted in localStorage)
  const [liveHlsUrl, setLiveHlsUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('marilag_live_hls_url') || DEFAULT_HLS_URL;
    } catch {
      return DEFAULT_HLS_URL;
    }
  });
  const [grafanaUrl, setGrafanaUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('marilag_grafana_url') || DEFAULT_GRAFANA_URL;
    } catch {
      return DEFAULT_GRAFANA_URL;
    }
  });
  const [draftHlsUrl, setDraftHlsUrl] = useState<string>(liveHlsUrl);
  const [draftGrafanaUrl, setDraftGrafanaUrl] = useState<string>(grafanaUrl);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);

  // Render Queue State
  const [job, setJob] = useState<ActiveJobState | null>(null);
  const [gallery, setGallery] = useState<GalleryVideo[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot>({
    queueLength: 0,
    currentProgressRatio: 0,
    jobsCompletedTotal: 0,
    jobsFailedTotal: 0,
    lastRenderSeconds: 0,
  });
  const [rawPrometheusText, setRawPrometheusText] = useState<string>('');

  // Upload & Render Form State
  const [uploadedInputPath, setUploadedInputPath] = useState<string>('test.mp4');
  const [outputBaseName, setOutputBaseName] = useState<string>('marilag_render');
  const [uploadedDurationSec, setUploadedDurationSec] = useState<number>(20);
  const [segmentsCount, setSegmentsCount] = useState<number>(24);
  const [workersCount, setWorkersCount] = useState<number>(4);
  const [crfValue, setCrfValue] = useState<number>(23);
  const [forceCpu, setForceCpu] = useState<boolean>(false);
  const [uploadingFile, setUploadingFile] = useState<boolean>(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [filipinoError, setFilipinoError] = useState<string | null>(null);

  // Gallery State
  const [gallerySearch, setGallerySearch] = useState<string>('');
  const [playingVideo, setPlayingVideo] = useState<GalleryVideo | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<GalleryVideo | null>(null);
  const [deletingVideo, setDeletingVideo] = useState<boolean>(false);

  // Live HLS Player Ref & State
  const hlsVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  const [hlsStatus, setHlsStatus] = useState<string>('Handa nang mag-load ng HLS stream');
  const [hlsError, setHlsError] = useState<string | null>(null);

  const fetchStatusAndGallery = async () => {
    try {
      const res = await fetch('/api/render/status');
      if (!res.ok) return;
      const data = await res.json();
      if (data.job) setJob(data.job);
      if (Array.isArray(data.gallery)) setGallery(data.gallery);
      if (data.metrics) setMetrics(data.metrics);
    } catch {}
  };

  const fetchPrometheusText = async () => {
    try {
      const res = await fetch('/metrics');
      if (res.ok) {
        setRawPrometheusText(await res.text());
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatusAndGallery();
    fetchPrometheusText();
    const timer = window.setInterval(() => {
      fetchStatusAndGallery();
      if (activeTab === 'live') {
        fetchPrometheusText();
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  // Setup HLS.js when on Live tab
  const attachHlsStream = (streamUrl: string) => {
    const videoEl = hlsVideoRef.current;
    if (!videoEl) return;

    setHlsError(null);
    setHlsStatus(`Kumokonekta sa ${streamUrl}...`);

    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsInstanceRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setHlsStatus('LIVE: Konektado sa HLS stream');
        setHlsError(null);
        videoEl.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setHlsStatus('Walang aktibong HLS stream sa URL na ito');
          setHlsError(
            `Hindi ma-load ang HLS stream (${streamUrl}). Siguraduhing tumatakbo ang iyong Nginx-RTMP Docker container o palitan ang Live HLS URL sa Settings.`
          );
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = streamUrl;
      videoEl.addEventListener('loadedmetadata', () => {
        setHlsStatus('LIVE: Konektado (Native HLS)');
        videoEl.play().catch(() => {});
      });
      videoEl.addEventListener('error', () => {
        setHlsStatus('Walang aktibong HLS stream');
        setHlsError(
          `Hindi ma-play ang HLS stream (${streamUrl}). Siguraduhing bukas ang iyong Nginx-RTMP server.`
        );
      });
    } else {
      setHlsError('Hindi suportado ang HLS playback sa browser na ito.');
    }
  };

  useEffect(() => {
    if (activeTab === 'live') {
      attachHlsStream(liveHlsUrl);
      fetchPrometheusText();
    }
    return () => {
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
    };
  }, [activeTab, liveHlsUrl]);

  const handlePhoneVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFilipinoError(null);
    setUploadNotice(null);

    const clientCheck = validateVideoUpload({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      maxSizeBytes: 200 * 1024 * 1024,
    });

    if (!clientCheck.valid) {
      setFilipinoError(clientCheck.errorFilipino || 'Hindi valid na video file.');
      e.target.value = '';
      return;
    }

    setUploadingFile(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const str = String(reader.result || '');
          const comma = str.indexOf(',');
          resolve(comma >= 0 ? str.slice(comma + 1) : str);
        };
        reader.onerror = () => reject(new Error('Nabigo sa pagbasa ng video mula sa phone.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/render/upload-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          base64Data,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Nabigo sa pag-upload ng video.');
      }

      setUploadedInputPath(data.inputPath);
      setOutputBaseName(data.baseName);
      setUploadedDurationSec(data.durationSec);
      const capped = capSegmentsByDuration(segmentsCount, data.durationSec);
      setSegmentsCount(capped);
      setUploadNotice(
        `Na-upload ang '${file.name}' (${(data.sizeBytes / (1024 * 1024)).toFixed(2)} MB, ${data.durationSec.toFixed(1)}s). Handa nang i-render bilang MarilagOutput/${data.baseName}_final.mp4.`
      );
    } catch (err: any) {
      setFilipinoError(err.message || 'Nagka-error sa pag-upload ng video.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleStartRender = async (customOpts?: {
    generateTest?: boolean;
    testDuration?: number;
    noAudio?: boolean;
    customBaseName?: string;
    customSegments?: number;
  }) => {
    setFilipinoError(null);
    setUploadNotice(null);

    const effectiveDuration = customOpts?.generateTest
      ? customOpts.testDuration || 20
      : uploadedDurationSec;
    const requestedSegs = customOpts?.customSegments ?? segmentsCount;
    const safeSegments = capSegmentsByDuration(requestedSegs, effectiveDuration);
    const cleanBase = sanitizeVideoBaseName(
      customOpts?.customBaseName || outputBaseName || 'marilag_video'
    );

    try {
      const res = await fetch('/api/render/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputPath: customOpts?.generateTest ? `uploads/${cleanBase}_src.mp4` : uploadedInputPath,
          baseName: cleanBase,
          segments: safeSegments,
          workers: workersCount,
          crf: crfValue,
          forceCpu,
          generateTest: Boolean(customOpts?.generateTest),
          testDuration: customOpts?.testDuration || 20,
          noAudio: Boolean(customOpts?.noAudio),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Hindi masimulan ang render job.');
      }
      await fetchStatusAndGallery();
    } catch (err: any) {
      setFilipinoError(err.message || 'Nabigo sa pagsisimula ng render job.');
    }
  };

  const handleCancelRender = async () => {
    setFilipinoError(null);
    try {
      const res = await fetch('/api/render/cancel', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Hindi makansela ang render job.');
      }
      setFilipinoError('Kinansela ng user ang kasalukuyang render job.');
      await fetchStatusAndGallery();
    } catch (err: any) {
      setFilipinoError(err.message);
    }
  };

  const handleConfirmDeleteVideo = async () => {
    if (!videoToDelete) return;
    setDeletingVideo(true);
    try {
      const res = await fetch(`/api/gallery/${encodeURIComponent(videoToDelete.baseName)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Nabigo sa pagbura ng video.');
      }
      if (playingVideo?.baseName === videoToDelete.baseName) {
        setPlayingVideo(null);
      }
      setVideoToDelete(null);
      await fetchStatusAndGallery();
    } catch (err: any) {
      setFilipinoError(err.message);
    } finally {
      setDeletingVideo(false);
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHls = draftHlsUrl.trim() || DEFAULT_HLS_URL;
    const cleanGrafana = draftGrafanaUrl.trim() || DEFAULT_GRAFANA_URL;
    setLiveHlsUrl(cleanHls);
    setGrafanaUrl(cleanGrafana);
    try {
      localStorage.setItem('marilag_live_hls_url', cleanHls);
      localStorage.setItem('marilag_grafana_url', cleanGrafana);
    } catch {}
    setSettingsSavedMsg('Na-save na ang bagong Live HLS URL at Grafana URL!');
    setTimeout(() => setSettingsSavedMsg(null), 3500);
  };

  const handleResetSettings = () => {
    setDraftHlsUrl(DEFAULT_HLS_URL);
    setDraftGrafanaUrl(DEFAULT_GRAFANA_URL);
    setLiveHlsUrl(DEFAULT_HLS_URL);
    setGrafanaUrl(DEFAULT_GRAFANA_URL);
    try {
      localStorage.setItem('marilag_live_hls_url', DEFAULT_HLS_URL);
      localStorage.setItem('marilag_grafana_url', DEFAULT_GRAFANA_URL);
    } catch {}
    setSettingsSavedMsg('Ibinalik sa default ang Live HLS URL at Grafana URL.');
    setTimeout(() => setSettingsSavedMsg(null), 3500);
  };

  const segmentsMap = job?.parsedSegments || {};
  const totalJobSegments = Math.max(1, job?.totalSegments || segmentsCount || 24);
  const completedSegmentsCount = Object.values(segmentsMap).filter((s) => s.success).length;
  const progressPct = job?.isRunning
    ? Math.min(99, Math.round((completedSegmentsCount / totalJobSegments) * 100))
    : job?.exitCode === 0 && completedSegmentsCount > 0
    ? 100
    : Math.round((completedSegmentsCount / totalJobSegments) * 100);

  const filteredGallery = gallery.filter((item) => {
    if (!gallerySearch.trim()) return true;
    const q = gallerySearch.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.fileName.toLowerCase().includes(q) ||
      item.baseName.toLowerCase().includes(q)
    );
  });

  const featuredHeroVideo = gallery.length > 0 ? gallery[0] : null;

  if (studioWorkspace === 'drama') {
    return <AiDramaStudio onSwitchToRenderBackend={() => setStudioWorkspace('marilag')} />;
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#0b0d13] text-slate-100 flex flex-col pb-20 md:pb-8">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-[#0f131d]/95 border-b border-slate-800/80 px-3 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="bg-red-600 text-white font-black text-sm sm:text-base px-2.5 py-1 rounded-lg tracking-wider shrink-0 shadow-md shadow-red-600/20">
              MARILAG
            </div>
            <div className="truncate">
              <div className="text-xs sm:text-sm font-bold text-white truncate">
                Render Queue Studio
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Mobile Control Panel & Netflix Portal
              </div>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav
            aria-label="Main Navigation"
            className="hidden md:flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800"
          >
            <button
              type="button"
              onClick={() => setActiveTab('render')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeTab === 'render'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Render Queue</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('gallery')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeTab === 'gallery'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Gallery ({gallery.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeTab === 'live'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Live HLS</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeTab === 'settings'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('youtube')}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'youtube'
                  ? 'bg-red-600 text-white font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Youtube className="w-3.5 h-3.5" />
              <span>YouTube API</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('drive')}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'drive'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Drive</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('cluster3d')}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'cluster3d'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D Rack</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ailab')}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'ailab'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Lab</span>
            </button>
          </nav>

          {/* Switch back to AI Drama Studio + Grafana Quick Link */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setStudioWorkspace('drama')}
              className="min-h-[44px] px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-red-600/20"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>3!2!1! Akzyon</span>
            </button>
            <a
              href={grafanaUrl}
              target="_blank"
              rel="noreferrer"
              className="min-h-[44px] px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-emerald-400 flex items-center gap-1.5 shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Grafana</span>
            </a>
          </div>
        </div>

        {/* Secondary Chip Bar for Optional Tabs on Mobile */}
        <div className="flex md:hidden items-center gap-1.5 pt-2.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-semibold shrink-0 flex items-center gap-1 border ${
              activeTab === 'youtube'
                ? 'bg-red-600 text-white border-red-500 font-bold'
                : 'bg-slate-900/90 text-slate-300 border-slate-800'
            }`}
          >
            <Youtube className="w-3.5 h-3.5" />
            <span>YouTube API</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('drive')}
            className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-semibold shrink-0 flex items-center gap-1 border ${
              activeTab === 'drive'
                ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                : 'bg-slate-900/90 text-slate-300 border-slate-800'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Google Drive</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cluster3d')}
            className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-semibold shrink-0 flex items-center gap-1 border ${
              activeTab === 'cluster3d'
                ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                : 'bg-slate-900/90 text-slate-300 border-slate-800'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>3D Visualizer (Optional)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ailab')}
            className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-semibold shrink-0 flex items-center gap-1 border ${
              activeTab === 'ailab'
                ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                : 'bg-slate-900/90 text-slate-300 border-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Media Lab (Optional)</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-5">
        {/* ==================== TAB 1: RENDER QUEUE STUDIO ==================== */}
        {activeTab === 'render' && (
          <div className="space-y-6">
            {/* Filipino Error Banner */}
            {(filipinoError || job?.error) && (
              <div
                role="alert"
                className="bg-red-950/70 border border-red-700 text-red-200 rounded-2xl p-4 flex items-start gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs sm:text-sm leading-relaxed">
                  <strong className="font-bold block text-red-300">Mensahe ng System:</strong>
                  {filipinoError || job?.error}
                </div>
                <button
                  type="button"
                  aria-label="Isara ang error message"
                  onClick={() => setFilipinoError(null)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-red-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {uploadNotice && (
              <div className="bg-emerald-950/60 border border-emerald-700/80 text-emerald-200 rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1">{uploadNotice}</div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Upload from Phone & Render Configuration */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
                    Hakbang 1 · Upload & Hatiin sa Segments
                  </span>
                  <h1 className="text-lg sm:text-xl font-bold text-white mt-0.5">
                    Mag-upload ng Video Mula sa Phone
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    Hinahati sa default 24 segments (nililimitahan sa haba ng video sa segundo),
                    nire-render nang parallel, at sine-save bilang{' '}
                    <code className="text-amber-300">
                      MarilagOutput/&lt;pangalan&gt;_final.mp4
                    </code>{' '}
                    at <code className="text-amber-300">.jpg</code>.
                  </p>
                </div>

                {/* Phone File Upload Input */}
                <div className="space-y-2">
                  <label
                    htmlFor="phone-video-upload"
                    className="flex flex-col items-center justify-center w-full min-h-[104px] border-2 border-dashed border-slate-700 hover:border-red-500 rounded-2xl p-4 cursor-pointer bg-slate-950/70 transition-colors text-center"
                  >
                    <Upload className="w-6 h-6 text-red-500 mb-1.5" />
                    <span className="text-xs sm:text-sm font-bold text-slate-100">
                      {uploadingFile
                        ? 'Ina-upload at sinusuri ang video...'
                        : 'Pumili ng Video sa Phone (.mp4, .mov, .webm, .mkv)'}
                    </span>
                    <span className="text-[11px] text-slate-400 mt-0.5">
                      Max 200 MB · Auto-sanitize ng filename
                    </span>
                    <input
                      id="phone-video-upload"
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/*"
                      onChange={handlePhoneVideoSelect}
                      disabled={uploadingFile || job?.isRunning}
                      className="sr-only"
                    />
                  </label>
                </div>

                {/* Output Base Name (<pangalan>) */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="output-base-name"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Pangalan ng Output (<code className="text-amber-400">&lt;pangalan&gt;</code>)
                  </label>
                  <input
                    id="output-base-name"
                    type="text"
                    value={outputBaseName}
                    onChange={(e) => setOutputBaseName(e.target.value)}
                    placeholder="hal. pacquiao_highlight"
                    className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono"
                  />
                  <p className="text-[11px] text-slate-400 font-mono truncate">
                    Output: MarilagOutput/{sanitizeVideoBaseName(outputBaseName)}_final.mp4
                  </p>
                </div>

                {/* Segments & Workers Controls */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="segments-input"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Bilang ng Segments
                    </label>
                    <input
                      id="segments-input"
                      type="number"
                      min={1}
                      max={64}
                      value={segmentsCount}
                      onChange={(e) =>
                        setSegmentsCount(Math.max(1, Math.min(64, Number(e.target.value) || 24)))
                      }
                      className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white font-mono"
                    />
                    <span className="block text-[10px] text-slate-400">
                      Max ≤ haba ng video sa segundo
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="workers-input"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Parallel Workers
                    </label>
                    <input
                      id="workers-input"
                      type="number"
                      min={1}
                      max={16}
                      value={workersCount}
                      onChange={(e) =>
                        setWorkersCount(Math.max(1, Math.min(16, Number(e.target.value) || 4)))
                      }
                      className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white font-mono"
                    />
                    <span className="block text-[10px] text-slate-400">
                      NVENC / libx264 threads
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer min-h-[44px] px-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <input
                    type="checkbox"
                    checked={forceCpu}
                    onChange={(e) => setForceCpu(e.target.checked)}
                    className="w-4 h-4 accent-red-600"
                  />
                  <span>Pilitin ang CPU fallback (libx264) kahit may NVIDIA NVENC</span>
                </label>

                {/* Primary Start / Cancel Buttons (Touch >= 48px) */}
                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleStartRender()}
                    disabled={Boolean(job?.isRunning) || uploadingFile}
                    className="flex-1 min-h-[48px] px-5 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>
                      {job?.isRunning ? 'Nagre-render Ngayon...' : 'Simulan ang Parallel Render'}
                    </span>
                  </button>

                  {job?.isRunning && (
                    <button
                      type="button"
                      onClick={handleCancelRender}
                      className="min-h-[48px] px-5 py-3 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-sm rounded-xl shadow-lg flex items-center justify-center gap-2 transition-colors"
                    >
                      <Square className="w-4 h-4 fill-current" />
                      <span>Cancel Render</span>
                    </button>
                  )}
                </div>

                {/* Built-in Test Verification Presets (Requirement D.12) */}
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <span className="block text-[11px] font-semibold text-slate-400">
                    Mabilisang Pagpapatunay (Real FFmpeg Test Presets):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={Boolean(job?.isRunning)}
                      onClick={() =>
                        handleStartRender({
                          generateTest: true,
                          testDuration: 20,
                          noAudio: false,
                          customBaseName: 'test_20s_audio',
                          customSegments: 24,
                        })
                      }
                      className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-slate-200 rounded-xl"
                    >
                      Test 20s Video
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(job?.isRunning)}
                      onClick={() =>
                        handleStartRender({
                          generateTest: true,
                          testDuration: 10,
                          noAudio: true,
                          customBaseName: 'test_walang_audio',
                          customSegments: 10,
                        })
                      }
                      className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-slate-200 rounded-xl"
                    >
                      Test Walang Audio
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(job?.isRunning)}
                      onClick={() =>
                        handleStartRender({
                          generateTest: true,
                          testDuration: 5,
                          noAudio: false,
                          customBaseName: 'test_5s_maikli',
                          customSegments: 24,
                        })
                      }
                      className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-slate-200 rounded-xl"
                    >
                      Test 5s Maikli
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Progress Bar, Segment Matrix & Retry, and Terminal Log */}
              <div className="lg:col-span-7 space-y-5">
                {/* Live Progress Card */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-mono uppercase text-slate-400">
                        Live Render Progress · {completedSegmentsCount} / {totalJobSegments} Segments
                      </span>
                      <h2 className="text-base sm:text-lg font-bold text-white">
                        {job?.isRunning
                          ? `Nagre-render: ${job.baseName}_final.mp4`
                          : job?.exitCode === 0 && completedSegmentsCount > 0
                          ? `Tapos na: ${job.baseName || 'latest'}_final.mp4`
                          : 'Handa sa Susunod na Render Job'}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black font-mono text-emerald-400">
                        {progressPct}%
                      </span>
                      {!job?.isRunning && job?.exitCode !== null && job?.exitCode !== 0 && (
                        <button
                          type="button"
                          onClick={() => handleStartRender()}
                          className="min-h-[44px] px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>I-retry ang Job</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div
                    role="progressbar"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="w-full h-3.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800"
                  >
                    <div
                      className={`h-full transition-all duration-300 ${
                        job?.error ? 'bg-red-600' : 'bg-gradient-to-r from-red-600 to-emerald-500'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {/* Segment Status Grid */}
                  <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 pt-1">
                    {Array.from({ length: totalJobSegments }, (_, idx) => {
                      const num = idx + 1;
                      const seg = segmentsMap[num];
                      const isDone = seg?.success;
                      const isFailed = seg && !seg.success;
                      return (
                        <div
                          key={num}
                          className={`rounded-lg p-2 text-center border text-xs font-mono ${
                            isDone
                              ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-300'
                              : isFailed
                              ? 'bg-red-950/70 border-red-700 text-red-300'
                              : job?.isRunning
                              ? 'bg-amber-950/40 border-amber-700/50 text-amber-300 animate-pulse'
                              : 'bg-slate-950 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="font-bold">#{String(num).padStart(2, '0')}</div>
                          <div className="text-[10px] truncate">
                            {isDone
                              ? `${seg.elapsedSec.toFixed(1)}s`
                              : isFailed
                              ? 'FAIL'
                              : job?.isRunning
                              ? '...'
                              : 'Idle'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live FFmpeg Log Console */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 font-mono">
                      FFmpeg Parallel Queue Log (render_progress.log)
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      Last Render: {metrics.lastRenderSeconds.toFixed(2)}s
                    </span>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 h-52 overflow-y-auto font-mono text-[11px] text-emerald-400 space-y-1">
                    {!job?.logs || job.logs.length === 0 ? (
                      <div className="text-slate-400">
                        Wala pang aktibong log. Mag-upload ng video o pumili ng Test Preset para simulan ang render.
                      </div>
                    ) : (
                      job.logs.map((line, idx) => (
                        <div
                          key={idx}
                          className={
                            line.includes('ERROR') || line.includes('FAILED') || line.includes('WARNING')
                              ? 'text-red-400 font-semibold'
                              : line.includes('COMPLETE')
                              ? 'text-amber-300 font-bold'
                              : 'text-emerald-400'
                          }
                        >
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: NETFLIX GALLERY ==================== */}
        {activeTab === 'gallery' && (
          <div className="space-y-8">
            {/* Search & Count Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight">
                  MarilagFlix Video Gallery
                </h1>
                <p className="text-xs text-slate-400">
                  Lahat ng totoong natapos na video sa <code className="text-amber-400">MarilagOutput/*_final.mp4</code>
                </p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  aria-label="Maghanap ng video sa gallery"
                  placeholder="Maghanap ng video..."
                  value={gallerySearch}
                  onChange={(e) => setGallerySearch(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2 text-sm text-white"
                />
              </div>
            </div>

            {gallery.length === 0 ? (
              /* Honest Empty State (Requirement C.11 - No Fake Data) */
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-8 sm:p-12 text-center max-w-xl mx-auto space-y-4">
                <Film className="w-12 h-12 text-red-500 mx-auto" />
                <h2 className="text-lg sm:text-xl font-bold text-white">
                  Walang Laman ang Gallery sa Ngayon
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Walang fake o sample placeholder video dito. Mag-upload ng video mula sa iyong
                  phone o magpatakbo ng render sa <strong>Render Queue</strong> tab upang lumabas
                  ang iyong unang <code className="text-amber-400">&lt;pangalan&gt;_final.mp4</code>.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('render')}
                  className="min-h-[48px] px-6 py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-sm rounded-xl shadow-lg inline-flex items-center gap-2"
                >
                  <Sliders className="w-4 h-4" />
                  <span>Pumunta sa Render Queue</span>
                </button>
              </div>
            ) : (
              <>
                {/* Hero Banner for the Newest Completed Video (Requirement A.3) */}
                {featuredHeroVideo && (
                  <section className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 min-h-[280px] sm:min-h-[340px] flex items-end">
                    {featuredHeroVideo.hasThumbnail && (
                      <img
                        src={featuredHeroVideo.thumbnailUrl}
                        alt={featuredHeroVideo.title}
                        className="absolute inset-0 w-full h-full object-cover opacity-45"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d13] via-[#0b0d13]/70 to-transparent" />
                    <div className="relative z-10 p-5 sm:p-8 max-w-2xl space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="bg-red-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded uppercase">
                          Pinakabagong Render
                        </span>
                        <span className="text-xs font-mono text-emerald-400">
                          {featuredHeroVideo.segments} Segments · {featuredHeroVideo.encoder}
                        </span>
                        <span className="text-xs font-mono text-slate-300">
                          {formatDuration(featuredHeroVideo.durationSec)}
                        </span>
                      </div>
                      <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight break-words">
                        {featuredHeroVideo.title}
                      </h2>
                      <p className="text-xs text-slate-300 font-mono break-all">
                        File: MarilagOutput/{featuredHeroVideo.fileName} (
                        {(featuredHeroVideo.sizeBytes / (1024 * 1024)).toFixed(2)} MB)
                      </p>
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => setPlayingVideo(featuredHeroVideo)}
                          className="min-h-[46px] px-5 py-2.5 bg-white hover:bg-slate-200 text-slate-950 font-bold text-sm rounded-xl flex items-center gap-2 shadow-lg"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          <span>I-play Ngayon</span>
                        </button>
                        <a
                          href={featuredHeroVideo.videoUrl}
                          download={featuredHeroVideo.fileName}
                          className="min-h-[46px] px-4 py-2.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-white font-semibold text-xs rounded-xl flex items-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          <span>I-download</span>
                        </a>
                      </div>
                    </div>
                  </section>
                )}

                {/* Searchable Video Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredGallery.map((vid) => (
                    <div
                      key={vid.baseName}
                      className="bg-slate-900/90 border border-slate-800 hover:border-red-600/60 rounded-2xl overflow-hidden flex flex-col justify-between transition-all shadow-lg"
                    >
                      <div>
                        <div
                          onClick={() => setPlayingVideo(vid)}
                          className="aspect-video bg-slate-950 relative cursor-pointer group overflow-hidden"
                        >
                          {vid.hasThumbnail ? (
                            <img
                              src={vid.thumbnailUrl}
                              alt={vid.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">
                              Walang Thumbnail
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg">
                              <Play className="w-5 h-5 fill-current ml-0.5" />
                            </div>
                          </div>
                          <span className="absolute bottom-2 right-2 bg-black/85 text-white text-[11px] px-2 py-0.5 rounded font-mono">
                            {formatDuration(vid.durationSec)}
                          </span>
                        </div>

                        <div className="p-4 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-red-400 font-bold uppercase">
                              {vid.segments} Segs · {vid.encoder}
                            </span>
                            <span className="text-slate-400">
                              {(vid.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                            </span>
                          </div>
                          <h3 className="font-bold text-white text-base truncate">{vid.title}</h3>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            MarilagOutput/{vid.fileName}
                          </p>
                        </div>
                      </div>

                      <div className="p-4 pt-0 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPlayingVideo(vid)}
                          className="flex-1 min-h-[44px] px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Play</span>
                        </button>
                        <a
                          href={vid.videoUrl}
                          download={vid.fileName}
                          aria-label={`I-download ang ${vid.fileName}`}
                          className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </a>
                        <button
                          type="button"
                          aria-label={`Burahin ang ${vid.fileName}`}
                          onClick={() => setVideoToDelete(vid)}
                          className="min-h-[44px] min-w-[44px] px-3 py-2 bg-slate-800 hover:bg-red-950/80 text-red-400 hover:text-red-300 text-xs font-semibold rounded-xl flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ==================== TAB 3: LIVE HLS STREAM & MONITORING ==================== */}
        {activeTab === 'live' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
              <div>
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
                  <Radio className="w-4 h-4 animate-pulse" />
                  <span>{hlsStatus}</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">
                  Nginx-RTMP Live HLS Player & Grafana Link
                </h1>
                <p className="text-xs text-slate-400 font-mono break-all mt-0.5">
                  Stream URL: {liveHlsUrl}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => attachHlsStream(liveHlsUrl)}
                  className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-xl flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>I-reload ang Stream</span>
                </button>
                <a
                  href={grafanaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Buksan ang Grafana ({grafanaUrl})</span>
                </a>
              </div>
            </div>

            {hlsError && (
              <div
                role="alert"
                className="bg-amber-950/50 border border-amber-700/70 text-amber-200 rounded-2xl p-4 text-xs sm:text-sm"
              >
                {hlsError}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-black border border-slate-800 rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
                <video
                  ref={hlsVideoRef}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-white">
                    Prometheus Endpoint (<code className="text-emerald-400">GET /metrics</code>)
                  </h2>
                  <button
                    type="button"
                    onClick={fetchPrometheusText}
                    className="min-h-[38px] px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg"
                  >
                    Refresh
                  </button>
                </div>
                <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-[11px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">
                  {rawPrometheusText || 'Nilo-load ang /metrics...'}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: SETTINGS (HLS & GRAFANA URLS) ==================== */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-6">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">
                Mga Setting ng External Docker Links
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                I-configure dito ang URL ng iyong hiwalay na Nginx-RTMP HLS stream at Grafana
                dashboard.
              </p>
            </div>

            {settingsSavedMsg && (
              <div className="bg-emerald-950/60 border border-emerald-700 text-emerald-200 rounded-xl p-3.5 text-xs font-semibold">
                {settingsSavedMsg}
              </div>
            )}

            <form onSubmit={handleSaveSettings} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="setting-hls-url"
                  className="block text-xs font-semibold text-slate-200"
                >
                  Live HLS URL (Default: <code className="text-amber-400">{DEFAULT_HLS_URL}</code>)
                </label>
                <input
                  id="setting-hls-url"
                  type="url"
                  value={draftHlsUrl}
                  onChange={(e) => setDraftHlsUrl(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="setting-grafana-url"
                  className="block text-xs font-semibold text-slate-200"
                >
                  Grafana URL (Default: <code className="text-amber-400">{DEFAULT_GRAFANA_URL}</code>)
                </label>
                <input
                  id="setting-grafana-url"
                  type="url"
                  value={draftGrafanaUrl}
                  onChange={(e) => setDraftGrafanaUrl(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="submit"
                  className="min-h-[46px] px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs sm:text-sm rounded-xl"
                >
                  I-save ang Settings
                </button>
                <button
                  type="button"
                  onClick={handleResetSettings}
                  className="min-h-[46px] px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm rounded-xl"
                >
                  Ibalik sa Default
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================== OPTIONAL TAB 5: GOOGLE DRIVE ==================== */}
        {activeTab === 'drive' && (
          <OptionalTabErrorBoundary tabTitle="Google Drive Sync">
            <GoogleDriveSync
              galleryVideos={gallery.map((g) => ({
                baseName: g.baseName,
                fileName: g.fileName,
                videoUrl: g.videoUrl,
                sizeBytes: g.sizeBytes,
              }))}
            />
          </OptionalTabErrorBoundary>
        )}

        {/* ==================== OPTIONAL TAB 6: 3D VISUALIZER ==================== */}
        {activeTab === 'cluster3d' && (
          <OptionalTabErrorBoundary tabTitle="3D Cluster Visualizer">
            <RenderCluster3D
              segmentsMap={segmentsMap}
              isJobRunning={Boolean(job?.isRunning)}
              detectedEncoder="libx264 / NVENC"
              onTriggerRender={() => handleStartRender()}
            />
          </OptionalTabErrorBoundary>
        )}

        {/* ==================== OPTIONAL TAB 7: AI MEDIA LAB ==================== */}
        {activeTab === 'ailab' && (
          <OptionalTabErrorBoundary tabTitle="AI Media Lab">
            <AiMultimediaLab />
          </OptionalTabErrorBoundary>
        )}
      </main>

      {/* ==================== VIDEO PLAYER MODAL ==================== */}
      {playingVideo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Playing ${playingVideo.title}`}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-3 sm:p-6"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl">
            <div className="px-4 sm:px-6 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
              <div className="truncate">
                <span className="text-[10px] font-mono uppercase text-red-400 block">
                  MarilagOutput/{playingVideo.fileName}
                </span>
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  {playingVideo.title}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Isara ang video player"
                onClick={() => setPlayingVideo(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-xl hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video bg-black">
              <video
                src={playingVideo.videoUrl}
                poster={playingVideo.hasThumbnail ? playingVideo.thumbnailUrl : undefined}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="text-slate-300 font-mono">
                Haba: {formatDuration(playingVideo.durationSec)} ·{' '}
                {(playingVideo.sizeBytes / (1024 * 1024)).toFixed(2)} MB
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={playingVideo.videoUrl}
                  download={playingVideo.fileName}
                  className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>I-download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPlayingVideo(null)}
                  className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl"
                >
                  Isara
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== DELETE CONFIRMATION MODAL (Requirement A.3) ==================== */}
      {videoToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-video-modal-title"
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 id="delete-video-modal-title" className="text-base font-bold text-white">
              Kumpirmahin ang Pagbura ng Video
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Sigurado ka bang gusto mong burahin ang{' '}
              <code className="text-amber-400">MarilagOutput/{videoToDelete.fileName}</code> at ang
              thumbnail nitong{' '}
              <code className="text-amber-400">{videoToDelete.thumbnailFileName}</code>? Hindi na
              ito maibabalik.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setVideoToDelete(null)}
                disabled={deletingVideo}
                className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl"
              >
                Kanselahin
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteVideo}
                disabled={deletingVideo}
                className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-500 text-xs font-bold text-white rounded-xl"
              >
                {deletingVideo ? 'Binubura...' : 'Oo, Burahin ang Video'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MOBILE BOTTOM NAVIGATION BAR (390x844 Optimized) ==================== */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0f131d]/95 border-t border-slate-800 grid grid-cols-4 px-2 py-1"
      >
        <button
          type="button"
          onClick={() => setActiveTab('render')}
          className={`min-h-[52px] flex flex-col items-center justify-center rounded-xl text-[11px] font-bold ${
            activeTab === 'render' ? 'text-red-500' : 'text-slate-400'
          }`}
        >
          <Sliders className="w-5 h-5 mb-0.5" />
          <span>Render</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('gallery')}
          className={`min-h-[52px] flex flex-col items-center justify-center rounded-xl text-[11px] font-bold ${
            activeTab === 'gallery' ? 'text-red-500' : 'text-slate-400'
          }`}
        >
          <Film className="w-5 h-5 mb-0.5" />
          <span>Gallery ({gallery.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('live')}
          className={`min-h-[52px] flex flex-col items-center justify-center rounded-xl text-[11px] font-bold ${
            activeTab === 'live' ? 'text-red-500' : 'text-slate-400'
          }`}
        >
          <Radio className="w-5 h-5 mb-0.5" />
          <span>Live HLS</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`min-h-[52px] flex flex-col items-center justify-center rounded-xl text-[11px] font-bold ${
            activeTab === 'settings' ? 'text-red-500' : 'text-slate-400'
          }`}
        >
          <SettingsIcon className="w-5 h-5 mb-0.5" />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
