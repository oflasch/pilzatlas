import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
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

// Explicitly bind MapLibre GL v6's worker to the Vite-resolved URL so workers load
// cleanly in both Vite dev pre-bundling and hashed production/Docker builds.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

type BasemapStyleId = 'top' | 'col';

const BASEMAP_DE_STYLES: Record<BasemapStyleId, string> = {
  top: 'https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_top.json',
  col: 'https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json',
};

const OFFLINE_FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'offline-parchment-bg',
      type: 'background',
      paint: { 'background-color': '#ECE9DF' },
    },
  ],
};

const STAND_SOURCE_ID = 'nrw-stands';
const GPS_SOURCE_ID = 'gps-location';
const NSG_PATTERN_ID = 'nsg-crimson-hatch';

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

type StandFeatureProps = {
  id: string;
  name: string;
  sourceNote: string;
  areaHectares: number;
  isProtectedNSG: boolean;
  isSelected: boolean;
  isDashed: boolean;
  probability: number;
  bestSpeciesName: string;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
};

interface GeoJsonPolygonGeometry {
  type: 'Polygon';
  coordinates: [number, number][][];
}

interface GeoJsonPointGeometry {
  type: 'Point';
  coordinates: [number, number];
}

interface GeoJsonFeature<
  G extends GeoJsonPolygonGeometry | GeoJsonPointGeometry = GeoJsonPolygonGeometry | GeoJsonPointGeometry,
  P = Record<string, unknown>,
> {
  type: 'Feature';
  properties: P;
  geometry: G;
}

interface GeoJsonFeatureCollection<
  G extends GeoJsonPolygonGeometry | GeoJsonPointGeometry = GeoJsonPolygonGeometry | GeoJsonPointGeometry,
  P = Record<string, unknown>,
> {
  type: 'FeatureCollection';
  features: GeoJsonFeature<G, P>[];
}

const EMPTY_FC: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] };

function toLngLat([lat, lng]: [number, number]): [number, number] {
  return [lng, lat];
}

function toLngLatBounds(
  bounds: [[number, number], [number, number]]
): [[number, number], [number, number]] {
  const [[south, west], [north, east]] = bounds;
  return [
    [west, south],
    [east, north],
  ];
}

function toClosedGeoJsonRing(coords: [number, number][]): [number, number][] {
  if (coords.length === 0) return [];
  const ring = coords.map(([lat, lng]): [number, number] => [lng, lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function createGeoJsonCircle(
  lng: number,
  lat: number,
  radiusMeters: number,
  steps = 48
): GeoJsonFeature<GeoJsonPolygonGeometry, { kind: string }> {
  const earthRadius = 6378137;
  const latRad = (lat * Math.PI) / 180;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusMeters * Math.cos(angle)) / earthRadius;
    const dLng = (radiusMeters * Math.sin(angle)) / (earthRadius * Math.cos(latRad));
    coords.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    properties: { kind: 'accuracy' },
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

function createCrimsonHatchImage(): { width: number; height: number; data: Uint8Array } | null {
  if (typeof document === 'undefined') return null;
  const size = 16; // 8 CSS px at 2x Retina pixelRatio
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = 'rgba(185, 28, 28, 0.14)';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(153, 27, 27, 0.72)';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-size / 2, size / 2);
  ctx.lineTo(size / 2, -size / 2);
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.moveTo(size / 2, size * 1.5);
  ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();

  const imgData = ctx.getImageData(0, 0, size, size);
  return {
    width: size,
    height: size,
    data: new Uint8Array(imgData.data.buffer),
  };
}

function buildHoverPopupElement(props: StandFeatureProps): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'text-xs leading-snug';

  if (props.isProtectedNSG) {
    const title = document.createElement('strong');
    title.className = 'text-[#991B1B] block';
    title.textContent = 'NSG · Sammelverbot';
    const sub = document.createElement('span');
    sub.textContent = `${props.name} `;
    const src = document.createElement('span');
    src.className = 'text-[#6B7280]';
    src.textContent = `(${props.sourceNote})`;
    sub.appendChild(src);
    wrap.append(title, sub);
  } else {
    const title = document.createElement('strong');
    title.className = 'block text-[#132A1E]';
    title.textContent = props.name;
    const line = document.createElement('div');
    const prob = document.createElement('span');
    prob.className = 'font-mono font-semibold text-[#132A1E]';
    prob.textContent = `${props.probability}%`;
    const mid = document.createTextNode(` · ${props.bestSpeciesName} · `);
    const meta = document.createElement('span');
    meta.className = 'text-[#4A5D52]';
    meta.textContent = `${props.areaHectares} ha · ${props.sourceNote}`;
    line.append(prob, mid, meta);
    wrap.append(title, line);
  }

  return wrap;
}

function formatDayChip(isoDate: string, offset: number): { top: string; bottom: string } {
  const d = new Date(`${isoDate}T12:00:00`);
  const weekday = offset === 0 ? 'Heute' : d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
  const dayNum = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const badgeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const naturraumMarkersRef = useRef<maplibregl.Marker[]>([]);
  const standsGeoJsonRef = useRef<GeoJsonFeatureCollection>(EMPTY_FC);
  const gpsGeoJsonRef = useRef<GeoJsonFeatureCollection>(EMPTY_FC);
  const onSelectStandRef = useRef(onSelectStand);
  const styleAppliedRef = useRef<BasemapStyleId>('top');
  const watchIdRef = useRef<number | null>(null);
  const hasCenteredGpsRef = useRef<boolean>(false);
  const fetchedTilesRef = useRef<Set<string>>(new Set());
  const autoLoadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onSelectStandRef.current = onSelectStand;
  }, [onSelectStand]);

  const [basemapStyle, setBasemapStyle] = useState<BasemapStyleId>('top');
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [showControlsSheet, setShowControlsSheet] = useState(false);
  const [mapZoom, setMapZoom] = useState<number>(7.5);
  const [viewportBounds, setViewportBounds] = useState<{
    south: number;
    west: number;
    north: number;
    east: number;
  } | null>(null);
  const [dismissedMsg, setDismissedMsg] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState<boolean>(false);
  const [styleReadyVersion, setStyleReadyVersion] = useState<number>(0);

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

  // Helper that installs our GeoJSON sources, hatch pattern, and layers above all basemap fills/roads
  // while keeping basemap.de's top place/landscape text labels cleanly on top.
  const installOverlayLayers = (map: maplibregl.Map) => {
    if (!map.hasImage(NSG_PATTERN_ID)) {
      const hatch = createCrimsonHatchImage();
      if (hatch) {
        map.addImage(NSG_PATTERN_ID, hatch, { pixelRatio: 2 });
      }
    }

    if (!map.getSource(STAND_SOURCE_ID)) {
      map.addSource(STAND_SOURCE_ID, {
        type: 'geojson',
        data: standsGeoJsonRef.current as Parameters<maplibregl.GeoJSONSource['setData']>[0],
        // Low simplification tolerance ensures small 2-30 ha NRW forest stands never vanish at overview zoom
        tolerance: 0.02,
        buffer: 64,
      });
    }

    // Place polygons right before the top-level symbol/label block (after ALL basemap fills,
    // rasters, water, roads, and bridges — avoiding early contour-label symbol layers at idx ~41).
    const styleLayers = map.getStyle()?.layers ?? [];
    let lastNonSymbolIdx = -1;
    styleLayers.forEach((l: maplibregl.LayerSpecification, idx: number) => {
      if (l.type !== 'symbol') lastNonSymbolIdx = idx;
    });
    const topLabelBeforeId =
      lastNonSymbolIdx >= 0 && lastNonSymbolIdx + 1 < styleLayers.length
        ? styleLayers[lastNonSymbolIdx + 1].id
        : undefined;

    if (!map.getLayer('nrw-stands-fill')) {
      map.addLayer(
        {
          id: 'nrw-stands-fill',
          type: 'fill',
          source: STAND_SOURCE_ID,
          filter: ['!=', ['get', 'isProtectedNSG'], true],
          paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': ['get', 'fillOpacity'],
          },
        },
        topLabelBeforeId
      );
    }

    if (!map.getLayer('nrw-stands-nsg-tint')) {
      map.addLayer(
        {
          id: 'nrw-stands-nsg-tint',
          type: 'fill',
          source: STAND_SOURCE_ID,
          filter: ['==', ['get', 'isProtectedNSG'], true],
          paint: {
            'fill-color': '#B91C1C',
            'fill-opacity': 0.22,
          },
        },
        topLabelBeforeId
      );
    }

    if (!map.getLayer('nrw-stands-nsg-fill')) {
      map.addLayer(
        {
          id: 'nrw-stands-nsg-fill',
          type: 'fill',
          source: STAND_SOURCE_ID,
          filter: ['==', ['get', 'isProtectedNSG'], true],
          paint: {
            'fill-pattern': NSG_PATTERN_ID,
            'fill-opacity': 0.9,
          },
        },
        topLabelBeforeId
      );
    }

    if (!map.getLayer('nrw-stands-outline-solid')) {
      map.addLayer(
        {
          id: 'nrw-stands-outline-solid',
          type: 'line',
          source: STAND_SOURCE_ID,
          filter: ['all', ['!=', ['get', 'isDashed'], true], ['!=', ['get', 'isSelected'], true]],
          paint: {
            'line-color': ['get', 'strokeColor'],
            'line-width': ['get', 'strokeWidth'],
          },
        },
        topLabelBeforeId
      );
    }

    if (!map.getLayer('nrw-stands-outline-dashed')) {
      map.addLayer(
        {
          id: 'nrw-stands-outline-dashed',
          type: 'line',
          source: STAND_SOURCE_ID,
          filter: ['all', ['==', ['get', 'isDashed'], true], ['!=', ['get', 'isSelected'], true]],
          paint: {
            'line-color': ['get', 'strokeColor'],
            'line-width': ['get', 'strokeWidth'],
            'line-dasharray': [3, 2],
          },
        },
        topLabelBeforeId
      );
    }

    if (!map.getLayer('nrw-stands-selected-outline')) {
      map.addLayer(
        {
          id: 'nrw-stands-selected-outline',
          type: 'line',
          source: STAND_SOURCE_ID,
          filter: ['==', ['get', 'isSelected'], true],
          paint: {
            'line-color': '#132A1E',
            'line-width': 3.5,
          },
        },
        topLabelBeforeId
      );
    }

    // GPS accuracy halo & position marker sit above all map layers
    if (!map.getSource(GPS_SOURCE_ID)) {
      map.addSource(GPS_SOURCE_ID, {
        type: 'geojson',
        data: gpsGeoJsonRef.current,
      });
    }

    if (!map.getLayer('gps-accuracy-fill')) {
      map.addLayer({
        id: 'gps-accuracy-fill',
        type: 'fill',
        source: GPS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'accuracy'],
        paint: {
          'fill-color': '#C86D1F',
          'fill-opacity': 0.14,
        },
      });
    }

    if (!map.getLayer('gps-accuracy-line')) {
      map.addLayer({
        id: 'gps-accuracy-line',
        type: 'line',
        source: GPS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'accuracy'],
        paint: {
          'line-color': '#C86D1F',
          'line-width': 1.2,
          'line-opacity': 0.65,
        },
      });
    }

    if (!map.getLayer('gps-dot')) {
      map.addLayer({
        id: 'gps-dot',
        type: 'circle',
        source: GPS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'point'],
        paint: {
          'circle-radius': 7,
          'circle-color': '#C86D1F',
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2.5,
        },
      });
    }
  };

  // Initialize MapLibre GL map once with official German basemap.de Web Vektor style
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let fellBackOffline = false;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_DE_STYLES[basemapStyle],
      center: [7.62, 51.42],
      zoom: 7.5,
      minZoom: 6,
      maxZoom: 17.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '© GeoBasis-DE / BKG (basemap.de)',
      }),
      'bottom-right'
    );

    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'pilz-maplibre-popup',
      offset: 12,
      maxWidth: '280px',
    });
    hoverPopupRef.current = hoverPopup;

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

    map.on('style.load', () => {
      installOverlayLayers(map);
      setStyleReadyVersion((v) => v + 1);
    });

    map.on('styleimagemissing', (e: { id: string }) => {
      if (e.id === NSG_PATTERN_ID && !map.hasImage(NSG_PATTERN_ID)) {
        const hatch = createCrimsonHatchImage();
        if (hatch) {
          map.addImage(NSG_PATTERN_ID, hatch, { pixelRatio: 2 });
        }
      }
    });

    map.on('load', () => {
      map.fitBounds(toLngLatBounds(NRW_CORRIDOR_BOUNDS), { padding: 24, duration: 0 });
      syncViewport();
    });

    map.on('error', (e: maplibregl.ErrorEvent) => {
      // If initial basemap.de style fails while offline and uncached, drop to clean parchment canvas
      if (!fellBackOffline && !navigator.onLine && e?.error) {
        const msg = String(e.error.message || '');
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          fellBackOffline = true;
          map.setStyle(OFFLINE_FALLBACK_STYLE);
        }
      }
    });

    map.on('zoomend', syncViewport);
    map.on('moveend', syncViewport);

    const queryStandAtPoint = (point: maplibregl.Point) => {
      const targetLayers = ['nrw-stands-nsg-fill', 'nrw-stands-nsg-tint', 'nrw-stands-fill'].filter((id) =>
        Boolean(map.getLayer(id))
      );
      if (targetLayers.length === 0) return null;
      const hits = map.queryRenderedFeatures(point, { layers: targetLayers });
      return hits[0] ?? null;
    };

    map.on('click', (e: maplibregl.MapMouseEvent) => {
      const hit = queryStandAtPoint(e.point);
      if (hit?.properties?.id) {
        onSelectStandRef.current(String(hit.properties.id));
      }
    });

    map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
      const hit = queryStandAtPoint(e.point);
      if (!hit || !hit.properties) {
        map.getCanvas().style.cursor = '';
        hoverPopup.remove();
        return;
      }
      map.getCanvas().style.cursor = 'pointer';
      const p = hit.properties as unknown as StandFeatureProps;
      hoverPopup.setLngLat(e.lngLat).setDOMContent(buildHoverPopupElement(p)).addTo(map);
    });

    map.getCanvas().addEventListener('mouseleave', () => {
      map.getCanvas().style.cursor = '';
      hoverPopup.remove();
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      badgeMarkersRef.current.forEach((m) => m.remove());
      badgeMarkersRef.current = [];
      naturraumMarkersRef.current.forEach((m) => m.remove());
      naturraumMarkersRef.current = [];
      hoverPopup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch between basemap.de Topografie (bm_web_top) and Klassisch Farbe (bm_web_col)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleAppliedRef.current === basemapStyle) return;
    styleAppliedRef.current = basemapStyle;
    map.setStyle(BASEMAP_DE_STYLES[basemapStyle]);
  }, [basemapStyle]);

  // Pan/zoom when sub-region filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (activeRegion === 'all') {
      map.fitBounds(toLngLatBounds(NRW_CORRIDOR_BOUNDS), { padding: 26, duration: 550 });
    } else {
      const meta = NRW_SUBREGIONS[activeRegion];
      map.fitBounds(toLngLatBounds(meta.bounds), { padding: 28, duration: 550 });
    }
  }, [activeRegion]);

  // Render approximate cartographic Naturraum labels at overview zoom (<= 9.5 in MapLibre scale)
  useEffect(() => {
    const map = mapRef.current;
    naturraumMarkersRef.current.forEach((m) => m.remove());
    naturraumMarkersRef.current = [];
    if (!map || mapZoom > 9.5) return;

    NRW_SUBREGION_LIST.forEach((sr) => {
      const isFocused = activeRegion === sr.id;
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = sr.naturraumLabel;
      el.style.fontFamily = "'Bricolage Grotesque', sans-serif";
      el.style.fontSize = mapZoom <= 7.2 ? '11px' : '12.5px';
      el.style.fontWeight = '700';
      el.style.letterSpacing = '0.06em';
      el.style.color = isFocused ? '#1B4332' : '#132A1E';
      el.style.textShadow =
        '0 1px 3px rgba(255,255,255,0.98), 0 0 8px rgba(247,246,242,0.98), 0 0 2px #FFFFFF';
      el.style.whiteSpace = 'nowrap';
      el.style.cursor = 'pointer';
      el.style.background = 'transparent';
      el.style.border = 'none';
      el.style.padding = '2px 4px';
      el.style.opacity = activeRegion === 'all' || isFocused ? '0.94' : '0.45';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onChangeRegion(sr.id);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(toLngLat(sr.labelPosition))
        .addTo(map);
      naturraumMarkersRef.current.push(marker);
    });
  }, [mapZoom, activeRegion, onChangeRegion]);

  // Automatic high-resolution NRW WFS loading when zoomed in to stand level (zoom >= 11 in MapLibre scale)
  useEffect(() => {
    if (!isOnline || !layers.autoLoadHighRes || !viewportBounds || mapZoom < 11) return;
    const centerLat = (viewportBounds.south + viewportBounds.north) / 2;
    const centerLng = (viewportBounds.west + viewportBounds.east) / 2;
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

  // Fly gently to selected stand if selected externally (e.g. from Forecast tab)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStand) return;
    const currentZoom = map.getZoom();
    map.easeTo({
      center: toLngLat(selectedStand.centroid),
      zoom: Math.max(currentZoom, 11.5),
      duration: 500,
    });
  }, [selectedStand?.id]);

  // Re-build GeoJSON forest stand polygons & floating % badges whenever scores, layers, or selection change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
        const [lat, lng] = stand.centroid;
        const nearHighRes = highResInView.some(
          (hr) => Math.abs(hr.centroid[0] - lat) < 0.045 && Math.abs(hr.centroid[1] - lng) < 0.065
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
          if (
            p &&
            (!s.isProtectedNSG ? p.probability >= 45 || s.id === selectedStandId : s.id === selectedStandId)
          ) {
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

    const features: GeoJsonFeature<GeoJsonPolygonGeometry, StandFeatureProps>[] = [];

    badgeMarkersRef.current.forEach((m) => m.remove());
    badgeMarkersRef.current = [];

    renderList.forEach((stand) => {
      const pred = predictions[stand.id];
      if (!pred) return;

      const isSelected = stand.id === selectedStandId;
      const tierMeta = getTierMeta(pred.tier);
      const isHighRes = stand.source !== 'curated-nrw';
      const sourceNote =
        stand.source === 'nrw-wfs-wald'
          ? 'Wald NRW'
          : stand.source === 'nrw-wfs-fsk'
          ? 'GD NRW FSK05'
          : stand.source === 'nrw-wfs-nsg'
          ? 'LANUV NRW'
          : stand.source === 'osm-overpass'
          ? 'OSM'
          : 'Übersicht';

      const ring = toClosedGeoJsonRing(stand.coordinates);
      if (ring.length >= 4) {
        features.push({
          type: 'Feature',
          properties: {
            id: stand.id,
            name: stand.name,
            sourceNote,
            areaHectares: stand.areaHectares,
            isProtectedNSG: stand.isProtectedNSG,
            isSelected,
            isDashed: stand.isProtectedNSG || pred.tier === 'low',
            probability: pred.probability,
            bestSpeciesName: pred.bestSpeciesName,
            fillColor: tierMeta.fillColor,
            fillOpacity: stand.isProtectedNSG
              ? 0.92
              : isSelected
              ? Math.min(0.74, tierMeta.fillOpacity + 0.18)
              : isHighRes
              ? Math.min(0.66, tierMeta.fillOpacity + 0.12)
              : Math.min(0.62, tierMeta.fillOpacity + 0.08),
            strokeColor: isSelected ? '#132A1E' : tierMeta.strokeColor,
            strokeWidth: isSelected
              ? 3.5
              : stand.isProtectedNSG
              ? 2.2
              : isHighRes
              ? pred.tier === 'peak'
                ? 2.2
                : 1.6
              : pred.tier === 'peak'
              ? 2.5
              : 1.8,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [ring],
          },
        });
      }

      if (badgeStandIds.has(stand.id)) {
        const badgeEl = document.createElement('button');
        badgeEl.type = 'button';
        badgeEl.textContent = stand.isProtectedNSG ? 'NSG' : `${pred.probability}%`;
        badgeEl.style.fontFamily = "'JetBrains Mono', monospace";
        badgeEl.style.fontSize = stand.isProtectedNSG ? '10px' : '11px';
        badgeEl.style.fontWeight = '700';
        badgeEl.style.padding = '2px 6px';
        badgeEl.style.borderRadius = '6px';
        badgeEl.style.whiteSpace = 'nowrap';
        badgeEl.style.cursor = 'pointer';
        badgeEl.style.lineHeight = '1.2';
        if (stand.isProtectedNSG) {
          badgeEl.style.background = '#991B1B';
          badgeEl.style.color = '#FFFFFF';
          badgeEl.style.border = '1.5px solid #FFFFFF';
          badgeEl.style.boxShadow = '0 2px 5px rgba(0,0,0,0.22)';
        } else {
          badgeEl.style.background = isSelected ? '#132A1E' : '#FFFFFF';
          badgeEl.style.color = isSelected ? '#FFFFFF' : '#132A1E';
          badgeEl.style.border = `1.5px solid ${tierMeta.strokeColor}`;
          badgeEl.style.boxShadow = '0 2px 6px rgba(19,42,30,0.18)';
        }
        badgeEl.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectStandRef.current(stand.id);
        });

        const marker = new maplibregl.Marker({ element: badgeEl, anchor: 'center' })
          .setLngLat(toLngLat(stand.centroid))
          .addTo(map);
        badgeMarkersRef.current.push(marker);
      }
    });

    const fc: GeoJsonFeatureCollection = { type: 'FeatureCollection', features };
    standsGeoJsonRef.current = fc;
    const src = map.getSource(STAND_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(fc as Parameters<maplibregl.GeoJSONSource['setData']>[0]);
    }
  }, [stands, predictions, layers, selectedStandId, mapZoom, viewportBounds, styleReadyVersion]);

  const handleLocateMe = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('Standortermittlung wird von diesem Browser nicht unterstützt.');
      return;
    }

    if (gpsActive && watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      hasCenteredGpsRef.current = false;
      gpsGeoJsonRef.current = EMPTY_FC;
      const src = mapRef.current?.getSource(GPS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      src?.setData(EMPTY_FC);
      setGpsActive(false);
      return;
    }

    setGpsActive(true);
    hasCenteredGpsRef.current = false;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        const radius = Math.min(Math.max(pos.coords.accuracy, 15), 250);
        const gpsFc: GeoJsonFeatureCollection = {
          type: 'FeatureCollection',
          features: [
            createGeoJsonCircle(lng, lat, radius),
            {
              type: 'Feature',
              properties: { kind: 'point' },
              geometry: { type: 'Point', coordinates: [lng, lat] },
            },
          ],
        };
        gpsGeoJsonRef.current = gpsFc;
        const src = map.getSource(GPS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        src?.setData(gpsFc as Parameters<maplibregl.GeoJSONSource['setData']>[0]);

        if (!hasCenteredGpsRef.current) {
          hasCenteredGpsRef.current = true;
          map.easeTo({ center: [lng, lat], zoom: 12.5, duration: 600 });
        }
      },
      (err) => {
        setGpsActive(false);
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? 'Standortfreigabe abgelehnt. Bitte GPS erlauben, um deine Position im Wald zu sehen.'
            : 'GPS-Position konnte gerade nicht ermittelt werden.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleLoadHighResClick = () => {
    const map = mapRef.current;
    if (!map) return;
    setDismissedMsg(null);
    if (map.getZoom() < 11) {
      const center = map.getCenter();
      map.easeTo({ center, zoom: 11.5, duration: 500 });
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
      {/* Main Topographic Vector Map Canvas */}
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
                  Ganz NRW
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
                  title="Amtliche Flächen von Wald & Holz NRW, GD NRW FSK05 (1:5.000) und LANUV NSG für diesen Ausschnitt laden"
                  className="hidden sm:inline-flex h-8 items-center gap-1 rounded-lg border border-[#1B4332] bg-[#1B4332] px-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#132A1E] disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap shrink-0"
                >
                  {highResLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : (
                    <Radar className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{highResLoading ? 'Lädt…' : 'NRW-Daten'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onChangeWeatherMode(weatherMode === 'live' ? 'peak-autumn' : 'live')
                  }
                  title="Zwischen aktuellem DWD-ICON-Wetter und Oktober-Hauptsaison umschalten"
                  className={`hidden sm:inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    weatherMode === 'peak-autumn'
                      ? 'border-[#C86D1F] bg-[#FFF7ED] text-[#9A3412]'
                      : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#132A1E] hover:bg-[#EFECE4]'
                  }`}
                >
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span>{weatherMode === 'live' ? 'Live DWD' : 'Okt-Peak'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowControlsSheet((v) => !v)}
                  aria-label="Kartenebenen und OpenGeodata.NRW-Optionen öffnen"
                  aria-expanded={showControlsSheet}
                  className={`inline-flex h-7 min-w-[30px] items-center justify-center gap-1 rounded-lg border px-1.5 text-[11px] font-semibold transition-colors sm:h-8 sm:px-2 ${
                    showControlsSheet
                      ? 'border-[#1B4332] bg-[#1B4332] text-white'
                      : 'border-[#D6D3C8] bg-[#F7F6F2] text-[#132A1E] hover:bg-[#EFECE4]'
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Ebenen</span>
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
                Alle Arten
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
                aria-label="Statusmeldung schließen"
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
                  Ebenen &amp; OpenGeodata.NRW
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#4A5D52]">
                  {visibleSummary.peakCount} Top · {visibleSummary.highCount} Hoch · {visibleSummary.nsgCount} NSG
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                {/* basemap.de Vector Style Switcher */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">basemap.de Stil</span>
                  <div className="flex items-center gap-1 rounded-lg bg-[#F7F6F2] p-0.5">
                    {(
                      [
                        { id: 'top', label: 'Relief' },
                        { id: 'col', label: 'Farbe' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setBasemapStyle(opt.id)}
                        className={`min-h-[30px] rounded-md px-2.5 text-xs font-semibold transition-colors ${
                          basemapStyle === opt.id
                            ? 'bg-[#1B4332] text-white'
                            : 'text-[#4A5D52] hover:text-[#132A1E]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">
                    NSG-Schutzgebiete
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
                    <span>{layers.showNSG ? 'An' : 'Aus'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">
                    Auto-Laden (Detailzoom)
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
                    {layers.autoLoadHighRes ? 'Auto' : 'Manuell'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">
                    Klare Detailansicht
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
                    {layers.hideCuratedInHighRes ? 'Nur Vermessung' : 'Beide'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#132A1E]">Min. Chance</span>
                  <div className="flex items-center gap-1 rounded-lg bg-[#F7F6F2] p-0.5">
                    {[
                      { val: 0, label: 'Alle' },
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
                        ? 'Lade OpenGeodata.NRW…'
                        : isOnline
                        ? `NRW-Daten hier laden (${highResCount} gespeichert)`
                        : 'Live-NRW-WFS offline nicht verfügbar'}
                    </span>
                  </button>
                  <p className="mt-1.5 text-[11px] leading-snug text-[#4A5D52]">
                    basemap.de Web Vektor (AdV / GeoBasis-DE) + Wald &amp; Holz NRW, GD NRW
                    FSK05 (1:5.000) &amp; LANUV NSG.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MapLibre GL WebGL Vector Canvas */}
        <div ref={mapContainerRef} className="h-full w-full" />

        {/* Right Floating Thumb-Zone Map Action Stack (Compact Apple Maps Style) */}
        <div className="pointer-events-auto absolute right-1.5 bottom-[52px] z-[450] flex flex-col gap-1 sm:right-2.5 sm:bottom-[146px] sm:gap-1.5">
          {/* Mobile-only Hi-Res NRW 1-tap button */}
          <button
            type="button"
            disabled={!isOnline || highResLoading}
            onClick={handleLoadHighResClick}
            aria-label="Hochauflösende NRW-Waldflächen laden"
            title="Vermessene NRW-Wälder & NSG laden"
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
            aria-label="Zwischen aktuellem DWD-Wetter und Oktober-Hauptsaison umschalten"
            title="Live DWD vs. Oktober-Hauptsaison"
            className={`flex h-10 w-10 flex-col items-center justify-center rounded-xl border shadow-md backdrop-blur-md transition-colors active:scale-95 sm:hidden ${
              weatherMode === 'peak-autumn'
                ? 'border-[#C86D1F] bg-[#FFF7ED]/95 text-[#9A3412]'
                : 'border-[#D6D3C8] bg-[#FFFFFF]/94 text-[#132A1E]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="mt-0.5 text-[7.5px] font-bold leading-none tracking-tight">
              {weatherMode === 'live' ? 'LIVE' : 'OKT'}
            </span>
          </button>

          {/* GPS Locate Button (All viewports) */}
          <button
            type="button"
            onClick={handleLocateMe}
            aria-label="Meine GPS-Position verfolgen"
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
              <span>Spitze 80%+</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-[#15803D]" />
              <span>Hoch 64–79%</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-[#D97706]" />
              <span>Mittel 45–63%</span>
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
              <span>{weatherMode === 'peak-autumn' ? 'Okt' : '7 Tage'}</span>
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
                    {weatherMode === 'peak-autumn' ? `+${idx}T` : bottom}
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
              <p className="text-[11px] font-semibold text-[#4A5D52]">NRW-Standortinspektor</p>
              <h2 className="mt-0.5 text-base font-bold leading-snug text-[#132A1E]">
                Waldfläche auf der Karte antippen
              </h2>
              <p className="mt-1.5 text-xs leading-snug text-[#4A5D52]">
                Verbindet Mykorrhiza-Wirtsbäume, NRW-Boden-pH, Höhenlage sowie DWD-ICON-D2
                21-Tage-Vorregen und Wurzelzonen-Bodenfeuchte.
              </p>

              {/* Top Ranked Stands Quick List */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold text-[#4A5D52]">
                    Top offene Waldflächen
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeWeatherMode(weatherMode === 'live' ? 'peak-autumn' : 'live')
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B4332] hover:underline"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>{weatherMode === 'live' ? 'Okt-Peak testen' : 'Zurück zu Live'}</span>
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
              <p className="font-semibold text-[#132A1E]">Live-Wetter vs. Hauptsaison</p>
              <p className="mt-0.5">
                Bei Frost oder Trockenheit sinken die Live-Werte gegen 0 %. Wechsle jederzeit zu{' '}
                <strong className="text-[#132A1E]">Okt-Peak</strong>, um die Herbst-Standorteignung
                in NRW zu vergleichen.
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
            aria-label={`Details für ${selectedStand.name}`}
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
