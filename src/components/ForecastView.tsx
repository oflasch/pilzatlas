import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CloudRain,
  Droplets,
  RefreshCw,
  Snowflake,
  Sparkles,
  Thermometer,
} from 'lucide-react';
import { NRW_SUBREGIONS, NRW_SUBREGION_LIST } from '../data/nrwForestStands';
import { computeWeightedRainLag, getTierMeta } from '../services/ecologyEngine';
import type {
  NRWForestStand,
  StandPrediction,
  SubRegionId,
  SubRegionWeatherSeries,
  WeatherMode,
} from '../types/foraging';

interface ForecastViewProps {
  stands: NRWForestStand[];
  predictions: Record<string, StandPrediction>;
  weatherByRegion: Record<SubRegionId, SubRegionWeatherSeries>;
  forecastDayOffset: number;
  onChangeForecastDay: (offset: number) => void;
  weatherMode: WeatherMode;
  onChangeWeatherMode: (mode: WeatherMode) => void;
  weatherLoading: boolean;
  weatherError: string | null;
  onRefreshWeather: () => void;
  onJumpToStand: (standId: string) => void;
}

export const ForecastView: React.FC<ForecastViewProps> = ({
  stands,
  predictions,
  weatherByRegion,
  forecastDayOffset,
  onChangeForecastDay,
  weatherMode,
  onChangeWeatherMode,
  weatherLoading,
  weatherError,
  onRefreshWeather,
  onJumpToStand,
}) => {
  const [selectedSubRegion, setSelectedSubRegion] = useState<SubRegionId>('bergisches-land');
  const [showAllStands, setShowAllStands] = useState(false);
  const activeSeries = weatherByRegion[selectedSubRegion];
  const targetIdx = Math.min(
    activeSeries.days.length - 1,
    activeSeries.todayIndex + forecastDayOffset
  );
  const selectedDay = activeSeries.days[targetIdx];
  const rainLagMm = computeWeightedRainLag(activeSeries.days, targetIdx);

  const forecastSlice = useMemo(
    () => activeSeries.days.slice(activeSeries.todayIndex, activeSeries.todayIndex + 7),
    [activeSeries]
  );

  // Last 18 days + 7 forecast days for precipitation bar chart
  const chartDays = useMemo(() => {
    const start = Math.max(0, activeSeries.todayIndex - 17);
    return activeSeries.days.slice(start, activeSeries.todayIndex + 7);
  }, [activeSeries]);

  const maxPrecip = useMemo(
    () => Math.max(12, ...chartDays.map((d) => d.precipitationMm)),
    [chartDays]
  );

  const topStands = useMemo(() => {
    return stands
      .filter((s) => !s.isProtectedNSG && s.subRegion === selectedSubRegion)
      .map((stand) => ({ stand, pred: predictions[stand.id] }))
      .filter((x) => Boolean(x.pred))
      .sort((a, b) => b.pred.probability - a.pred.probability);
  }, [stands, predictions, selectedSubRegion]);

  const visibleStands = showAllStands ? topStands : topStands.slice(0, 10);

  return (
    <div className="h-full overflow-y-auto bg-[#F7F6F2] pb-6">
      <div className="mx-auto max-w-6xl px-3 py-3 sm:px-5 sm:py-4">
        {/* Compact Page Header */}
        <div className="flex flex-col justify-between gap-2 border-b border-[#D6D3C8] pb-2.5 sm:flex-row sm:items-end sm:gap-3 sm:pb-3.5">
          <div>
            <p className="text-[10.5px] font-medium text-[#4A5D52] sm:text-xs">
              DWD ICON-D2 · 21d Rain Lag &amp; Soil Moisture
            </p>
            <h1 className="text-lg font-bold tracking-tight text-[#132A1E] sm:text-2xl">
              NRW 7-Day Fruiting Forecast
            </h1>
          </div>

          <div className="flex items-center justify-between gap-1.5 sm:justify-end">
            <div className="flex flex-1 items-center rounded-lg border border-[#D6D3C8] bg-white p-0.5 sm:flex-none">
              <button
                type="button"
                onClick={() => onChangeWeatherMode('live')}
                className={`h-8 flex-1 rounded-md px-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap sm:flex-none sm:text-xs ${
                  weatherMode === 'live'
                    ? 'bg-[#1B4332] text-white'
                    : 'text-[#4A5D52] hover:text-[#132A1E]'
                }`}
              >
                Live DWD
              </button>
              <button
                type="button"
                onClick={() => onChangeWeatherMode('peak-autumn')}
                className={`inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md px-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap sm:flex-none sm:text-xs ${
                  weatherMode === 'peak-autumn'
                    ? 'bg-[#C86D1F] text-white'
                    : 'text-[#4A5D52] hover:text-[#132A1E]'
                }`}
              >
                <Sparkles className="h-3 w-3 shrink-0" />
                <span>Oct Peak</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onRefreshWeather}
              disabled={weatherLoading}
              aria-label="Sync DWD weather"
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#D6D3C8] bg-white px-2.5 text-[11px] font-semibold text-[#132A1E] hover:bg-[#EFECE4] disabled:opacity-50 shrink-0 sm:text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${weatherLoading ? 'animate-spin' : ''}`} />
              <span>Sync</span>
            </button>
          </div>
        </div>

        {weatherError && weatherMode === 'live' && (
          <div className="mt-2.5 rounded-xl border border-[#C86D1F]/40 bg-[#FFFBEB] px-3 py-2 text-[11px] text-[#92400E]">
            {weatherError}
          </div>
        )}

        {/* Compact 2x3 Sub-Region Comparison Cards on iPhone, 3x2 on Desktop */}
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:mt-3.5 sm:gap-2.5 lg:grid-cols-3">
          {NRW_SUBREGION_LIST.map((sr) => {
            const series = weatherByRegion[sr.id];
            const idx = Math.min(series.days.length - 1, series.todayIndex + forecastDayOffset);
            const day = series.days[idx];
            const lag = computeWeightedRainLag(series.days, idx);
            const active = selectedSubRegion === sr.id;
            const frost = day.minAirTempC <= -1.0 || day.soilTemp6cmC <= 2.0;

            return (
              <button
                key={sr.id}
                type="button"
                onClick={() => {
                  setSelectedSubRegion(sr.id);
                  setShowAllStands(false);
                }}
                className={`flex flex-col rounded-xl border p-2 text-left transition-all sm:p-3 ${
                  active
                    ? 'border-[#1B4332] bg-white shadow-xs ring-1 ring-[#1B4332]'
                    : 'border-[#D6D3C8] bg-white/85 hover:border-[#4A5D52] hover:bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[#132A1E] sm:text-[13px]">
                      <span className="sm:hidden">{sr.shortName}</span>
                      <span className="hidden sm:inline">{sr.name}</span>
                    </p>
                    <p className="truncate text-[9.5px] text-[#4A5D52] sm:text-[11px]">
                      {sr.elevationRange[0]}–{sr.elevationRange[1]}m · pH {sr.typicalPhRange[0]}–{sr.typicalPhRange[1]}
                    </p>
                  </div>
                  {frost && (
                    <Snowflake className="h-3.5 w-3.5 shrink-0 text-[#1D4ED8]" aria-label="Frost risk" />
                  )}
                </div>

                <div className="mt-1.5 grid grid-cols-3 gap-1 border-t border-[#EFECE4] pt-1.5 sm:mt-2 sm:pt-2">
                  <div>
                    <span className="text-[9px] text-[#4A5D52] sm:text-[10px]">Rain</span>
                    <p className="font-mono text-[11.5px] font-semibold tabular-nums text-[#132A1E] sm:text-xs">
                      {lag.toFixed(0)}<span className="text-[8.5px] font-normal">mm</span>
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#4A5D52] sm:text-[10px]">Moist</span>
                    <p className="font-mono text-[11.5px] font-semibold tabular-nums text-[#132A1E] sm:text-xs">
                      {(day.soilMoisture3to9 * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#4A5D52] sm:text-[10px]">Soil</span>
                    <p className="font-mono text-[11.5px] font-semibold tabular-nums text-[#132A1E] sm:text-xs">
                      {day.soilTemp6cmC.toFixed(0)}°C
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 7-Day Selector + 24-Day Rain Lag Chart & Top Stands Split */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-12">
          {/* Left: Rainfall Lag Chart & Soil Conditions */}
          <div className="rounded-xl border border-[#D6D3C8] bg-white p-3 sm:rounded-2xl sm:p-4 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div>
                <h2 className="text-[13px] font-bold text-[#132A1E] sm:text-sm">
                  {NRW_SUBREGIONS[selectedSubRegion].shortName} — Rain Lag &amp; Soil
                </h2>
                <p className="text-[10.5px] text-[#4A5D52] sm:text-[11px]">
                  Fruiting peaks 10–15d after soaking rain (shaded window)
                </p>
              </div>
              <span className="font-mono text-[10.5px] tabular-nums text-[#4A5D52]">
                {weatherMode === 'peak-autumn' ? 'Oct Flush' : selectedDay.date}
              </span>
            </div>

            {/* 7-Day Day Buttons */}
            <div className="mt-2.5 grid grid-cols-7 gap-1 sm:mt-3">
              {forecastSlice.map((d, offset) => {
                const dt = new Date(`${d.date}T12:00:00`);
                const label = offset === 0 ? 'Today' : dt.toLocaleDateString('en-GB', { weekday: 'short' });
                const active = forecastDayOffset === offset;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => onChangeForecastDay(offset)}
                    className={`flex min-h-[36px] flex-col items-center justify-center rounded-lg border px-0.5 py-0.5 transition-colors sm:min-h-[40px] sm:px-1.5 ${
                      active
                        ? 'border-[#1B4332] bg-[#1B4332] text-white'
                        : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#132A1E] hover:bg-[#EFECE4]'
                    }`}
                  >
                    <span className="text-[9.5px] font-semibold leading-tight sm:text-[11px]">{label}</span>
                    <span
                      className={`font-mono text-[8.5px] tabular-nums leading-tight sm:text-[9.5px] ${
                        active ? 'text-white/80' : 'text-[#4A5D52]'
                      }`}
                    >
                      {d.precipitationMm.toFixed(0)}mm
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Crisp Responsive SVG Precipitation Lag Chart */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-[10.5px] text-[#4A5D52]">
                <span>Past 17d rain → 7d forecast</span>
                <span className="font-mono tabular-nums">Max {maxPrecip.toFixed(0)} mm</span>
              </div>
              <div className="mt-1 w-full">
                <svg
                  viewBox="0 0 600 150"
                  className="h-28 w-full sm:h-36"
                  role="img"
                  aria-label="Daily precipitation history and 7-day forecast chart"
                >
                  <line x1="0" y1="28" x2="600" y2="28" stroke="#EFECE4" strokeWidth="1" />
                  <line x1="0" y1="74" x2="600" y2="74" stroke="#EFECE4" strokeWidth="1" />
                  <line x1="0" y1="120" x2="600" y2="120" stroke="#D6D3C8" strokeWidth="1.2" />

                  {chartDays.map((day, idx) => {
                    const barW = 600 / chartDays.length;
                    const x = idx * barW + 3;
                    const w = Math.max(8, barW - 6);
                    const h = Math.max(2, (day.precipitationMm / maxPrecip) * 96);
                    const y = 120 - h;
                    const globalIdx = activeSeries.todayIndex - 17 + idx;
                    const daysBeforeTarget = targetIdx - globalIdx;
                    const inPrimeLagWindow = daysBeforeTarget >= 7 && daysBeforeTarget <= 15;
                    const isSelectedTarget = globalIdx === targetIdx;
                    const isForecast = globalIdx >= activeSeries.todayIndex;

                    const fill = isSelectedTarget
                      ? '#C86D1F'
                      : inPrimeLagWindow
                      ? '#1B4332'
                      : isForecast
                      ? '#60A5FA'
                      : '#9CAFA4';

                    return (
                      <g key={day.date}>
                        {inPrimeLagWindow && (
                          <rect
                            x={idx * barW}
                            y={10}
                            width={barW}
                            height={110}
                            fill="#1B4332"
                            fillOpacity="0.06"
                          />
                        )}
                        <rect x={x} y={y} width={w} height={h} rx="2.5" fill={fill} />
                        {isSelectedTarget && (
                          <text
                            x={x + w / 2}
                            y={138}
                            textAnchor="middle"
                            fontSize="9.5"
                            fontWeight="700"
                            fill="#C86D1F"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            Target
                          </text>
                        )}
                        {!isSelectedTarget && idx % 4 === 0 && (
                          <text
                            x={x + w / 2}
                            y={138}
                            textAnchor="middle"
                            fontSize="9"
                            fill="#4A5D52"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {day.date.slice(5)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[#4A5D52]">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-xs bg-[#1B4332]" />
                  <span>7–15d lag</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-xs bg-[#C86D1F]" />
                  <span>Selected day</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-xs bg-[#60A5FA]" />
                  <span>Forecast</span>
                </span>
              </div>
            </div>

            {/* Selected Day Microclimate Breakdown */}
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#EFECE4] pt-2.5">
              <div>
                <div className="flex items-center gap-1 text-[10.5px] text-[#4A5D52]">
                  <CloudRain className="h-3 w-3 shrink-0 text-[#1B4332]" />
                  <span className="truncate">Rain Lag</span>
                </div>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#132A1E] sm:text-base">
                  {rainLagMm.toFixed(1)} mm
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10.5px] text-[#4A5D52]">
                  <Droplets className="h-3 w-3 shrink-0 text-[#1B4332]" />
                  <span className="truncate">Soil Moist</span>
                </div>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#132A1E] sm:text-base">
                  {(selectedDay.soilMoisture3to9 * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10.5px] text-[#4A5D52]">
                  <Thermometer className="h-3 w-3 shrink-0 text-[#C86D1F]" />
                  <span className="truncate">Soil / Air</span>
                </div>
                <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#132A1E] sm:text-base">
                  {selectedDay.soilTemp6cmC.toFixed(0)}° / {selectedDay.minAirTempC.toFixed(0)}°C
                </p>
              </div>
            </div>
          </div>

          {/* Right: Ranked Forest Stands for Selected Sub-Region */}
          <div className="rounded-xl border border-[#D6D3C8] bg-white p-3 sm:rounded-2xl sm:p-4 lg:col-span-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-bold text-[#132A1E] sm:text-sm">
                Best Open Stands · {NRW_SUBREGIONS[selectedSubRegion].shortName}
              </h2>
              <span className="font-mono text-[10.5px] tabular-nums text-[#4A5D52]">
                {topStands.length} stands
              </span>
            </div>

            <div className="mt-1.5 divide-y divide-[#EFECE4]">
              {visibleStands.map(({ stand, pred }) => {
                const tierMeta = getTierMeta(pred.tier);
                return (
                  <button
                    key={stand.id}
                    type="button"
                    onClick={() => onJumpToStand(stand.id)}
                    className="group flex min-h-[48px] w-full items-center justify-between gap-2 py-1.5 text-left transition-colors hover:bg-[#F7F6F2] px-1.5 -mx-1.5 rounded-lg"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[#132A1E] group-hover:text-[#1B4332] sm:text-[13px]">
                        {stand.name}
                      </p>
                      <p className="truncate text-[11px] text-[#4A5D52]">
                        {pred.bestSpeciesName} · pH {stand.soilPh.toFixed(1)} · {stand.elevationM}m
                      </p>
                      <p className="truncate text-[10px]" style={{ color: tierMeta.textColor }}>
                        {pred.limitingFactor}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-sm font-bold tabular-nums text-[#132A1E] sm:text-base">
                        {pred.probability}%
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#4A5D52] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1B4332]" />
                    </div>
                  </button>
                );
              })}
            </div>

            {topStands.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAllStands((v) => !v)}
                className="mt-2 min-h-[36px] w-full rounded-lg border border-[#D6D3C8] bg-[#F7F6F2] text-xs font-semibold text-[#132A1E] hover:bg-[#EFECE4]"
              >
                {showAllStands ? 'Show Top 10 Stands' : `Show All ${topStands.length} Stands`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
