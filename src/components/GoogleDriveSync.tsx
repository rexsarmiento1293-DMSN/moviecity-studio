import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  logout,
  listDriveFiles,
  uploadBlobToDrive,
  deleteDriveFile,
  DriveFileItem,
  SCOPES,
} from '../services/googleDriveAuth';
import { CloudUpload, Trash2, RefreshCw, ExternalLink, Search, LogOut, ShieldCheck } from 'lucide-react';

export interface GalleryVideoItemForDrive {
  baseName: string;
  fileName: string;
  videoUrl: string;
  sizeBytes: number;
}

interface GoogleDriveSyncProps {
  galleryVideos: GalleryVideoItemForDrive[];
}

interface PendingConfirmAction {
  type: 'delete' | 'overwrite';
  title: string;
  description: string;
  targetFile: DriveFileItem;
}

export const GoogleDriveSync: React.FC<GoogleDriveSyncProps> = ({ galleryVideos }) => {
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [selectedVideoName, setSelectedVideoName] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<PendingConfirmAction | null>(null);

  useEffect(() => {
    if (galleryVideos.length > 0 && !selectedVideoName) {
      setSelectedVideoName(galleryVideos[0].fileName);
    }
  }, [galleryVideos, selectedVideoName]);

  useEffect(() => {
    const unsub = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
        fetchFiles();
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  const fetchFiles = async (query?: string) => {
    setLoadingFiles(true);
    setErrorMessage(null);
    try {
      const items = await listDriveFiles(query);
      setFiles(items);
    } catch (err: any) {
      if (err.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setErrorMessage(err.message || 'Hindi ma-load ang mga file mula sa Google Drive.');
      }
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMessage(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
        await fetchFiles(searchQuery);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Nabigo ang pag-sign in sa Google Drive.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleDisconnect = async () => {
    await logout();
    setUser(null);
    setFiles([]);
    setNeedsAuth(true);
    setStatusMessage('Matagumpay na na-disconnect ang Google Drive account.');
  };

  const selectedGalleryItem =
    galleryVideos.find((v) => v.fileName === selectedVideoName) || galleryVideos[0];

  const handleUploadSelectedMp4 = async (existingFile?: DriveFileItem) => {
    if (!selectedGalleryItem) {
      setErrorMessage('Walang natapos na video sa MarilagOutput/ para i-upload.');
      return;
    }
    setUploading(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await fetch(selectedGalleryItem.videoUrl);
      if (!response.ok) {
        throw new Error(`Hindi mahanap ang ${selectedGalleryItem.fileName} sa server.`);
      }
      const blob = await response.blob();
      const uploaded = await uploadBlobToDrive(
        blob,
        selectedGalleryItem.fileName,
        'video/mp4',
        existingFile?.id
      );
      setStatusMessage(
        existingFile
          ? `Na-update ang '${uploaded.name}' sa Google Drive.`
          : `Na-upload ang '${uploaded.name}' sa Google Drive.`
      );
      await fetchFiles(searchQuery);
    } catch (err: any) {
      if (err.message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
      } else {
        setErrorMessage(err.message || 'Nabigo ang pag-upload sa Google Drive.');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmProceed = async () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);

    if (action.type === 'delete') {
      setLoadingFiles(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        await deleteDriveFile(action.targetFile.id);
        setStatusMessage(`Nabura ang '${action.targetFile.name}' mula sa Google Drive.`);
        await fetchFiles(searchQuery);
      } catch (err: any) {
        if (err.message === 'AUTH_REQUIRED') {
          setNeedsAuth(true);
        } else {
          setErrorMessage(err.message || 'Nabigo sa pagbura ng file sa Google Drive.');
        }
      } finally {
        setLoadingFiles(false);
      }
    } else if (action.type === 'overwrite') {
      await handleUploadSelectedMp4(action.targetFile);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              Least-Privilege Scope: <code className="font-mono">{SCOPES[0]}</code>
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Google Drive Export & Backup
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Walang auto-overwrite o auto-delete. Laging may kumpirmasyon bago galawin ang file.
          </p>
        </div>

        {!needsAuth && user && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-300">
              Konektado: <strong className="text-white">{user.email}</strong>
            </span>
            <button
              type="button"
              onClick={handleDisconnect}
              className="min-h-[44px] px-4 py-2 text-xs font-semibold text-red-200 bg-red-950/60 border border-red-800 rounded-xl hover:bg-red-900/60 flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Disconnect Google Drive</span>
            </button>
          </div>
        )}
      </div>

      {statusMessage && (
        <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded-xl p-3.5">
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded-xl p-3.5"
        >
          {errorMessage}
        </div>
      )}

      {needsAuth ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 max-w-xl mx-auto text-center space-y-5">
          <h2 className="text-lg font-bold text-slate-100">
            Ikonekta ang Google Drive (Scope: drive.file lang)
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Mag-sign in gamit ang iyong Google account para mai-upload ang mga natapos na{' '}
            <code className="text-amber-400">MarilagOutput/&lt;pangalan&gt;_final.mp4</code>. Tanging
            mga file na ginawa ng app na ito ang maa-access (<code className="text-emerald-400">drive.file</code>).
          </p>

          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="min-h-[48px] px-6 py-3 bg-white hover:bg-slate-100 text-slate-950 font-bold text-sm rounded-xl shadow-lg flex items-center gap-3 transition-colors"
            >
              <CloudUpload className="w-5 h-5 text-red-600" />
              <span>{isLoggingIn ? 'Kumokonekta...' : 'Sign in with Google Drive'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchFiles(searchQuery);
              }}
              className="flex items-center gap-2 flex-1"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <input
                  type="text"
                  placeholder="Maghanap ng file sa Google Drive..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="min-h-[44px] px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl shrink-0"
              >
                Hanapin
              </button>
              <button
                type="button"
                onClick={() => fetchFiles(searchQuery)}
                aria-label="I-refresh ang Google Drive files"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl shrink-0"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </form>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {galleryVideos.length > 0 && (
                <select
                  aria-label="Piliin ang video na i-u-upload"
                  value={selectedVideoName}
                  onChange={(e) => setSelectedVideoName(e.target.value)}
                  className="min-h-[44px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                >
                  {galleryVideos.map((v) => (
                    <option key={v.fileName} value={v.fileName}>
                      {v.fileName} ({(v.sizeBytes / (1024 * 1024)).toFixed(2)} MB)
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => handleUploadSelectedMp4()}
                disabled={!selectedGalleryItem || uploading}
                className="min-h-[44px] px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shrink-0"
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  {uploading
                    ? 'Nag-u-upload sa Drive...'
                    : selectedGalleryItem
                    ? `I-upload ang ${selectedGalleryItem.fileName}`
                    : 'Walang Video na Ma-upload'}
                </span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="py-3 px-4 font-medium">Pangalan ng File</th>
                  <th className="py-3 px-4 font-medium">Laki</th>
                  <th className="py-3 px-4 font-medium text-right">Aksyon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {loadingFiles ? (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-slate-400">
                      Nilo-load ang mga Google Drive file...
                    </td>
                  </tr>
                ) : files.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-slate-400">
                      Walang file na nakita sa Google Drive para sa app na ito.
                    </td>
                  </tr>
                ) : (
                  files.map((file) => (
                    <tr key={file.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-100 break-all">
                        {file.name}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-300 font-mono">
                        {file.size ? `${(Number(file.size) / 1024).toFixed(1)} KB` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs text-sky-400 hover:text-sky-300 bg-slate-800 rounded-lg"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Buksan</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmAction({
                              type: 'overwrite',
                              title: `I-overwrite ang '${file.name}' sa Google Drive?`,
                              description: `Papalitan nito ang laman ng '${file.name}' gamit ang napiling video (${
                                selectedGalleryItem?.fileName || 'final.mp4'
                              }). Sigurado ka ba?`,
                              targetFile: file,
                            })
                          }
                          className="px-3 py-2 text-xs text-amber-300 hover:text-amber-200 bg-slate-800 rounded-lg"
                        >
                          I-overwrite
                        </button>
                        <button
                          type="button"
                          aria-label={`Burahin ang ${file.name}`}
                          onClick={() =>
                            setConfirmAction({
                              type: 'delete',
                              title: `Burahin ang '${file.name}' sa Google Drive?`,
                              description: `Sigurado ka bang gusto mong burahin nang permanente ang '${file.name}' mula sa iyong Google Drive?`,
                              targetFile: file,
                            })
                          }
                          className="p-2 text-red-400 hover:text-red-300 bg-slate-800 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmAction && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="drive-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 id="drive-confirm-title" className="text-base font-bold text-slate-100">
              {confirmAction.title}
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {confirmAction.description}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl"
              >
                Kanselahin
              </button>
              <button
                type="button"
                onClick={handleConfirmProceed}
                className={`min-h-[44px] px-4 py-2 text-xs font-bold rounded-xl ${
                  confirmAction.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                {confirmAction.type === 'delete' ? 'Oo, Burahin' : 'Oo, I-overwrite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
