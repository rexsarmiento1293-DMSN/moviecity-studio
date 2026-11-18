import React, { useEffect, useState } from 'react';
import {
  Youtube,
  Search,
  Play,
  ThumbsUp,
  ListVideo,
  MessageSquare,
  CloudUpload,
  ShieldCheck,
  KeyRound,
  LogOut,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Smartphone,
  Plus,
  Trash2,
  Database,
} from 'lucide-react';
import {
  fetchYouTubeProxyWithRetry,
  generatePkcePair,
  SecureTokenVault,
  sanitizeYouTubeQuery,
  validateYouTubeResourceId,
  validateRegionCode,
} from '../utils/youtubeResilience';

export interface GalleryVideoForYouTube {
  baseName: string;
  title: string;
  fileName: string;
  thumbnailFileName: string;
  sizeBytes: number;
  durationSec: number;
}

interface YouTubeStudioHubProps {
  galleryVideos: GalleryVideoForYouTube[];
}

type YtSubTab = 'search' | 'playlists' | 'comments' | 'upload' | 'apkguide';

interface YouTubeConfigStatus {
  apiKeyConfigured: boolean;
  oauthClientConfigured: boolean;
  androidRestrictionConfigured: boolean;
  packageName: string;
  callbackUrl: string;
}

export const YouTubeStudioHub: React.FC<YouTubeStudioHubProps> = ({ galleryVideos }) => {
  const [subTab, setSubTab] = useState<YtSubTab>('search');

  // Server proxy configuration status
  const [configStatus, setConfigStatus] = useState<YouTubeConfigStatus>({
    apiKeyConfigured: false,
    oauthClientConfigured: false,
    androidRestrictionConfigured: false,
    packageName: 'com.marilag.renderstudio',
    callbackUrl: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/youtube/callback`,
  });

  // OAuth 2.0 PKCE State (Token stored in Android Keystore / WebCrypto AES-GCM Vault, NEVER localStorage)
  const [hasOAuthToken, setHasOAuthToken] = useState<boolean>(false);
  const [oauthChannelTitle, setOauthChannelTitle] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Common feedback banners
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [fromOfflineCache, setFromOfflineCache] = useState<boolean>(false);
  const [cachedAtTime, setCachedAtTime] = useState<string | undefined>(undefined);

  // 1. Search & Videos State
  const [searchQuery, setSearchQuery] = useState<string>('Manny Pacquiao highlights');
  const [searchType, setSearchType] = useState<'video' | 'channel' | 'playlist'>('video');
  const [regionCode, setRegionCode] = useState<string>('PH');
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchItems, setSearchItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');

  // 2. Playlists & Activities State
  const [channelIdFilter, setChannelIdFilter] = useState<string>('');
  const [playlistsLoading, setPlaylistsLoading] = useState<boolean>(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState<string>('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState<string>('');
  const [newPlaylistPrivacy, setNewPlaylistPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [playlistToDelete, setPlaylistToDelete] = useState<any | null>(null);

  // 3. Comments State
  const [commentVideoId, setCommentVideoId] = useState<string>('');
  const [commentsLoading, setCommentsLoading] = useState<boolean>(false);
  const [commentThreads, setCommentThreads] = useState<any[]>([]);
  const [newCommentText, setNewCommentText] = useState<string>('');
  const [postingComment, setPostingComment] = useState<boolean>(false);

  // 4. Upload Rendered Marilag Video to YouTube State
  const [selectedRenderBase, setSelectedRenderBase] = useState<string>('');
  const [ytUploadTitle, setYtUploadTitle] = useState<string>('');
  const [ytUploadDesc, setYtUploadDesc] = useState<string>(
    'Rendered in parallel via Marilag Render Queue Studio (24-segment FFmpeg pipeline).'
  );
  const [ytUploadPrivacy, setYtUploadPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [attachCustomThumbnail, setAttachCustomThumbnail] = useState<boolean>(true);
  const [uploadingToYt, setUploadingToYt] = useState<boolean>(false);
  const [uploadedYtVideoId, setUploadedYtVideoId] = useState<string | null>(null);

  useEffect(() => {
    if (galleryVideos.length > 0 && !selectedRenderBase) {
      setSelectedRenderBase(galleryVideos[0]?.baseName ?? '');
      setYtUploadTitle(galleryVideos[0]?.title ?? 'Marilag Master Render');
    }
  }, [galleryVideos, selectedRenderBase]);

  // Check backend proxy config & existing Keystore token on mount
  useEffect(() => {
    let mounted = true;
    fetchYouTubeProxyWithRetry<YouTubeConfigStatus>('/api/youtube/status', {
      cacheKey: 'yt_status',
      maxRetries: 1,
    }).then((res) => {
      if (!mounted) return;
      if (res.ok && res.data) {
        setConfigStatus({
          apiKeyConfigured: Boolean(res.data?.apiKeyConfigured),
          oauthClientConfigured: Boolean(res.data?.oauthClientConfigured),
          androidRestrictionConfigured: Boolean(res.data?.androidRestrictionConfigured),
          packageName: res.data?.packageName ?? 'com.marilag.renderstudio',
          callbackUrl:
            res.data?.callbackUrl ?? `${window.location.origin}/auth/youtube/callback`,
        });
      }
    });

    SecureTokenVault.getToken('youtube_access_token').then((tok) => {
      if (mounted && tok) {
        setHasOAuthToken(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Listen for OAuth 2.0 PKCE popup callback message
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin || '';
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }

      if (event.data?.type === 'YOUTUBE_OAUTH_CODE' && event.data?.code) {
        setAuthLoading(true);
        setErrorBanner(null);
        try {
          const codeVerifier = await SecureTokenVault.getToken('pkce_code_verifier');
          if (!codeVerifier) {
            throw new Error('Nawala ang PKCE code_verifier. Pakisubukan muli ang pag-sign in.');
          }
          const redirectUri = `${window.location.origin}/auth/youtube/callback`;
          const tokenRes = await fetchYouTubeProxyWithRetry<{
            access_token?: string;
            expires_in?: number;
            channelTitle?: string;
          }>('/api/youtube/auth/token', {
            method: 'POST',
            body: {
              code: String(event.data.code),
              codeVerifier,
              redirectUri,
            },
            maxRetries: 1,
          });

          if (!tokenRes.ok || !tokenRes.data?.access_token) {
            throw new Error(
              tokenRes.error?.messageFilipino || 'Nabigo sa pagkuha ng OAuth 2.0 access token.'
            );
          }

          await SecureTokenVault.setToken(
            'youtube_access_token',
            tokenRes.data.access_token,
            Number(tokenRes.data?.expires_in ?? 3500)
          );
          await SecureTokenVault.clearToken('pkce_code_verifier');

          setHasOAuthToken(true);
          setOauthChannelTitle(tokenRes.data?.channelTitle ?? 'Authenticated YouTube User');
          setInfoBanner(
            'Konektado na sa YouTube OAuth 2.0 (PKCE)! Ang token ay naka-encrypt sa Android Keystore / WebCrypto Vault (hindi sa localStorage).'
          );
        } catch (err: any) {
          setErrorBanner(err?.message || 'Nabigo ang OAuth 2.0 PKCE authentication.');
        } finally {
          setAuthLoading(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleStartPkceOAuth = async () => {
    setErrorBanner(null);
    setInfoBanner(null);
    setAuthLoading(true);
    try {
      const pkce = await generatePkcePair();
      await SecureTokenVault.setToken('pkce_code_verifier', pkce.codeVerifier, 600);

      const redirectUri = `${window.location.origin}/auth/youtube/callback`;
      const params = new URLSearchParams({
        codeChallenge: pkce.codeChallenge,
        codeChallengeMethod: pkce.codeChallengeMethod,
        redirectUri,
      });

      const res = await fetchYouTubeProxyWithRetry<{ url?: string }>(
        `/api/youtube/auth/url?${params.toString()}`,
        { maxRetries: 1 }
      );

      if (!res.ok || !res.data?.url) {
        throw new Error(
          res.error?.messageFilipino ||
            'Hindi makuha ang OAuth URL. Siguraduhing naka-set ang YOUTUBE_OAUTH_CLIENT_ID sa .env.'
        );
      }

      // Open Google OAuth 2.0 authorization URL directly in popup
      const popup = window.open(
        res.data.url,
        'youtube_pkce_oauth',
        'width=580,height=680,noopener=no'
      );
      if (!popup) {
        setErrorBanner(
          'Na-block ang popup window. Pakipayagan ang popups para makapag-sign in sa YouTube OAuth 2.0.'
        );
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Nabigo sa pagsisimula ng OAuth 2.0 PKCE.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDisconnectOAuth = async () => {
    await SecureTokenVault.clearToken('youtube_access_token');
    await SecureTokenVault.clearToken('pkce_code_verifier');
    setHasOAuthToken(false);
    setOauthChannelTitle('');
    setInfoBanner('Na-clear na ang OAuth token mula sa Secure Keystore Vault.');
  };

  // 1. Search & Video Categories Handler
  const handleRunSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorBanner(null);
    setInfoBanner(null);

    const cleanQ = sanitizeYouTubeQuery(searchQuery);
    const cleanRegion = validateRegionCode(regionCode);
    if (!cleanQ) {
      setErrorBanner('Maglagay ng hinahanap na keyword sa search box.');
      return;
    }

    setSearchLoading(true);
    try {
      const qs = new URLSearchParams({
        q: cleanQ,
        type: searchType,
        regionCode: cleanRegion,
        maxResults: '9',
      });
      const res = await fetchYouTubeProxyWithRetry<{ items?: any[]; categories?: any[] }>(
        `/api/youtube/search?${qs.toString()}`,
        {
          cacheKey: `yt_search_${searchType}_${cleanRegion}_${cleanQ}`,
        }
      );

      setFromOfflineCache(res.fromOfflineCache);
      setCachedAtTime(res.cachedAt);

      if (!res.ok) {
        setErrorBanner(
          res.error?.messageFilipino || 'Hindi makuha ang resulta mula sa YouTube Data API v3.'
        );
        setSearchItems([]);
        return;
      }

      const safeItems = Array.isArray(res.data?.items) ? res.data.items : [];
      setSearchItems(safeItems);
      if (Array.isArray(res.data?.categories)) {
        setCategories(res.data.categories);
      }
      if (res.fromOfflineCache && res.error) {
        setInfoBanner(res.error.messageFilipino);
      }
    } finally {
      setSearchLoading(false);
    }
  };

  const handleRateVideo = async (videoId: string, rating: 'like' | 'none') => {
    setErrorBanner(null);
    setInfoBanner(null);
    const idCheck = validateYouTubeResourceId(videoId);
    if (!idCheck.valid) {
      setErrorBanner(idCheck.errorFilipino || 'Invalid video ID');
      return;
    }
    const token = await SecureTokenVault.getToken('youtube_access_token');
    if (!token) {
      setErrorBanner(
        'Kailangan munang mag-sign in sa YouTube OAuth 2.0 (PKCE) bago mag-rate ng video (POST /videos/rate).'
      );
      return;
    }

    const res = await fetchYouTubeProxyWithRetry('/api/youtube/videos/rate', {
      method: 'POST',
      accessToken: token,
      body: { id: idCheck.sanitizedId, rating },
    });

    if (!res.ok) {
      setErrorBanner(res.error?.messageFilipino || 'Nabigo sa pag-rate ng video.');
      return;
    }
    setInfoBanner(`Matagumpay na na-update ang rating (${rating}) para sa video ${idCheck.sanitizedId}!`);
  };

  // 2. Playlists & Activities Handlers
  const handleFetchPlaylistsAndActivities = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorBanner(null);
    setInfoBanner(null);
    setPlaylistsLoading(true);

    try {
      const token = await SecureTokenVault.getToken('youtube_access_token');
      const cleanChannelId = channelIdFilter.trim();

      if (!token && !cleanChannelId) {
        setErrorBanner(
          'Mag-sign in sa OAuth 2.0 (PKCE) para makita ang sariling playlists, o maglagay ng public Channel ID (hal. UC...).'
        );
        setPlaylistsLoading(false);
        return;
      }

      if (cleanChannelId) {
        const check = validateYouTubeResourceId(cleanChannelId);
        if (!check.valid) {
          setErrorBanner(check.errorFilipino || 'Invalid Channel ID');
          setPlaylistsLoading(false);
          return;
        }
      }

      const qs = new URLSearchParams();
      if (cleanChannelId) qs.set('channelId', cleanChannelId);

      const [plRes, actRes] = await Promise.all([
        fetchYouTubeProxyWithRetry<{ items?: any[] }>(`/api/youtube/playlists?${qs.toString()}`, {
          accessToken: token,
          cacheKey: `yt_playlists_${cleanChannelId || 'mine'}`,
        }),
        fetchYouTubeProxyWithRetry<{ items?: any[] }>(`/api/youtube/activities?${qs.toString()}`, {
          accessToken: token,
          cacheKey: `yt_activities_${cleanChannelId || 'mine'}`,
        }),
      ]);

      setFromOfflineCache(plRes.fromOfflineCache || actRes.fromOfflineCache);
      setCachedAtTime(plRes.cachedAt || actRes.cachedAt);

      if (!plRes.ok) {
        setErrorBanner(plRes.error?.messageFilipino || 'Hindi ma-load ang playlists.');
      } else {
        setPlaylists(Array.isArray(plRes.data?.items) ? plRes.data.items : []);
      }

      if (actRes.ok) {
        setActivities(Array.isArray(actRes.data?.items) ? actRes.data.items : []);
      }
    } finally {
      setPlaylistsLoading(false);
    }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setInfoBanner(null);

    const title = sanitizeYouTubeQuery(newPlaylistTitle, 100);
    const description = sanitizeYouTubeQuery(newPlaylistDesc, 400);
    if (!title) {
      setErrorBanner('Maglagay ng pamagat (title) para sa bagong playlist.');
      return;
    }

    const token = await SecureTokenVault.getToken('youtube_access_token');
    if (!token) {
      setErrorBanner('Kailangan ng OAuth 2.0 (PKCE) token upang gumawa ng playlist.');
      return;
    }

    setPlaylistsLoading(true);
    try {
      const res = await fetchYouTubeProxyWithRetry<{ id?: string; snippet?: any }>(
        '/api/youtube/playlists',
        {
          method: 'POST',
          accessToken: token,
          body: {
            title,
            description,
            privacyStatus: newPlaylistPrivacy,
          },
        }
      );

      if (!res.ok) {
        setErrorBanner(res.error?.messageFilipino || 'Nabigo sa paggawa ng playlist.');
        return;
      }

      setNewPlaylistTitle('');
      setNewPlaylistDesc('');
      setInfoBanner(`Nagawa na ang playlist: '${res.data?.snippet?.title ?? title}'!`);
      await handleFetchPlaylistsAndActivities();
    } finally {
      setPlaylistsLoading(false);
    }
  };

  const handleConfirmDeletePlaylist = async () => {
    if (!playlistToDelete?.id) return;
    const token = await SecureTokenVault.getToken('youtube_access_token');
    if (!token) {
      setErrorBanner('Kailangan ng OAuth 2.0 token upang magbura ng playlist.');
      setPlaylistToDelete(null);
      return;
    }

    setPlaylistsLoading(true);
    try {
      const res = await fetchYouTubeProxyWithRetry(
        `/api/youtube/playlists?id=${encodeURIComponent(playlistToDelete.id)}`,
        {
          method: 'DELETE',
          accessToken: token,
        }
      );
      setPlaylistToDelete(null);
      if (!res.ok) {
        setErrorBanner(res.error?.messageFilipino || 'Nabigo sa pagbura ng playlist.');
        return;
      }
      setInfoBanner('Matagumpay na nabura ang playlist.');
      await handleFetchPlaylistsAndActivities();
    } finally {
      setPlaylistsLoading(false);
    }
  };

  // 3. Comments Handlers (commentThreads.list & commentThreads.insert)
  const handleLoadComments = async (e?: React.FormEvent, overrideVidId?: string) => {
    if (e) e.preventDefault();
    setErrorBanner(null);
    setInfoBanner(null);

    const targetId = overrideVidId ?? commentVideoId;
    const check = validateYouTubeResourceId(targetId);
    if (!check.valid) {
      setErrorBanner(check.errorFilipino || 'Maglagay ng valid na YouTube Video ID.');
      return;
    }

    setCommentsLoading(true);
    try {
      const res = await fetchYouTubeProxyWithRetry<{ items?: any[] }>(
        `/api/youtube/commentThreads?videoId=${encodeURIComponent(check.sanitizedId)}`,
        {
          cacheKey: `yt_comments_${check.sanitizedId}`,
        }
      );
      setFromOfflineCache(res.fromOfflineCache);
      setCachedAtTime(res.cachedAt);

      if (!res.ok) {
        setErrorBanner(res.error?.messageFilipino || 'Hindi ma-load ang mga komento.');
        setCommentThreads([]);
        return;
      }
      setCommentThreads(Array.isArray(res.data?.items) ? res.data.items : []);
    } finally {
      setCommentsLoading(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setInfoBanner(null);

    const check = validateYouTubeResourceId(commentVideoId);
    if (!check.valid) {
      setErrorBanner(check.errorFilipino || 'Maglagay ng valid na Video ID.');
      return;
    }

    const cleanComment = sanitizeYouTubeQuery(newCommentText, 500);
    if (!cleanComment) {
      setErrorBanner('Maglagay ng komento bago i-post.');
      return;
    }

    const token = await SecureTokenVault.getToken('youtube_access_token');
    if (!token) {
      setErrorBanner(
        'Kailangan munang mag-sign in sa YouTube OAuth 2.0 (PKCE) upang mag-post ng komento (POST /commentThreads).'
      );
      return;
    }

    setPostingComment(true);
    try {
      const res = await fetchYouTubeProxyWithRetry('/api/youtube/commentThreads', {
        method: 'POST',
        accessToken: token,
        body: {
          videoId: check.sanitizedId,
          textOriginal: cleanComment,
        },
      });

      if (!res.ok) {
        setErrorBanner(res.error?.messageFilipino || 'Nabigo sa pag-post ng komento.');
        return;
      }

      setNewCommentText('');
      setInfoBanner('Matagumpay na nai-post ang iyong komento sa YouTube!');
      await handleLoadComments(undefined, check.sanitizedId);
    } finally {
      setPostingComment(false);
    }
  };

  // 4. Upload Rendered Marilag Video to YouTube (POST /videos + POST /thumbnails/set)
  const handleUploadRenderedToYouTube = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setInfoBanner(null);
    setUploadedYtVideoId(null);

    if (!selectedRenderBase) {
      setErrorBanner('Pumili muna ng natapos na video mula sa MarilagOutput/.');
      return;
    }

    const token = await SecureTokenVault.getToken('youtube_access_token');
    if (!token) {
      setErrorBanner(
        'Kailangan ng OAuth 2.0 (PKCE) authorization para mag-upload ng video sa YouTube (POST /videos & POST /thumbnails/set).'
      );
      return;
    }

    const cleanTitle = sanitizeYouTubeQuery(ytUploadTitle || selectedRenderBase, 100);
    const cleanDesc = sanitizeYouTubeQuery(ytUploadDesc, 1000);

    setUploadingToYt(true);
    try {
      const res = await fetchYouTubeProxyWithRetry<{
        videoId?: string;
        thumbnailUpdated?: boolean;
        watchUrl?: string;
      }>('/api/youtube/upload-rendered', {
        method: 'POST',
        accessToken: token,
        timeoutMs: 120000,
        maxRetries: 1,
        body: {
          baseName: selectedRenderBase,
          title: cleanTitle,
          description: cleanDesc,
          privacyStatus: ytUploadPrivacy,
          setCustomThumbnail: attachCustomThumbnail,
        },
      });

      if (!res.ok || !res.data?.videoId) {
        setErrorBanner(
          res.error?.messageFilipino || 'Nabigo sa pag-upload ng video sa YouTube.'
        );
        return;
      }

      setUploadedYtVideoId(res.data.videoId);
      setInfoBanner(
        `Matagumpay na na-upload sa YouTube (ID: ${res.data.videoId})${
          res.data.thumbnailUpdated ? ' kasama ang custom thumbnail (_final.jpg)!' : '!'
        }`
      );
    } finally {
      setUploadingToYt(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Security & OAuth 2.0 PKCE Status Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 bg-red-600/20 text-red-400 border border-red-700/60 px-2.5 py-0.5 rounded-md font-bold">
              <Youtube className="w-3.5 h-3.5" />
              YouTube Data API v3 Proxy
            </span>
            <span className="inline-flex items-center gap-1 bg-emerald-950/80 text-emerald-300 border border-emerald-800 px-2.5 py-0.5 rounded-md font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              PKCE S256 + Keystore Vault
            </span>
            {fromOfflineCache && (
              <span className="inline-flex items-center gap-1 bg-amber-950/80 text-amber-300 border border-amber-800 px-2.5 py-0.5 rounded-md font-mono">
                <Database className="w-3.5 h-3.5" />
                Offline Cache ({cachedAtTime ? new Date(cachedAtTime).toLocaleTimeString() : 'Saved'})
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-white">
            YouTube Data API v3 Studio & Android APK Center
          </h1>
          <p className="text-xs text-slate-400">
            Lahat ng requests ay dumadaan sa server-side HTTPS proxy (<code className="text-amber-300">/api/youtube/*</code>) — walang API key sa APK.
          </p>
        </div>

        {/* OAuth 2.0 PKCE Connect / Disconnect Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {hasOAuthToken ? (
            <>
              <span className="text-xs text-emerald-300 font-medium bg-emerald-950/50 border border-emerald-800 px-3 py-2 rounded-xl">
                OAuth PKCE: <strong>{oauthChannelTitle || 'Active in Keystore'}</strong>
              </span>
              <button
                type="button"
                onClick={handleDisconnectOAuth}
                className="min-h-[44px] px-4 py-2 bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-200 text-xs font-bold rounded-xl flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>Disconnect OAuth</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleStartPkceOAuth}
              disabled={authLoading}
              className="min-h-[44px] px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-lg"
            >
              <KeyRound className="w-4 h-4" />
              <span>
                {authLoading ? 'Kumokonekta (PKCE)...' : 'Connect YouTube OAuth 2.0 (PKCE)'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-Navigation Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSubTab('search')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
            subTab === 'search'
              ? 'bg-red-600 text-white'
              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search & Videos</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('playlists')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
            subTab === 'playlists'
              ? 'bg-red-600 text-white'
              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          <ListVideo className="w-3.5 h-3.5" />
          <span>Playlists & Activities</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('comments')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
            subTab === 'comments'
              ? 'bg-red-600 text-white'
              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Comments Thread</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('upload')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
            subTab === 'upload'
              ? 'bg-red-600 text-white'
              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          <CloudUpload className="w-3.5 h-3.5" />
          <span>Upload Render to YouTube</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('apkguide')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
            subTab === 'apkguide'
              ? 'bg-emerald-600 text-slate-950'
              : 'bg-slate-900 text-emerald-400 hover:text-emerald-300 border border-emerald-800/60'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>APK Build & Security Checklist</span>
        </button>
      </div>

      {/* Global Error / Info Feedback for YouTube Studio */}
      {errorBanner && (
        <div
          role="alert"
          className="bg-red-950/70 border border-red-700 text-red-200 rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">{errorBanner}</div>
        </div>
      )}

      {infoBanner && (
        <div className="bg-emerald-950/60 border border-emerald-700 text-emerald-200 rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">{infoBanner}</div>
        </div>
      )}

      {/* ==================== SUB-TAB 1: SEARCH & VIDEOS ==================== */}
      {subTab === 'search' && (
        <div className="space-y-6">
          <form
            onSubmit={handleRunSearch}
            className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row gap-3"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Maghanap sa YouTube (GET /youtube/v3/search)..."
                className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2 text-sm text-white"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Resource Type"
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as any)}
                className="min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
              >
                <option value="video">Videos</option>
                <option value="channel">Channels</option>
                <option value="playlist">Playlists</option>
              </select>
              <input
                type="text"
                aria-label="Region Code"
                maxLength={2}
                value={regionCode}
                onChange={(e) => setRegionCode(e.target.value.toUpperCase())}
                placeholder="PH"
                className="w-16 min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-center text-white font-mono"
              />
              <button
                type="submit"
                disabled={searchLoading}
                className="min-h-[44px] px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                <span>{searchLoading ? 'Hinahanap...' : 'Maghanap'}</span>
              </button>
            </div>
          </form>

          {selectedVideoId && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-white font-mono">
                  Playing YouTube Video ID: {selectedVideoId}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedVideoId('')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg"
                >
                  Isara ang Player
                </button>
              </div>
              <div className="aspect-video bg-black">
                <iframe
                  title={`YouTube Player ${selectedVideoId}`}
                  src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(selectedVideoId)}`}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {searchLoading ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-10 text-center text-sm text-slate-400">
              Nilo-load ang resulta mula sa YouTube Data API v3 proxy...
            </div>
          ) : searchItems.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
              <Youtube className="w-10 h-10 text-red-500 mx-auto" />
              <h3 className="text-base font-bold text-white">
                Walang Resulta o Hindi Pa Naghahanap
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Maglagay ng keyword sa itaas at pindutin ang <strong>Maghanap</strong> upang
                mag-query sa <code className="text-amber-300">GET /youtube/v3/search</code>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchItems.map((item, idx) => {
                const videoId = item?.id?.videoId ?? (typeof item?.id === 'string' ? item.id : '');
                const channelId = item?.id?.channelId ?? item?.snippet?.channelId ?? '';
                const playlistId = item?.id?.playlistId ?? '';
                const title = item?.snippet?.title ?? 'Untitled YouTube Resource';
                const channelTitle = item?.snippet?.channelTitle ?? 'Unknown Channel';
                const thumbUrl =
                  item?.snippet?.thumbnails?.high?.url ??
                  item?.snippet?.thumbnails?.medium?.url ??
                  item?.snippet?.thumbnails?.default?.url ??
                  '';

                return (
                  <div
                    key={videoId || playlistId || channelId || idx}
                    className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <div className="aspect-video bg-slate-950 relative overflow-hidden">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                            No Thumbnail
                          </div>
                        )}
                      </div>
                      <div className="p-4 space-y-1.5">
                        <span className="text-[11px] font-mono text-red-400 block truncate">
                          {channelTitle}
                        </span>
                        <h3 className="text-sm font-bold text-white line-clamp-2">{title}</h3>
                      </div>
                    </div>

                    <div className="p-4 pt-0 flex flex-wrap items-center gap-2">
                      {videoId && (
                        <>
                          <button
                            type="button"
                            onClick={() => setSelectedVideoId(videoId)}
                            className="flex-1 min-h-[40px] px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRateVideo(videoId, 'like')}
                            className="min-h-[40px] px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-1"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                            <span>Like</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCommentVideoId(videoId);
                              setSubTab('comments');
                              handleLoadComments(undefined, videoId);
                            }}
                            className="min-h-[40px] px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-1"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Comments</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {categories.length > 0 && (
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 space-y-2">
              <span className="text-xs font-bold text-slate-300">
                YouTube Video Categories ({regionCode}):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {categories.slice(0, 14).map((cat) => (
                  <span
                    key={cat?.id}
                    className="text-[11px] bg-slate-950 border border-slate-800 text-slate-300 px-2.5 py-1 rounded-lg font-mono"
                  >
                    #{cat?.id}: {cat?.snippet?.title ?? 'Category'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== SUB-TAB 2: PLAYLISTS & ACTIVITIES ==================== */}
      {subTab === 'playlists' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-5">
            <form
              onSubmit={handleFetchPlaylistsAndActivities}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4"
            >
              <h2 className="text-base font-bold text-white">
                Kunin ang Playlists & Channel Activities
              </h2>
              <div className="space-y-1.5">
                <label
                  htmlFor="yt-channel-id-input"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Channel ID (Opsyonal kung naka-OAuth Sign In)
                </label>
                <input
                  id="yt-channel-id-input"
                  type="text"
                  value={channelIdFilter}
                  onChange={(e) => setChannelIdFilter(e.target.value)}
                  placeholder="hal. UC_x5XG1OV2P6uZZ5FSM9Ttw"
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={playlistsLoading}
                className="w-full min-h-[44px] px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>
                  {playlistsLoading ? 'Nilo-load...' : 'I-load ang Playlists at Activities'}
                </span>
              </button>
            </form>

            <form
              onSubmit={handleCreatePlaylist}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4"
            >
              <h2 className="text-base font-bold text-white">
                Gumawa ng Bagong Playlist (POST /playlists)
              </h2>
              <div className="space-y-1.5">
                <label
                  htmlFor="new-playlist-title"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Pamagat ng Playlist
                </label>
                <input
                  id="new-playlist-title"
                  type="text"
                  value={newPlaylistTitle}
                  onChange={(e) => setNewPlaylistTitle(e.target.value)}
                  placeholder="Marilag 4K Renders"
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="new-playlist-desc"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Deskripsyon
                </label>
                <input
                  id="new-playlist-desc"
                  type="text"
                  value={newPlaylistDesc}
                  onChange={(e) => setNewPlaylistDesc(e.target.value)}
                  placeholder="Mga natapos na video mula sa Marilag Studio"
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="new-playlist-privacy"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Privacy Status
                </label>
                <select
                  id="new-playlist-privacy"
                  value={newPlaylistPrivacy}
                  onChange={(e) => setNewPlaylistPrivacy(e.target.value as any)}
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white"
                >
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={playlistsLoading}
                className="w-full min-h-[44px] px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Gumawa ng Playlist</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 space-y-5">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white">
                Mga Playlist ({playlists.length})
              </h3>
              {playlists.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Walang naka-load na playlist. Mag-sign in sa OAuth o maglagay ng Channel ID.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {playlists.map((pl, i) => (
                    <div
                      key={pl?.id ?? i}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">
                          {pl?.snippet?.title ?? 'Untitled Playlist'}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          ID: {pl?.id} · {pl?.contentDetails?.itemCount ?? 0} videos
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Burahin ang playlist"
                        onClick={() => setPlaylistToDelete(pl)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-slate-900 hover:bg-red-950 text-red-400 rounded-xl"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white">
                Channel Activities (GET /activities · {activities.length})
              </h3>
              {activities.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Walang nakitang recent channel activity events.
                </p>
              ) : (
                <div className="space-y-2">
                  {activities.slice(0, 8).map((act, idx) => (
                    <div
                      key={act?.id ?? idx}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-slate-400 font-mono">
                        <span className="uppercase text-emerald-400">
                          {act?.snippet?.type ?? 'activity'}
                        </span>
                        <span>
                          {act?.snippet?.publishedAt
                            ? new Date(act.snippet.publishedAt).toLocaleDateString()
                            : ''}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-100">
                        {act?.snippet?.title ?? 'Channel Activity'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 3: COMMENTS ==================== */}
      {subTab === 'comments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-5">
            <form
              onSubmit={(e) => handleLoadComments(e)}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4"
            >
              <h2 className="text-base font-bold text-white">
                Kunin ang Comments (GET /commentThreads)
              </h2>
              <div className="space-y-1.5">
                <label
                  htmlFor="comment-video-id"
                  className="block text-xs font-semibold text-slate-300"
                >
                  YouTube Video ID
                </label>
                <input
                  id="comment-video-id"
                  type="text"
                  value={commentVideoId}
                  onChange={(e) => setCommentVideoId(e.target.value)}
                  placeholder="hal. dQw4w9WgXcQ"
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={commentsLoading}
                className="w-full min-h-[44px] px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl"
              >
                {commentsLoading ? 'Nilo-load ang Komento...' : 'I-load ang Comment Threads'}
              </button>
            </form>

            <form
              onSubmit={handlePostComment}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4"
            >
              <h2 className="text-base font-bold text-white">
                Mag-post ng Top-Level Comment (POST /commentThreads)
              </h2>
              <textarea
                rows={3}
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="Isulat ang iyong komento..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white"
              />
              <button
                type="submit"
                disabled={postingComment}
                className="w-full min-h-[44px] px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl"
              >
                {postingComment ? 'Pino-post...' : 'I-post ang Komento (OAuth PKCE)'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">
              Mga Komento ({commentThreads.length})
            </h3>
            {commentsLoading ? (
              <p className="text-xs text-slate-400">Nilo-load ang mga komento...</p>
            ) : commentThreads.length === 0 ? (
              <p className="text-xs text-slate-400">
                Walang nakitang komento. Maglagay ng Video ID sa kaliwa upang tingnan ang comment threads.
              </p>
            ) : (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {commentThreads.map((thread, idx) => {
                  const topComment = thread?.snippet?.topLevelComment?.snippet;
                  return (
                    <div
                      key={thread?.id ?? idx}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <strong className="text-slate-200">
                          {topComment?.authorDisplayName ?? 'YouTube User'}
                        </strong>
                        <span className="text-[11px] text-slate-500 font-mono">
                          👍 {topComment?.likeCount ?? 0}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed break-words">
                        {topComment?.textOriginal ?? topComment?.textDisplay ?? ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== SUB-TAB 4: UPLOAD RENDER TO YOUTUBE ==================== */}
      {subTab === 'upload' && (
        <div className="max-w-2xl mx-auto bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-7 space-y-5">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
              POST /youtube/v3/videos & POST /youtube/v3/thumbnails/set
            </span>
            <h2 className="text-lg sm:text-xl font-bold text-white mt-0.5">
              I-upload ang Natapos na Render sa YouTube Channel
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Direktang ina-upload ng backend proxy ang{' '}
              <code className="text-amber-300">MarilagOutput/&lt;pangalan&gt;_final.mp4</code> at
              ang thumbnail nitong <code className="text-amber-300">_final.jpg</code> gamit ang iyong
              OAuth 2.0 (PKCE) token.
            </p>
          </div>

          {galleryVideos.length === 0 ? (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400">
              Wala pang natapos na video sa <code className="text-amber-400">MarilagOutput/</code>.
              Mag-render muna sa Render Queue tab.
            </div>
          ) : (
            <form onSubmit={handleUploadRenderedToYouTube} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="yt-select-render"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Piliin ang Na-render na Video
                </label>
                <select
                  id="yt-select-render"
                  value={selectedRenderBase}
                  onChange={(e) => {
                    setSelectedRenderBase(e.target.value);
                    const found = galleryVideos.find((v) => v.baseName === e.target.value);
                    if (found) setYtUploadTitle(found.title);
                  }}
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono"
                >
                  {galleryVideos.map((v) => (
                    <option key={v.baseName} value={v.baseName}>
                      {v.fileName} ({(v.sizeBytes / (1024 * 1024)).toFixed(2)} MB)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="yt-upload-title"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Pamagat sa YouTube (Title)
                </label>
                <input
                  id="yt-upload-title"
                  type="text"
                  value={ytUploadTitle}
                  onChange={(e) => setYtUploadTitle(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="yt-upload-desc"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Deskripsyon (Description)
                </label>
                <textarea
                  id="yt-upload-desc"
                  rows={3}
                  value={ytUploadDesc}
                  onChange={(e) => setYtUploadDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="yt-upload-privacy"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Privacy Status
                  </label>
                  <select
                    id="yt-upload-privacy"
                    value={ytUploadPrivacy}
                    onChange={(e) => setYtUploadPrivacy(e.target.value as any)}
                    className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white"
                  >
                    <option value="private">Private (Recommended)</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer min-h-[44px] px-3.5 bg-slate-950 border border-slate-800 rounded-xl mt-auto">
                  <input
                    type="checkbox"
                    checked={attachCustomThumbnail}
                    onChange={(e) => setAttachCustomThumbnail(e.target.checked)}
                    className="w-4 h-4 accent-red-600"
                  />
                  <span>I-upload din ang _final.jpg bilang Thumbnail</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={uploadingToYt}
                className="w-full min-h-[48px] px-5 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg flex items-center justify-center gap-2"
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  {uploadingToYt
                    ? 'Ina-upload sa YouTube Data API v3...'
                    : 'I-upload ang Video sa YouTube'}
                </span>
              </button>

              {uploadedYtVideoId && (
                <div className="p-4 bg-emerald-950/60 border border-emerald-700 rounded-xl flex items-center justify-between">
                  <span className="text-xs text-emerald-200 font-mono">
                    YouTube Video ID: {uploadedYtVideoId}
                  </span>
                  <a
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(uploadedYtVideoId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300 underline"
                  >
                    <span>Buksan sa YouTube</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {/* ==================== SUB-TAB 5: APK BUILD & SECURITY CHECKLIST ==================== */}
      {subTab === 'apkguide' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-emerald-400" />
              <span>Capacitor Android APK & Firebase Gradle Setup</span>
            </h2>
            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-[11px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`// 1. Root-level (<project>/android/build.gradle.kts)
plugins {
    id("com.android.application") version "8.7.2" apply false
    id("com.google.gms.google-services") version "4.5.0" apply false
}

// 2. App-level (<project>/android/app/build.gradle.kts)
plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:35.1.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
}

# 3. Build & Sync Commands
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug`}
            </pre>
          </div>

          <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-sky-400" />
              <span>Live Server Proxy & Pre-Release Security Audit</span>
            </h2>
            <div className="space-y-2 text-xs">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                <span className="text-slate-300">YOUTUBE_API_KEY (Server Proxy Only)</span>
                <span
                  className={`font-mono font-bold ${
                    configStatus.apiKeyConfigured ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {configStatus.apiKeyConfigured ? 'CONFIGURED' : 'SET IN .ENV'}
                </span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                <span className="text-slate-300">YOUTUBE_OAUTH_CLIENT_ID (PKCE)</span>
                <span
                  className={`font-mono font-bold ${
                    configStatus.oauthClientConfigured ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {configStatus.oauthClientConfigured ? 'CONFIGURED' : 'SET IN .ENV'}
                </span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                <span className="text-slate-300">Android Package / SHA-1 Header Restriction</span>
                <span
                  className={`font-mono font-bold ${
                    configStatus.androidRestrictionConfigured ? 'text-emerald-400' : 'text-sky-400'
                  }`}
                >
                  {configStatus.packageName}
                </span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <span className="text-slate-400 block">OAuth 2.0 Redirect URI:</span>
                <code className="text-[11px] font-mono text-amber-300 break-all block">
                  {configStatus.callbackUrl}
                </code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Playlist Confirmation Modal */}
      {playlistToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-white">
              Burahin ang Playlist sa YouTube?
            </h3>
            <p className="text-xs text-slate-300">
              Sigurado ka bang gusto mong burahin ang playlist na{' '}
              <strong className="text-white">
                {playlistToDelete?.snippet?.title ?? playlistToDelete?.id}
              </strong>
              ?
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPlaylistToDelete(null)}
                className="min-h-[44px] px-4 py-2 bg-slate-800 text-xs font-semibold text-slate-200 rounded-xl"
              >
                Kanselahin
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePlaylist}
                className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-500 text-xs font-bold text-white rounded-xl"
              >
                Oo, Burahin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
