export type SubRegionId =
  | 'ruhr-niederrhein'
  | 'bergisches-land'
  | 'sauerland-siegerland'
  | 'eifel-boerde'
  | 'muensterland'
  | 'ostwestfalen-lippe';
export type RegionFilter = 'all' | SubRegionId;
export type LeafType = 'needleleaved' | 'broadleaved' | 'mixed';
export type TreeHostKey = 'spruce' | 'pine' | 'beech' | 'oak' | 'birch' | 'clearing';
export type AspectDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'Flat';
export type WeatherMode = 'live' | 'peak-autumn';
export type ActiveTab = 'map' | 'forecast' | 'guide' | 'offline';

export interface SubRegionMeta {
  id: SubRegionId;
  name: string;
  shortName: string;
  /** Approximate cartographic Naturraum label shown on overview zoom */
  naturraumLabel: string;
  labelPosition: [number, number];
  subtitle: string;
  center: [number, number];
  zoom: number;
  bounds: [[number, number], [number, number]];
  geologySummary: string;
  typicalPhRange: [number, number];
  elevationRange: [number, number];
}

export interface OfficialGeodataMeta {
  dataset: string;
  parcelCode?: string;
  localId?: string;
  standortTyp?: string;
  basenText?: string;
  waterBalance?: string;
  nfk?: string;
  vegDays?: string;
  kwbv?: string;
  wetSummary?: string;
  osmEnrichedWithFsk?: boolean;
}

export interface NRWForestStand {
  id: string;
  name: string;
  subRegion: SubRegionId;
  source: 'curated-nrw' | 'osm-overpass' | 'nrw-wfs-wald' | 'nrw-wfs-fsk' | 'nrw-wfs-nsg';
  /** Array of [lat, lng] coordinates forming closed polygon */
  coordinates: [number, number][];
  centroid: [number, number];
  areaHectares: number;
  leafType: LeafType;
  /** Relative composition weights summing roughly to 1.0 */
  hostComposition: Partial<Record<TreeHostKey, number>>;
  geology: string;
  soilTexture: 'sandy-podsol' | 'acidic-slate-loam' | 'braunerde' | 'calcareous-loam' | 'moist-gley';
  soilPh: number;
  elevationM: number;
  slopeDeg: number;
  aspect: AspectDirection;
  /** Valley / Siepen microclimate moisture retention bonus (0 - 1) */
  valleyHumidityBonus: number;
  isProtectedNSG: boolean;
  nsgName?: string;
  notes: string;
  officialMeta?: OfficialGeodataMeta;
}

export interface LookalikeWarning {
  germanName: string;
  latinName: string;
  toxicity: 'deadly' | 'toxic' | 'inedible-bitter';
  distinguishingCues: string[];
}

export interface MushroomSpecies {
  id: string;
  germanName: string;
  englishName: string;
  latinName: string;
  imagePath: string;
  edibility: string;
  legalNote: string;
  hostSummary: string;
  /** 0..1 affinity to each tree host */
  hostAffinities: Partial<Record<TreeHostKey, number>>;
  /** Optimal pH center and sigma tolerance */
  optimalPh: number;
  phTolerance: number;
  /** Preferred soil textures */
  preferredTextures: NRWForestStand['soilTexture'][];
  /** Preferred elevation window in meters */
  elevationWindow: [number, number];
  /** Preferred 14-day exponentially weighted rainfall target (mm) */
  optimalRainLagMm: number;
  /** Optimal volumetric soil moisture at 3-9cm (m³/m³) */
  optimalSoilMoisture: number;
  /** Optimal soil temp at 6cm (°C) and tolerance */
  optimalSoilTempC: number;
  soilTempTolerance: number;
  /** Monthly phenology index [Jan..Dec], 0..1 */
  monthlySeasonality: [
    number, number, number, number, number, number,
    number, number, number, number, number, number
  ];
  seasonLabel: string;
  description: string;
  habitatNotes: string;
  idCheckpoints: string[];
  lookalike: LookalikeWarning;
}

export interface DailyWeatherPoint {
  date: string; // YYYY-MM-DD
  precipitationMm: number;
  soilMoisture3to9: number; // m³/m³ (typical 0.12 - 0.45)
  soilMoisture9to27: number;
  soilTemp6cmC: number;
  minAirTempC: number;
  maxAirTempC: number;
}

export interface SubRegionWeatherSeries {
  subRegion: SubRegionId;
  fetchedAt: string;
  source: 'open-meteo-dwd-icon' | 'cached-indexeddb' | 'nrw-seasonal-fallback' | 'peak-autumn-reference';
  /** 21 past days + 7 forecast days (total 28 entries). Index 21 = Today (offset 0). */
  days: DailyWeatherPoint[];
  todayIndex: number;
}

export type ProbabilityTier = 'peak' | 'high' | 'moderate' | 'low' | 'dormant' | 'nsg';

export interface EcologicalFactorBreakdown {
  hostScore: number; // 0..100
  soilPhScore: number; // 0..100
  microclimateScore: number; // 0..100
  rainLagScore: number; // 0..100
  soilMoistureScore: number; // 0..100
  soilTempScore: number; // 0..100
  seasonScore: number; // 0..100
  weightedRainLagMm: number;
  soilMoisture3to9: number;
  soilTemp6cmC: number;
  minAirTempC: number;
  thermalShockBonus: boolean;
  frostBlocked: boolean;
}

export interface StandPrediction {
  standId: string;
  speciesId: string;
  bestSpeciesId: string;
  bestSpeciesName: string;
  probability: number; // 0..100
  habitatSuitability: number; // 0..100
  fruitingTrigger: number; // 0..100
  tier: ProbabilityTier;
  isLegalBlocked: boolean;
  summaryReason: string;
  limitingFactor: string;
  factors: EcologicalFactorBreakdown;
  speciesRanking: { speciesId: string; germanName: string; probability: number }[];
}

export interface OfflinePackRecord {
  subRegion: SubRegionId;
  cachedAt: string;
  tileCount: number;
  estimatedMb: number;
  weatherSyncedAt: string;
  standCount: number;
}

export interface LayerSettings {
  showNSG: boolean;
  minProbability: number; // 0 | 45 | 65
  showLabels: boolean;
  hideCuratedInHighRes: boolean;
  autoLoadHighRes: boolean;
}

export interface HighResGeodataResponse {
  stands: NRWForestStand[];
  counts: {
    waldNrwForests: number;
    fskSoilPolygons: number;
    lanuvProtected: number;
    enrichedWithFsk: number;
  };
  sources: string[];
  cached: boolean;
  elapsedMs: number;
  warnings: string[];
}
