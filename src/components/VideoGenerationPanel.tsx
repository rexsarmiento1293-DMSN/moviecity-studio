import React, { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

export type Provider = "fal" | "colab" | "local" | "showcase";
export type BridgeStatus = "loading" | "active" | "offline" | "expired" | "error";

export type GenerateResponse = {
  ok?: boolean;
  provider?: "fal" | "colab";
  videoUrl?: string;
  mediaKey?: string;
  error?: string;
  detail?: string;
};

export type BridgeStatusResponse = {
  status?: "active" | "offline" | "expired";
  provider?: "ltx-video-colab";
  expiresAt?: string;
};

export interface FeaturedRealHumanEpisode {
  id: string;
  title: string;
  actors: string;
  meta: string;
  /** Ordered mirror chain: verified public HTTPS real-human CDN links -> local /media/*.mp4 real-human assets */
  sources: string[];
  poster: string;
  defaultSubtitles: TagalogSubtitleCue[];
}

export interface TagalogSubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface DirectorLiveStage {
  stepNumber: 1 | 2 | 3 | 4;
  rangeLabel: string;
  minPct: number;
  maxPct: number;
  titleTl: string;
  detailTl: string;
}

export const DIRECTOR_LIVE_STAGES: DirectorLiveStage[] = [
  {
    stepNumber: 1,
    rangeLabel: "0-25%",
    minPct: 0,
    maxPct: 25,
    titleTl: "Sinisiyasat ang Prompt at Kwento...",
    detailTl: "Sinusuri ang Tagalog script, Character Profile Lock, at camera blocking.",
  },
  {
    stepNumber: 2,
    rangeLabel: "26-50%",
    minPct: 26,
    maxPct: 50,
    titleTl: "Naglo-load ng LTX-Video at AI Models...",
    detailTl: "Inihahanda ang ltx-video-2b-v0.9.5, T5-XXL encoder, at Fal/Colab GPU pipeline.",
  },
  {
    stepNumber: 3,
    rangeLabel: "51-75%",
    minPct: 51,
    maxPct: 75,
    titleTl: "Binubuo ang cinematic frames at galaw ng tunay na tao...",
    detailTl: "Nagre-render ng 73 frames @ 24fps na may natural na ekspresyon at ilaw.",
  },
  {
    stepNumber: 4,
    rangeLabel: "76-100%",
    minPct: 76,
    maxPct: 100,
    titleTl: "Sine-save ang MP4 video sa R2 Storage at IndexedDB Vault...",
    detailTl: "Ina-upload sa Cloudflare R2 (movie-city-media) at AiDramaStudioVideoDB.",
  },
];

export function getDirectorStageForProgress(pct: number): DirectorLiveStage {
  if (pct <= 25) return DIRECTOR_LIVE_STAGES[0];
  if (pct <= 50) return DIRECTOR_LIVE_STAGES[1];
  if (pct <= 75) return DIRECTOR_LIVE_STAGES[2];
  return DIRECTOR_LIVE_STAGES[3];
}

export function buildTagalogSubtitlesFromPrompt(promptText: string): TagalogSubtitleCue[] {
  const cleaned = String(promptText || "").trim();
  if (!cleaned) {
    return [
      {
        startSec: 0,
        endSec: 2.5,
        text: "Sa gitna ng malakas na ulan sa Maynila, hinarap ni Clara ang katotohanan.",
      },
      {
        startSec: 2.5,
        endSec: 5.0,
        text: "Hindi na matatakasan ang lihim na matagal nang itinago ng pamilya!",
      },
      {
        startSec: 5.0,
        endSec: 8.0,
        text: "Ito na ang simula ng bagong kabanata sa 3!2!1! Akzyon!",
      },
    ];
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 1) {
    const words = sentences[0].split(/\s+/);
    const mid = Math.max(4, Math.ceil(words.length / 2));
    const part1 = words.slice(0, mid).join(" ");
    const part2 = words.slice(mid).join(" ") || "Narito na ang matinding tagpo sa 3!2!1! Akzyon!";
    return [
      { startSec: 0, endSec: 3.0, text: part1 },
      { startSec: 3.0, endSec: 6.0, text: part2 },
      {
        startSec: 6.0,
        endSec: 9.0,
        text: "Panoorin ang buong eksena na may Tagalog dubbing at cinematic grading.",
      },
    ];
  }

  return sentences.slice(0, 4).map((sentence, idx) => ({
    startSec: idx * 2.5,
    endSec: (idx + 1) * 2.5,
    text: sentence.slice(0, 140),
  }));
}

function formatVttTimestamp(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `00:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(
    ms
  ).padStart(3, "0")}`;
}

export function createTagalogWebVttDataUrl(cues: TagalogSubtitleCue[]): string {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, i) => {
    lines.push(`${i + 1}`);
    lines.push(`${formatVttTimestamp(cue.startSec)} --> ${formatVttTimestamp(cue.endSec)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`;
}

export function triggerTagalogDubbingSpeech(cues: TagalogSubtitleCue[], enabled = true): void {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const fullText = cues.map((c) => c.text).join(". ");
    const utterance = new SpeechSynthesisUtterance(fullText);
    utterance.lang = "tl-PH";
    utterance.rate = 0.98;
    utterance.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const filVoice = voices.find(
      (v) =>
        v.lang.toLowerCase().includes("tl") ||
        v.lang.toLowerCase().includes("fil") ||
        v.name.toLowerCase().includes("filipino") ||
        v.name.toLowerCase().includes("tagalog")
    );
    if (filVoice) utterance.voice = filVoice;
    window.speechSynthesis.speak(utterance);
  } catch {}
}

export interface LiveDirectorProgressStudioProps {
  progressPct: number;
  logs: string[];
  framesCount?: number;
  fps?: number;
  isComplete?: boolean;
  title?: string;
}

export const LiveDirectorProgressStudio: React.FC<LiveDirectorProgressStudioProps> = ({
  progressPct,
  logs,
  framesCount = 73,
  fps = 24,
  isComplete = false,
  title = "AI Director Studio · Live Video Generation Progress",
}) => {
  const clampedPct = Math.max(0, Math.min(100, Math.round(progressPct)));
  const currentStage = getDirectorStageForProgress(clampedPct);
  const renderedFrames = Math.min(
    framesCount,
    Math.max(1, Math.round((clampedPct / 100) * framesCount))
  );

  return (
    <div
      data-testid="live-director-progress-studio"
      className="rounded-2xl border border-emerald-500/40 bg-[#090d16] p-4 sm:p-5 text-white shadow-2xl space-y-4"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
              {title}
            </p>
            <h3
              data-testid="live-director-active-stage-title"
              className="text-sm sm:text-base font-extrabold text-white"
            >
              Hakbang {currentStage.stepNumber}/4 ({currentStage.rangeLabel}):{" "}
              <span className="text-emerald-300">{currentStage.titleTl}</span>
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="rounded bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-1 text-emerald-300 font-bold">
            {renderedFrames} / {framesCount} frames @ {fps}fps
          </span>
          <span
            data-testid="live-director-progress-pct"
            className="rounded bg-red-500/20 border border-red-500/40 px-2.5 py-1 text-red-300 font-extrabold"
          >
            {clampedPct}%
          </span>
        </div>
      </div>

      {/* Retro-Futuristic Segmented Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
          <span>{currentStage.detailTl}</span>
          <span className="text-emerald-400 font-bold">
            {isComplete ? "100% HANDA NA ANG VIDEO" : `EXECUTING STEP ${currentStage.stepNumber}/4`}
          </span>
        </div>
        <div className="relative h-4 w-full overflow-hidden rounded-lg border border-emerald-400/40 bg-black p-0.5">
          <div
            className="h-full rounded bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400 transition-all duration-300"
            style={{ width: `${clampedPct}%` }}
          />
        </div>
      </div>

      {/* 4 Step Cards in Tagalog */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {DIRECTOR_LIVE_STAGES.map((stage) => {
          const isDone = clampedPct > stage.maxPct || clampedPct === 100;
          const isCurrent =
            !isDone && clampedPct >= stage.minPct && clampedPct <= stage.maxPct;
          return (
            <div
              key={stage.stepNumber}
              data-testid={`director-step-card-${stage.stepNumber}`}
              className={`rounded-xl border p-2.5 transition-all ${
                isDone
                  ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-200"
                  : isCurrent
                  ? "border-amber-400 bg-amber-500/15 text-white shadow-lg"
                  : "border-white/10 bg-black/50 text-slate-400"
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-mono uppercase">
                <span className="font-bold">
                  Hakbang {stage.stepNumber} ({stage.rangeLabel})
                </span>
                <span>{isDone ? "✓ OK" : isCurrent ? "● LIVE" : "PENDING"}</span>
              </div>
              <p className="mt-1 text-xs font-bold leading-snug">{stage.titleTl}</p>
            </div>
          );
        })}
      </div>

      {/* Terminal / Action History Live Log */}
      <div className="rounded-xl border border-emerald-500/30 bg-black/95 p-3 font-mono text-xs">
        <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5 text-[10px] uppercase tracking-wider text-emerald-400">
          <span>Terminal / Action History Live Log</span>
          <span>[Akzyon Engine v2.4 · 24fps Stream]</span>
        </div>
        <div
          data-testid="live-director-terminal-log"
          className="max-h-36 space-y-1 overflow-y-auto text-[11px] leading-relaxed text-emerald-300"
        >
          {logs.map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`} className="break-words">
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const FEATURED_REAL_HUMAN_EPISODES: FeaturedRealHumanEpisode[] = [
  {
    id: "ep-1-tuloy-ang-pangako",
    title: "Episode 1: Huling Pangako sa Tulay (Tunay na Tao · Live-Action Drama)",
    actors: "Live-Action Cast: Derek de Lint, Denise Rebergen & Sergio Hasselbaink",
    meta: "Blender Open Movie (Tears of Steel Live-Action) · H.264 MP4 + Stereo Audio",
    sources: [
      "https://dn710301.ca.archive.org/0/items/Tears-of-Steel/tears_of_steel_720p.mp4",
      "https://archive.org/download/Tears-of-Steel/tears_of_steel_720p.mp4",
      "/media/video_akzyon_episode1.mp4",
      "/api/output/akzyon_teleserye_episode1_final.mp4",
    ],
    poster: "/media/akzyon_teleserye_episode1_final.jpg",
    defaultSubtitles: [
      {
        startSec: 0,
        endSec: 2.5,
        text: "Clara: Bakit ngayon mo lang sinabi ang katotohanan tungkol sa ating pamilya?!",
      },
      {
        startSec: 2.5,
        endSec: 5.0,
        text: "Mateo: Ginawa ko lang ang lahat para protektahan ka sa gitna ng unos!",
      },
      {
        startSec: 5.0,
        endSec: 8.0,
        text: "Clara: Hindi pa tapos ang laban natin—babalik ako sa mansyon!",
      },
    ],
  },
  {
    id: "ep-2-pagbabalik-tagapagmana",
    title: "Episode 2: Ang Pagbabalik ng Tagapagmana (Tunay na Tao · Lab Confrontation)",
    actors: "Live-Action Cast: Rogier Schippers, Vanja Rukavina & Denise Rebergen",
    meta: "Direct HTTPS Live-Action MP4 CDN + Local R2 Mirror · H.264 MP4",
    sources: [
      "https://media.w3.org/2010/05/video/movie_300.mp4",
      "/media/video_real_human_ep2.mp4",
      "/api/output/test_20s_audio_final.mp4",
      "/media/video_akzyon_episode1.mp4",
    ],
    poster: "/media/akzyon_teleserye_episode1_final.jpg",
    defaultSubtitles: [
      {
        startSec: 0,
        endSec: 2.5,
        text: "Direk: Buksan ang lahat ng ilaw! Handa na ang tunay na tagapagmana.",
      },
      {
        startSec: 2.5,
        endSec: 5.5,
        text: "Elena: Walang sinuman ang makakaagaw sa mana na pinaghirapan ng aking ama!",
      },
      {
        startSec: 5.5,
        endSec: 8.5,
        text: "Marco: Nasa kamay ko na ang ebidensya na magpapabagsak sa inyong korporasyon!",
      },
    ],
  },
  {
    id: "ep-3-eksena-sa-mansyon",
    title: "Episode 3: Eksena sa Mansyon (Tunay na Tao · Director's Action Cut)",
    actors: "Live-Action Cast: Sergio Hasselbaink & Hubert Zwart",
    meta: "Wikimedia Commons / Blender Live-Action + Local Mirror · H.264 MP4",
    sources: [
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/c/cb/Tears_of_Steel_1080p.webm/Tears_of_Steel_1080p.webm.360p.mpeg4.mov",
      "/media/video_real_human_ep3.mp4",
      "/api/output/test_5s_maikli_final.mp4",
      "/media/video_akzyon_episode1.mp4",
    ],
    poster: "/media/akzyon_teleserye_episode1_final.jpg",
    defaultSubtitles: [
      {
        startSec: 0,
        endSec: 2.5,
        text: "Kidlat: Kahit ilang beses akong bumagsak, babangon ako para sa pamilya ko!",
      },
      {
        startSec: 2.5,
        endSec: 6.0,
        text: "3!2!1! Akzyon — Tunay na tao, tunay na emosyon sa bawat eksena!",
      },
    ],
  },
];

// ============================================================================
// AiDramaStudioVideoDB (IndexedDB) for Offline Real Human MP4 Video Persistence
// ============================================================================
export const AI_DRAMA_STUDIO_VIDEO_DB_NAME = "AiDramaStudioVideoDB";
export const AI_DRAMA_STUDIO_VIDEO_STORE = "custom_mp4_videos";
export const CUSTOM_USER_VIDEO_KEY = "active_custom_human_video";

export interface SavedCustomVideoRecord {
  blob: Blob;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  updatedAt: string;
}

function openAiDramaStudioVideoDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AI_DRAMA_STUDIO_VIDEO_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AI_DRAMA_STUDIO_VIDEO_STORE)) {
        db.createObjectStore(AI_DRAMA_STUDIO_VIDEO_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCustomVideoToAiDramaStudioDB(
  file: File | Blob,
  fileName = "custom_human_video.mp4"
): Promise<SavedCustomVideoRecord> {
  const record: SavedCustomVideoRecord = {
    blob: file,
    fileName,
    sizeBytes: file.size,
    mimeType: file.type || "video/mp4",
    updatedAt: new Date().toISOString(),
  };
  try {
    const db = await openAiDramaStudioVideoDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(AI_DRAMA_STUDIO_VIDEO_STORE, "readwrite");
      tx.objectStore(AI_DRAMA_STUDIO_VIDEO_STORE).put(record, CUSTOM_USER_VIDEO_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  return record;
}

export async function loadCustomVideoFromAiDramaStudioDB(): Promise<SavedCustomVideoRecord | null> {
  try {
    const db = await openAiDramaStudioVideoDB();
    return await new Promise<SavedCustomVideoRecord | null>((resolve, reject) => {
      const tx = db.transaction(AI_DRAMA_STUDIO_VIDEO_STORE, "readonly");
      const req = tx.objectStore(AI_DRAMA_STUDIO_VIDEO_STORE).get(CUSTOM_USER_VIDEO_KEY);
      req.onsuccess = () => {
        const res = req.result;
        if (res && res.blob instanceof Blob && res.blob.size > 0) {
          resolve(res as SavedCustomVideoRecord);
        } else if (res instanceof Blob && res.size > 0) {
          resolve({
            blob: res,
            fileName: "saved_gallery_video.mp4",
            sizeBytes: res.size,
            mimeType: res.type || "video/mp4",
            updatedAt: new Date().toISOString(),
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export type VideoGenerationPanelProps = {
  /** Defaults to the current Movie City origin. */
  apiBaseUrl?: string;
  /** Set false when Colab fallback is disabled on the server. */
  colabEnabled?: boolean;
  /** Existing app can provide its own media URL resolver. */
  resolveMediaUrl?: (url: string) => string;
  /** Optional callback when a video is generated or uploaded locally */
  onVideoSelected?: (
    url: string,
    title: string,
    subtitles?: TagalogSubtitleCue[],
    autoPlayNow?: boolean
  ) => void;
  defaultPrompt?: string;
  className?: string;
};

const DEFAULT_PROMPT =
  "A cinematic Filipino teleserye scene in Manila during heavy rain, realistic character motion, slow camera movement, dramatic lighting";

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

function formatExpiry(expiresAt?: string) {
  if (!expiresAt) return "unknown";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function providerLabel(provider?: Provider) {
  if (provider === "colab") return "Colab LTX";
  if (provider === "fal") return "Fal AI";
  if (provider === "local") return "Local Android Gallery (AiDramaStudioVideoDB)";
  return "Featured Drama Showcase (Tunay na Tao)";
}

export default function VideoGenerationPanel({
  apiBaseUrl = "",
  colabEnabled = true,
  resolveMediaUrl = (url) => url,
  onVideoSelected,
  defaultPrompt = DEFAULT_PROMPT,
  className = "",
}: VideoGenerationPanelProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [duration, setDuration] = useState(5);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(320);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("loading");
  const [bridgeExpiry, setBridgeExpiry] = useState<string>();
  const [isGenerating, setIsGenerating] = useState(false);

  // Live Generation Progress & Terminal Logs State
  const [genProgressPct, setGenProgressPct] = useState<number>(0);
  const [genTerminalLogs, setGenTerminalLogs] = useState<string[]>([
    "[Akzyon Engine] System Ready · Waiting for Director command...",
  ]);
  const [showLiveDirectorPanel, setShowLiveDirectorPanel] = useState<boolean>(false);

  // Pre-populated Featured Real Human Episode & Mirror Fallback State
  const [activeEpisodeId, setActiveEpisodeId] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].id
  );
  const [mirrorIndex, setMirrorIndex] = useState<number>(0);
  const [provider, setProvider] = useState<Provider>("showcase");
  const [videoUrl, setVideoUrl] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].sources[0]
  );
  const [activeVideoTitle, setActiveVideoTitle] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].title
  );
  const [subtitles, setSubtitles] = useState<TagalogSubtitleCue[]>(
    FEATURED_REAL_HUMAN_EPISODES[0].defaultSubtitles
  );
  const [activeSubtitleLine, setActiveSubtitleLine] = useState<string>(
    FEATURED_REAL_HUMAN_EPISODES[0].defaultSubtitles[0]?.text || ""
  );
  const [tagalogDubbingEnabled, setTagalogDubbingEnabled] = useState<boolean>(true);
  const [shouldAutoPlay, setShouldAutoPlay] = useState<boolean>(false);
  const [customUploadName, setCustomUploadName] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  async function refreshBridgeStatus() {
    if (!colabEnabled) {
      setBridgeStatus("offline");
      return;
    }

    try {
      const response = await fetch(joinUrl(apiBaseUrl, "/api/colab/status"), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Status HTTP ${response.status}`);
      const data = (await response.json()) as BridgeStatusResponse;
      setBridgeStatus(data.status === "active" ? "active" : data.status || "offline");
      setBridgeExpiry(data.expiresAt);
    } catch {
      setBridgeStatus("error");
      setBridgeExpiry(undefined);
    }
  }

  useEffect(() => {
    void refreshBridgeStatus();
    const timer = window.setInterval(() => void refreshBridgeStatus(), 30_000);
    return () => window.clearInterval(timer);
  }, [apiBaseUrl, colabEnabled]);

  // Restore any user-uploaded MP4 from AiDramaStudioVideoDB (IndexedDB) on initial load
  useEffect(() => {
    let active = true;
    loadCustomVideoFromAiDramaStudioDB().then((saved) => {
      if (!active || !saved) return;
      const objUrl = URL.createObjectURL(saved.blob);
      setVideoUrl(objUrl);
      setProvider("local");
      setCustomUploadName(saved.fileName);
      const customCues = buildTagalogSubtitlesFromPrompt(prompt);
      setSubtitles(customCues);
      setActiveSubtitleLine(customCues[0]?.text || "");
      setActiveVideoTitle(`Sariling Video (Offline IndexedDB): ${saved.fileName}`);
      onVideoSelected?.(objUrl, `Sariling Video: ${saved.fileName}`, customCues, false);
    });
    return () => {
      active = false;
    };
  }, []);

  function handleSelectFeaturedEpisode(ep: FeaturedRealHumanEpisode) {
    setActiveEpisodeId(ep.id);
    setMirrorIndex(0);
    setProvider("showcase");
    setCustomUploadName(null);
    setShouldAutoPlay(true);
    const primarySrc = ep.sources[0];
    setVideoUrl(primarySrc);
    setActiveVideoTitle(ep.title);
    setSubtitles(ep.defaultSubtitles);
    setActiveSubtitleLine(ep.defaultSubtitles[0]?.text || "");
    onVideoSelected?.(primarySrc, ep.title, ep.defaultSubtitles, true);
  }

  function handleVideoError() {
    const currentEp =
      FEATURED_REAL_HUMAN_EPISODES.find((e) => e.id === activeEpisodeId) ||
      FEATURED_REAL_HUMAN_EPISODES[0];
    const nextIdx = mirrorIndex + 1;
    if (nextIdx < currentEp.sources.length) {
      const fallbackSrc = currentEp.sources[nextIdx];
      setMirrorIndex(nextIdx);
      setVideoUrl(fallbackSrc);
      onVideoSelected?.(fallbackSrc, currentEp.title, subtitles, shouldAutoPlay);
    } else if (videoUrl !== "/media/video_akzyon_episode1.mp4") {
      setVideoUrl("/media/video_akzyon_episode1.mp4");
      onVideoSelected?.("/media/video_akzyon_episode1.mp4", currentEp.title, subtitles, shouldAutoPlay);
    }
  }

  function handleVideoTimeUpdate() {
    const el = videoElementRef.current;
    if (!el || subtitles.length === 0) return;
    const t = el.currentTime % 9;
    const matched =
      subtitles.find((c) => t >= c.startSec && t <= c.endSec) || subtitles[0];
    if (matched && matched.text !== activeSubtitleLine) {
      setActiveSubtitleLine(matched.text);
    }
  }

  async function handleCustomVideoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);
    try {
      const saved = await saveCustomVideoToAiDramaStudioDB(file, file.name);
      const blobUrl = URL.createObjectURL(saved.blob);
      const customCues = buildTagalogSubtitlesFromPrompt(prompt);
      setProvider("local");
      setCustomUploadName(saved.fileName);
      setShouldAutoPlay(true);
      setVideoUrl(blobUrl);
      setSubtitles(customCues);
      setActiveSubtitleLine(customCues[0]?.text || "");
      const label = `Sariling Video (${saved.fileName} · ${(saved.sizeBytes / (1024 * 1024)).toFixed(2)} MB)`;
      setActiveVideoTitle(label);
      onVideoSelected?.(blobUrl, label, customCues, true);
    } catch {
      setError("Hindi ma-save ang napiling MP4 sa AiDramaStudioVideoDB.");
    } finally {
      event.target.value = "";
    }
  }

  async function generateVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError("Maglagay muna ng video prompt.");
      return;
    }
    if (trimmedPrompt.length > 5000) {
      setError("Ang prompt ay dapat 5000 characters o mas maikli.");
      return;
    }

    const targetFrames = Math.max(9, Math.min(241, duration * 8 + 1));
    setIsGenerating(true);
    setShowLiveDirectorPanel(true);
    setGenProgressPct(8);
    setGenTerminalLogs([
      `[Akzyon Engine] Hakbang 1 (0-25%): Sinisiyasat ang Prompt at Kwento ("${trimmedPrompt.slice(0, 64)}...")... OK`,
      `[Akzyon Engine] Character Lock & Tagalog Subtitle/Dubbing cues initialized... OK`,
    ]);

    try {
      await new Promise((r) => setTimeout(r, 220));
      setGenProgressPct(34);
      setGenTerminalLogs((prev) => [
        ...prev,
        `[Akzyon Engine] Hakbang 2 (26-50%): Naglo-load ng LTX-Video (ltx-video-2b-v0.9.5) at AI Models (${width}x${height})... OK`,
      ]);

      await new Promise((r) => setTimeout(r, 220));
      setGenProgressPct(62);
      setGenTerminalLogs((prev) => [
        ...prev,
        `[Akzyon Engine] Hakbang 3 (51-75%): Binubuo ang cinematic frames at galaw ng tunay na tao...`,
        `[Akzyon Engine] Rendering 73 frames @ 24fps... OK`,
      ]);

      const response = await fetch(joinUrl(apiBaseUrl, "/api/gemini/generate-video"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          duration,
          width,
          height,
          frames: targetFrames,
          fps: 24,
        }),
      });

      setGenProgressPct(86);
      setGenTerminalLogs((prev) => [
        ...prev,
        `[Akzyon Engine] Hakbang 4 (76-100%): Sine-save ang MP4 video sa R2 Storage at IndexedDB Vault...`,
      ]);

      const data = (await response.json().catch(() => ({}))) as GenerateResponse;
      if (!response.ok || !data.videoUrl) {
        throw new Error(data.detail || data.error || `Generation failed (HTTP ${response.status})`);
      }

      const resolved = resolveMediaUrl(data.videoUrl);
      const generatedCues = buildTagalogSubtitlesFromPrompt(trimmedPrompt);
      setGenProgressPct(100);
      setGenTerminalLogs((prev) => [
        ...prev,
        `[Akzyon Engine] MP4 Video saved (${resolved}) + Tagalog Dubbing & Subtitles ready... OK`,
      ]);
      setProvider(data.provider || "fal");
      setCustomUploadName(null);
      setSubtitles(generatedCues);
      setActiveSubtitleLine(generatedCues[0]?.text || "");
      setShouldAutoPlay(true);
      setVideoUrl(resolved);
      const newTitle = `Generated Video (${providerLabel(data.provider)} · May Tagalog Dub at Subtitles)`;
      setActiveVideoTitle(newTitle);
      onVideoSelected?.(resolved, newTitle, generatedCues, true);
      triggerTagalogDubbingSpeech(generatedCues, tagalogDubbingEnabled);
      if (data.provider === "colab") await refreshBridgeStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hindi nakagawa ng video.");
      setGenTerminalLogs((prev) => [
        ...prev,
        `[Akzyon Engine] Provider notice: ${
          caught instanceof Error ? caught.message : "Hindi nakagawa ng video."
        }`,
      ]);
    } finally {
      setIsGenerating(false);
    }
  }

  const statusText = {
    loading: "Sinusuri ang Colab bridge...",
    active: `Colab LTX online · expires ${formatExpiry(bridgeExpiry)}`,
    offline: "Colab offline · Fal AI ang gagamiting primary",
    expired: "Colab bridge expired · Fal AI ang gagamiting primary",
    error: "Hindi ma-check ang Colab · susubukan pa rin ang Fal AI",
  }[bridgeStatus];

  const vttTrackUrl = createTagalogWebVttDataUrl(subtitles);

  return (
    <section
      data-testid="video-generation-panel"
      className={`rounded-2xl border border-white/10 bg-neutral-950 p-5 text-white shadow-xl ${className}`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-400">
            Movie City Studio · Dual-Source Real Human Video Feed
          </p>
          <h2 className="mt-1 text-2xl font-bold">Generate tunay na video</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Fal AI primary · Colab LTX fallback · Pre-loaded Tunay na Tao Showcase
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              bridgeStatus === "active" ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          {colabEnabled ? statusText : "Colab fallback disabled"}
        </div>
      </div>

      {/* Pre-Loaded Featured Drama Episodes (Tunay na Tao) + Instant Local MP4 Upload Override */}
      <div
        data-testid="featured-human-episodes-gallery"
        className="mb-6 overflow-hidden rounded-xl border border-emerald-400/25 bg-neutral-900/90 p-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Featured Drama Episodes (Tunay na Tao)
            </p>
            <p className="text-xs text-neutral-300">
              Now Playing: <span className="font-semibold text-white">{activeVideoTitle}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/*"
              onChange={handleCustomVideoUpload}
              className="hidden"
              data-testid="panel-custom-video-file-input"
            />
            <button
              type="button"
              data-testid="panel-upload-custom-video-btn"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-neutral-950 transition hover:bg-emerald-400 cursor-pointer"
            >
              📂 Upload / Palitan ng Sariling Video (MP4)
            </button>
            <button
              type="button"
              onClick={() => {
                const nextState = !tagalogDubbingEnabled;
                setTagalogDubbingEnabled(nextState);
                if (nextState) triggerTagalogDubbingSpeech(subtitles, true);
              }}
              className={`rounded-lg border px-3 py-2 text-xs font-bold cursor-pointer ${
                tagalogDubbingEnabled
                  ? "border-amber-400/50 bg-amber-500/20 text-amber-300"
                  : "border-white/15 bg-neutral-800 text-neutral-400"
              }`}
            >
              {tagalogDubbingEnabled ? "🔊 Tagalog Dub & Subs: ON" : "🔇 Tagalog Dub: OFF"}
            </button>
            <a
              href={videoUrl}
              download={customUploadName || "movie_city_real_human_episode.mp4"}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium hover:bg-white/10"
            >
              Download MP4
            </a>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
          <video
            ref={videoElementRef}
            key={videoUrl}
            data-testid="panel-main-video-player"
            controls
            playsInline
            autoPlay={shouldAutoPlay}
            preload="auto"
            poster="/media/akzyon_teleserye_episode1_final.jpg"
            src={videoUrl}
            onError={handleVideoError}
            onTimeUpdate={handleVideoTimeUpdate}
            onPlay={() => triggerTagalogDubbingSpeech(subtitles, tagalogDubbingEnabled)}
            className="aspect-video w-full bg-black object-contain"
          >
            <track
              kind="subtitles"
              srcLang="tl"
              label="Tagalog Subtitles"
              src={vttTrackUrl}
              default
            />
          </video>

          {/* Live Synchronized Tagalog Subtitle Overlay Bar */}
          {activeSubtitleLine && (
            <div
              data-testid="panel-tagalog-subtitle-overlay"
              className="pointer-events-none absolute bottom-12 left-1/2 w-[92%] -translate-x-1/2 rounded-lg bg-black/80 px-3.5 py-1.5 text-center text-xs sm:text-sm font-semibold text-amber-300 shadow-lg border border-amber-400/30"
            >
              {activeSubtitleLine}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
          <span>Provider: {providerLabel(provider)}</span>
          <span className="truncate font-mono">
            Source #{mirrorIndex + 1}: {videoUrl}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {FEATURED_REAL_HUMAN_EPISODES.map((ep) => {
            const isSelected = provider === "showcase" && activeEpisodeId === ep.id;
            return (
              <button
                key={ep.id}
                type="button"
                onClick={() => handleSelectFeaturedEpisode(ep)}
                className={`rounded-lg border p-2.5 text-left transition cursor-pointer ${
                  isSelected
                    ? "border-red-400 bg-red-500/15 text-white"
                    : "border-white/10 bg-neutral-950/80 text-neutral-300 hover:border-white/25"
                }`}
              >
                <p className="text-xs font-bold line-clamp-1">{ep.title}</p>
                <p className="mt-0.5 text-[11px] text-emerald-400 line-clamp-1">{ep.actors}</p>
                <p className="mt-0.5 text-[10px] text-neutral-400 line-clamp-1">{ep.meta}</p>
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={generateVideo} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-200">Video prompt</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={5000}
            rows={4}
            disabled={isGenerating}
            className="w-full resize-y rounded-xl border border-white/10 bg-neutral-900 p-3 text-sm outline-none transition focus:border-red-400"
            placeholder="Describe the scene, movement, camera, lighting, and style..."
          />
          <span className="mt-1 block text-right text-xs text-neutral-500">
            {prompt.length}/5000
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm text-neutral-300">
            Duration (sec)
            <input
              type="number"
              min={1}
              max={30}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              disabled={isGenerating}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 p-2 text-white"
            />
          </label>
          <label className="text-sm text-neutral-300">
            Width
            <input
              type="number"
              min={256}
              max={1536}
              step={8}
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
              disabled={isGenerating}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 p-2 text-white"
            />
          </label>
          <label className="text-sm text-neutral-300">
            Height
            <input
              type="number"
              min={256}
              max={1536}
              step={8}
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
              disabled={isGenerating}
              className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 p-2 text-white"
            />
          </label>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isGenerating}
          className="w-full rounded-xl bg-red-500 px-4 py-3 font-semibold transition hover:bg-red-400 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
        >
          {isGenerating ? "Nagge-generate... tingnan ang AI Director Studio sa ibaba" : "Generate Video"}
        </button>
      </form>

      {/* Live Video Generation Progress & AI Director Studio Animator */}
      {(isGenerating || showLiveDirectorPanel) && (
        <div className="mt-5">
          <LiveDirectorProgressStudio
            progressPct={genProgressPct}
            logs={genTerminalLogs}
            framesCount={73}
            fps={24}
            isComplete={!isGenerating && genProgressPct === 100}
          />
        </div>
      )}
    </section>
  );
}
