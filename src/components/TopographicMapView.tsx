import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Calendar,
  Crosshair,
  Eye,
  EyeOff,
  Filter,
  Loader2,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  NRW_CORRIDOR_BOUNDS,
  NRW_SUBREGIONS,
  NRW_SUBREGION_LIST,
} from '../data/nrwForestStands';
import { NRW_MUSHROOM_SPECIES } from '../data/species';
import { getTierMeta } from '../services/ecologyEngine';
import type {
  LayerSettings,
  NRWForestStand,
  RegionFilter,
  StandPrediction,
  SubRegionId,
  SubRegionWeatherSeries,
  WeatherMode,
} from '../types/foraging';
import { StandInspectorPanel } from './StandInspectorPanel';

interface TopographicMapViewProps {
  stands: NRWForestStand[];
  predictions: Record<string, StandPrediction>;
  weatherByRegion: Record<SubRegionId, SubRegionWeatherSeries>;
  activeRegion: RegionFilter;
  onChangeRegion: (region: RegionFilter) => void;
  activeSpeciesId: string;
  onChangeSpecies: (speciesId: string) => void;
  forecastDayOffset: number;
  onChangeForecastDay: (offset: number) => void;
  weatherMode: WeatherMode;
  onChangeWeatherMode: (mode: WeatherMode) => void;
  selectedStandId: string | null;
  onSelectStand: (standId: string | null) => void;
  layers: LayerSettings;
  onChangeLayers: (layers: LayerSettings) => void;
  onLoadHighResNRW: (bounds: { south: number; west: number; north: number; east: number }) => Promise<void>;
  highResLoading: boolean;
  highResMessage: string | null;
  highResCount: number;
  isOnline: boolean;
  onOpenSpeciesGuide: (speciesId: string) => void;
}

function formatDayChip(isoDate: string, offset: number): { top: string; bottom: string } {
  const d = new Date(`${isoDate}T12:00:00`);
  const weekday = offset === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' });
  const dayNum = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return { top: weekday, bottom: dayNum };
}

export const TopographicMapView: React.FC<TopographicMapViewProps> = ({
  stands,
  predictions,
  weatherByRegion,
  activeRegion,
  onChangeRegion,
  activeSpeciesId,
  onChangeSpecies,
  forecastDayOffset,
  onChangeForecastDay,
  weatherMode,
  onChangeWeatherMode,
  selectedStandId,
  onSelectStand,
  layers,
  onChangeLayers,
  onLoadHighResNRW,
  highResLoading,
  highResMessage,
  highResCount,
  isOnline,
  onOpenSpeciesGuide,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonsLayerRef = useRef<L.LayerGroup | null>(null);
  const naturraumLabelsLayerRef = useRef<L.LayerGroup | null>(null);
  const gpsMarkerRef = useRef<L.CircleMarker | null>(null);
  const gpsAccuracyRef = useRef<L.Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const fetchedTilesRef = useRef<Set<string>>(new Set());
  const autoLoadTimerRef = useRef<number | null>(null);

  const [gpsActive, setGpsActive] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [basemapFallback, setBasemapFallback] = useState(false);
  const [showControlsSheet, setShowControlsSheet] = useState(false);
  const [mapZoom, setMapZoom] = useState<number>(8);
  const [viewportBounds, setViewportBounds] = useState<{
    south: number;
    west: number;
    north: number;
    east: number;
  } | null>(null);
  const [dismissedMsg, setDismissedMsg] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState<boolean>(false);

  // Reset mobile sheet to half-height peek whenever a new polygon is selected
  useEffect(() => {
    setSheetExpanded(false);
  }, [selectedStandId]);

  const selectedStand = useMemo(
    () => stands.find((s) => s.id === selectedStandId) ?? null,
    [stands, selectedStandId]
  );

  // Reference weather series for the 7-day timeline labels
  const refSeries =
    activeRegion === 'all'
      ? weatherByRegion['bergisches-land']
      : weatherByRegion[activeRegion];
  const forecastDays = useMemo(() => {
    const start = refSeries.todayIndex;
    return refSeries.days.slice(start, start + 7);
  }, [refSeries]);

  // Summary counts for visible filtered polygons
  const visibleSummary = useMemo(() => {
    let highCount = 0;
    let peakCount = 0;
    let nsgCount = 0;
    stands.forEach((s) => {
      if (activeRegion !== 'all' && s.subRegion !== activeRegion) return;
      const p = predictions[s.id];
      if (!p) return;
      if (s.isProtectedNSG) nsgCount++;
      else if (p.tier === 'peak') peakCount++;
      else if (p.tier === 'high') highCount++;
    });
    return { highCount, peakCount, nsgCount };
  }, [stands, predictions, activeRegion]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [51.42, 7.62],
      zoom: 8,
      minZoom: 7,
      maxZoom: 16,
      zoomControl: false,
      preferCanvas: false, // SVG renderer allows crisp crimson diagonal hatch pattern on NSG zones
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    const topoLayer = L.tileLayer('https://a.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 16,
      attribution:
        '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> · <a href="https://opentopomap.org">OpenTopoMap</a>',
      crossOrigin: true,
    });

    let tileErrors = 0;
    topoLayer.on('tileerror', () => {
      tileErrors++;
      if (tileErrors >= 6 && !basemapFallback) {
        setBasemapFallback(true);
      }
    });

    topoLayer.addTo(map);
    map.fitBounds(NRW_CORRIDOR_BOUNDS, { padding: [22, 22] });
    const syncViewport = () => {
      setMapZoom(map.getZoom());
      const b = map.getBounds();
      setViewportBounds({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
    };
    syncViewport();
    map.on('zoomend', syncViewport);
    map.on('moveend', syncViewport);

    // Inject SVG diagonal hatch pattern into Leaflet's overlay pane for color-blind-safe NSG zones
    map.whenReady(() => {
      const overlayPane = map.getPanes().overlayPane;
      const svgEl = overlayPane.querySelector('svg');
      if (svgEl && !svgEl.querySelector('#nsg-crimson-hatch')) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
          <pattern id="nsg-crimson-hatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#B91C1C" fill-opacity="0.14" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="#991B1B" stroke-width="2.2" stroke-opacity="0.72" />
          </pattern>
        `;
        svgEl.insertBefore(defs, svgEl.firstChild);
      }
    });

    polygonsLayerRef.current = L.layerGroup().addTo(map);
    naturraumLabelsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch to OSM Standard fallback if OpenTopoMap fails repeatedly online
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !basemapFallback) return;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; OpenStreetMap contributors',
      crossOrigin: true,
    }).addTo(map);
  }, [basemapFallback]);

  // Pan/zoom when sub-region filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (activeRegion === 'all') {
      map.fitBounds(NRW_CORRIDOR_BOUNDS, { padding: [26, 26], animate: true });
    } else {
      const meta = NRW_SUBREGIONS[activeRegion];
      map.fitBounds(meta.bounds, { padding: [28, 28], animate: true });
    }
  }, [activeRegion]);

  // Render approximate cartographic Naturraum labels at overview zoom (<= 10)
  useEffect(() => {
    const labelGroup = naturraumLabelsLayerRef.current;
    if (!labelGroup) return;
    labelGroup.clearLayers();
    if (mapZoom > 10) return;

    NRW_SUBREGION_LIST.forEach((sr) => {
      const isFocused = activeRegion === sr.id;
      const icon = L.divIcon({
        className: 'pilz-naturraum-label',
        html: `<div style="transform:translate(-50%,-50%);font-family:'Bricolage Grotesque',sans-serif;font-size:${
          mapZoom <= 8 ? 11 : 12.5
        }px;font-weight:700;letter-spacing:0.06em;color:${
          isFocused ? '#1B4332' : '#132A1E'
        };text-shadow:0 1px 3px rgba(255,255,255,0.98),0 0 8px rgba(247,246,242,0.98),0 0 2px #FFFFFF;white-space:nowrap;pointer-events:auto;cursor:pointer;opacity:${
          activeRegion === 'all' || isFocused ? 0.92 : 0.45
        };">${sr.naturraumLabel}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker(sr.labelPosition, { icon, interactive: true })
        .on('click', () => onChangeRegion(sr.id))
        .addTo(labelGroup);
    });
  }, [mapZoom, activeRegion, onChangeRegion]);

  // Automatic high-resolution NRW WFS loading when zoomed in to stand level (zoom >= 12)
  useEffect(() => {
    if (!isOnline || !layers.autoLoadHighRes || !viewportBounds || mapZoom < 12) return;
    const centerLat = (viewportBounds.south + viewportBounds.north) / 2;
    const centerLng = (viewportBounds.west + viewportBounds.east) / 2;
    // Only auto-query inside NRW extent
    if (centerLat < 50.28 || centerLat > 52.55 || centerLng < 5.82 || centerLng > 9.5) return;

    const tileKey = `${(Math.round(centerLat * 20) / 20).toFixed(2)},${(Math.round(centerLng * 20) / 20).toFixed(2)}`;
    if (fetchedTilesRef.current.has(tileKey)) return;

    if (autoLoadTimerRef.current) window.clearTimeout(autoLoadTimerRef.current);
    autoLoadTimerRef.current = window.setTimeout(() => {
      fetchedTilesRef.current.add(tileKey);
      void onLoadHighResNRW(viewportBounds);
    }, 450);

    return () => {
      if (autoLoadTimerRef.current) window.clearTimeout(autoLoadTimerRef.current);
    };
  }, [viewportBounds, mapZoom, isOnline, layers.autoLoadHighRes, onLoadHighResNRW]);

  // Pan gently to selected stand if selected externally (e.g. from Forecast tab)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStand) return;
    const currentZoom = map.getZoom();
    map.setView(selectedStand.centroid, Math.max(currentZoom, 12), { animate: true });
  }, [selectedStand?.id]);

  // Re-render forest stand polygons whenever scores, layers, or selection change
  useEffect(() => {
    const map = mapRef.current;
    const group = polygonsLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    // Ensure SVG hatch pattern exists once first polygon creates the SVG renderer
    const ensureHatchPattern = () => {
      const svgEl = map.getPanes().overlayPane.querySelector('svg');
      if (svgEl && !svgEl.querySelector('#nsg-crimson-hatch')) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
          <pattern id="nsg-crimson-hatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#B91C1C" fill-opacity="0.14" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="#991B1B" stroke-width="2.2" stroke-opacity="0.72" />
          </pattern>
        `;
        svgEl.insertBefore(defs, svgEl.firstChild);
      }
    };

    // Detect if high-res surveyed NRW stands are present near the current zoomed-in viewport
    const highResInView = stands.filter((s) => {
      if (s.source === 'curated-nrw') return false;
      if (!viewportBounds) return true;
      const [lat, lng] = s.centroid;
      return (
        lat >= viewportBounds.south - 0.08 &&
        lat <= viewportBounds.north + 0.08 &&
        lng >= viewportBounds.west - 0.12 &&
        lng <= viewportBounds.east + 0.12
      );
    });
    const hideCuratedLocally =
      layers.hideCuratedInHighRes && mapZoom >= 11 && highResInView.length >= 4;

    const renderList = stands.filter((stand) => {
      const pred = predictions[stand.id];
      if (!pred) return false;
      if (stand.isProtectedNSG && !layers.showNSG) return false;
      if (!stand.isProtectedNSG && pred.probability < layers.minProbability) return false;
      if (hideCuratedLocally && stand.source === 'curated-nrw' && stand.id !== selectedStandId) {
        // Hide coarse overview blobs that sit inside a loaded high-res NRW survey area
        const [lat, lng] = stand.centroid;
        const nearHighRes = highResInView.some(
          (hr) => Math.abs(hr.centroid[0] - lat) < 0.085 && Math.abs(hr.centroid[1] - lng) < 0.125
        );
        if (nearHighRes) return false;
      }
      return true;
    });

    // At high polygon density, show floating % badges on top 22 largest/highest stands + selected stand
    const badgeStandIds = new Set<string>();
    if (layers.showLabels) {
      if (renderList.length <= 45) {
        renderList.forEach((s) => {
          const p = predictions[s.id];
          if (p && (!s.isProtectedNSG ? p.probability >= 45 || s.id === selectedStandId : s.id === selectedStandId)) {
            badgeStandIds.add(s.id);
          }
        });
      } else {
        renderList
          .filter((s) => !s.isProtectedNSG && (predictions[s.id]?.probability ?? 0) >= 45)
          .sort(
            (a, b) =>
              (predictions[b.id]?.probability ?? 0) * Math.log10(b.areaHectares + 2) -
              (predictions[a.id]?.probability ?? 0) * Math.log10(a.areaHectares + 2)
          )
          .slice(0, 22)
          .forEach((s) => badgeStandIds.add(s.id));
        if (selectedStandId) badgeStandIds.add(selectedStandId);
      }
    }

    renderList.forEach((stand) => {
      const pred = predictions[stand.id];
      if (!pred) return;

      const isSelected = stand.id === selectedStandId;
      const tierMeta = getTierMeta(pred.tier);
      const isHighRes = stand.source !== 'curated-nrw';

      const poly = L.polygon(stand.coordinates, {
        color: isSelected ? '#132A1E' : tierMeta.strokeColor,
        weight: isSelected
          ? 3.5
          : stand.isProtectedNSG
          ? 2.0
          : isHighRes
          ? pred.tier === 'peak'
            ? 2.0
            : 1.3
          : pred.tier === 'peak'
          ? 2.4
          : 1.6,
        dashArray: stand.isProtectedNSG ? '5 4' : pred.tier === 'low' ? '4 4' : undefined,
        fillColor: stand.isProtectedNSG ? 'url(#nsg-crimson-hatch)' : tierMeta.fillColor,
        fillOpacity: stand.isProtectedNSG
          ? 0.92
          : isSelected
          ? Math.min(0.7, tierMeta.fillOpacity + 0.16)
          : isHighRes
          ? Math.min(0.62, tierMeta.fillOpacity + 0.08)
          : tierMeta.fillOpacity,
      });

      const sourceNote =
        stand.source === 'nrw-wfs-wald'
          ? 'Wald NRW'
          : stand.source === 'nrw-wfs-fsk'
          ? 'GD NRW FSK05'
          : stand.source === 'nrw-wfs-nsg'
          ? 'LANUV NRW'
          : stand.source === 'osm-overpass'
          ? 'OSM'
          : 'Overview';

      const tooltipHtml = stand.isProtectedNSG
        ? `<div class="text-xs"><strong class="text-[#991B1B]">NSG · Picking Prohibited</strong><br/><span>${stand.name}</span> <span style="color:#6B7280">(${sourceNote})</span></div>`
        : `<div class="text-xs"><strong>${stand.name}</strong><br/><span class="font-mono font-semibold">${pred.probability}%</span> · ${pred.bestSpeciesName} · <span style="color:#4A5D52">${stand.areaHectares} ha · ${sourceNote}</span></div>`;

      poly.bindTooltip(tooltipHtml, {
        sticky: true,
        direction: 'top',
        className: 'pilz-stand-tooltip',
      });

      poly.on('click', () => {
        onSelectStand(stand.id);
      });

      poly.addTo(group);

      if (badgeStandIds.has(stand.id)) {
        const badgeIcon = L.divIcon({
          className: 'pilz-score-marker',
          html: stand.isProtectedNSG
            ? `<div style="background:#991B1B;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;padding:2px 6px;border-radius:6px;border:1.5px solid #FFFFFF;white-space:nowrap;box-shadow:0 2px 5px rgba(0,0,0,0.22);">NSG</div>`
            : `<div style="background:${isSelected ? '#132A1E' : '#FFFFFF'};color:${isSelected ? '#FFFFFF' : '#132A1E'};font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;padding:2px 6px;border-radius:6px;border:1.5px solid ${tierMeta.strokeColor};white-space:nowrap;box-shadow:0 2px 6px rgba(19,42,30,0.18);">${pred.probability}%</div>`,
          iconSize: [0, 0],
          iconAnchor: [18, 10],
        });
        L.marker(stand.centroid, { icon: badgeIcon, interactive: true })
          .on('click', () => onSelectStand(stand.id))
          .addTo(group);
      }
    });

    ensureHatchPattern();
  }, [stands, predictions, layers, selectedStandId, onSelectStand, mapZoom, viewportBounds]);

  const handleLocateMe = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser.');
      return;
    }

    if (gpsActive && watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      gpsMarkerRef.current?.remove();
      gpsAccuracyRef.current?.remove();
      setGpsActive(false);
      return;
    }

    setGpsActive(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        if (!gpsMarkerRef.current) {
          gpsAccuracyRef.current = L.circle(latlng, {
            radius: Math.min(pos.coords.accuracy, 250),
            color: '#C86D1F',
            fillColor: '#C86D1F',
            fillOpacity: 0.14,
            weight: 1,
          }).addTo(map);
          gpsMarkerRef.current = L.circleMarker(latlng, {
            radius: 7,
            color: '#FFFFFF',
            weight: 2.5,
            fillColor: '#C86D1F',
            fillOpacity: 1,
          }).addTo(map);
          map.setView(latlng, 13, { animate: true });
        } else {
          gpsMarkerRef.current.setLatLng(latlng);
          gpsAccuracyRef.current?.setLatLng(latlng);
          gpsAccuracyRef.current?.setRadius(Math.min(pos.coords.accuracy, 250));
        }
      },
      (err) => {
        setGpsActive(false);
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Enable GPS to track your forest trail position.'
            : 'Unable to acquire GPS fix right now.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleLoadHighResClick = () => {
    const map = mapRef.current;
    if (!map) return;
    setDismissedMsg(null);
    if (map.getZoom() < 12) {
      // Smoothly zoom into the current center so the surveyed polygons are immediately crisp
      const center = map.getCenter();
      map.setView(center, 12, { animate: true });
      const b = {
        south: center.lat - 0.055,
        north: center.lat + 0.055,
        west: center.lng - 0.085,
        east: center.lng + 0.085,
      };
      void onLoadHighResNRW(b);
      return;
    }
    const b = map.getBounds();
    void onLoadHighResNRW({
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    });
  };

  return (
    <div className="relative flex h-full w-full flex-col lg:flex-row">
      {/* Main Topographic Map Canvas */}
      <div className="relative flex-1 overflow-hidden">
        {/* Top Floating Filter Deck (Unified Ultra-Compact Frosted Card) */}
        <div className="pointer-events-none absolute top-1.5 left-1.5 right-1.5 z-[450] flex flex-col gap-1 sm:top-2 sm:left-2 sm:right-2">
          <div className="pointer-events-auto divide-y divide-[#EFECE4] rounded-xl border border-[#D6D3C8]/90 bg-[#FFFFFF]/93 shadow-sm backdrop-blur-md">
            {/* Row 1: Sub-Regions + Compact Actions */}
            <div className="flex items-center justify-between gap-1 px-1 py-0.5 sm:gap-1.5 sm:px-1.5 sm:py-1">
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar sm:gap-1">
                <button
                  type="button"
                  onClick={() => onChangeRegion('all')}
                  className={`h-7 rounded-lg px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 sm:h-8 sm:px-2.5 sm:text-xs ${
                    activeRegion === 'all'
                      ? 'bg-[#1B4332] text-white'
                      : 'text-[#4A5D52] hover:bg-[#F7F6F2] hover:text-[#132A1E]'
                  }`}
                >
                  All NRW
                </button>
                {NRW_SUBREGION_LIST.map((sr) => (
                  <button
                    key={sr.id}
                    type="button"
                    onClick={() => onChangeRegion(sr.id)}
                    className={`h-7 rounded-lg px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 sm:h-8 sm:px-2.5 sm:text-xs ${
                      activeRegion === sr.id
                        ? 'bg-[#1B4332] text-white'
                        : 'text-[#4A5D52] hover:bg-[#F7F6F2] hover:text-[#132A1E]'
                    }`}
                  >
                    {sr.shortName}
                  </button>
                ))}
              </div>

              {/* Right Controls: Desktop Buttons + Mobile Compact Layers Icon */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={!isOnline || highResLoading}
                  onClick={handleLoadHighResClick}
                  title="Load surveyed Wald & Holz NRW, GD NRW FSK05 (1:5,000), and LANUV NSG polygons for this area"
                  className="hidden sm:inline-flex h-8 items-center gap-1 rounded-lg border border-[#1B4332] bg-[#1B4332] px-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#132A1E] disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap shrink-0"
                >
                  {highResLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : (
                    <Radar className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{highResLoading ? 'Loading…' : 'High-Res NRW'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onChangeWeatherMode(weatherMode === 'live' ? 'peak-autumn' : 'live')
                  }
                  title="Switch between live DWD ICON weather and peak October fruiting simulation"
                  className={`hidden sm:inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    weatherMode === 'peak-autumn'
                      ? 'border-[#C86D1F] bg-[#FFF7ED] text-[#9A3412]'
                      : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#132A1E] hover:bg-[#EFECE4]'
                  }`}
                >
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span>{weatherMode === 'live' ? 'Live DWD' : 'Oct Peak'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowControlsSheet((v) => !v)}
                  aria-label="Toggle map filters and OpenGeodata.NRW controls"
                  aria-expanded={showControlsSheet}
                  className={`inline-flex h-7 min-w-[30px] items-center justify-center gap-1 rounded-lg border px-1.5 text-[11px] font-semibold transition-colors sm:h-8 sm:px-2 ${
                    showControlsSheet
                      ? 'border-[#1B4332] bg-[#1B4332] text-white'
                      : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#132A1E] hover:bg-[#EFECE4]'
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Layers</span>
                </button>
              </div>
            </div>

            {/* Row 2: Slim Species Strip */}
            <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-1 py-0.5 sm:gap-1 sm:px-1.5 sm:py-1">
              <button
                type="button"
                onClick={() => onChangeSpecies('all')}
                className={`h-[26px] rounded-md px-2 text-[10.5px] font-semibold transition-colors whitespace-nowrap shrink-0 sm:h-7 sm:px-2.5 sm:text-[11px] ${
                  activeSpeciesId === 'all'
                    ? 'bg-[#132A1E] text-white'
                    : 'text-[#4A5D52] hover:bg-[#F7F6F2] hover:text-[#132A1E]'
                }`}
              >
                All Species
              </button>
              {NRW_MUSHROOM_SPECIES.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => onChangeSpecies(sp.id)}
                  className={`h-[26px] rounded-md px-2 text-[10.5px] font-medium transition-colors whitespace-nowrap shrink-0 sm:h-7 sm:px-2.5 sm:text-[11px] ${
                    activeSpeciesId === sp.id
                      ? 'bg-[#132A1E] text-white font-semibold'
                      : 'text-[#4A5D52] hover:bg-[#F7F6F2] hover:text-[#132A1E]'
                  }`}
                >
                  {sp.germanName.replace('Gemeiner ', '').replace('Echter ', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Compact High-Res NRW WFS Status Toast */}
          {highResMessage && highResMessage !== dismissedMsg && (
            <div className="pointer-events-auto flex w-fit max-w-[calc(100%-3rem)] items-center gap-1 rounded-lg border border-[#1B4332]/25 bg-[#FFFFFF]/94 px-2 py-0.5 text-[10.5px] text-[#132A1E] shadow-xs backdrop-blur-md sm:max-w-full sm:px-2.5 sm:py-1 sm:text-[11px]">
              <span className="truncate font-medium">{highResMessage}</span>
              <button
                type="button"
                onClick={() => setDismissedMsg(highResMessage)}
                className="flex h-4 w-4 items-center justify-center text-[#4A5D52] hover:text-[#132A1E] font-bold shrink-0"
                aria-label="Dismiss status message"
              >
                ×
              </button>
            </div>
          )}

          {/* Expandable Map Layers & OpenGeodata.NRW Panel */}
          {showControlsSheet && (
            <div className="pointer-events-auto ml-auto w-full max-w-[340px] rounded-2xl border border-[#D6D3C8] bg-[#FFFFFF]/98 p-3.5 shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-[#EFECE4] pb-2">
                <span className="text-xs font-bold text-[#132A1E]">
                  Layers &amp; OpenGeodata.NRW
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#4A5D52]">
                  {visibleSummary.peakCount} peak · {visibleSummary.highCount} high · {visibleSummary.nsgCount} NSG
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">
                    Protected NSG Exclusions
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeLayers({ ...layers, showNSG: !layers.showNSG })}
                    className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${
                      layers.showNSG
                        ? 'border-[#991B1B] bg-[#FEF2F2] text-[#991B1B]'
                        : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#4A5D52]'
                    }`}
                  >
                    {layers.showNSG ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    <span>{layers.showNSG ? 'On' : 'Off'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">
                    Auto-load Surveyed (z≥12)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeLayers({ ...layers, autoLoadHighRes: !layers.autoLoadHighRes })
                    }
                    className={`inline-flex min-h-[34px] items-center rounded-lg border px-2.5 text-xs font-semibold ${
                      layers.autoLoadHighRes
                        ? 'border-[#1B4332] bg-[#F0FDF4] text-[#14532D]'
                        : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#4A5D52]'
                    }`}
                  >
                    {layers.autoLoadHighRes ? 'Auto' : 'Manual'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">
                    Clean Hi-Res View
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeLayers({
                        ...layers,
                        hideCuratedInHighRes: !layers.hideCuratedInHighRes,
                      })
                    }
                    className={`inline-flex min-h-[34px] items-center rounded-lg border px-2.5 text-xs font-semibold ${
                      layers.hideCuratedInHighRes
                        ? 'border-[#1B4332] bg-[#F0FDF4] text-[#14532D]'
                        : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#4A5D52]'
                    }`}
                  >
                    {layers.hideCuratedInHighRes ? 'Surveyed Only' : 'Show Both'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">Min Probability</span>
                  <div className="flex items-center gap-1 rounded-lg bg-[#F7F6F2] p-0.5">
                    {[
                      { val: 0, label: 'All' },
                      { val: 45, label: '≥45%' },
                      { val: 64, label: '≥64%' },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => onChangeLayers({ ...layers, minProbability: opt.val })}
                        className={`min-h-[30px] rounded-md px-2 font-mono text-xs font-semibold transition-colors ${
                          layers.minProbability === opt.val
                            ? 'bg-[#1B4332] text-white'
                            : 'text-[#4A5D52] hover:text-[#132A1E]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#EFECE4] pt-2.5">
                  <button
                    type="button"
                    disabled={!isOnline || highResLoading}
                    onClick={() => {
                      setShowControlsSheet(false);
                      handleLoadHighResClick();
                    }}
                    className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-[#1B4332] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#132A1E] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {highResLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Radar className="h-4 w-4" />
                    )}
                    <span>
                      {highResLoading
                        ? 'Fetching OpenGeodata.NRW…'
                        : isOnline
                        ? `Load Surveyed NRW Here (${highResCount} cached)`
                        : 'Live NRW WFS unavailable offline'}
                    </span>
                  </button>
                  <p className="mt-1.5 text-[11px] leading-snug text-[#4A5D52]">
                    Wald &amp; Holz NRW Basis-DLM forests, GD NRW FSK05 (1:5,000) soil/water, and
                    LANUV NRW NSG boundaries.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Leaflet Container */}
        <div ref={mapContainerRef} className="h-full w-full" />

        {/* Right Floating Thumb-Zone Map Action Stack (Compact Apple Maps Style) */}
        <div className="pointer-events-auto absolute right-1.5 bottom-[52px] z-[450] flex flex-col gap-1 sm:right-2.5 sm:bottom-22 sm:gap-1.5">
          {/* Mobile-only Hi-Res NRW 1-tap button */}
          <button
            type="button"
            disabled={!isOnline || highResLoading}
            onClick={handleLoadHighResClick}
            aria-label="Load high-resolution NRW forest polygons"
            title="Load surveyed NRW forests & NSGs"
            className="flex h-10 w-10 flex-col items-center justify-center rounded-xl border border-[#1B4332] bg-[#1B4332]/95 text-white shadow-md backdrop-blur-md transition-colors active:scale-95 disabled:opacity-55 sm:hidden"
          >
            {highResLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Radar className="h-3.5 w-3.5" />
            )}
            <span className="mt-0.5 text-[7.5px] font-bold leading-none tracking-tight">NRW</span>
          </button>

          {/* Mobile-only Live DWD / Oct Peak quick switch */}
          <button
            type="button"
            onClick={() =>
              onChangeWeatherMode(weatherMode === 'live' ? 'peak-autumn' : 'live')
            }
            aria-label="Toggle October Peak Preview vs Live DWD weather"
            title="Toggle Live DWD vs Oct Peak Preview"
            className={`flex h-10 w-10 flex-col items-center justify-center rounded-xl border shadow-md backdrop-blur-md transition-colors active:scale-95 sm:hidden ${
              weatherMode === 'peak-autumn'
                ? 'border-[#C86D1F] bg-[#FFF7ED]/95 text-[#9A3412]'
                : 'border-[#D6D3C8] bg-[#FFFFFF]/94 text-[#132A1E]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="mt-0.5 text-[7.5px] font-bold leading-none tracking-tight">
              {weatherMode === 'live' ? 'LIVE' : 'OCT'}
            </span>
          </button>

          {/* GPS Locate Button (All viewports) */}
          <button
            type="button"
            onClick={handleLocateMe}
            aria-label="Track my GPS position"
            className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-md backdrop-blur-md transition-colors active:scale-95 sm:h-10 sm:w-10 ${
              gpsActive
                ? 'border-[#C86D1F] bg-[#C86D1F] text-white'
                : 'border-[#D6D3C8] bg-[#FFFFFF]/94 text-[#132A1E] hover:bg-[#F7F6F2]'
            }`}
          >
            <Crosshair className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* GPS Hint Toast */}
        {gpsError && (
          <div className="pointer-events-auto absolute top-20 left-2 right-14 z-[460] mx-auto max-w-md rounded-xl border border-[#C86D1F] bg-[#FFFBEB]/95 px-2.5 py-1.5 text-[11px] font-medium text-[#92400E] shadow-md backdrop-blur-xs">
            {gpsError}
          </div>
        )}

        {/* Bottom Map Overlay: Sleek Compact 7-Day Forecast Scrubber + Desktop Legend */}
        <div className="pointer-events-none absolute bottom-1.5 left-1.5 right-1.5 z-[450] flex flex-col gap-1 sm:bottom-2.5 sm:left-2 sm:right-14 sm:gap-1.5">
          {/* Compact Daylight Probability Legend (Tablet/Desktop) */}
          <div className="pointer-events-auto hidden w-fit flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-lg border border-[#D6D3C8] bg-[#FFFFFF]/92 px-2.5 py-1 text-[10.5px] text-[#132A1E] shadow-xs backdrop-blur-xs sm:flex">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-[#065F46]" />
              <span>Peak 80%+</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-[#15803D]" />
              <span>High 64–79%</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-[#D97706]" />
              <span>Mod 45–63%</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs border border-[#991B1B] bg-[#FEE2E2]" />
              <span className="inline-flex items-center gap-0.5 font-medium text-[#991B1B]">
                <ShieldAlert className="h-2.5 w-2.5" /> NSG
              </span>
            </span>
          </div>

          {/* 7-Day Fruiting Forecast Timeline Strip */}
          <div className="pointer-events-auto grid grid-cols-7 gap-0.5 rounded-xl border border-[#D6D3C8]/90 bg-[#FFFFFF]/94 p-0.5 shadow-md backdrop-blur-md sm:flex sm:items-center sm:gap-1 sm:overflow-x-auto sm:p-1">
            <div className="hidden items-center gap-1 px-1.5 text-[11px] font-semibold text-[#4A5D52] md:flex shrink-0">
              <Calendar className="h-3.5 w-3.5 text-[#1B4332]" />
              <span>{weatherMode === 'peak-autumn' ? 'Oct' : '7-Day'}</span>
            </div>
            {forecastDays.map((day, idx) => {
              const { top, bottom } = formatDayChip(day.date, idx);
              const active = forecastDayOffset === idx;
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onChangeForecastDay(idx)}
                  className={`flex min-h-[34px] flex-col items-center justify-center rounded-lg px-0.5 py-0.5 text-center transition-colors sm:min-h-[38px] sm:min-w-[52px] sm:px-2 sm:shrink-0 ${
                    active
                      ? 'bg-[#1B4332] text-white shadow-2xs'
                      : 'bg-[#F7F6F2] text-[#132A1E] hover:bg-[#EFECE4]'
                  }`}
                >
                  <span className="text-[9.5px] font-semibold leading-tight sm:text-[10.5px]">
                    {top}
                  </span>
                  <span
                    className={`font-mono text-[8.5px] tabular-nums leading-tight sm:text-[9.5px] ${
                      active ? 'text-white/80' : 'text-[#4A5D52]'
                    }`}
                  >
                    {weatherMode === 'peak-autumn' ? `+${idx}d` : bottom.slice(0, 6)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Desktop Docked Inspector Panel (Slimmer 336px for More Map Canvas) */}
      <aside className="hidden h-full w-[336px] shrink-0 border-l border-[#D6D3C8] bg-[#FFFFFF] lg:flex lg:flex-col">
        {selectedStand && predictions[selectedStand.id] ? (
          <StandInspectorPanel
            stand={selectedStand}
            prediction={predictions[selectedStand.id]}
            activeSpeciesId={activeSpeciesId}
            onClose={() => onSelectStand(null)}
            onOpenSpeciesGuide={onOpenSpeciesGuide}
            onSelectSpecies={onChangeSpecies}
          />
        ) : (
          <div className="flex h-full flex-col justify-between overflow-y-auto p-3.5">
            <div>
              <p className="text-[11px] font-semibold text-[#4A5D52]">NRW Corridor Inspector</p>
              <h2 className="mt-0.5 text-base font-bold leading-snug text-[#132A1E]">
                Tap any forest polygon to inspect its mycology
              </h2>
              <p className="mt-1.5 text-xs leading-snug text-[#4A5D52]">
                Combines obligate host trees, NRW soil acidity, elevation, and live DWD ICON-D2
                21-day rainfall lag + root-zone soil moisture.
              </p>

              {/* Top Ranked Stands Quick List */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold text-[#4A5D52]">
                    Highest-Scoring Open Stands
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeWeatherMode(weatherMode === 'live' ? 'peak-autumn' : 'live')
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B4332] hover:underline"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>{weatherMode === 'live' ? 'Try Oct Peak' : 'Back to Live'}</span>
                  </button>
                </div>
                <div className="mt-1.5 divide-y divide-[#EFECE4] border-y border-[#EFECE4]">
                  {stands
                    .filter(
                      (s) =>
                        !s.isProtectedNSG &&
                        (activeRegion === 'all' || s.subRegion === activeRegion)
                    )
                    .map((s) => ({ stand: s, pred: predictions[s.id] }))
                    .filter((x) => Boolean(x.pred))
                    .sort((a, b) => b.pred.probability - a.pred.probability)
                    .slice(0, 7)
                    .map(({ stand, pred }) => (
                      <button
                        key={stand.id}
                        type="button"
                        onClick={() => onSelectStand(stand.id)}
                        className="flex min-h-[44px] w-full items-center justify-between gap-2.5 py-1.5 text-left transition-colors hover:bg-[#F7F6F2] px-1.5 rounded-lg"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-[#132A1E]">
                            {stand.name}
                          </p>
                          <p className="truncate text-[11px] text-[#4A5D52]">
                            {NRW_SUBREGIONS[stand.subRegion].shortName} · {pred.bestSpeciesName}
                          </p>
                        </div>
                        <span className="font-mono text-xs font-bold tabular-nums text-[#1B4332] shrink-0">
                          {pred.probability}%
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-[#D6D3C8] bg-[#F7F6F2] p-2.5 text-[11px] leading-snug text-[#4A5D52]">
              <p className="font-semibold text-[#132A1E]">Live Weather vs. Season</p>
              <p className="mt-0.5">
                During frost or dry spells, live probabilities drop near 0%. Switch to{' '}
                <strong className="text-[#132A1E]">Oct Peak</strong> anytime to compare autumn NRW
                forest suitability.
              </p>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile iOS-Native 2-Detent Bottom Sheet Inspector (Respects Home Indicator Safe Area) */}
      {selectedStand && predictions[selectedStand.id] && (
        <>
          <div
            className="fixed inset-0 z-[600] bg-black/20 lg:hidden"
            aria-hidden="true"
            onClick={() => onSelectStand(null)}
          />
          <div
            className={`pb-safe fixed inset-x-0 bottom-0 z-[650] flex flex-col overflow-hidden rounded-t-3xl border-t border-[#D6D3C8] bg-[#FFFFFF] shadow-2xl transition-[height] duration-200 ease-out lg:hidden ${
              sheetExpanded ? 'h-[82dvh]' : 'h-[48dvh]'
            }`}
            role="dialog"
            aria-label={`Details for ${selectedStand.name}`}
          >
            <StandInspectorPanel
              stand={selectedStand}
              prediction={predictions[selectedStand.id]}
              activeSpeciesId={activeSpeciesId}
              onClose={() => onSelectStand(null)}
              onOpenSpeciesGuide={onOpenSpeciesGuide}
              onSelectSpecies={onChangeSpecies}
              isExpanded={sheetExpanded}
              onToggleExpand={() => setSheetExpanded((v) => !v)}
            />
          </div>
        </>
      )}
    </div>
  );
};
