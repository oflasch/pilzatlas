import React from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Compass,
  Droplets,
  Mountain,
  ShieldAlert,
  Thermometer,
  Trees,
  X,
} from 'lucide-react';
import { NRW_SUBREGIONS } from '../data/nrwForestStands';
import { getTierMeta } from '../services/ecologyEngine';
import type {
  AspectDirection,
  NRWForestStand,
  StandPrediction,
  TreeHostKey,
} from '../types/foraging';

interface StandInspectorPanelProps {
  stand: NRWForestStand;
  prediction: StandPrediction;
  activeSpeciesId: string;
  onClose: () => void;
  onOpenSpeciesGuide: (speciesId: string) => void;
  onSelectSpecies: (speciesId: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const HOST_LABELS: Record<TreeHostKey, string> = {
  spruce: 'Fichte',
  pine: 'Waldkiefer',
  beech: 'Rotbuche',
  oak: 'Eiche',
  birch: 'Birke',
  clearing: 'Lichtung / Waldrand',
};

const TEXTURE_LABELS: Record<NRWForestStand['soilTexture'], string> = {
  'acidic-slate-loam': 'Saurer Schieferlehm',
  'sandy-podsol': 'Sandiger Podsol',
  braunerde: 'Löss-Braunerde',
  'calcareous-loam': 'Kalkreicher Lehm',
  'moist-gley': 'Feuchter Gley',
};

const ASPECT_LABELS: Record<AspectDirection, string> = {
  N: 'N',
  NE: 'NO',
  NW: 'NW',
  E: 'O',
  W: 'W',
  SE: 'SO',
  SW: 'SW',
  S: 'S',
  Flat: 'Eben',
};

export const StandInspectorPanel: React.FC<StandInspectorPanelProps> = ({
  stand,
  prediction,
  activeSpeciesId,
  onClose,
  onOpenSpeciesGuide,
  onSelectSpecies,
  isExpanded = false,
  onToggleExpand,
}) => {
  const tierMeta = getTierMeta(prediction.tier);
  const subRegionMeta = NRW_SUBREGIONS[stand.subRegion];
  const hostEntries = Object.entries(stand.hostComposition)
    .filter(([, share]) => (share ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  const factorRows = [
    { label: 'Mykorrhiza-Wirtsbäume', value: prediction.factors.hostScore },
    { label: 'Boden-pH & Substrat', value: prediction.factors.soilPhScore },
    { label: '14-Tage-Regengedächtnis', value: prediction.factors.rainLagScore },
    { label: 'Bodenfeuchte (Wurzelzone)', value: prediction.factors.soilMoistureScore },
    {
      label: 'Bodentemp. (6 cm) & Saison',
      value: Math.round((prediction.factors.soilTempScore + prediction.factors.seasonScore) / 2),
    },
  ];

  return (
    <div className="flex h-full flex-col bg-[#FFFFFF] text-[#132A1E]">
      {/* Tap-to-Expand iOS Sheet Grabber */}
      {onToggleExpand && (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={isExpanded ? 'Standortdetails verkleinern' : 'Standortdetails vergrößern'}
          className="flex w-full items-center justify-center pt-1.5 pb-0.5 lg:hidden"
        >
          <span className="h-1 w-8 rounded-full bg-[#D6D3C8]" aria-hidden="true" />
        </button>
      )}

      {/* Compact Header */}
      <div className="flex items-start justify-between gap-2 border-b border-[#D6D3C8] px-3 py-2 lg:px-3.5 lg:py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-[#4A5D52]">
            <span>{subRegionMeta.shortName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{stand.areaHectares} ha</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{stand.elevationM} m</span>
          </div>
          <h2 className="mt-0.5 truncate text-[15px] font-bold leading-snug text-[#132A1E] lg:text-base lg:whitespace-normal">
            {stand.name}
          </h2>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-label={isExpanded ? 'Details einklappen' : 'Details ausklappen'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#4A5D52] hover:bg-[#F7F6F2] lg:hidden"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Standortdetails schließen"
            className="flex h-8 w-8 -mr-1 items-center justify-center rounded-lg text-[#4A5D52] hover:bg-[#F7F6F2] hover:text-[#132A1E] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-2.5 lg:space-y-3.5 lg:px-3.5 lg:py-3">
        {/* Legal / NSG Warning or Probability Summary */}
        {stand.isProtectedNSG ? (
          <div className="rounded-xl border border-[#B91C1C]/40 bg-[#FEF2F2] p-2.5">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#991B1B]" />
              <div>
                <p className="text-xs font-bold text-[#991B1B]">
                  Naturschutzgebiet (NSG) — Sammelverbot
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-[#7F1D1D]">
                  {stand.nsgName ?? stand.name}. Das Verlassen der Wege und das Sammeln von Pilzen
                  sind nach NRW-Naturschutzrecht (BNatSchG / LFoG) streng verboten.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#D6D3C8] bg-[#F7F6F2] px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-[#4A5D52]">
                  {activeSpeciesId === 'all'
                    ? `Top: ${prediction.bestSpeciesName}`
                    : prediction.bestSpeciesName}
                </p>
                <p className="text-xs font-semibold" style={{ color: tierMeta.textColor }}>
                  {tierMeta.label}
                </p>
              </div>
              <span className="font-mono text-2xl font-bold tabular-nums leading-none text-[#132A1E] shrink-0">
                {prediction.probability}%
              </span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-[#4A5D52]">
              {prediction.summaryReason}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-[#D6D3C8] pt-1.5 text-[10.5px] text-[#4A5D52]">
              <span>
                Standort <strong className="font-mono tabular-nums text-[#132A1E]">{prediction.habitatSuitability}%</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Wetter <strong className="font-mono tabular-nums text-[#132A1E]">{prediction.fruitingTrigger}%</strong>
              </span>
              {prediction.factors.thermalShockBonus && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-[#C86D1F]">Kältereiz aktiv</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Single-Row 4-Metric Micro-Environment Strip */}
        <div className="grid grid-cols-4 gap-1.5">
          <div className="rounded-lg border border-[#D6D3C8] bg-white px-2 py-1.5 text-center">
            <div className="flex items-center justify-center gap-0.5 text-[9.5px] text-[#4A5D52]">
              <CloudRain className="h-3 w-3 text-[#1B4332]" />
              <span>Regen</span>
            </div>
            <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#132A1E]">
              {prediction.factors.weightedRainLagMm}mm
            </p>
          </div>
          <div className="rounded-lg border border-[#D6D3C8] bg-white px-2 py-1.5 text-center">
            <div className="flex items-center justify-center gap-0.5 text-[9.5px] text-[#4A5D52]">
              <Droplets className="h-3 w-3 text-[#1B4332]" />
              <span>Feuchte</span>
            </div>
            <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#132A1E]">
              {(prediction.factors.soilMoisture3to9 * 100).toFixed(0)}%
            </p>
          </div>
          <div className="rounded-lg border border-[#D6D3C8] bg-white px-2 py-1.5 text-center">
            <div className="flex items-center justify-center gap-0.5 text-[9.5px] text-[#4A5D52]">
              <Thermometer className="h-3 w-3 text-[#C86D1F]" />
              <span>Boden</span>
            </div>
            <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#132A1E]">
              {prediction.factors.soilTemp6cmC.toFixed(1)}°
            </p>
          </div>
          <div className="rounded-lg border border-[#D6D3C8] bg-white px-2 py-1.5 text-center">
            <div className="flex items-center justify-center gap-0.5 text-[9.5px] text-[#4A5D52]">
              <Compass className="h-3 w-3 text-[#1B4332]" />
              <span>pH/{ASPECT_LABELS[stand.aspect]}</span>
            </div>
            <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#132A1E]">
              {stand.soilPh.toFixed(1)}
            </p>
          </div>
        </div>

        {/* Ecological Driver Bars */}
        {!stand.isProtectedNSG && (
          <div>
            <h3 className="text-[10.5px] font-semibold tracking-wide text-[#4A5D52]">
              Ökologische Bewertung
            </h3>
            <div className="mt-1.5 space-y-1.5">
              {factorRows.map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#132A1E]">{row.label}</span>
                    <span className="font-mono font-medium tabular-nums text-[#4A5D52]">
                      {row.value}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EFECE4]">
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{
                        width: `${row.value}%`,
                        backgroundColor:
                          row.value >= 75 ? '#15803D' : row.value >= 45 ? '#C86D1F' : '#8A8F8C',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Forest Composition & Geology */}
        <div className="border-t border-[#D6D3C8] pt-2.5">
          <h3 className="text-[10.5px] font-semibold tracking-wide text-[#4A5D52]">
            Bestand &amp; Geologie
          </h3>
          <div className="mt-1.5 space-y-1 text-[11px] text-[#4A5D52]">
            <p className="flex items-start gap-1.5">
              <Trees className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1B4332]" />
              <span>
                {hostEntries
                  .map(([k, v]) => `${HOST_LABELS[k as TreeHostKey]} ${Math.round((v ?? 0) * 100)}%`)
                  .join(' · ')}
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <Mountain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1B4332]" />
              <span>
                {stand.geology} · {TEXTURE_LABELS[stand.soilTexture]} · Hangneigung {stand.slopeDeg}°
              </span>
            </p>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-[#4A5D52]">{stand.notes}</p>

          {stand.officialMeta && (
            <div className="mt-2 rounded-lg border border-[#D6D3C8] bg-[#F7F6F2] p-2.5 text-[10.5px] text-[#4A5D52]">
              <p className="font-semibold text-[#132A1E]">{stand.officialMeta.dataset}</p>
              <div className="mt-1 grid grid-cols-2 gap-x-2.5 gap-y-0.5 font-mono">
                {stand.officialMeta.parcelCode && (
                  <span>Standort: {stand.officialMeta.parcelCode}</span>
                )}
                {stand.officialMeta.localId && (
                  <span>ID: {stand.officialMeta.localId}</span>
                )}
                {stand.officialMeta.basenText && (
                  <span className="col-span-2 font-sans">
                    Basenstatus: <strong className="text-[#132A1E]">{stand.officialMeta.basenText}</strong>
                  </span>
                )}
                {stand.officialMeta.waterBalance && (
                  <span className="font-sans">
                    Wasser: <strong className="text-[#132A1E]">{stand.officialMeta.waterBalance}</strong>
                  </span>
                )}
                {stand.officialMeta.nfk && (
                  <span>nFK: {stand.officialMeta.nfk}</span>
                )}
                {stand.officialMeta.vegDays && (
                  <span>Veg.-Tage: {stand.officialMeta.vegDays}</span>
                )}
                {stand.officialMeta.kwbv && (
                  <span>KWBV: {stand.officialMeta.kwbv}</span>
                )}
                {stand.officialMeta.wetSummary && (
                  <span className="col-span-2 font-sans">
                    WET: <strong className="text-[#132A1E]">{stand.officialMeta.wetSummary}</strong>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Species Ranking in this Stand */}
        {!stand.isProtectedNSG && (
          <div className="border-t border-[#D6D3C8] pt-2.5">
            <h3 className="text-[10.5px] font-semibold tracking-wide text-[#4A5D52]">
              Top-Arten an diesem Standort
            </h3>
            <div className="mt-1 divide-y divide-[#EFECE4]">
              {prediction.speciesRanking.slice(0, 4).map((sp) => (
                <div key={sp.speciesId} className="flex items-center justify-between py-1">
                  <button
                    type="button"
                    onClick={() => onSelectSpecies(sp.speciesId)}
                    className="min-h-[34px] text-left text-xs font-medium text-[#132A1E] hover:text-[#1B4332] hover:underline"
                  >
                    {sp.germanName}
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold tabular-nums text-[#132A1E]">
                      {sp.probability}%
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenSpeciesGuide(sp.speciesId)}
                      aria-label={`Pilzführer für ${sp.germanName} öffnen`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#D6D3C8] text-[#1B4332] hover:bg-[#F7F6F2]"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Legal Reminder Footer */}
        {!stand.isProtectedNSG && (
          <div className="flex items-start gap-1.5 rounded-lg bg-[#F7F6F2] p-2 text-[10.5px] leading-snug text-[#4A5D52]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C86D1F]" />
            <span>
              NRW-Eigenbedarfsregel nach BArtSchV (~1–2 kg/Tag). Örtliche Forstsperrungen und
              eingezäunte Schonungen stets beachten.
            </span>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      {!stand.isProtectedNSG && (
        <div className="border-t border-[#D6D3C8] bg-[#FFFFFF] px-3 py-2">
          <button
            type="button"
            onClick={() => onOpenSpeciesGuide(prediction.bestSpeciesId)}
            className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#1B4332] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#132A1E] transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Pilzführer: {prediction.bestSpeciesName}</span>
          </button>
        </div>
      )}
    </div>
  );
};
