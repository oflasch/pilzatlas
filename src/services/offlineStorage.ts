import { NRW_FOREST_STANDS, NRW_SUBREGIONS, NRW_SUBREGION_LIST } from '../data/nrwForestStands';
import type {
  NRWForestStand,
  OfflinePackRecord,
  SubRegionId,
  SubRegionWeatherSeries,
} from '../types/foraging';

const DB_NAME = 'pilzatlas-nrw-db';
const DB_VERSION = 1;
const STORE_WEATHER = 'weather';
const STORE_PACKS = 'offline_packs';
const STORE_OSM_STANDS = 'osm_stands';
export const TILE_CACHE_NAME = 'pilzatlas-topo-tiles-v1';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_WEATHER)) {
        db.createObjectStore(STORE_WEATHER, { keyPath: 'subRegion' });
      }
      if (!db.objectStoreNames.contains(STORE_PACKS)) {
        db.createObjectStore(STORE_PACKS, { keyPath: 'subRegion' });
      }
      if (!db.objectStoreNames.contains(STORE_OSM_STANDS)) {
        db.createObjectStore(STORE_OSM_STANDS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveCachedWeather(series: SubRegionWeatherSeries): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_WEATHER, 'readwrite');
      tx.objectStore(STORE_WEATHER).put(series);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Graceful no-op in restricted browser contexts
  }
}

export async function loadCachedWeather(subRegion: SubRegionId): Promise<SubRegionWeatherSeries | null> {
  try {
    const db = await openDB();
    return await new Promise<SubRegionWeatherSeries | null>((resolve, reject) => {
      const tx = db.transaction(STORE_WEATHER, 'readonly');
      const req = tx.objectStore(STORE_WEATHER).get(subRegion);
      req.onsuccess = () => resolve((req.result as SubRegionWeatherSeries | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveOsmStands(stands: NRWForestStand[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OSM_STANDS, 'readwrite');
      const store = tx.objectStore(STORE_OSM_STANDS);
      stands.forEach((s) => store.put(s));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function loadOsmStands(): Promise<NRWForestStand[]> {
  try {
    const db = await openDB();
    return await new Promise<NRWForestStand[]>((resolve, reject) => {
      const tx = db.transaction(STORE_OSM_STANDS, 'readonly');
      const req = tx.objectStore(STORE_OSM_STANDS).getAll();
      req.onsuccess = () => resolve((req.result as NRWForestStand[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function clearOsmStands(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OSM_STANDS, 'readwrite');
      tx.objectStore(STORE_OSM_STANDS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function loadAllOfflinePacks(): Promise<Record<SubRegionId, OfflinePackRecord | null>> {
  const result = Object.fromEntries(
    NRW_SUBREGION_LIST.map((sr) => [sr.id, null])
  ) as Record<SubRegionId, OfflinePackRecord | null>;
  try {
    const db = await openDB();
    const list = await new Promise<OfflinePackRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PACKS, 'readonly');
      const req = tx.objectStore(STORE_PACKS).getAll();
      req.onsuccess = () => resolve((req.result as OfflinePackRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    list.forEach((rec) => {
      result[rec.subRegion] = rec;
    });
  } catch {
    // Ignore
  }
  return result;
}

export async function saveOfflinePackRecord(record: OfflinePackRecord): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PACKS, 'readwrite');
    tx.objectStore(STORE_PACKS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteOfflinePack(subRegion: SubRegionId): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PACKS, 'readwrite');
      tx.objectStore(STORE_PACKS).delete(subRegion);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }

  // Also purge matching tile URLs from Cache Storage
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(TILE_CACHE_NAME);
      const urls = computeTileUrlsForSubRegion(subRegion);
      await Promise.all(urls.map((u) => cache.delete(u)));
    } catch {
      // Ignore
    }
  }
}

function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export function computeTileUrlsForSubRegion(subRegion: SubRegionId): string[] {
  const [[south, west], [north, east]] = NRW_SUBREGIONS[subRegion].bounds;
  const urls: string[] = [];
  // Cache zooms 9, 10, 11, and 12 for balanced full-Naturraum coverage & fast offline download
  const zooms = [9, 10, 11, 12];
  for (const z of zooms) {
    const topLeft = latLngToTile(north, west, z);
    const bottomRight = latLngToTile(south, east, z);
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        urls.push(`https://a.tile.opentopomap.org/${z}/${x}/${y}.png`);
      }
    }
  }
  return urls;
}

export async function downloadSubRegionOfflinePack(
  subRegion: SubRegionId,
  weatherSeries: SubRegionWeatherSeries,
  onProgress: (done: number, total: number) => void
): Promise<OfflinePackRecord> {
  await saveCachedWeather(weatherSeries);

  const urls = computeTileUrlsForSubRegion(subRegion);
  const total = urls.length;
  let completed = 0;
  let cachedCount = 0;

  if (typeof caches !== 'undefined') {
    const cache = await caches.open(TILE_CACHE_NAME);
    // Throttled batches of 6 concurrent requests so we respect OpenTopoMap tile servers
    const batchSize = 6;
    for (let i = 0; i < urls.length; i += batchSize) {
      const slice = urls.slice(i, i + batchSize);
      await Promise.all(
        slice.map(async (url) => {
          try {
            const existing = await cache.match(url);
            if (existing) {
              cachedCount++;
            } else {
              const resp = await fetch(url, { mode: 'cors' });
              if (resp.ok || resp.type === 'opaque') {
                await cache.put(url, resp);
                cachedCount++;
              }
            }
          } catch {
            // Skip individual failed tile cleanly
          } finally {
            completed++;
            onProgress(completed, total);
          }
        })
      );
    }
  } else {
    completed = total;
    onProgress(total, total);
  }

  const standCount = NRW_FOREST_STANDS.filter((s) => s.subRegion === subRegion).length;
  // Typical OpenTopoMap PNG tile is ~36 KB
  const estimatedMb = Number(((cachedCount * 36) / 1024 + 0.15).toFixed(1));
  const record: OfflinePackRecord = {
    subRegion,
    cachedAt: new Date().toISOString(),
    tileCount: cachedCount,
    estimatedMb,
    weatherSyncedAt: weatherSeries.fetchedAt,
    standCount,
  };
  await saveOfflinePackRecord(record);
  return record;
}
