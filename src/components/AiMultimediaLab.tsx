import React, { useState, useRef, useEffect } from 'react';
import {
  Brain,
  Image as ImageIcon,
  Film,
  Volume2,
  Mic,
  MicOff,
  Sparkles,
  Upload,
  Play,
  Download,
} from 'lucide-react';

type LabSubTab = 'intelligence' | 'images' | 'video' | 'voice';

const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'] as const;
const IMAGE_SIZES = ['1K', '2K', '4K'] as const;
const VIDEO_ASPECT_RATIOS = ['16:9', '9:16'] as const;
const TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({ base64, mimeType: file.type || 'application/octet-stream' });
    };
    reader.onerror = () => reject(new Error('Failed reading file'));
    reader.readAsDataURL(file);
  });
}

function pcmFloat32ToBase64(float32Array: Float32Array): string {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const AiMultimediaLab: React.FC = () => {
  const [subTab, setSubTab] = useState<LabSubTab>('intelligence');

  // 1. Intelligence / Video & Image Analysis / High-Thinking State
  const [intelMode, setIntelMode] = useState<
    'high-thinking' | 'video-analysis' | 'image-analysis' | 'fast-flash'
  >('high-thinking');
  const [intelPrompt, setIntelPrompt] = useState<string>(
    'Analyze our 24-segment FFmpeg parallel render pipeline: how should we tune keyframe intervals (-g), NVENC lookahead, and concat demuxer timestamps to prevent audio drift across 24 segments?'
  );
  const [fastModelSpeed, setFastModelSpeed] = useState<'flash' | 'lite'>('flash');
  const [analysisFile, setAnalysisFile] = useState<File | null>(null);
  const [useRenderedFinalVideo, setUseRenderedFinalVideo] = useState<boolean>(true);
  const [intelLoading, setIntelLoading] = useState<boolean>(false);
  const [intelResult, setIntelResult] = useState<string>('');
  const [intelModelUsed, setIntelModelUsed] = useState<string>('');
  const [intelError, setIntelError] = useState<string | null>(null);

  // Gemini Model Registry & Status State
  const [modelCheckStatus, setModelCheckStatus] = useState<string>('Naka-konekta');
  const [availableModels, setAvailableModels] = useState<string[]>([
    'gemini-3.8-flash',
    'gemini-4-argon',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-image',
    'gemini-nano-banana-2.1',
    'gemini-omni-1.1-flash',
  ]);
  const [modelCheckWarning, setModelCheckWarning] = useState<string | null>(null);

  // 2. Image Generation & Editing State
  const [imgPrompt, setImgPrompt] = useState<string>(
    'Cinematic wide shot of a futuristic Manila film post-production grading suite with a 24-node liquid-cooled GPU render rack, warm tungsten rim light, 8k realism'
  );
  const [imgModel, setImgModel] = useState<'gemini-nano-banana-2.1' | 'gemini-3-pro-image'>(
    'gemini-nano-banana-2.1'
  );
  const [imgAspectRatio, setImgAspectRatio] =
    useState<(typeof ASPECT_RATIOS)[number]>('16:9');
  const [imgSize, setImgSize] = useState<(typeof IMAGE_SIZES)[number]>('1K');
  const [editSourceFile, setEditSourceFile] = useState<File | null>(null);
  const [imgLoading, setImgLoading] = useState<boolean>(false);
  const [generatedImgUrl, setGeneratedImgUrl] = useState<string | null>(
    '/media/image_clara_manila_noir.png'
  );
  const [imgError, setImgError] = useState<string | null>(null);

  // 3. Video Generation & Image-to-Video Animation State (gemini-omni-1.1-flash)
  const [vidMode, setVidMode] = useState<'text-to-video' | 'image-to-video'>('text-to-video');
  const [vidPrompt, setVidPrompt] = useState<string>(
    'Smooth dolly shot along a glowing 24-blade GPU server corridor with warm golden data pulses reflecting on dark brushed aluminum'
  );
  const [vidAspectRatio, setVidAspectRatio] =
    useState<(typeof VIDEO_ASPECT_RATIOS)[number]>('16:9');
  const [vidSourcePhoto, setVidSourcePhoto] = useState<File | null>(null);
  const [vidLoading, setVidLoading] = useState<boolean>(false);
  const [generatedVidUrl, setGeneratedVidUrl] = useState<string | null>(
    '/media/video_akzyon_episode1.mp4'
  );
  const [vidError, setVidError] = useState<string | null>(null);

  // 4. Voice TTS & Live API State
  const [ttsText, setTtsText] = useState<string>(
    'Prangkahan tayo, Tol! Kumpleto na ang bente-kwatro segments sa Marilag Output final dot MP4. Walang sablay ang render queue natin!'
  );
  const [ttsVoice, setTtsVoice] = useState<(typeof TTS_VOICES)[number]>('Kore');
  const [ttsStyle, setTtsStyle] = useState<string>(
    'Confident, warm Filipino action director announcing a completed film render'
  );
  const [ttsLoading, setTtsLoading] = useState<boolean>(false);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // Live API WebSocket State
  const [liveConnected, setLiveConnected] = useState<boolean>(false);
  const [liveStatus, setLiveStatus] = useState<string>('Disconnected');
  const [liveTextInput, setLiveTextInput] = useState<string>('');
  const [liveTranscripts, setLiveTranscripts] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, []);

  const handleRunIntelligence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intelPrompt.trim()) {
      setIntelError('Please enter a prompt or question first.');
      return;
    }

    setIntelLoading(true);
    setIntelError(null);

    try {
      if (intelMode === 'high-thinking') {
        const res = await fetch('/api/gemini/think', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: intelPrompt, contextMode: 'tol' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'High-thinking request failed');
        setIntelResult(data.text);
        setIntelModelUsed(`${data.model} (ThinkingLevel.HIGH)`);
      } else if (intelMode === 'fast-flash') {
        const res = await fetch('/api/gemini/fast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: intelPrompt, speedMode: fastModelSpeed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Fast assistant request failed');
        setIntelResult(data.text);
        setIntelModelUsed(data.model);
      } else if (intelMode === 'image-analysis') {
        if (!analysisFile) {
          throw new Error('Please upload an image file to analyze with gemini-4-argon.');
        }
        const { base64, mimeType } = await fileToBase64(analysisFile);
        const res = await fetch('/api/gemini/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64Data: base64,
            mimeType,
            prompt: intelPrompt,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Image analysis failed');
        setIntelResult(data.text);
        setIntelModelUsed(data.model);
      } else if (intelMode === 'video-analysis') {
        let payload: any = {
          prompt: intelPrompt,
          useRenderedOutput: useRenderedFinalVideo,
        };
        if (!useRenderedFinalVideo) {
          if (!analysisFile) {
            throw new Error(
              'Please upload a video file or select MarilagOutput/final.mp4.'
            );
          }
          const { base64, mimeType } = await fileToBase64(analysisFile);
          payload = {
            base64Data: base64,
            mimeType,
            prompt: intelPrompt,
            useRenderedOutput: false,
          };
        }
        const res = await fetch('/api/gemini/analyze-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Video analysis failed');
        setIntelResult(data.text);
        setIntelModelUsed(data.model);
      }
    } catch (err: any) {
      setIntelError(err.message || 'Request failed');
    } finally {
      setIntelLoading(false);
    }
  };

  const handleGenerateImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imgPrompt.trim()) {
      setImgError('Please enter an image description prompt.');
      return;
    }

    setImgLoading(true);
    setImgError(null);

    try {
      let referenceImageBase64: string | undefined;
      let referenceImageMimeType: string | undefined;

      if (editSourceFile) {
        const encoded = await fileToBase64(editSourceFile);
        referenceImageBase64 = encoded.base64;
        referenceImageMimeType = encoded.mimeType;
      }

      const res = await fetch('/api/gemini/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imgPrompt,
          modelChoice: imgModel,
          aspectRatio: imgAspectRatio,
          imageSize: imgSize,
          referenceImageBase64,
          referenceImageMimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image generation failed');
      setGeneratedImgUrl(data.imageUrl || data.url || data.mediaUrl);
    } catch (err: any) {
      setImgError(err.message || 'Image generation failed');
    } finally {
      setImgLoading(false);
    }
  };

  const handleGenerateVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vidPrompt.trim()) {
      setVidError('Please enter a video motion prompt.');
      return;
    }

    setVidLoading(true);
    setVidError(null);

    try {
      let inputImageBase64: string | undefined;
      let inputImageMimeType: string | undefined;

      if (vidMode === 'image-to-video') {
        if (!vidSourcePhoto) {
          throw new Error('Please upload a starting photo to animate into a video.');
        }
        const encoded = await fileToBase64(vidSourcePhoto);
        inputImageBase64 = encoded.base64;
        inputImageMimeType = encoded.mimeType;
      }

      const res = await fetch('/api/gemini/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: vidPrompt,
          aspectRatio: vidAspectRatio,
          inputImageBase64,
          inputImageMimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Video generation failed');
      setGeneratedVidUrl(data.videoUrl || data.url || data.mediaUrl);
    } catch (err: any) {
      setVidError(err.message || 'Video generation failed');
    } finally {
      setVidLoading(false);
    }
  };

  const handleGenerateTts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ttsText.trim()) {
      setTtsError('Please enter text to synthesize into speech.');
      return;
    }

    setTtsLoading(true);
    setTtsError(null);

    try {
      const res = await fetch('/api/gemini/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ttsText,
          voiceName: ttsVoice,
          stylePrompt: ttsStyle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'TTS failed');
      setTtsAudioUrl(data.audioUrl);
    } catch (err: any) {
      setTtsError(err.message || 'TTS generation failed');
    } finally {
      setTtsLoading(false);
    }
  };

  const playPcmChunk24k = (base64Pcm: string) => {
    if (!outputAudioCtxRef.current) {
      outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = outputAudioCtxRef.current;
    const binary = atob(base64Pcm);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;
  };

  const startLiveSession = async () => {
    try {
      setLiveStatus('Connecting to gemini-3.8-live...');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/live`);
      wsRef.current = ws;

      ws.onopen = async () => {
        setLiveConnected(true);
        setLiveStatus('Connected (gemini-3.8-live)');
        setLiveTranscripts((prev) => [
          ...prev,
          'Live Voice session connected. Speak into your mic or send a message below.',
        ]);

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaStreamRef.current = stream;
          const inputCtx = new AudioContext({ sampleRate: 16000 });
          inputAudioCtxRef.current = inputCtx;
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          source.connect(processor);
          processor.connect(inputCtx.destination);

          processor.onaudioprocess = (ev) => {
            if (ws.readyState === WebSocket.OPEN) {
              const b64 = pcmFloat32ToBase64(ev.inputBuffer.getChannelData(0));
              ws.send(JSON.stringify({ audio: b64 }));
            }
          };
        } catch {
          setLiveTranscripts((prev) => [
            ...prev,
            'Microphone permission unavailable; using text-to-voice live mode.',
          ]);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.audio) {
            playPcmChunk24k(msg.audio);
          }
          if (msg.text) {
            setLiveTranscripts((prev) => [...prev, `TOL: ${msg.text}`]);
          }
          if (msg.interrupted) {
            nextStartTimeRef.current = 0;
          }
          if (msg.error) {
            setLiveStatus(`Error: ${msg.error}`);
          }
        } catch {}
      };

      ws.onclose = () => {
        setLiveConnected(false);
        setLiveStatus('Disconnected');
      };
    } catch (err: any) {
      setLiveStatus(`Failed: ${err.message}`);
    }
  };

  const stopLiveSession = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    setLiveConnected(false);
    setLiveStatus('Disconnected');
  };

  const sendLiveTextMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveTextInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(JSON.stringify({ text: liveTextInput.trim() }));
    setLiveTranscripts((prev) => [...prev, `You: ${liveTextInput.trim()}`]);
    setLiveTextInput('');
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Marilag AI Post-Production Suite</span>
            <span aria-hidden="true">·</span>
            <span>Server-Side Gemini Models</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mt-1">
            Multimedia Generation, Video Analysis & Voice Studio
          </h1>
        </div>

        {/* Interactive Segmented Sub-Tab Controls */}
        <div
          role="tablist"
          aria-label="AI Studio Tools"
          className="flex flex-nowrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto shrink-0"
        >
          <button
            role="tab"
            aria-selected={subTab === 'intelligence'}
            onClick={() => setSubTab('intelligence')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'intelligence'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Analyze & High Thinking</span>
          </button>
          <button
            role="tab"
            aria-selected={subTab === 'images'}
            onClick={() => setSubTab('images')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'images'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Create & Edit Images</span>
          </button>
          <button
            role="tab"
            aria-selected={subTab === 'video'}
            onClick={() => setSubTab('video')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'video'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Omni Flash Video</span>
          </button>
          <button
            role="tab"
            aria-selected={subTab === 'voice'}
            onClick={() => setSubTab('voice')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'voice'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>TTS & Live Voice</span>
          </button>
        </div>
      </div>

      {/* Verified Available Gemini Models Banner (Requirement C.9) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-200">
            Katayuan ng Gemini API Key: <span className="text-emerald-400 font-mono">{modelCheckStatus}</span>
          </span>
          {availableModels.length > 0 && (
            <span className="text-[11px] text-slate-400 font-mono">
              Auto-fallback enabled para sa hindi existing na model
            </span>
          )}
        </div>
        {modelCheckWarning ? (
          <div role="alert" className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/70 rounded-lg p-2.5">
            {modelCheckWarning}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 font-mono break-words">
            Valid Models: {availableModels.slice(0, 12).join(', ')}
            {availableModels.length > 12 ? ` (+${availableModels.length - 12} pa)` : ''}
          </div>
        )}
      </div>

      {/* SUB-TAB 1: HIGH THINKING & VIDEO / IMAGE ANALYSIS */}
      {subTab === 'intelligence' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={handleRunIntelligence}
            className="lg:col-span-5 bg-slate-900/70 border border-slate-800 rounded-xl p-6 space-y-5"
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                01. Gemini Intelligence & Multimodal Inspector
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Deep reasoning with <code className="text-sky-400">gemini-4-argon</code>{' '}
                (ThinkingLevel.HIGH), video/photo inspection, and fast tasks with{' '}
                <code className="text-sky-400">gemini-3.8-flash</code> &{' '}
                <code className="text-sky-400">gemini-3.1-flash-lite</code>.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Select Task Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIntelMode('high-thinking')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                    intelMode === 'high-thinking'
                      ? 'bg-sky-500/15 border-sky-400 text-sky-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  High Thinking (Argon)
                </button>
                <button
                  type="button"
                  onClick={() => setIntelMode('video-analysis')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                    intelMode === 'video-analysis'
                      ? 'bg-sky-500/15 border-sky-400 text-sky-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  Analyze Video (Argon)
                </button>
                <button
                  type="button"
                  onClick={() => setIntelMode('image-analysis')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                    intelMode === 'image-analysis'
                      ? 'bg-sky-500/15 border-sky-400 text-sky-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  Analyze Image (Argon)
                </button>
                <button
                  type="button"
                  onClick={() => setIntelMode('fast-flash')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                    intelMode === 'fast-flash'
                      ? 'bg-sky-500/15 border-sky-400 text-sky-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  Fast / Lite Assistant
                </button>
              </div>
            </div>

            {intelMode === 'fast-flash' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="fast-speed-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Model Tier
                </label>
                <select
                  id="fast-speed-select"
                  value={fastModelSpeed}
                  onChange={(e) => setFastModelSpeed(e.target.value as 'flash' | 'lite')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                >
                  <option value="flash">gemini-3.8-flash (General Tasks)</option>
                  <option value="lite">gemini-3.1-flash-lite (Ultra-Low Latency)</option>
                </select>
              </div>
            )}

            {intelMode === 'video-analysis' && (
              <div className="space-y-3 p-3.5 bg-slate-950 border border-slate-800 rounded-lg">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useRenderedFinalVideo}
                    onChange={(e) => setUseRenderedFinalVideo(e.target.checked)}
                    className="accent-sky-400"
                  />
                  <span>
                    Inspect rendered{' '}
                    <code className="text-amber-400">MarilagOutput/final.mp4</code> directly
                  </span>
                </label>
                {!useRenderedFinalVideo && (
                  <div>
                    <label
                      htmlFor="video-upload-input"
                      className="block text-xs text-slate-400 mb-1"
                    >
                      Upload Video File (.mp4, .webm)
                    </label>
                    <input
                      id="video-upload-input"
                      type="file"
                      accept="video/*"
                      onChange={(e) => setAnalysisFile(e.target.files?.[0] || null)}
                      className="w-full text-xs text-slate-300"
                    />
                  </div>
                )}
              </div>
            )}

            {intelMode === 'image-analysis' && (
              <div className="space-y-2 p-3.5 bg-slate-950 border border-slate-800 rounded-lg">
                <label
                  htmlFor="image-analysis-upload"
                  className="block text-xs font-medium text-slate-300"
                >
                  Upload Photo or Frame to Analyze
                </label>
                <input
                  id="image-analysis-upload"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setAnalysisFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-300"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="intel-prompt-textarea"
                className="block text-xs font-medium text-slate-300"
              >
                Query / Analysis Prompt
              </label>
              <textarea
                id="intel-prompt-textarea"
                rows={4}
                value={intelPrompt}
                onChange={(e) => setIntelPrompt(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            {intelError && (
              <div role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded-lg p-3">
                {intelError}
              </div>
            )}

            <button
              type="submit"
              disabled={intelLoading}
              className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {intelLoading ? 'Running Gemini Analysis...' : 'Run Gemini Analysis'}
              </span>
            </button>
          </form>

          <div className="lg:col-span-7 bg-slate-900/70 border border-slate-800 rounded-xl p-6 min-h-[360px] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <h3 className="text-sm font-semibold text-slate-200">
                  Analysis & Reasoning Output
                </h3>
                <span className="text-xs font-mono text-slate-400">
                  {intelModelUsed || 'Ready'}
                </span>
              </div>
              {intelResult ? (
                <div className="prose prose-invert max-w-none text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {intelResult}
                </div>
              ) : (
                <div className="py-16 text-center text-sm text-slate-400">
                  Submit a query or select <code className="text-amber-400">MarilagOutput/final.mp4</code> to run deep video, image, or architectural analysis.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: CREATE & EDIT IMAGES */}
      {subTab === 'images' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={handleGenerateImage}
            className="lg:col-span-5 bg-slate-900/70 border border-slate-800 rounded-xl p-6 space-y-5"
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                02. Studio Image Creation & Editing
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Generate or edit storyboards and textures with{' '}
                <code className="text-sky-400">gemini-nano-banana-2.1</code> or{' '}
                <code className="text-sky-400">gemini-3-pro-image</code> across 8 aspect ratios
                and 1K/2K/4K resolutions.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="img-model-select"
                className="block text-xs font-medium text-slate-300"
              >
                Image Model
              </label>
              <select
                id="img-model-select"
                value={imgModel}
                onChange={(e) =>
                  setImgModel(
                    e.target.value as 'gemini-nano-banana-2.1' | 'gemini-3-pro-image'
                  )
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                <option value="gemini-nano-banana-2.1">
                  gemini-nano-banana-2.1 (Create & Edit Images)
                </option>
                <option value="gemini-3-pro-image">
                  gemini-3-pro-image (Studio-Quality 1K/2K/4K)
                </option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="img-aspect-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Aspect Ratio
                </label>
                <select
                  id="img-aspect-select"
                  value={imgAspectRatio}
                  onChange={(e) => setImgAspectRatio(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono"
                >
                  {ASPECT_RATIOS.map((ar) => (
                    <option key={ar} value={ar}>
                      {ar}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="img-size-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Resolution Size
                </label>
                <select
                  id="img-size-select"
                  value={imgSize}
                  onChange={(e) => setImgSize(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono"
                >
                  {IMAGE_SIZES.map((sz) => (
                    <option key={sz} value={sz}>
                      {sz}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="edit-reference-upload"
                className="block text-xs font-medium text-slate-300"
              >
                Optional Reference Image (for Image Editing)
              </label>
              <input
                id="edit-reference-upload"
                type="file"
                accept="image/*"
                onChange={(e) => setEditSourceFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-2"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="img-prompt-input"
                className="block text-xs font-medium text-slate-300"
              >
                Image Prompt
              </label>
              <textarea
                id="img-prompt-input"
                rows={3}
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
              />
            </div>

            {imgError && (
              <div role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded-lg p-3">
                {imgError}
              </div>
            )}

            <button
              type="submit"
              disabled={imgLoading}
              className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors"
            >
              {imgLoading
                ? 'Rendering Studio Image...'
                : editSourceFile
                ? 'Edit Uploaded Image'
                : 'Generate Studio Image'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-slate-900/70 border border-slate-800 rounded-xl p-6 min-h-[380px] flex flex-col items-center justify-center">
            {generatedImgUrl ? (
              <div className="w-full space-y-4">
                <img
                  src={generatedImgUrl}
                  alt="Generated studio output"
                  referrerPolicy="no-referrer"
                  className="w-full max-h-[460px] object-contain rounded-lg border border-slate-800 bg-slate-950"
                />
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>
                    {imgModel} · {imgAspectRatio} · {imgSize}
                  </span>
                  <a
                    href={generatedImgUrl}
                    download={`marilag_frame_${Date.now()}.png`}
                    className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 font-sans font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Image</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400 max-w-md">
                Configure aspect ratio (<code className="text-slate-300">1:1</code> to{' '}
                <code className="text-slate-300">21:9</code>) and resolution (
                <code className="text-slate-300">1K</code>,{' '}
                <code className="text-slate-300">2K</code>,{' '}
                <code className="text-slate-300">4K</code>) to generate or edit visual assets.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: OMNI FLASH VIDEO GENERATION & PHOTO ANIMATION */}
      {subTab === 'video' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={handleGenerateVideo}
            className="lg:col-span-5 bg-slate-900/70 border border-slate-800 rounded-xl p-6 space-y-5"
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                03. Omni Flash Video Generator & Animator
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Powered by <code className="text-sky-400">gemini-omni-1.1-flash</code> via the
                Interactions API. Generate videos from text or animate an uploaded photo in{' '}
                <code className="text-slate-300">16:9</code> or{' '}
                <code className="text-slate-300">9:16</code>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVidMode('text-to-video')}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  vidMode === 'text-to-video'
                    ? 'bg-sky-500/15 border-sky-400 text-sky-300'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                Generate Video from Text
              </button>
              <button
                type="button"
                onClick={() => setVidMode('image-to-video')}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  vidMode === 'image-to-video'
                    ? 'bg-sky-500/15 border-sky-400 text-sky-300'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                Animate Uploaded Photo
              </button>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="video-aspect-select"
                className="block text-xs font-medium text-slate-300"
              >
                Video Aspect Ratio
              </label>
              <select
                id="video-aspect-select"
                value={vidAspectRatio}
                onChange={(e) => setVidAspectRatio(e.target.value as '16:9' | '9:16')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono"
              >
                <option value="16:9">16:9 (Landscape Widescreen)</option>
                <option value="9:16">9:16 (Portrait Vertical)</option>
              </select>
            </div>

            {vidMode === 'image-to-video' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="animate-photo-upload"
                  className="block text-xs font-medium text-slate-300"
                >
                  Upload Starting Frame Photo
                </label>
                <input
                  id="animate-photo-upload"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setVidSourcePhoto(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-2"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="vid-prompt-textarea"
                className="block text-xs font-medium text-slate-300"
              >
                Motion / Scene Prompt
              </label>
              <textarea
                id="vid-prompt-textarea"
                rows={3}
                value={vidPrompt}
                onChange={(e) => setVidPrompt(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
              />
            </div>

            {vidError && (
              <div role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded-lg p-3">
                {vidError}
              </div>
            )}

            <button
              type="submit"
              disabled={vidLoading}
              className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors"
            >
              {vidLoading
                ? 'Generating Video with Omni Flash...'
                : vidMode === 'image-to-video'
                ? 'Animate Photo into Video'
                : 'Generate Video Clip'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-slate-900/70 border border-slate-800 rounded-xl p-6 min-h-[380px] flex flex-col items-center justify-center">
            {generatedVidUrl ? (
              <div className="w-full space-y-4">
                <video
                  src={generatedVidUrl}
                  controls
                  className="w-full max-h-[440px] rounded-lg border border-slate-800 bg-black"
                />
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>gemini-omni-1.1-flash · {vidAspectRatio}</span>
                  <a
                    href={generatedVidUrl}
                    download={`marilag_omni_${Date.now()}.mp4`}
                    className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 font-sans font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP4</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400 max-w-md">
                Generate a 720p video clip from text or upload an image frame to animate with{' '}
                <code className="text-sky-400">gemini-omni-1.1-flash</code>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: TTS & LIVE VOICE CONVERSATION */}
      {subTab === 'voice' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Gemini 3.8 Flash TTS */}
          <form
            onSubmit={handleGenerateTts}
            className="lg:col-span-6 bg-slate-900/70 border border-slate-800 rounded-xl p-6 space-y-5"
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                04A. Expressive Text-to-Speech (<code className="text-sky-400">gemini-3.8-flash-tts</code>)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Convert narration or screenplay lines into studio 24kHz WAV speech.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="tts-voice-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Voice Persona
                </label>
                <select
                  id="tts-voice-select"
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                >
                  {TTS_VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="tts-style-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Delivery Direction
                </label>
                <input
                  id="tts-style-input"
                  type="text"
                  value={ttsStyle}
                  onChange={(e) => setTtsStyle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="tts-text-input"
                className="block text-xs font-medium text-slate-300"
              >
                Speech Script
              </label>
              <textarea
                id="tts-text-input"
                rows={3}
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100"
              />
            </div>

            {ttsError && (
              <div role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded-lg p-3">
                {ttsError}
              </div>
            )}

            <button
              type="submit"
              disabled={ttsLoading}
              className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-lg transition-colors"
            >
              {ttsLoading ? 'Synthesizing Speech...' : 'Convert Text to Speech'}
            </button>

            {ttsAudioUrl && (
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
                <div className="text-xs text-slate-400 font-mono">
                  WAV Output (24kHz Mono · {ttsVoice})
                </div>
                <audio src={ttsAudioUrl} controls className="w-full" />
              </div>
            )}
          </form>

          {/* Right: Gemini 3.8 Live Real-Time Voice Conversation */}
          <div className="lg:col-span-6 bg-slate-900/70 border border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  04B. Real-Time Voice Conversation (<code className="text-sky-400">gemini-3.8-live</code>)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Low-latency bidirectional voice session with TOL via WebSocket Live API.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-300 shrink-0">
                {liveStatus}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {!liveConnected ? (
                <button
                  type="button"
                  onClick={startLiveSession}
                  className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <Mic className="w-4 h-4" />
                  <span>Start Live Voice Session</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopLiveSession}
                  className="px-4 py-2.5 bg-red-500 hover:bg-red-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <MicOff className="w-4 h-4" />
                  <span>End Live Session</span>
                </button>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 h-48 overflow-y-auto space-y-2 text-xs text-slate-300 font-mono">
              {liveTranscripts.length === 0 ? (
                <p className="text-slate-500">
                  Click &ldquo;Start Live Voice Session&rdquo; to talk in real time with TOL using gemini-3.8-live.
                </p>
              ) : (
                liveTranscripts.map((line, i) => <div key={i}>{line}</div>)
              )}
            </div>

            <form onSubmit={sendLiveTextMessage} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Send a live prompt to the active voice session..."
                value={liveTextInput}
                onChange={(e) => setLiveTextInput(e.target.value)}
                disabled={!liveConnected}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!liveConnected}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-slate-100 rounded-lg whitespace-nowrap shrink-0"
              >
                Send Live
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
