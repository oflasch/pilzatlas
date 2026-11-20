import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Search,
  ShieldAlert,
  Trees,
  X,
} from 'lucide-react';
import { NRW_MUSHROOM_SPECIES } from '../data/species';
import type { MushroomSpecies, StandPrediction } from '../types/foraging';

interface FieldGuideViewProps {
  predictions: Record<string, StandPrediction>;
  focusedSpeciesId: string | null;
  onClearFocusedSpecies: () => void;
  onFilterMapBySpecies: (speciesId: string) => void;
}

type HostFilter = 'all' | 'conifer' | 'deciduous' | 'edges';
const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export const FieldGuideView: React.FC<FieldGuideViewProps> = ({
  predictions,
  focusedSpeciesId,
  onClearFocusedSpecies,
  onFilterMapBySpecies,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hostFilter, setHostFilter] = useState<HostFilter>('all');
  const [selectedSpecies, setSelectedSpecies] = useState<MushroomSpecies | null>(() =>
    focusedSpeciesId
      ? NRW_MUSHROOM_SPECIES.find((s) => s.id === focusedSpeciesId) ?? null
      : null
  );
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  // Sync external navigation into a specific species dossier
  React.useEffect(() => {
    if (focusedSpeciesId) {
      const match = NRW_MUSHROOM_SPECIES.find((s) => s.id === focusedSpeciesId);
      if (match) setSelectedSpecies(match);
    }
  }, [focusedSpeciesId]);

  // Compute max current regional probability for each species across open NRW stands
  const maxProbBySpecies = useMemo(() => {
    const map: Record<string, number> = {};
    NRW_MUSHROOM_SPECIES.forEach((s) => {
      map[s.id] = 0;
    });
    Object.values(predictions).forEach((pred) => {
      if (pred.isLegalBlocked) return;
      pred.speciesRanking.forEach((entry) => {
        if (entry.probability > (map[entry.speciesId] ?? 0)) {
          map[entry.speciesId] = entry.probability;
        }
      });
    });
    return map;
  }, [predictions]);

  const filteredSpecies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return NRW_MUSHROOM_SPECIES.filter((sp) => {
      if (hostFilter === 'conifer') {
        const score = (sp.hostAffinities.spruce ?? 0) + (sp.hostAffinities.pine ?? 0);
        if (score < 0.9) return false;
      } else if (hostFilter === 'deciduous') {
        const score = (sp.hostAffinities.beech ?? 0) + (sp.hostAffinities.oak ?? 0);
        if (score < 1.2) return false;
      } else if (hostFilter === 'edges') {
        const score = (sp.hostAffinities.birch ?? 0) + (sp.hostAffinities.clearing ?? 0);
        if (score < 0.9) return false;
      }

      if (!q) return true;
      return (
        sp.germanName.toLowerCase().includes(q) ||
        sp.englishName.toLowerCase().includes(q) ||
        sp.latinName.toLowerCase().includes(q) ||
        sp.hostSummary.toLowerCase().includes(q)
      );
    });
  }, [searchQuery, hostFilter]);

  const handleCloseDossier = () => {
    setSelectedSpecies(null);
    onClearFocusedSpecies();
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F7F6F2] pb-6">
      <div className="mx-auto max-w-6xl px-3 py-3 sm:px-5 sm:py-4">
        {/* Compact Header & Safety Notice */}
        <div className="border-b border-[#D6D3C8] pb-2.5 sm:pb-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-lg font-bold tracking-tight text-[#132A1E] sm:text-2xl">
              NRW Field Guide &amp; Lookalikes
            </h1>
            <span className="text-[10.5px] font-medium text-[#4A5D52] whitespace-nowrap">
              Offline · {NRW_MUSHROOM_SPECIES.length} spp.
            </span>
          </div>
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-[#C86D1F]/35 bg-[#FFFBEB] px-2.5 py-1.5 text-[10.5px] leading-snug text-[#78350F] sm:text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C86D1F]" />
            <span>
              <strong className="text-[#132A1E]">Safety:</strong> Never eat wild mushrooms solely
              from app scores. Confirm finds with a certified{' '}
              <strong className="text-[#132A1E]">DGfM Pilzsachverständiger</strong>.
            </span>
          </div>
        </div>

        {/* Compact Search & Host Filter Controls (16px font prevents iOS Safari zoom) */}
        <div className="mt-2.5 flex flex-col gap-2 sm:mt-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#4A5D52]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Steinpilz, Pfifferling, Beech…"
              aria-label="Search mushroom species"
              className="h-9 w-full rounded-lg border border-[#D6D3C8] bg-white pl-8 pr-3 text-[16px] text-[#132A1E] placeholder:text-[#4A5D52]/70 focus:border-[#1B4332] focus:outline-none sm:h-10 sm:text-sm"
            />
          </div>

          <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar rounded-lg border border-[#D6D3C8] bg-white p-0.5">
            {[
              { id: 'all', label: 'All (8)' },
              { id: 'conifer', label: 'Spruce & Pine' },
              { id: 'deciduous', label: 'Beech & Oak' },
              { id: 'edges', label: 'Birch & Edges' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setHostFilter(tab.id as HostFilter)}
                className={`h-7 rounded-md px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 sm:h-8 sm:px-2.5 sm:text-xs ${
                  hostFilter === tab.id
                    ? 'bg-[#1B4332] text-white'
                    : 'text-[#4A5D52] hover:text-[#132A1E]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Species List (Compact Horizontal Cards on Mobile, 2/3-Col Botanical Grid on Desktop) */}
        {filteredSpecies.length === 0 ? (
          <div className="mt-4 rounded-xl border border-[#D6D3C8] bg-white p-5 text-center">
            <p className="text-xs font-semibold text-[#132A1E]">
              No species match “{searchQuery}”.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setHostFilter('all');
              }}
              className="mt-2.5 h-9 rounded-lg bg-[#1B4332] px-3.5 text-xs font-semibold text-white"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3">
            {filteredSpecies.map((sp) => {
              const peakProb = maxProbBySpecies[sp.id] ?? 0;
              return (
                <article
                  key={sp.id}
                  className="flex flex-row overflow-hidden rounded-xl border border-[#D6D3C8] bg-white transition-shadow hover:shadow-sm sm:flex-col sm:rounded-2xl"
                >
                  {/* Botanical Photograph (Compact Square Thumbnail on Mobile, 16/10 on Desktop) */}
                  <button
                    type="button"
                    onClick={() => setSelectedSpecies(sp)}
                    className="relative w-24 shrink-0 overflow-hidden bg-[#E8E6DC] text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1B4332] sm:aspect-[16/10] sm:w-full"
                  >
                    {!failedImages[sp.id] ? (
                      <img
                        src={sp.imagePath}
                        alt={`${sp.germanName} (${sp.latinName}) in a German forest`}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onError={() =>
                          setFailedImages((prev) => ({ ...prev, [sp.id]: true }))
                        }
                        className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#1B4332]/15 to-[#C86D1F]/15 p-2 text-center">
                        <Trees className="h-6 w-6 text-[#1B4332]" />
                        <span className="mt-1 text-[10px] font-bold text-[#132A1E]">
                          {sp.germanName}
                        </span>
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-1.5 pt-4 pb-1 text-white sm:px-3 sm:pt-6 sm:pb-2">
                      <p className="font-mono text-[10px] font-semibold tabular-nums text-white/95 sm:text-xs">
                        <span className="sm:hidden">{peakProb}% max</span>
                        <span className="hidden sm:inline">Peak NRW stand: {peakProb}%</span>
                      </p>
                    </div>
                  </button>

                  {/* Card Content (Compact Zero-Pill Discipline) */}
                  <div className="flex min-w-0 flex-1 flex-col justify-between p-2.5 sm:p-3.5">
                    <div>
                      <h2 className="truncate text-sm font-bold leading-snug text-[#132A1E] sm:text-base">
                        {sp.germanName}
                      </h2>
                      <p className="truncate text-[11px] italic text-[#4A5D52]">
                        {sp.latinName} · {sp.englishName}
                      </p>

                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-[#4A5D52] sm:text-[11px]">
                        <span className="truncate">{sp.hostSummary}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">pH ~{sp.optimalPh.toFixed(1)}</span>
                      </div>

                      <p className="mt-1.5 hidden line-clamp-2 text-xs leading-snug text-[#4A5D52] sm:block">
                        {sp.description}
                      </p>

                      <p className="mt-1 truncate text-[10.5px] text-[#991B1B] sm:mt-2 sm:border-t sm:border-[#EFECE4] sm:pt-1.5 sm:text-[11px]">
                        <span className="font-semibold">Lookalike:</span> {sp.lookalike.germanName}
                      </p>
                    </div>

                    <div className="mt-2 flex items-center gap-1.5 sm:pt-2">
                      <button
                        type="button"
                        onClick={() => setSelectedSpecies(sp)}
                        className="h-8 flex-1 rounded-lg border border-[#D6D3C8] bg-[#F7F6F2] px-2 text-[11px] font-semibold text-[#132A1E] hover:bg-[#EFECE4] transition-colors sm:h-9 sm:text-xs"
                      >
                        ID &amp; Lookalikes
                      </button>
                      <button
                        type="button"
                        onClick={() => onFilterMapBySpecies(sp.id)}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[#1B4332] px-2.5 text-[11px] font-semibold text-white hover:bg-[#132A1E] transition-colors sm:h-9 sm:px-3 sm:text-xs"
                      >
                        <MapPin className="h-3 w-3" />
                        <span>Map</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Full Species Botanical Dossier Modal / Sheet */}
      {selectedSpecies && (
        <div
          className="fixed inset-0 z-[900] flex items-end justify-center bg-black/55 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="species-dossier-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDossier();
          }}
        >
          <div className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-[#D6D3C8] bg-white shadow-2xl sm:rounded-2xl">
            {/* Modal Top Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[#D6D3C8] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] text-[#4A5D52]">
                  {selectedSpecies.edibility} · {selectedSpecies.seasonLabel}
                </p>
                <h2
                  id="species-dossier-title"
                  className="mt-0.5 truncate text-lg font-bold text-[#132A1E]"
                >
                  {selectedSpecies.germanName}
                </h2>
                <p className="text-[11px] italic text-[#4A5D52]">
                  {selectedSpecies.latinName} ({selectedSpecies.englishName})
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseDossier}
                aria-label="Close species guide"
                className="flex h-9 w-9 -mr-1 items-center justify-center rounded-lg text-[#4A5D52] hover:bg-[#F7F6F2] hover:text-[#132A1E]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Scroll Body */}
            <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5">
              <div className="overflow-hidden rounded-xl border border-[#D6D3C8] bg-[#E8E6DC]">
                {!failedImages[selectedSpecies.id] ? (
                  <img
                    src={selectedSpecies.imagePath}
                    alt={`${selectedSpecies.germanName} botanical photograph`}
                    referrerPolicy="no-referrer"
                    className="aspect-[16/10] w-full max-h-52 object-cover sm:max-h-64"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm font-semibold text-[#132A1E]">
                    {selectedSpecies.germanName}
                  </div>
                )}
              </div>

              <p className="text-xs leading-relaxed text-[#132A1E] sm:text-sm">
                {selectedSpecies.description}
              </p>

              {/* Key Identification Checkpoints */}
              <div>
                <h3 className="text-[11px] font-bold tracking-wide text-[#4A5D52]">
                  Key Field Identification Checkpoints
                </h3>
                <ul className="mt-1.5 space-y-1.5">
                  {selectedSpecies.idCheckpoints.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-xs text-[#132A1E] sm:text-[13px]">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#15803D]" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Toxic Lookalike Comparison */}
              <div className="rounded-xl border border-[#B91C1C]/35 bg-[#FEF2F2] p-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#991B1B]" />
                  <div>
                    <p className="text-[11px] font-bold text-[#991B1B]">
                      Lookalike Warning ·{' '}
                      {selectedSpecies.lookalike.toxicity === 'deadly'
                        ? 'Potentially Deadly'
                        : selectedSpecies.lookalike.toxicity === 'toxic'
                        ? 'Toxic'
                        : 'Inedible / Bitter'}
                    </p>
                    <p className="mt-0.5 text-xs font-bold text-[#7F1D1D] sm:text-sm">
                      {selectedSpecies.lookalike.germanName}{' '}
                      <span className="font-normal italic">
                        ({selectedSpecies.lookalike.latinName})
                      </span>
                    </p>
                    <ul className="mt-1.5 space-y-1 text-[11px] leading-snug text-[#7F1D1D]">
                      {selectedSpecies.lookalike.distinguishingCues.map((cue) => (
                        <li key={cue}>• {cue}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* NRW Habitat & Seasonality Chart */}
              <div className="grid grid-cols-1 gap-3 border-t border-[#EFECE4] pt-3 sm:grid-cols-2">
                <div>
                  <h3 className="text-[11px] font-bold tracking-wide text-[#4A5D52]">
                    NRW Forest Habitat &amp; Soil
                  </h3>
                  <p className="mt-1 text-[11px] leading-snug text-[#4A5D52]">
                    {selectedSpecies.habitatNotes}
                  </p>
                  <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[#132A1E]">
                    {selectedSpecies.hostSummary} · pH ~{selectedSpecies.optimalPh.toFixed(1)} ·{' '}
                    {selectedSpecies.elevationWindow[0]}–{selectedSpecies.elevationWindow[1]}m
                  </p>
                  <p className="mt-1 text-[11px] text-[#4A5D52]">{selectedSpecies.legalNote}</p>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold tracking-wide text-[#4A5D52]">
                    German Fruiting Calendar
                  </h3>
                  <div className="mt-2 flex h-16 items-end gap-1">
                    {selectedSpecies.monthlySeasonality.map((val, idx) => (
                      <div key={idx} className="flex flex-1 flex-col items-center gap-0.5">
                        <div className="flex h-12 w-full items-end rounded-t-xs bg-[#F7F6F2]">
                          <div
                            className="w-full rounded-t-xs"
                            style={{
                              height: `${Math.max(4, Math.round(val * 100))}%`,
                              backgroundColor: val >= 0.7 ? '#1B4332' : val >= 0.25 ? '#C86D1F' : '#D6D3C8',
                            }}
                          />
                        </div>
                        <span className="font-mono text-[9.5px] text-[#4A5D52]">
                          {MONTH_LABELS[idx]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer CTA (iOS Safe-Area Aware) */}
            <div className="pb-safe border-t border-[#D6D3C8] bg-[#F7F6F2]">
              <div className="flex items-center justify-end gap-2 px-4 py-2.5">
                <button
                  type="button"
                  onClick={handleCloseDossier}
                  className="h-10 rounded-xl border border-[#D6D3C8] bg-white px-3.5 text-xs font-semibold text-[#132A1E] hover:bg-[#EFECE4]"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = selectedSpecies.id;
                    handleCloseDossier();
                    onFilterMapBySpecies(id);
                  }}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1B4332] px-4 text-xs font-semibold text-white hover:bg-[#132A1E] sm:flex-none"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  <span>View on Map</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
