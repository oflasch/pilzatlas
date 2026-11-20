import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center justify-center gap-1 rounded-lg bg-[#1B4332] text-white font-semibold transition-colors hover:bg-[#132A1E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4332] whitespace-nowrap shrink-0 ${
          compact ? 'h-7 px-2 text-[11px] sm:h-8 sm:px-2.5 sm:text-xs' : 'min-h-[40px] px-3.5 text-xs'
        }`}
      >
        <Download className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
        <span>Install</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className={`inline-flex items-center justify-center gap-1 rounded-lg border border-[#132A1E]/20 bg-[#F7F6F2] text-[#132A1E] font-semibold transition-colors hover:bg-[#EFECE4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4332] whitespace-nowrap shrink-0 ${
          compact ? 'h-7 px-2 text-[11px] sm:h-8 sm:px-2.5 sm:text-xs' : 'min-h-[40px] px-3.5 text-xs'
        }`}
      >
        <Download className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
        <span className="sm:hidden">{isIOS ? 'Add' : 'App'}</span>
        <span className="hidden sm:inline">{isIOS ? 'Install on iOS' : 'Offline App'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-[#D6D3C8] bg-[#FFFFFF] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h3 id="pwa-install-guide-title" className="text-lg font-bold text-[#132A1E]">
                {isIOS ? 'Install on iPhone or iPad' : 'Install for Offline Forest Use'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="flex min-h-[44px] min-w-[44px] -mr-2 -mt-2 items-center justify-center rounded-lg text-[#4A5D52] hover:bg-[#F7F6F2] hover:text-[#132A1E]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {isIOS ? (
              <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-[#4A5D52]">
                <li className="flex items-start gap-2">
                  <span className="font-mono font-semibold text-[#132A1E]">1.</span>
                  <span>
                    Tap the <strong className="text-[#132A1E]">Share</strong>{' '}
                    <Share className="inline h-3.5 w-3.5 text-[#1B4332]" /> icon in Safari’s
                    toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono font-semibold text-[#132A1E]">2.</span>
                  <span>
                    Scroll down and select <strong className="text-[#132A1E]">Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono font-semibold text-[#132A1E]">3.</span>
                  <span>Launch PilzAtlas from your home screen before entering the forest.</span>
                </li>
              </ol>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-[#4A5D52]">
                Open your browser menu and choose <strong className="text-[#132A1E]">Install app</strong>{' '}
                or <strong className="text-[#132A1E]">Add to Home Screen</strong>. All field-guide
                images and downloaded NRW topographic packs will then open even with zero cellular
                signal.
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-[#1B4332] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#132A1E] transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
