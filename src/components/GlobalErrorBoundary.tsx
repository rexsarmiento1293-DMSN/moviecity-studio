import React, { useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw, WifiOff, X } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Hindi inaasahang runtime error.',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[GlobalErrorBoundary Caught]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0b0d13] text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-red-800/80 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-600/20 text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-bold text-white">
              Napigilan ang Crash ng App (Auto-Recovery)
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              May nahuling error sa UI ngunit ligtas ang iyong mga na-render na video at data.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-red-300 break-words">
              {this.state.errorMessage}
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="min-h-[44px] px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Ibalik ang Screen</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        <GlobalRuntimeMonitors />
        {this.props.children}
      </>
    );
  }
}

const GlobalRuntimeMonitors: React.FC = () => {
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [runtimeWarning, setRuntimeWarning] = useState<string | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);

    const onWindowError = (event: ErrorEvent) => {
      event.preventDefault();
      const msg = event.message || 'Runtime exception caught';
      setRuntimeWarning(`Nahuling error (window.onerror): ${msg}`);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const reason =
        event.reason?.message || String(event.reason || 'Unhandled promise rejection');
      setRuntimeWarning(`Nahuling async error: ${reason}`);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  if (!isOffline && !runtimeWarning) return null;

  return (
    <div className="bg-amber-950/90 border-b border-amber-700/80 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-3 z-50">
      <div className="flex items-center gap-2">
        {isOffline ? (
          <>
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Offline Mode:</strong> Walang internet sa ngayon. Gumagana pa rin ang lokal na
              gallery at naka-cache na YouTube data.
            </span>
          </>
        ) : (
          <>
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">{runtimeWarning}</span>
          </>
        )}
      </div>
      {runtimeWarning && (
        <button
          type="button"
          onClick={() => setRuntimeWarning(null)}
          aria-label="Isara ang babala"
          className="p-1 text-amber-300 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
