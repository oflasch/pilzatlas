/**
 * Server-side Option 2 Geodata Proxy for North Rhine-Westphalia (NRW)
 *
 * Bridges non-CORS official OpenGeodata.NRW WFS services (dl-de/zero-2-0) into
 * unified, simplified, mycology-ready NRWForestStand polygons in ~1 second:
 *
 * 1. Wald und Holz NRW / Geobasis NRW Basis-DLM WFS (https://www.wfs.nrw.de/umwelt/wald)
 *    - wa:Laubwald (broadleaved deciduous stands)
 *    - wa:Mischwald (mixed forest stands)
 *    - wa:Nadelwald (needleleaved conifer stands)
 *    - wa:Wildnisentwicklungsgebiete (protected wilderness zones)
 * 2. Geologischer Dienst NRW FSK05 1:5,000 Forstliche Standortkarte (https://www.wfs.nrw.de/gd/fsk05)
 *    - gd:wet: real per-stand base/acidity (BASEN_TEXT -> pH), water balance (GWH_TEXT + NFK),
 *      growing season (VEG10 -> elevation proxy), and recommended stand types (WET).
 *    - Spatially joined onto overlapping Basis-DLM forest stands + exposed as standalone stands.
 * 3. LANUV NRW INSPIRE Protected Areas WFS (https://www.wfs.nrw.de/umwelt/wfs_nw_inspire-schutzgebiete)
 *    - ps:PS.ProtectedSite.NSG (Naturschutzgebiete)
 *    - ps:PS.ProtectedSite.NP (Nationalpark Eifel)
 *    - ps:PS.ProtectedSite.NWZ (Naturwaldzellen)
 */

import type {
  HighResGeodataResponse,
  LeafType,
  NRWForestStand,
  OfficialGeodataMeta,
  SubRegionId,
  TreeHostKey,
} from '../types/foraging.ts';

export interface GeodataBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface SubRegionBaseline {
  id: SubRegionId;
  shortName: string;
  center: [number, number];
  geologySummary: string;
  typicalPh: number;
  typicalElevationM: number;
  defaultTexture: NRWForestStand['soilTexture'];
  defaultSlopeDeg: number;
  defaultHumidity: number;
}

const SUBREGION_BASELINES: SubRegionBaseline[] = [
  {
    id: 'ruhr-niederrhein',
    shortName: 'Ruhr / Niederrhein',
    center: [51.48, 6.95],
    geologySummary: 'Rhine-Ruhr terrace sands, loess & Carboniferous sandstone',
    typicalPh: 5.2,
    typicalElevationM: 95,
    defaultTexture: 'braunerde',
    defaultSlopeDeg: 5,
    defaultHumidity: 0.72,
  },
  {
    id: 'bergisches-land',
    shortName: 'Bergisches Land',
    center: [51.07, 7.46],
    geologySummary: 'Devonian slate, greywacke & humid Oberberg Siepen valleys',
    typicalPh: 4.8,
    typicalElevationM: 315,
    defaultTexture: 'acidic-slate-loam',
    defaultSlopeDeg: 13,
    defaultHumidity: 0.86,
  },
  {
    id: 'sauerland-siegerland',
    shortName: 'Sauerland / Siegerland',
    center: [51.18, 8.22],
    geologySummary: 'Devonian Rothaar slate, quartzite & acidic highland loam',
    typicalPh: 4.5,
    typicalElevationM: 530,
    defaultTexture: 'acidic-slate-loam',
    defaultSlopeDeg: 16,
    defaultHumidity: 0.88,
  },
  {
    id: 'eifel-boerde',
    shortName: 'Eifel / Börde',
    center: [50.64, 6.52],
    geologySummary: 'Rhenish slate hills, Buntsandstein & Eifel limestone',
    typicalPh: 5.1,
    typicalElevationM: 420,
    defaultTexture: 'acidic-slate-loam',
    defaultSlopeDeg: 12,
    defaultHumidity: 0.82,
  },
  {
    id: 'muensterland',
    shortName: 'Münsterland',
    center: [51.96, 7.55],
    geologySummary: 'Glacial cover sands, Hohe Mark podsols & Baumberge marl',
    typicalPh: 5.0,
    typicalElevationM: 78,
    defaultTexture: 'sandy-podsol',
    defaultSlopeDeg: 3,
    defaultHumidity: 0.73,
  },
  {
    id: 'ostwestfalen-lippe',
    shortName: 'OWL / Teutoburg',
    center: [51.84, 8.84],
    geologySummary: 'Teutoburg Muschelkalk ridges, Egge sandstone & Weser loam',
    typicalPh: 5.8,
    typicalElevationM: 280,
    defaultTexture: 'braunerde',
    defaultSlopeDeg: 11,
    defaultHumidity: 0.79,
  },
];

// Simple LRU/TTL cache keyed by quantized viewport bbox
interface CacheEntry {
  createdAt: number;
  payload: HighResGeodataResponse;
}

const CACHE_TTL_MS = 20 * 60 * 1000;
const MAX_CACHE_ENTRIES = 80;
const geodataCache = new Map<string, CacheEntry>();

function getCacheKey(b: GeodataBounds): string {
  const q = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
  return `${q(b.south)},${q(b.west)},${q(b.north)},${q(b.east)}`;
}

function closestSubRegion(lat: number, lng: number): SubRegionBaseline {
  // Prefer accurate NRW Naturraum geographic bands before Euclidean fallback
  if (lat >= 51.38 && lat <= 51.72 && lng <= 7.82) {
    return SUBREGION_BASELINES[0]; // ruhr-niederrhein (includes Dortmund, Bochum, Essen, Niederrhein)
  }
  if (lat >= 51.72 && lng <= 8.18) {
    return SUBREGION_BASELINES[4]; // muensterland
  }
  if (lat >= 51.45 && lng > 8.18) {
    return SUBREGION_BASELINES[5]; // ostwestfalen-lippe
  }
  if (lat < 51.38 && lng < 7.05) {
    return SUBREGION_BASELINES[3]; // eifel-boerde
  }
  if (lat < 51.45 && lng >= 7.72) {
    return SUBREGION_BASELINES[2]; // sauerland-siegerland
  }
  if (lat < 51.38 && lng >= 7.05 && lng < 7.72) {
    return SUBREGION_BASELINES[1]; // bergisches-land (includes Oberberg / Gummersbach)
  }

  let best = SUBREGION_BASELINES[1];
  let bestDist = Infinity;
  for (const sr of SUBREGION_BASELINES) {
    const d = Math.hypot(lat - sr.center[0], lng - sr.center[1]);
    if (d < bestDist) {
      bestDist = d;
      best = sr;
    }
  }
  return best;
}

// ============================================================================
// Coordinate Projection: WGS84 (EPSG:4326) <-> ETRS89 / UTM 32N (EPSG:25832)
// ============================================================================

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
const UTM_K0 = 0.9996;
const UTM32_LON0 = (9 * Math.PI) / 180; // Zone 32 central meridian 9°E

function latLngToUtm32N(lat: number, lng: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = WGS84_EP2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - UTM32_LON0);

  const M =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 ** 2) / 64 - (5 * WGS84_E2 ** 3) / 256) * phi -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 ** 2) / 32 + (45 * WGS84_E2 ** 3) / 1024) *
        Math.sin(2 * phi) +
      ((15 * WGS84_E2 ** 2) / 256 + (45 * WGS84_E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * WGS84_E2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    500000 +
    UTM_K0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) * A ** 5) / 120);

  const northing =
    UTM_K0 *
    (M +
      N *
        tanPhi *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * WGS84_EP2) * A ** 6) / 720));

  return [Math.round(easting), Math.round(northing)];
}

function utm32NToLatLng(easting: number, northing: number): [number, number] {
  const x = easting - 500000.0;
  const y = northing;
  const M = y / UTM_K0;

  const mu =
    M /
    (WGS84_A * (1 - WGS84_E2 / 4 - (3 * WGS84_E2 ** 2) / 64 - (5 * WGS84_E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinP1 = Math.sin(phi1);
  const cosP1 = Math.cos(phi1);
  const tanP1 = Math.tan(phi1);

  const N1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinP1 * sinP1);
  const R1 = (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sinP1 * sinP1, 1.5);
  const T1 = tanP1 * tanP1;
  const C1 = WGS84_EP2 * cosP1 * cosP1;
  const D = x / (N1 * UTM_K0);

  const latRad =
    phi1 -
    ((N1 * tanP1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * WGS84_EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * WGS84_EP2 - 3 * C1 * C1) * D ** 6) / 720);

  const lngRad =
    UTM32_LON0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * WGS84_EP2 + 24 * T1 * T1) * D ** 5) / 120) /
      cosP1;

  return [(latRad * 180) / Math.PI, (lngRad * 180) / Math.PI];
}

// ============================================================================
// Geometry Helpers
// ============================================================================

function perpendicularDistance(
  pt: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(pt[0] - lineStart[0], pt[1] - lineStart[1]);
  }
  const t = ((pt[0] - lineStart[0]) * dx + (pt[1] - lineStart[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(pt[0] - (lineStart[0] + clamped * dx), pt[1] - (lineStart[1] + clamped * dy));
}

function simplifyRing(ring: [number, number][], toleranceDeg = 0.0001): [number, number][] {
  if (ring.length <= 6) {
    return ring.map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
  }

  const dp = (pts: [number, number][]): [number, number][] => {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let maxIdx = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
      const d = perpendicularDistance(pts[i], pts[0], pts[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceDeg) {
      const left = dp(pts.slice(0, maxIdx + 1));
      const right = dp(pts.slice(maxIdx));
      return [...left.slice(0, -1), ...right];
    }
    return [pts[0], pts[end]];
  };

  const mid = Math.floor(ring.length / 2);
  const firstHalf = dp(ring.slice(0, mid + 1));
  const secondHalf = dp(ring.slice(mid));
  const merged = [...firstHalf.slice(0, -1), ...secondHalf];
  const rounded: [number, number][] = merged.map(([lat, lng]) => [
    Number(lat.toFixed(5)),
    Number(lng.toFixed(5)),
  ]);
  if (rounded.length < 4) {
    return ring.slice(0, 6).map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
  }
  const first = rounded[0];
  const last = rounded[rounded.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    rounded.push([first[0], first[1]]);
  }
  return rounded;
}

function computeAreaHectares(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const latFactor = 111.32;
  const avgLat = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
  const lngFactor = 111.32 * Math.cos((avgLat * Math.PI) / 180);
  let areaKm2 = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const x1 = coords[i][1] * lngFactor;
    const y1 = coords[i][0] * latFactor;
    const x2 = coords[j][1] * lngFactor;
    const y2 = coords[j][0] * latFactor;
    areaKm2 += x1 * y2 - x2 * y1;
  }
  return Number(((Math.abs(areaKm2) / 2) * 100).toFixed(1));
}

function computeCentroid(coords: [number, number][]): [number, number] {
  const n = coords.length;
  if (n === 0) return [51.2, 7.5];
  let lat = 0;
  let lng = 0;
  for (const c of coords) {
    lat += c[0];
    lng += c[1];
  }
  return [Number((lat / n).toFixed(5)), Number((lng / n).toFixed(5))];
}

function computeRingBBox(coords: [number, number][]): GeodataBounds {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const [lat, lng] of coords) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

function pointInPolygon(pt: [number, number], ring: [number, number][]): boolean {
  const [y, x] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j][0];
    const xj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function bboxesOverlap(a: GeodataBounds, b: GeodataBounds): boolean {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}

interface GeoJsonGeometry {
  type: 'Polygon' | 'MultiPolygon' | string;
  coordinates: unknown;
}

interface GeoJsonFeature {
  type: 'Feature';
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: GeoJsonGeometry | null;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features?: GeoJsonFeature[];
}

function extractOuterRingsLatLng(geometry: GeoJsonGeometry | null | undefined): [number, number][][] {
  if (!geometry) return [];
  const rings: [number, number][][] = [];
  if (geometry.type === 'Polygon') {
    const poly = geometry.coordinates as number[][][];
    if (Array.isArray(poly) && Array.isArray(poly[0]) && poly[0].length >= 4) {
      rings.push(poly[0].map(([lng, lat]) => [lat, lng] as [number, number]));
    }
  } else if (geometry.type === 'MultiPolygon') {
    const multi = geometry.coordinates as number[][][][];
    if (Array.isArray(multi)) {
      for (const poly of multi) {
        if (Array.isArray(poly) && Array.isArray(poly[0]) && poly[0].length >= 4) {
          rings.push(poly[0].map(([lng, lat]) => [lat, lng] as [number, number]));
        }
      }
    }
  }
  return rings;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'PilzAtlasNRW/1.0 (OpenGeodata.NRW)',
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// 1. Official LANUV NRW Protected Areas WFS (NSG, NP, NWZ)
// ============================================================================

async function fetchLanuvProtectedAreas(bounds: GeodataBounds): Promise<{
  stands: NRWForestStand[];
  bboxes: { stand: NRWForestStand; bbox: GeodataBounds }[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const bboxParam = `${bounds.south.toFixed(5)},${bounds.west.toFixed(5)},${bounds.north.toFixed(5)},${bounds.east.toFixed(5)},urn:ogc:def:crs:EPSG::4326`;
  const layers: { typeName: string; prefix: string; label: string; count: number }[] = [
    { typeName: 'ps:PS.ProtectedSite.NSG', prefix: 'nsg', label: 'Naturschutzgebiet (NSG)', count: 45 },
    { typeName: 'ps:PS.ProtectedSite.NP', prefix: 'np', label: 'Nationalpark', count: 5 },
    { typeName: 'ps:PS.ProtectedSite.NWZ', prefix: 'nwz', label: 'Naturwaldzelle (NWZ)', count: 15 },
  ];

  const results = await Promise.allSettled(
    layers.map(async (layer) => {
      const url = `https://www.wfs.nrw.de/umwelt/wfs_nw_inspire-schutzgebiete?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${encodeURIComponent(layer.typeName)}&BBOX=${encodeURIComponent(bboxParam)}&COUNT=${layer.count}&OUTPUTFORMAT=GEOJSON`;
      const res = await fetchWithTimeout(url, {}, 7500);
      if (!res.ok) {
        throw new Error(`LANUV ${layer.prefix.toUpperCase()} HTTP ${res.status}`);
      }
      const data = (await res.json()) as GeoJsonFeatureCollection;
      return { layer, features: data.features ?? [] };
    })
  );

  const stands: NRWForestStand[] = [];
  const bboxes: { stand: NRWForestStand; bbox: GeodataBounds }[] = [];

  for (const settled of results) {
    if (settled.status === 'rejected') {
      warnings.push(String(settled.reason));
      continue;
    }
    const { layer, features } = settled.value;
    for (const feat of features) {
      const props = feat.properties ?? {};
      const siteName = String(props.siteName || props.id_localId || layer.label);
      const localId = props.id_localId ? String(props.id_localId) : undefined;
      const objId = String(props.OBJECTID ?? feat.id ?? Math.random().toString(36).slice(2, 8));

      const outerRings = extractOuterRingsLatLng(feat.geometry);
      const rankedRings = outerRings
        .map((r) => ({ ring: r, area: computeAreaHectares(r) }))
        .filter((x) => x.area >= 0.8)
        .sort((a, b) => b.area - a.area)
        .slice(0, 3);

      rankedRings.forEach((item, idx) => {
        const simplified = simplifyRing(item.ring, 0.0001);
        const centroid = computeCentroid(simplified);
        const sr = closestSubRegion(centroid[0], centroid[1]);
        const stand: NRWForestStand = {
          id: `lanuv-${layer.prefix}-${objId}-${idx}`,
          name: rankedRings.length > 1 ? `${siteName} (Part ${idx + 1})` : siteName,
          subRegion: sr.id,
          source: 'nrw-wfs-nsg',
          coordinates: simplified,
          centroid,
          areaHectares: Math.max(1, Math.round(item.area)),
          leafType: 'mixed',
          hostComposition: { beech: 0.45, oak: 0.3, spruce: 0.15, birch: 0.1 },
          geology: sr.geologySummary,
          soilTexture: sr.defaultTexture,
          soilPh: sr.typicalPh,
          elevationM: sr.typicalElevationM,
          slopeDeg: sr.defaultSlopeDeg,
          aspect: 'Flat',
          valleyHumidityBonus: sr.defaultHumidity,
          isProtectedNSG: true,
          nsgName: localId ? `${siteName} (${localId})` : siteName,
          notes: `Official surveyed boundary from LANUV NRW (${layer.label}, dl-de/zero-2-0). Leaving marked paths and collecting mushrooms are strictly prohibited.`,
          officialMeta: {
            dataset: `LANUV NRW · ${layer.label}`,
            localId,
          },
        };
        stands.push(stand);
        bboxes.push({ stand, bbox: computeRingBBox(simplified) });
      });
    }
  }

  return { stands, bboxes, warnings };
}

// ============================================================================
// 2. Official Geologischer Dienst NRW FSK05 (1:5,000 Forstliche Standortkarte)
// ============================================================================

interface ParsedFskAttributes {
  soilPh: number;
  soilTexture: NRWForestStand['soilTexture'];
  valleyHumidityBonus: number;
  elevationM: number;
  leafType: LeafType;
  hostComposition: Partial<Record<TreeHostKey, number>>;
  geology: string;
  officialMeta: OfficialGeodataMeta;
}

interface IndexedFskPolygon {
  stand: NRWForestStand;
  bbox: GeodataBounds;
  parsed: ParsedFskAttributes;
}

function parseFskProperties(
  props: Record<string, unknown>,
  baseline: SubRegionBaseline
): ParsedFskAttributes {
  const basenText = String(props.BASEN_TEXT ?? '').trim();
  const gwhText = String(props.GWH_TEXT ?? '').trim();
  const standortTyp = String(props.STANDORTTYP ?? '').trim();
  const nfk = props.NFK ? String(props.NFK).trim() : undefined;
  const veg10 = props.VEG10 ? String(props.VEG10).trim() : undefined;
  const kwbv = props.KWBV ? String(props.KWBV).trim() : undefined;
  const parcelCode = props.NAME ? String(props.NAME).trim() : undefined;

  const combinedAcid = `${basenText} ${standortTyp}`.toLowerCase();
  let soilPh = baseline.typicalPh;
  let soilTexture: NRWForestStand['soilTexture'] = baseline.defaultTexture;

  if (combinedAcid.includes('sehr basenarm') || combinedAcid.includes('extrem basenarm')) {
    soilPh = 4.1;
    soilTexture = baseline.id === 'muensterland' ? 'sandy-podsol' : 'acidic-slate-loam';
  } else if (combinedAcid.includes('basenarm') || combinedAcid.includes('oligotroph')) {
    soilPh = 4.6;
    soilTexture = baseline.id === 'muensterland' ? 'sandy-podsol' : 'acidic-slate-loam';
  } else if (combinedAcid.includes('mäßig basenhaltig') || combinedAcid.includes('mesotroph')) {
    soilPh = 5.3;
    soilTexture = 'braunerde';
  } else if (
    combinedAcid.includes('basenreich') ||
    combinedAcid.includes('eutroph') ||
    combinedAcid.includes('kalk')
  ) {
    soilPh = 6.6;
    soilTexture = 'calcareous-loam';
  }

  const combinedWater = `${gwhText} ${standortTyp}`.toLowerCase();
  let valleyHumidityBonus = baseline.defaultHumidity;
  if (
    combinedWater.includes('nass') ||
    combinedWater.includes('grundfeucht') ||
    combinedWater.includes('staufeucht')
  ) {
    valleyHumidityBonus = 0.94;
    if (soilTexture === 'braunerde') soilTexture = 'moist-gley';
  } else if (combinedWater.includes('hangfeucht') || combinedWater.includes('feucht')) {
    valleyHumidityBonus = 0.9;
  } else if (combinedWater.includes('sehr frisch') || combinedWater.includes('grundfrisch')) {
    valleyHumidityBonus = 0.84;
  } else if (combinedWater.includes('frisch') || combinedWater.includes('wechselfeucht')) {
    valleyHumidityBonus = 0.78;
  } else if (combinedWater.includes('mäßig trocken')) {
    valleyHumidityBonus = 0.6;
  } else if (combinedWater.includes('trocken')) {
    valleyHumidityBonus = 0.48;
  }

  let elevationM = baseline.typicalElevationM;
  const vegMatch = veg10?.match(/(\d+)/);
  if (vegMatch) {
    const days = Number(vegMatch[1]);
    if (Number.isFinite(days) && days >= 110 && days <= 230) {
      elevationM = Math.max(45, Math.min(820, Math.round((215 - days) * 8.2)));
    }
  }

  const wetLabels: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('WET') && k.endsWith('OPT') && typeof v === 'string' && v.trim()) {
      wetLabels.push(v.trim());
    }
  }
  if (wetLabels.length === 0) {
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('WET') && k.endsWith('RED') && typeof v === 'string' && v.trim()) {
        wetLabels.push(v.trim());
      }
    }
  }

  const wetJoined = wetLabels.join(' ').toLowerCase();
  const weights: Partial<Record<TreeHostKey, number>> = {};
  if (wetJoined.includes('buche')) weights.beech = (weights.beech ?? 0) + 0.45;
  if (wetJoined.includes('eiche')) weights.oak = (weights.oak ?? 0) + 0.35;
  if (wetJoined.includes('fichte') || wetJoined.includes('douglasie') || wetJoined.includes('tanne')) {
    weights.spruce = (weights.spruce ?? 0) + 0.38;
  }
  if (wetJoined.includes('kiefer') || wetJoined.includes('lärche')) {
    weights.pine = (weights.pine ?? 0) + 0.32;
  }
  if (wetJoined.includes('birke') || wetJoined.includes('erle')) {
    weights.birch = (weights.birch ?? 0) + 0.2;
  }

  const totalW = Object.values(weights).reduce((s, n) => s + (n ?? 0), 0);
  let hostComposition: Partial<Record<TreeHostKey, number>>;
  if (totalW > 0) {
    hostComposition = {};
    for (const [k, v] of Object.entries(weights)) {
      hostComposition[k as TreeHostKey] = Number(((v ?? 0) / totalW).toFixed(2));
    }
  } else {
    hostComposition = { beech: 0.42, spruce: 0.32, oak: 0.16, birch: 0.1 };
  }

  const coniferShare = (hostComposition.spruce ?? 0) + (hostComposition.pine ?? 0);
  const leafType: LeafType =
    coniferShare >= 0.65 ? 'needleleaved' : coniferShare <= 0.25 ? 'broadleaved' : 'mixed';

  const wetSummary = wetLabels
    .slice(0, 2)
    .map((w) => w.replace(/^WET\s+\d+:\s*/i, ''))
    .join(' · ');

  const geologyParts = [
    basenText ? `FSK05 ${basenText}` : null,
    gwhText ? `Water: ${gwhText}` : null,
    nfk ? `NFK ${nfk}` : null,
  ].filter(Boolean);

  return {
    soilPh,
    soilTexture,
    valleyHumidityBonus,
    elevationM,
    leafType,
    hostComposition,
    geology: geologyParts.length > 0 ? geologyParts.join(' · ') : baseline.geologySummary,
    officialMeta: {
      dataset: 'Geologischer Dienst NRW · FSK05 (1:5,000)',
      parcelCode,
      standortTyp: standortTyp || undefined,
      basenText: basenText || undefined,
      waterBalance: gwhText || undefined,
      nfk,
      vegDays: veg10,
      kwbv,
      wetSummary: wetSummary || undefined,
    },
  };
}

async function fetchGdNrwFsk05(bounds: GeodataBounds): Promise<{
  indexed: IndexedFskPolygon[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const [minE, minN] = latLngToUtm32N(bounds.south, bounds.west);
  const [maxE, maxN] = latLngToUtm32N(bounds.north, bounds.east);
  const url = `https://www.wfs.nrw.de/gd/fsk05?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=gd:wet&BBOX=${minE},${minN},${maxE},${maxN}&COUNT=240&OUTPUTFORMAT=GEOJSON`;

  try {
    const res = await fetchWithTimeout(url, {}, 8500);
    if (!res.ok) {
      warnings.push(`GD NRW FSK05 returned HTTP ${res.status}`);
      return { indexed: [], warnings };
    }
    const data = (await res.json()) as GeoJsonFeatureCollection;
    const features = data.features ?? [];
    const indexed: IndexedFskPolygon[] = [];

    for (const feat of features) {
      const props = feat.properties ?? {};
      const shapeAreaM2 = Number(props.Shape_Area ?? 0);
      const outerRings = extractOuterRingsLatLng(feat.geometry);
      if (outerRings.length === 0) continue;

      const primary = outerRings.sort((a, b) => computeAreaHectares(b) - computeAreaHectares(a))[0];
      const areaHa =
        shapeAreaM2 > 0 ? Number((shapeAreaM2 / 10000).toFixed(1)) : computeAreaHectares(primary);
      if (areaHa < 0.7) continue;

      const simplified = simplifyRing(primary, 0.0001);
      const centroid = computeCentroid(simplified);
      const baseline = closestSubRegion(centroid[0], centroid[1]);
      const parsed = parseFskProperties(props, baseline);
      const objId = String(props.OBJECTID ?? feat.id ?? Math.random().toString(36).slice(2, 8));
      const parcelCode = parsed.officialMeta.parcelCode ?? objId;
      const wetTitle = parsed.officialMeta.wetSummary
        ? parsed.officialMeta.wetSummary.split(' · ')[0]
        : 'Forestry Site';

      const stand: NRWForestStand = {
        id: `fsk05-${objId}`,
        name: `FSK05 ${wetTitle} (${parcelCode})`,
        subRegion: baseline.id,
        source: 'nrw-wfs-fsk',
        coordinates: simplified,
        centroid,
        areaHectares: Math.max(1, Math.round(areaHa)),
        leafType: parsed.leafType,
        hostComposition: parsed.hostComposition,
        geology: parsed.geology,
        soilTexture: parsed.soilTexture,
        soilPh: parsed.soilPh,
        elevationM: parsed.elevationM,
        slopeDeg: baseline.defaultSlopeDeg,
        aspect: 'NE',
        valleyHumidityBonus: parsed.valleyHumidityBonus,
        isProtectedNSG: false,
        notes: parsed.officialMeta.standortTyp
          ? `Official Geologischer Dienst NRW 1:5,000 site survey: ${parsed.officialMeta.standortTyp}`
          : 'Official Geologischer Dienst NRW 1:5,000 Forstliche Standortkarte polygon.',
        officialMeta: parsed.officialMeta,
      };

      indexed.push({
        stand,
        bbox: computeRingBBox(simplified),
        parsed,
      });
    }

    indexed.sort((a, b) => b.stand.areaHectares - a.stand.areaHectares);
    return { indexed, warnings };
  } catch (err) {
    warnings.push(`GD NRW FSK05 unavailable: ${err instanceof Error ? err.message : 'timeout'}`);
    return { indexed: [], warnings };
  }
}

// ============================================================================
// 3. Official Wald und Holz NRW / Basis-DLM WFS (Laubwald, Mischwald, Nadelwald)
// ============================================================================

interface WaldLayerSpec {
  typeName: 'wa:Laubwald' | 'wa:Mischwald' | 'wa:Nadelwald';
  leafType: LeafType;
  germanLabel: string;
  englishLabel: string;
  count: number;
}

const WALD_LAYERS: WaldLayerSpec[] = [
  {
    typeName: 'wa:Laubwald',
    leafType: 'broadleaved',
    germanLabel: 'Laubwald',
    englishLabel: 'Deciduous Stand',
    count: 55,
  },
  {
    typeName: 'wa:Mischwald',
    leafType: 'mixed',
    germanLabel: 'Mischwald',
    englishLabel: 'Mixed Forest Stand',
    count: 55,
  },
  {
    typeName: 'wa:Nadelwald',
    leafType: 'needleleaved',
    germanLabel: 'Nadelwald',
    englishLabel: 'Conifer Stand',
    count: 55,
  },
];

function defaultHostCompositionForWald(
  leafType: LeafType,
  subRegion: SubRegionId
): Partial<Record<TreeHostKey, number>> {
  if (leafType === 'needleleaved') {
    if (subRegion === 'muensterland' || subRegion === 'ruhr-niederrhein') {
      return { pine: 0.62, spruce: 0.24, birch: 0.08, beech: 0.06 };
    }
    return { spruce: 0.68, pine: 0.16, beech: 0.1, clearing: 0.06 };
  }
  if (leafType === 'broadleaved') {
    if (subRegion === 'muensterland' || subRegion === 'ruhr-niederrhein') {
      return { oak: 0.44, beech: 0.38, birch: 0.12, clearing: 0.06 };
    }
    return { beech: 0.62, oak: 0.24, birch: 0.08, clearing: 0.06 };
  }
  // mixed
  if (subRegion === 'muensterland' || subRegion === 'ruhr-niederrhein') {
    return { oak: 0.3, pine: 0.28, beech: 0.24, birch: 0.12, spruce: 0.06 };
  }
  return { beech: 0.38, spruce: 0.34, oak: 0.16, pine: 0.06, birch: 0.06 };
}

function parseGmlWaldMembers(xmlText: string): {
  gmlId: string;
  objId?: string;
  name?: string;
  standDate?: string;
  outerRingsLatLng: [number, number][][];
}[] {
  const members: {
    gmlId: string;
    objId?: string;
    name?: string;
    standDate?: string;
    outerRingsLatLng: [number, number][][];
  }[] = [];

  const memberRegex = /<wfs:member>([\s\S]*?)<\/wfs:member>/g;
  let m: RegExpExecArray | null;
  while ((m = memberRegex.exec(xmlText)) !== null) {
    const chunk = m[1];
    const gmlId = chunk.match(/gml:id="([^"]+)"/)?.[1] ?? Math.random().toString(36).slice(2, 9);
    const objId = chunk.match(/<wa:objid>([^<]+)<\/wa:objid>/)?.[1]?.trim();
    const rawName = chunk.match(/<wa:nam>([^<]+)<\/wa:nam>/)?.[1]?.trim();
    const standDate = chunk.match(/<wa:stand>([^<]+)<\/wa:stand>/)?.[1]?.trim();

    // Extract exterior rings only (ignore interior clearings so Leaflet polygon renders cleanly)
    const exteriorRegex = /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]+)<\/gml:posList>[\s\S]*?<\/gml:exterior>/g;
    const outerRingsLatLng: [number, number][][] = [];
    let ext: RegExpExecArray | null;
    while ((ext = exteriorRegex.exec(chunk)) !== null) {
      const nums = ext[1].trim().split(/\s+/).map(Number);
      if (nums.length < 8) continue;
      const ring: [number, number][] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const easting = nums[i];
        const northing = nums[i + 1];
        if (!Number.isFinite(easting) || !Number.isFinite(northing)) continue;
        ring.push(utm32NToLatLng(easting, northing));
      }
      if (ring.length >= 4) {
        outerRingsLatLng.push(ring);
      }
    }

    if (outerRingsLatLng.length > 0) {
      members.push({ gmlId, objId, name: rawName || undefined, standDate, outerRingsLatLng });
    }
  }
  return members;
}

async function fetchWaldNrwForests(
  bounds: GeodataBounds,
  fskIndex: IndexedFskPolygon[],
  lanuvProtected: { stand: NRWForestStand; bbox: GeodataBounds }[]
): Promise<{ stands: NRWForestStand[]; enrichedCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  const [minE, minN] = latLngToUtm32N(bounds.south, bounds.west);
  const [maxE, maxN] = latLngToUtm32N(bounds.north, bounds.east);

  const settled = await Promise.allSettled(
    WALD_LAYERS.map(async (layer) => {
      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature service="WFS" version="2.0.0" count="${layer.count}"
  xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:fes="http://www.opengis.net/fes/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:wa="http://www.windwfs.nrw.de/namespaces/energieatlas/wald/1.0">
  <wfs:Query typeNames="${layer.typeName}" srsName="urn:ogc:def:crs:EPSG::25832">
    <fes:Filter>
      <fes:BBOX>
        <fes:ValueReference>wa:location</fes:ValueReference>
        <gml:Envelope srsName="urn:ogc:def:crs:EPSG::25832">
          <gml:lowerCorner>${minE} ${minN}</gml:lowerCorner>
          <gml:upperCorner>${maxE} ${maxN}</gml:upperCorner>
        </gml:Envelope>
      </fes:BBOX>
    </fes:Filter>
  </wfs:Query>
</wfs:GetFeature>`;

      const res = await fetchWithTimeout(
        'https://www.wfs.nrw.de/umwelt/wald',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/xml' },
          body: xmlBody,
        },
        8500
      );
      if (!res.ok) {
        throw new Error(`Wald NRW ${layer.germanLabel} HTTP ${res.status}`);
      }
      const xml = await res.text();
      return { layer, members: parseGmlWaldMembers(xml) };
    })
  );

  const candidates: { stand: NRWForestStand; areaHa: number; enriched: boolean }[] = [];

  for (const res of settled) {
    if (res.status === 'rejected') {
      warnings.push(String(res.reason));
      continue;
    }
    const { layer, members } = res.value;
    for (const mem of members) {
      const sized = mem.outerRingsLatLng
        .map((ring) => ({ ring, area: computeAreaHectares(ring) }))
        .filter((x) => x.area >= 1.2)
        .sort((a, b) => b.area - a.area)
        .slice(0, 1);

      for (const { ring, area } of sized) {
        const simplified = simplifyRing(ring, 0.0001);
        const centroid = computeCentroid(simplified);
        const ringBBox = computeRingBBox(simplified);
        const baseline = closestSubRegion(centroid[0], centroid[1]);

        // Skip stands whose centroid sits squarely inside a LANUV NSG/NP/NWZ (LANUV red-hatched polygon renders on top!)
        let insideProtected: NRWForestStand | null = null;
        for (const prot of lanuvProtected) {
          if (bboxesOverlap(ringBBox, prot.bbox) && pointInPolygon(centroid, prot.stand.coordinates)) {
            insideProtected = prot.stand;
            break;
          }
        }
        if (insideProtected) continue;

        // Spatial soil enrichment from official Geologischer Dienst NRW FSK05 (1:5,000)
        let matchedFsk: IndexedFskPolygon | null = null;
        for (const fsk of fskIndex) {
          if (!bboxesOverlap(ringBBox, fsk.bbox)) continue;
          if (
            pointInPolygon(centroid, fsk.stand.coordinates) ||
            pointInPolygon(fsk.stand.centroid, simplified)
          ) {
            matchedFsk = fsk;
            break;
          }
        }
        if (!matchedFsk) {
          for (const fsk of fskIndex) {
            if (bboxesOverlap(ringBBox, fsk.bbox)) {
              matchedFsk = fsk;
              break;
            }
          }
        }

        const hostComposition = defaultHostCompositionForWald(layer.leafType, baseline.id);
        const shortCode = (mem.objId ?? mem.gmlId).slice(-5).toUpperCase();
        const displayName = mem.name
          ? `${mem.name} (${layer.germanLabel})`
          : `${layer.germanLabel} · ${baseline.shortName} #${shortCode}`;

        const officialMeta: OfficialGeodataMeta = matchedFsk
          ? {
              ...matchedFsk.parsed.officialMeta,
              dataset: `Wald & Holz NRW (${layer.germanLabel}) + GD NRW FSK05`,
              localId: mem.objId,
              osmEnrichedWithFsk: true,
            }
          : {
              dataset: `Wald & Holz NRW · Basis-DLM (${layer.germanLabel})`,
              localId: mem.objId,
            };

        candidates.push({
          areaHa: area,
          enriched: Boolean(matchedFsk),
          stand: {
            id: `wald-${layer.leafType}-${mem.gmlId}`,
            name: displayName,
            subRegion: baseline.id,
            source: 'nrw-wfs-wald',
            coordinates: simplified,
            centroid,
            areaHectares: Math.max(1, Math.round(area)),
            leafType: layer.leafType,
            hostComposition,
            geology: matchedFsk
              ? matchedFsk.parsed.geology
              : `${baseline.geologySummary} (Naturraum baseline)`,
            soilTexture: matchedFsk ? matchedFsk.parsed.soilTexture : baseline.defaultTexture,
            soilPh: matchedFsk ? matchedFsk.parsed.soilPh : baseline.typicalPh,
            elevationM: matchedFsk ? matchedFsk.parsed.elevationM : baseline.typicalElevationM,
            slopeDeg: baseline.defaultSlopeDeg,
            aspect: 'NE',
            valleyHumidityBonus: matchedFsk
              ? matchedFsk.parsed.valleyHumidityBonus
              : baseline.defaultHumidity,
            isProtectedNSG: false,
            notes: matchedFsk
              ? `Official Basis-DLM ${layer.germanLabel} polygon (${mem.standDate ?? 'NRW'}) spatially enriched with Geologischer Dienst NRW FSK05 soil & water data (${matchedFsk.parsed.officialMeta.basenText ?? 'surveyed'}).`
              : `Official Basis-DLM / Wald & Holz NRW ${layer.germanLabel} surveyed forest polygon (${mem.standDate ?? 'NRW'}) paired with ${baseline.shortName} pH & microclimate baseline.`,
            officialMeta,
          },
        });
      }
    }
  }

  // Keep largest & clearest surveyed polygons up to 110 stands per viewport for smooth 60fps SVG rendering
  candidates.sort((a, b) => b.areaHa - a.areaHa);
  const top = candidates.slice(0, 110);
  return {
    stands: top.map((c) => c.stand),
    enrichedCount: top.filter((c) => c.enriched).length,
    warnings,
  };
}

// ============================================================================
// Public Orchestrator
// ============================================================================

export async function fetchHighResNRWGeodata(rawBounds: GeodataBounds): Promise<HighResGeodataResponse> {
  const started = Date.now();

  const clamped: GeodataBounds = {
    south: Math.max(50.25, Math.min(52.58, rawBounds.south)),
    north: Math.max(50.25, Math.min(52.58, rawBounds.north)),
    west: Math.max(5.8, Math.min(9.55, rawBounds.west)),
    east: Math.max(5.8, Math.min(9.55, rawBounds.east)),
  };

  const latSpan = clamped.north - clamped.south;
  const lngSpan = clamped.east - clamped.west;
  if (latSpan <= 0.002 || lngSpan <= 0.002) {
    throw new Error('Invalid map bounding box.');
  }

  // If zoomed out wide, automatically query a focused ~12 x 14 km high-res window around the viewport center
  let queryBounds = clamped;
  const warnings: string[] = [];
  if (latSpan > 0.22 || lngSpan > 0.34) {
    const midLat = (clamped.south + clamped.north) / 2;
    const midLng = (clamped.west + clamped.east) / 2;
    queryBounds = {
      south: midLat - 0.055,
      north: midLat + 0.055,
      west: midLng - 0.085,
      east: midLng + 0.085,
    };
    warnings.push('Loaded centered ~12 × 12 km high-resolution NRW survey window.');
  }

  const cacheKey = getCacheKey(queryBounds);
  const hit = geodataCache.get(cacheKey);
  if (hit && Date.now() - hit.createdAt < CACHE_TTL_MS) {
    return {
      ...hit.payload,
      cached: true,
      elapsedMs: Date.now() - started,
    };
  }

  // Fetch LANUV Protected Areas + GD NRW FSK05 in parallel (~200-800ms)
  const [lanuvRes, fskRes] = await Promise.all([
    fetchLanuvProtectedAreas(queryBounds),
    fetchGdNrwFsk05(queryBounds),
  ]);
  warnings.push(...lanuvRes.warnings, ...fskRes.warnings);

  // Fetch official Wald & Holz NRW Basis-DLM Laubwald + Mischwald + Nadelwald (~700ms) and enrich with FSK05 + filter NSG interiors
  const waldRes = await fetchWaldNrwForests(queryBounds, fskRes.indexed, lanuvRes.bboxes);
  warnings.push(...waldRes.warnings);

  // Include standalone large FSK05 forestry site stands (>= 3 ha, up to 25) when Wald NRW didn't cover them or for granular soil detail
  const standaloneFsk = fskRes.indexed
    .filter((f) => f.stand.areaHectares >= 3)
    .slice(0, 25)
    .map((f) => f.stand);

  // Layer order: Wald NRW forests -> FSK05 soil-site overlays -> LANUV NSG/NP/NWZ on top
  const stands: NRWForestStand[] = [
    ...waldRes.stands,
    ...standaloneFsk,
    ...lanuvRes.stands,
  ];

  const sources: string[] = [];
  if (waldRes.stands.length > 0) sources.push('Wald & Holz NRW Basis-DLM WFS');
  if (fskRes.indexed.length > 0) sources.push('GD NRW FSK05 (1:5,000)');
  if (lanuvRes.stands.length > 0) sources.push('LANUV NRW Schutzgebiete WFS');

  const payload: HighResGeodataResponse = {
    stands,
    counts: {
      waldNrwForests: waldRes.stands.length,
      fskSoilPolygons: standaloneFsk.length,
      lanuvProtected: lanuvRes.stands.length,
      enrichedWithFsk: waldRes.enrichedCount,
    },
    sources,
    cached: false,
    elapsedMs: Date.now() - started,
    warnings,
  };

  if (geodataCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = geodataCache.keys().next().value;
    if (oldestKey) geodataCache.delete(oldestKey);
  }
  geodataCache.set(cacheKey, { createdAt: Date.now(), payload });

  return payload;
}
