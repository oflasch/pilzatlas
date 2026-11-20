/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CloudSun, HardDriveDownload, Map as MapIcon } from 'lucide-react';
import { FieldGuideView } from './components/FieldGuideView';
import { ForecastView } from './components/ForecastView';
import { MushroomLogo } from './components/MushroomLogo';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OfflinePacksView } from './components/OfflinePacksView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { TopographicMapView } from './components/TopographicMapView';
import { NRW_FOREST_STANDS, NRW_SUBREGION_LIST } from './data/nrwForestStands';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { evaluateStand } from './services/ecologyEngine';
import {
  clearOsmStands,
  deleteOfflinePack,
  downloadSubRegionOfflinePack,
  loadAllOfflinePacks,
  loadOsmStands,
  saveOsmStands,
} from './services/offlineStorage';
import { fetchHighResNRWStandsInBounds } from './services/nrwGeodataService';
import {
  buildPeakAutumnReferenceWeather,
  buildSeasonalFallbackWeather,
  fetchAllNRWWeather,
} from './services/weatherService';
import type {
  ActiveTab,
  LayerSettings,
  NRWForestStand,
  OfflinePackRecord,
  RegionFilter,
  StandPrediction,
  SubRegionId,
  SubRegionWeatherSeries,
  WeatherMode,
} from './types/foraging';

const PEAK_AUTUMN_WEATHER = buildPeakAutumnReferenceWeather();

export default function App() {
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<ActiveTab>('map');
  const [activeRegion, setActiveRegion] = useState<RegionFilter>('all');
  const [activeSpeciesId, setActiveSpeciesId] = useState<string>('all');
  const [forecastDayOffset, setForecastDayOffset] = useState<number>(0);
  const [weatherMode, setWeatherMode] = useState<WeatherMode>('live');
  const [selectedStandId, setSelectedStandId] = useState<string | null>(null);
  const [focusedGuideSpeciesId, setFocusedGuideSpeciesId] = useState<string | null>(null);

  const [layers, setLayers] = useState<LayerSettings>({
    showNSG: true,
    minProbability: 0,
    showLabels: true,
    hideCuratedInHighRes: true,
    autoLoadHighRes: true,
  });

  const [liveWeather, setLiveWeather] = useState<Record<SubRegionId, SubRegionWeatherSeries>>(() =>
    buildSeasonalFallbackWeather()
  );
  const [weatherLoading, setWeatherLoading] = useState<boolean>(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  const [highResStands, setHighResStands] = useState<NRWForestStand[]>([]);
  const [highResLoading, setHighResLoading] = useState<boolean>(false);
  const [highResMessage, setHighResMessage] = useState<string | null>(null);

  const [offlinePacks, setOfflinePacks] = useState<Record<SubRegionId, OfflinePackRecord | null>>(
    () =>
      Object.fromEntries(
        NRW_SUBREGION_LIST.map((sr) => [sr.id, null])
      ) as Record<SubRegionId, OfflinePackRecord | null>
  );

  const allStands = useMemo(() => {
    const map = new Map<string, NRWForestStand>();
    NRW_FOREST_STANDS.forEach((s) => map.set(s.id, s));
    highResStands.forEach((s) => map.set(s.id, s));
    return Array.from(map.values());
  }, [highResStands]);

  const activeWeather = weatherMode === 'peak-autumn' ? PEAK_AUTUMN_WEATHER : liveWeather;

  const syncWeather = useCallback(async (force = false) => {
    setWeatherLoading(true);
    setWeatherError(null);
    const { weather, error } = await fetchAllNRWWeather(force);
    setLiveWeather(weather);
    if (error) setWeatherError(error);
    setWeatherLoading(false);
  }, []);

  // Initial hydration: live DWD ICON-D2 weather + IndexedDB offline packs + saved high-res WFS stands
  useEffect(() => {
    void syncWeather(false);
    void loadAllOfflinePacks().then(setOfflinePacks);
    void loadOsmStands().then(setHighResStands);
  }, [syncWeather]);

  // Compute mechanistic ecological predictions for every forest polygon
  const predictions = useMemo<Record<string, StandPrediction>>(() => {
    const out: Record<string, StandPrediction> = {};
    allStands.forEach((stand) => {
      out[stand.id] = evaluateStand(
        stand,
        activeSpeciesId,
        activeWeather,
        forecastDayOffset,
        weatherMode
      );
    });
    return out;
  }, [allStands, activeSpeciesId, activeWeather, forecastDayOffset, weatherMode]);

  const handleLoadHighResNRW = useCallback(
    async (bounds: { south: number; west: number; north: number; east: number }) => {
      setHighResLoading(true);
      try {
        const res = await fetchHighResNRWStandsInBounds(bounds);
        if (res.stands.length === 0) {
          setHighResMessage('Keine vermessenen NRW-Wald- oder NSG-Flächen im Kartenausschnitt gefunden.');
        } else {
          setHighResStands((prev) => {
            const byId = new Map(prev.map((s) => [s.id, s]));
            res.stands.forEach((d) => byId.set(d.id, d));
            // Keep most recent 650 surveyed polygons in memory so panning across multiple regions stays snappy
            const merged = Array.from(byId.values());
            return merged.length > 650 ? merged.slice(merged.length - 650) : merged;
          });
          await saveOsmStands(res.stands);
          const parts: string[] = [];
          if (res.counts.waldNrwForests > 0) parts.push(`${res.counts.waldNrwForests} Wald-NRW`);
          if (res.counts.fskSoilPolygons > 0) parts.push(`${res.counts.fskSoilPolygons} FSK05-Boden`);
          if (res.counts.lanuvProtected > 0) parts.push(`${res.counts.lanuvProtected} LANUV-NSG`);
          const enrichedNote =
            res.counts.enrichedWithFsk > 0 ? ` (${res.counts.enrichedWithFsk} mit FSK05-Boden)` : '';
          setHighResMessage(
            `Geladen: ${parts.join(' · ')}${enrichedNote} in ${(res.elapsedMs / 1000).toFixed(1)} s — offline gespeichert.`
          );
        }
      } catch (err) {
        setHighResMessage(
          err instanceof Error ? err.message : 'OpenGeodata.NRW-Proxy ist derzeit nicht erreichbar.'
        );
      } finally {
        setHighResLoading(false);
      }
    },
    []
  );

  const handleDownloadPack = useCallback(
    async (subRegion: SubRegionId, onProgress: (done: number, total: number) => void) => {
      const record = await downloadSubRegionOfflinePack(
        subRegion,
        liveWeather[subRegion],
        onProgress
      );
      setOfflinePacks((prev) => ({ ...prev, [subRegion]: record }));
    },
    [liveWeather]
  );

  const handleDeletePack = useCallback(async (subRegion: SubRegionId) => {
    await deleteOfflinePack(subRegion);
    setOfflinePacks((prev) => ({ ...prev, [subRegion]: null }));
  }, []);

  const handleClearHighResStands = useCallback(async () => {
    await clearOsmStands();
    setHighResStands([]);
    setHighResMessage('Gespeicherte hochauflösende NRW-Flächen wurden geleert.');
  }, []);

  const handleOpenSpeciesGuide = useCallback((speciesId: string) => {
    setFocusedGuideSpeciesId(speciesId);
    setActiveTab('guide');
  }, []);

  const handleFilterMapBySpecies = useCallback((speciesId: string) => {
    setActiveSpeciesId(speciesId);
    setActiveTab('map');
  }, []);

  const handleJumpToStand = useCallback((standId: string) => {
    setSelectedStandId(standId);
    setActiveTab('map');
  }, []);

  const navItems: { id: ActiveTab; label: string; icon: typeof MapIcon }[] = [
    { id: 'map', label: 'Karte', icon: MapIcon },
    { id: 'forecast', label: 'Prognose', icon: CloudSun },
    { id: 'guide', label: 'Pilzführer', icon: BookOpen },
    { id: 'offline', label: 'Offline', icon: HardDriveDownload },
  ];

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#F7F6F2] text-[#132A1E]">
      {/* Top Bar: Ultra-Compact iOS-safe 40px on Mobile, Clean 3-Zone 48px on Desktop */}
      <header className="pt-safe z-[500] shrink-0 border-b border-[#D6D3C8] bg-[#FFFFFF]/95 backdrop-blur-md">
        <div className="flex h-10 items-center justify-between gap-3 px-2.5 lg:h-12 lg:gap-8 lg:px-5">
          {/* Zone 1: Friendly Comic Mushroom Logo + Single-Line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('map')}
            className="group flex items-center gap-1.5 font-display text-[15px] font-bold tracking-tight text-[#132A1E] whitespace-nowrap shrink-0 lg:gap-2 lg:text-[17px]"
          >
            <MushroomLogo className="h-7 w-7 shrink-0 transition-transform duration-150 group-hover:scale-105 lg:h-8 lg:w-8" />
            <span>PilzAtlas NRW</span>
          </button>

          {/* Zone 2: Clean Single-Line Navigation Links (Desktop) */}
          <nav
            aria-label="Hauptnavigation"
            className="hidden items-center gap-6 lg:flex"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative min-h-[38px] px-1 text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-[#1B4332] font-semibold'
                      : 'text-[#4A5D52] hover:text-[#132A1E]'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 -bottom-[6px] h-0.5 bg-[#1B4332]"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            <PWAInstallButton compact />
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="relative flex-1 overflow-hidden">
        {activeTab === 'map' && (
          <TopographicMapView
            stands={allStands}
            predictions={predictions}
            weatherByRegion={activeWeather}
            activeRegion={activeRegion}
            onChangeRegion={setActiveRegion}
            activeSpeciesId={activeSpeciesId}
            onChangeSpecies={setActiveSpeciesId}
            forecastDayOffset={forecastDayOffset}
            onChangeForecastDay={setForecastDayOffset}
            weatherMode={weatherMode}
            onChangeWeatherMode={setWeatherMode}
            selectedStandId={selectedStandId}
            onSelectStand={setSelectedStandId}
            layers={layers}
            onChangeLayers={setLayers}
            onLoadHighResNRW={handleLoadHighResNRW}
            highResLoading={highResLoading}
            highResMessage={highResMessage}
            highResCount={highResStands.length}
            isOnline={isOnline}
            onOpenSpeciesGuide={handleOpenSpeciesGuide}
          />
        )}

        {activeTab === 'forecast' && (
          <ForecastView
            stands={allStands}
            predictions={predictions}
            weatherByRegion={activeWeather}
            forecastDayOffset={forecastDayOffset}
            onChangeForecastDay={setForecastDayOffset}
            weatherMode={weatherMode}
            onChangeWeatherMode={setWeatherMode}
            weatherLoading={weatherLoading}
            weatherError={weatherError}
            onRefreshWeather={() => void syncWeather(true)}
            onJumpToStand={handleJumpToStand}
          />
        )}

        {activeTab === 'guide' && (
          <FieldGuideView
            predictions={predictions}
            focusedSpeciesId={focusedGuideSpeciesId}
            onClearFocusedSpecies={() => setFocusedGuideSpeciesId(null)}
            onFilterMapBySpecies={handleFilterMapBySpecies}
          />
        )}

        {activeTab === 'offline' && (
          <OfflinePacksView
            offlinePacks={offlinePacks}
            weatherByRegion={liveWeather}
            isOnline={isOnline}
            osmStandCount={highResStands.length}
            onDownloadPack={handleDownloadPack}
            onDeletePack={handleDeletePack}
            onClearOsmStands={handleClearHighResStands}
          />
        )}
      </main>

      {/* Mobile Ergonomic iOS-Safe Thumb-Zone Bottom Tab Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="pb-safe z-[500] shrink-0 border-t border-[#D6D3C8] bg-[#FFFFFF]/95 backdrop-blur-md lg:hidden"
      >
        <div className="grid h-[48px] grid-cols-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#1B4332] font-semibold' : 'text-[#4A5D52]'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 1.85} />
                <span className="text-[9.5px] leading-none tracking-tight whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Non-intrusive Offline Connectivity Indicator */}
      <OfflineIndicator />
    </div>
  );
}
