import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Loader2,
  Scale,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { NRW_SUBREGION_LIST } from '../data/nrwForestStands';
import { computeTileUrlsForSubRegion } from '../services/offlineStorage';
import type {
  OfflinePackRecord,
  SubRegionId,
  SubRegionWeatherSeries,
} from '../types/foraging';
import { PWAInstallButton } from './PWAInstallButton';

interface OfflinePacksViewProps {
  offlinePacks: Record<SubRegionId, OfflinePackRecord | null>;
  weatherByRegion: Record<SubRegionId, SubRegionWeatherSeries>;
  isOnline: boolean;
  osmStandCount: number;
  onDownloadPack: (
    subRegion: SubRegionId,
    onProgress: (done: number, total: number) => void
  ) => Promise<void>;
  onDeletePack: (subRegion: SubRegionId) => Promise<void>;
  onClearOsmStands: () => Promise<void>;
}

export const OfflinePacksView: React.FC<OfflinePacksViewProps> = ({
  offlinePacks,
  weatherByRegion,
  isOnline,
  osmStandCount,
  onDownloadPack,
  onDeletePack,
  onClearOsmStands,
}) => {
  const [downloadingId, setDownloadingId] = useState<SubRegionId | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const totalMb = Object.values(offlinePacks).reduce((sum, p) => sum + (p?.estimatedMb ?? 0), 0);
  const cachedPacksCount = Object.values(offlinePacks).filter(Boolean).length;

  const handleDownload = async (subRegion: SubRegionId) => {
    setStatusNote(null);
    setDownloadingId(subRegion);
    setProgress({ done: 0, total: computeTileUrlsForSubRegion(subRegion).length });
    try {
      await onDownloadPack(subRegion, (done, total) => setProgress({ done, total }));
      setStatusNote(`Cached topographic tiles & DWD weather snapshot for ${subRegion}.`);
    } catch (err) {
      setStatusNote(
        err instanceof Error ? err.message : 'Unable to finish offline download right now.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F7F6F2] pb-6">
      <div className="mx-auto max-w-5xl px-3 py-3 sm:px-5 sm:py-4">
        {/* Compact Header */}
        <div className="flex items-end justify-between gap-3 border-b border-[#D6D3C8] pb-2.5 sm:pb-3.5">
          <div className="min-w-0">
            <p className="text-[10.5px] font-medium text-[#4A5D52] sm:text-xs">
              Dead-Zone Forest Readiness · Cache &amp; IndexedDB
            </p>
            <h1 className="text-lg font-bold tracking-tight text-[#132A1E] sm:text-2xl">
              Offline Packs &amp; Open Data
            </h1>
          </div>
          <div className="hidden sm:block">
            <PWAInstallButton />
          </div>
        </div>

        {/* Compact 3-Column Connectivity & Storage Strip */}
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:mt-3.5 sm:gap-2.5">
          <div className="rounded-xl border border-[#D6D3C8] bg-white p-2 sm:p-3">
            <div className="flex items-center gap-1 text-[10px] text-[#4A5D52] sm:text-[11px]">
              {isOnline ? (
                <Wifi className="h-3 w-3 shrink-0 text-[#15803D] sm:h-3.5 sm:w-3.5" />
              ) : (
                <WifiOff className="h-3 w-3 shrink-0 text-[#C86D1F] sm:h-3.5 sm:w-3.5" />
              )}
              <span className="truncate">Network</span>
            </div>
            <p className="mt-0.5 truncate text-xs font-bold text-[#132A1E] sm:text-sm">
              {isOnline ? 'Online' : 'Offline'}
            </p>
          </div>

          <div className="rounded-xl border border-[#D6D3C8] bg-white p-2 sm:p-3">
            <div className="flex items-center gap-1 text-[10px] text-[#4A5D52] sm:text-[11px]">
              <HardDrive className="h-3 w-3 shrink-0 text-[#1B4332] sm:h-3.5 sm:w-3.5" />
              <span className="truncate">Topo Packs</span>
            </div>
            <p className="mt-0.5 truncate font-mono text-xs font-bold tabular-nums text-[#132A1E] sm:text-sm">
              {cachedPacksCount}/{NRW_SUBREGION_LIST.length} · {totalMb.toFixed(0)}MB
            </p>
          </div>

          <div className="rounded-xl border border-[#D6D3C8] bg-white p-2 sm:p-3">
            <div className="flex items-center gap-1 text-[10px] text-[#4A5D52] sm:text-[11px]">
              <Database className="h-3 w-3 shrink-0 text-[#1B4332] sm:h-3.5 sm:w-3.5" />
              <span className="truncate">Field Guide</span>
            </div>
            <p className="mt-0.5 truncate text-xs font-bold text-[#15803D] sm:text-sm">
              Offline Ready
            </p>
          </div>
        </div>

        {statusNote && (
          <div className="mt-2.5 rounded-lg border border-[#15803D]/30 bg-[#F0FDF4] px-3 py-2 text-[11px] font-medium text-[#14532D]">
            {statusNote}
          </div>
        )}

        {/* Sub-Region Offline Pack Rows (Compact Single-Row Layout) */}
        <div className="mt-3 space-y-1.5 sm:mt-4 sm:space-y-2">
          <h2 className="text-[11px] font-bold text-[#132A1E] sm:text-xs">
            NRW Naturraum Packs (OpenTopoMap z9–z12 + DWD Weather)
          </h2>

          {NRW_SUBREGION_LIST.map((sr) => {
            const pack = offlinePacks[sr.id];
            const isDownloading = downloadingId === sr.id;
            const estTiles = computeTileUrlsForSubRegion(sr.id).length;
            const estMb = ((estTiles * 36) / 1024 + 0.15).toFixed(1);
            const pct =
              isDownloading && progress.total > 0
                ? Math.round((progress.done / progress.total) * 100)
                : 0;
            const weatherTime = new Date(weatherByRegion[sr.id].fetchedAt).toLocaleString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={sr.id}
                className="rounded-xl border border-[#D6D3C8] bg-white px-3 py-2.5 sm:px-4 sm:py-3"
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-[13px] font-bold text-[#132A1E] sm:text-sm">
                        <span className="sm:hidden">{sr.shortName}</span>
                        <span className="hidden sm:inline">{sr.name}</span>
                      </h3>
                      {pack && (
                        <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-[#15803D] shrink-0">
                          <CheckCircle2 className="h-3 w-3" />
                          Saved
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[10.5px] text-[#4A5D52] sm:text-[11px]">{sr.subtitle}</p>
                    <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[#4A5D52] sm:text-[11px]">
                      {pack
                        ? `${pack.tileCount} tiles · ${pack.estimatedMb} MB · ${new Date(
                            pack.cachedAt
                          ).toLocaleDateString('de-DE')}`
                        : `~${estTiles} tiles · ~${estMb} MB · ${weatherTime}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={!isOnline || downloadingId !== null}
                      onClick={() => handleDownload(sr.id)}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#1B4332] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#132A1E] disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:px-3.5 sm:text-xs"
                    >
                      {isDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      <span>{isDownloading ? `${pct}%` : pack ? 'Update' : 'Save'}</span>
                    </button>

                    {pack && (
                      <button
                        type="button"
                        disabled={downloadingId !== null}
                        onClick={() => onDeletePack(sr.id)}
                        aria-label={`Delete offline pack for ${sr.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D6D3C8] bg-white text-[#991B1B] hover:bg-[#FEF2F2] disabled:opacity-50 sm:h-10 sm:w-10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isDownloading && (
                  <div className="mt-2">
                    <div className="flex justify-between font-mono text-[10px] tabular-nums text-[#4A5D52]">
                      <span>Caching OpenTopoMap tiles…</span>
                      <span>
                        {progress.done} / {progress.total}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#EFECE4]">
                      <div
                        className="h-full rounded-full bg-[#1B4332] transition-all duration-150"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Cached High-Resolution NRW WFS Polygons Summary */}
        {osmStandCount > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#D6D3C8] bg-white px-3 py-2.5 sm:mt-4 sm:px-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-[#132A1E] sm:text-sm">
                Surveyed NRW Polygons Cached ({osmStandCount})
              </p>
              <p className="truncate text-[10.5px] text-[#4A5D52] sm:text-xs">
                Wald &amp; Holz NRW, GD NRW FSK05 (1:5,000), and LANUV NSG saved in IndexedDB.
              </p>
            </div>
            <button
              type="button"
              onClick={onClearOsmStands}
              className="h-8 rounded-lg border border-[#D6D3C8] px-2.5 text-[11px] font-semibold text-[#991B1B] hover:bg-[#FEF2F2] shrink-0 sm:h-9 sm:px-3"
            >
              Clear
            </button>
          </div>
        )}

        {/* NRW Legal Rules & Open Data Provenance */}
        <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:mt-4 sm:gap-3.5 md:grid-cols-2">
          <section className="rounded-xl border border-[#D6D3C8] bg-white p-3.5 sm:p-4">
            <div className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-[#1B4332]" />
              <h2 className="text-xs font-bold text-[#132A1E] sm:text-sm">
                NRW Foraging Rules (BNatSchG / BArtSchV / LFoG)
              </h2>
            </div>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-snug text-[#4A5D52]">
              <li>
                • <strong className="text-[#132A1E]">Personal Use Only:</strong> Protected edible
                mushrooms (<em>Steinpilz</em>, <em>Pfifferling</em>, <em>Birkenpilz</em>) are
                limited to small personal amounts (~1–2 kg/person/day).
              </li>
              <li>
                • <strong className="text-[#132A1E]">Naturschutzgebiete (NSG):</strong> Picking
                mushrooms and leaving marked paths are strictly forbidden in crimson-hatched NSG
                zones.
              </li>
              <li>
                • <strong className="text-[#132A1E]">Forestry Safety:</strong> Respect fenced young
                plantations (<em>Schonungen</em>) and storm/logging closures.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#D6D3C8] bg-white p-3.5 sm:p-4">
            <div className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-[#1B4332]" />
              <h2 className="text-xs font-bold text-[#132A1E] sm:text-sm">Open Data Sources &amp; Model</h2>
            </div>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-snug text-[#4A5D52]">
              <li>
                • <strong className="text-[#132A1E]">Surveyed Forests &amp; Reserves:</strong> Live
                OpenGeodata.NRW WFS (dl-de/zero-2-0) — Wald &amp; Holz NRW Basis-DLM, GD NRW FSK05
                (1:5,000), and LANUV NRW NSG / NP / NWZ.
              </li>
              <li>
                • <strong className="text-[#132A1E]">Weather &amp; Soil Moisture:</strong>{' '}
                Open-Meteo DWD ICON-D2 / ICON-EU (21-day rain lag, 3–9 cm moisture, 6 cm soil temp).
              </li>
              <li>
                • <strong className="text-[#132A1E]">Topographic Basemap:</strong> OpenTopoMap /
                OpenStreetMap tiles cached offline via PWA Cache Storage.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};
