import { NRW_SUBREGIONS } from '../data/nrwForestStands';
import type {
  DailyWeatherPoint,
  SubRegionId,
  SubRegionWeatherSeries,
} from '../types/foraging';
import { loadCachedWeather, saveCachedWeather } from './offlineStorage';

interface OpenMeteoResponse {
  hourly?: {
    time: string[];
    precipitation: (number | null)[];
    soil_temperature_6cm: (number | null)[];
    soil_moisture_3_9cm: (number | null)[];
    soil_moisture_9_27cm: (number | null)[];
    temperature_2m: (number | null)[];
  };
}

function formatDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function aggregateHourlyToDaily(hourly: NonNullable<OpenMeteoResponse['hourly']>): DailyWeatherPoint[] {
  const byDay = new Map<
    string,
    {
      precip: number;
      sm39: number[];
      sm927: number[];
      st6: number[];
      temps: number[];
    }
  >();

  for (let i = 0; i < hourly.time.length; i++) {
    const dayKey = hourly.time[i].slice(0, 10);
    let bucket = byDay.get(dayKey);
    if (!bucket) {
      bucket = { precip: 0, sm39: [], sm927: [], st6: [], temps: [] };
      byDay.set(dayKey, bucket);
    }
    const p = hourly.precipitation[i];
    if (typeof p === 'number' && !Number.isNaN(p)) bucket.precip += p;

    const m1 = hourly.soil_moisture_3_9cm[i];
    if (typeof m1 === 'number' && !Number.isNaN(m1)) bucket.sm39.push(m1);

    const m2 = hourly.soil_moisture_9_27cm[i];
    if (typeof m2 === 'number' && !Number.isNaN(m2)) bucket.sm927.push(m2);

    const st = hourly.soil_temperature_6cm[i];
    if (typeof st === 'number' && !Number.isNaN(st)) bucket.st6.push(st);

    const t = hourly.temperature_2m[i];
    if (typeof t === 'number' && !Number.isNaN(t)) bucket.temps.push(t);
  }

  const avg = (arr: number[], fallback: number) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : fallback;

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      precipitationMm: Number(b.precip.toFixed(1)),
      soilMoisture3to9: Number(avg(b.sm39, 0.30).toFixed(3)),
      soilMoisture9to27: Number(avg(b.sm927, 0.31).toFixed(3)),
      soilTemp6cmC: Number(avg(b.st6, 10.0).toFixed(1)),
      minAirTempC: b.temps.length ? Number(Math.min(...b.temps).toFixed(1)) : 5.0,
      maxAirTempC: b.temps.length ? Number(Math.max(...b.temps).toFixed(1)) : 12.0,
    }));
}

/**
 * Generates an authentic mid-October NRW fruiting flush weather profile
 * (soaking rain 10-14 days prior + mild cooling drop) so users can explore
 * peak mushroom season differentiation across polygons even during winter frost.
 */
export function buildPeakAutumnReferenceWeather(): Record<SubRegionId, SubRegionWeatherSeries> {
  const baseDate = new Date();
  const buildSeries = (
    subRegion: SubRegionId,
    rainScale: number,
    tempOffset: number,
    moistureBase: number
  ): SubRegionWeatherSeries => {
    // 28 days: indices 0..20 = past 21 days, 21..27 = today..+6d
    const rainPattern = [
      1.2, 0.0, 0.4, 2.5, 0.0, 4.8, 12.6, 16.4, 9.2, 3.8, 11.5, 6.4, 1.8, 0.2,
      0.0, 2.4, 8.6, 5.2, 1.0, 0.4, 2.1,
      // Forecast (Today .. +6d)
      1.4, 6.8, 11.2, 3.5, 0.6, 0.2, 4.4,
    ];
    const days: DailyWeatherPoint[] = rainPattern.map((rawRain, idx) => {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + (idx - 21));
      const precip = Number((rawRain * rainScale).toFixed(1));
      // Mild autumn cooling transition around day 17-22 that triggers primordia
      const coolingCurve = idx >= 18 ? -2.2 - (idx - 18) * 0.18 : 0;
      const soilTemp = Number((14.8 + tempOffset + coolingCurve + Math.sin(idx * 0.5) * 0.7).toFixed(1));
      const sm39 = Number(
        Math.min(0.41, moistureBase + (precip > 6 ? 0.03 : 0) + (idx >= 21 ? 0.015 : 0)).toFixed(3)
      );
      return {
        date: formatDateIso(d),
        precipitationMm: precip,
        soilMoisture3to9: sm39,
        soilMoisture9to27: Number(Math.min(0.42, sm39 + 0.02).toFixed(3)),
        soilTemp6cmC: soilTemp,
        minAirTempC: Number((soilTemp - 5.2).toFixed(1)),
        maxAirTempC: Number((soilTemp + 4.4).toFixed(1)),
      };
    });

    return {
      subRegion,
      fetchedAt: new Date().toISOString(),
      source: 'peak-autumn-reference',
      days,
      todayIndex: 21,
    };
  };

  return {
    'ruhr-niederrhein': buildSeries('ruhr-niederrhein', 0.90, 1.0, 0.29),
    'bergisches-land': buildSeries('bergisches-land', 1.26, -0.3, 0.35),
    'sauerland-siegerland': buildSeries('sauerland-siegerland', 1.22, -1.2, 0.35),
    'eifel-boerde': buildSeries('eifel-boerde', 1.12, -0.8, 0.33),
    muensterland: buildSeries('muensterland', 0.95, 0.6, 0.31),
    'ostwestfalen-lippe': buildSeries('ostwestfalen-lippe', 1.08, -0.4, 0.32),
  };
}

/**
 * Generates an offline-safe seasonal NRW baseline if the user opens the app
 * with no network and no prior IndexedDB weather cache.
 */
export function buildSeasonalFallbackWeather(): Record<SubRegionId, SubRegionWeatherSeries> {
  const now = new Date();
  const month = now.getMonth(); // 0..11
  // Approximate NRW monthly mean 6cm soil temp (°C)
  const monthlySoilTemp = [2.8, 3.2, 5.8, 9.2, 13.4, 16.5, 18.2, 17.8, 14.6, 11.2, 6.8, 3.8];
  const baseTemp = monthlySoilTemp[month];

  const buildSub = (subRegion: SubRegionId, rainMult: number, tempDelta: number): SubRegionWeatherSeries => {
    const rainSeeds = [
      2.0, 0.5, 4.2, 1.1, 0.0, 6.5, 9.8, 3.4, 0.8, 5.6, 11.2, 4.1, 0.0, 1.6,
      3.8, 7.4, 2.2, 0.0, 1.5, 4.6, 2.8,
      1.2, 5.4, 8.2, 2.6, 0.4, 1.8, 3.6,
    ];
    const days: DailyWeatherPoint[] = rainSeeds.map((r, idx) => {
      const d = new Date(now);
      d.setDate(d.getDate() + (idx - 21));
      const tSoil = Number((baseTemp + tempDelta + Math.cos(idx * 0.45) * 1.1).toFixed(1));
      const sm = Number(Math.min(0.40, 0.27 + (rainMult - 0.9) * 0.08 + (r > 5 ? 0.03 : 0)).toFixed(3));
      return {
        date: formatDateIso(d),
        precipitationMm: Number((r * rainMult).toFixed(1)),
        soilMoisture3to9: sm,
        soilMoisture9to27: Number((sm + 0.02).toFixed(3)),
        soilTemp6cmC: tSoil,
        minAirTempC: Number((tSoil - 4.2).toFixed(1)),
        maxAirTempC: Number((tSoil + 3.8).toFixed(1)),
      };
    });

    return {
      subRegion,
      fetchedAt: now.toISOString(),
      source: 'nrw-seasonal-fallback',
      days,
      todayIndex: 21,
    };
  };

  return {
    'ruhr-niederrhein': buildSub('ruhr-niederrhein', 0.92, 0.9),
    'bergisches-land': buildSub('bergisches-land', 1.28, -0.4),
    'sauerland-siegerland': buildSub('sauerland-siegerland', 1.24, -1.3),
    'eifel-boerde': buildSub('eifel-boerde', 1.14, -0.8),
    muensterland: buildSub('muensterland', 0.96, 0.5),
    'ostwestfalen-lippe': buildSub('ostwestfalen-lippe', 1.08, -0.4),
  };
}

async function fetchSubRegionOpenMeteo(subRegion: SubRegionId): Promise<SubRegionWeatherSeries> {
  const [lat, lon] = NRW_SUBREGIONS[subRegion].center;
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'precipitation,soil_temperature_6cm,soil_moisture_3_9cm,soil_moisture_9_27cm,temperature_2m',
    past_days: '21',
    forecast_days: '7',
    timezone: 'Europe/Berlin',
  });

  // Use DWD ICON endpoint (high-resolution Central Europe ICON-D2 / ICON-EU)
  const url = `https://api.open-meteo.com/v1/dwd-icon?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo DWD-ICON-Abruf fehlgeschlagen (${res.status})`);
  }
  const data = (await res.json()) as OpenMeteoResponse;
  if (!data.hourly || data.hourly.time.length === 0) {
    throw new Error('Open-Meteo-Antwort enthält keine stündlichen Wetterdaten');
  }

  const days = aggregateHourlyToDaily(data.hourly);
  const todayStr = formatDateIso(new Date());
  const exactTodayIdx = days.findIndex((d) => d.date === todayStr);
  const todayIndex = exactTodayIdx >= 0 ? exactTodayIdx : Math.max(0, days.length - 7);

  const series: SubRegionWeatherSeries = {
    subRegion,
    fetchedAt: new Date().toISOString(),
    source: 'open-meteo-dwd-icon',
    days,
    todayIndex,
  };

  await saveCachedWeather(series);
  return series;
}

export async function fetchAllNRWWeather(forceRefresh = false): Promise<{
  weather: Record<SubRegionId, SubRegionWeatherSeries>;
  fromCache: boolean;
  error?: string;
}> {
  const subRegions: SubRegionId[] = [
    'ruhr-niederrhein',
    'bergisches-land',
    'sauerland-siegerland',
    'eifel-boerde',
    'muensterland',
    'ostwestfalen-lippe',
  ];
  const fallback = buildSeasonalFallbackWeather();

  // First try IndexedDB cache if offline or not forced and fresh (< 3 hours)
  if (!forceRefresh) {
    try {
      const cachedList = await Promise.all(subRegions.map((sr) => loadCachedWeather(sr)));
      const allPresent = cachedList.every((c) => c !== null);
      if (allPresent) {
        const newestAgeMs = Date.now() - new Date(cachedList[0]!.fetchedAt).getTime();
        if (!navigator.onLine || newestAgeMs < 1000 * 60 * 180) {
          const map = {} as Record<SubRegionId, SubRegionWeatherSeries>;
          cachedList.forEach((c) => {
            if (c) map[c.subRegion] = { ...c, source: 'cached-indexeddb' };
          });
          if (!navigator.onLine) {
            return { weather: map, fromCache: true };
          }
          // Fresh cache online: return immediately
          if (newestAgeMs < 1000 * 60 * 180) {
            return { weather: map, fromCache: true };
          }
        }
      }
    } catch {
      // Ignore cache read error and proceed to live fetch
    }
  }

  if (!navigator.onLine) {
    return {
      weather: fallback,
      fromCache: true,
      error: 'Offline — nutzt saisonales NRW-Klimaprofil bis zur Online-Synchronisierung.',
    };
  }

  try {
    const results = await Promise.all(subRegions.map((sr) => fetchSubRegionOpenMeteo(sr)));
    const weather = {} as Record<SubRegionId, SubRegionWeatherSeries>;
    results.forEach((series) => {
      weather[series.subRegion] = series;
    });
    return { weather, fromCache: false };
  } catch (err) {
    // Try falling back to any cached IndexedDB records before seasonal fallback
    try {
      const cachedList = await Promise.all(subRegions.map((sr) => loadCachedWeather(sr)));
      if (cachedList.every((c) => c !== null)) {
        const map = {} as Record<SubRegionId, SubRegionWeatherSeries>;
        cachedList.forEach((c) => {
          if (c) map[c.subRegion] = { ...c, source: 'cached-indexeddb' };
        });
        return {
          weather: map,
          fromCache: true,
          error: 'Live-DWD-ICON-Abruf nicht verfügbar — nutzt letzten gespeicherten Wetterstand.',
        };
      }
    } catch {
      // Ignore
    }

    return {
      weather: fallback,
      fromCache: true,
      error: err instanceof Error ? err.message : 'Open-Meteo DWD-ICON-API nicht erreichbar.',
    };
  }
}
