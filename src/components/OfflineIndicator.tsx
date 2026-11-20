import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(3.35rem+env(safe-area-inset-bottom,0px))] left-2.5 right-2.5 z-[580] mx-auto flex max-w-md items-center justify-center gap-2 rounded-xl border border-[#C86D1F] bg-[#FFFBEB]/95 px-3 py-1.5 text-[11px] font-semibold text-[#92400E] shadow-md backdrop-blur-xs lg:bottom-3.5 lg:left-3.5 lg:right-auto"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0 text-[#C86D1F]" />
      <span className="truncate">Offline-Modus · Gespeicherte NRW-Flächen &amp; Topokarten</span>
    </div>
  );
};
