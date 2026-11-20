import { NRW_SUBREGIONS } from '../data/nrwForestStands';
import type { LeafType, NRWForestStand, SubRegionId, TreeHostKey } from '../types/foraging';

interface OverpassElement {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function closestSubRegion(lat: number, lng: number): SubRegionId {
  let best: SubRegionId = 'bergisches-land';
  let bestDist = Infinity;
  for (const [id, meta] of Object.entries(NRW_SUBREGIONS)) {
    const d = Math.hypot(lat - meta.center[0], lng - meta.center[1]);
    if (d < bestDist) {
      bestDist = d;
      best = id as SubRegionId;
    }
  }
  return best;
}

function estimatePolygonAreaHectares(coords: [number, number][]): number {
  if (coords.length < 3) return 5;
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
  return Math.max(2, Math.round((Math.abs(areaKm2) / 2) * 100));
}

function inferHostsFromOsmTags(tags: Record<string, string>): {
  leafType: LeafType;
  hostComposition: Partial<Record<TreeHostKey, number>>;
} {
  const leaf = tags.leaf_type;
  const species = (tags.species || tags['species:de'] || '').toLowerCase();

  if (species.includes('picea') || species.includes('fichte')) {
    return { leafType: 'needleleaved', hostComposition: { spruce: 0.72, beech: 0.18, pine: 0.1 } };
  }
  if (species.includes('pinus') || species.includes('kiefer')) {
    return { leafType: 'needleleaved', hostComposition: { pine: 0.75, spruce: 0.15, birch: 0.1 } };
  }
  if (species.includes('fagus') || species.includes('buche')) {
    return { leafType: 'broadleaved', hostComposition: { beech: 0.72, oak: 0.2, birch: 0.08 } };
  }
  if (species.includes('quercus') || species.includes('eiche')) {
    return { leafType: 'broadleaved', hostComposition: { oak: 0.65, beech: 0.25, birch: 0.1 } };
  }
  if (leaf === 'needleleaved') {
    return { leafType: 'needleleaved', hostComposition: { spruce: 0.58, pine: 0.28, beech: 0.14 } };
  }
  if (leaf === 'broadleaved') {
    return { leafType: 'broadleaved', hostComposition: { beech: 0.52, oak: 0.3, birch: 0.12, clearing: 0.06 } };
  }
  return {
    leafType: 'mixed',
    hostComposition: { beech: 0.36, spruce: 0.32, oak: 0.16, pine: 0.1, birch: 0.06 },
  };
}

/**
 * Fetches live OpenStreetMap forest stands and Naturschutzgebiete inside the
 * given map bounding box via the CORS-enabled Overpass API.
 */
export async function fetchOverpassStandsInBounds(bounds: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<NRWForestStand[]> {
  // Clamp bounding box span to protect Overpass API from overly wide queries
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  if (latSpan > 0.35 || lngSpan > 0.55) {
    throw new Error('Zoom in closer (regional stand level) before scanning live OpenStreetMap polygons.');
  }

  const bbox = `${bounds.south.toFixed(4)},${bounds.west.toFixed(4)},${bounds.north.toFixed(4)},${bounds.east.toFixed(4)}`;
  const query = `
[out:json][timeout:18];
(
  way["landuse"="forest"](${bbox});
  way["natural"="wood"](${bbox});
  way["boundary"="protected_area"]["protect_class"="4"](${bbox});
  way["leisure"="nature_reserve"](${bbox});
);
out geom qt 45;
`.trim();

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`Overpass API returned HTTP ${res.status}. Please retry in a few seconds.`);
  }

  const json = (await res.json()) as OverpassResponse;
  const stands: NRWForestStand[] = [];

  for (const el of json.elements) {
    if (!el.geometry || el.geometry.length < 4) continue;
    const coords: [number, number][] = el.geometry.map((pt) => [pt.lat, pt.lon]);
    const areaHa = estimatePolygonAreaHectares(coords);
    if (areaHa < 6) continue; // Skip tiny urban tree patches

    const centroidLat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const centroidLng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const subRegion = closestSubRegion(centroidLat, centroidLng);
    const meta = NRW_SUBREGIONS[subRegion];
    const tags = el.tags ?? {};
    const isNSG =
      tags.leisure === 'nature_reserve' ||
      tags.boundary === 'protected_area' ||
      (tags.name ?? '').toLowerCase().includes('naturschutzgebiet');

    const { leafType, hostComposition } = inferHostsFromOsmTags(tags);
    const avgPh = Number(((meta.typicalPhRange[0] + meta.typicalPhRange[1]) / 2).toFixed(1));
    const avgElev = Math.round((meta.elevationRange[0] + meta.elevationRange[1]) / 2);

    stands.push({
      id: `osm-way-${el.id}`,
      name:
        tags.name ||
        (isNSG
          ? `OSM Protected Reserve #${String(el.id).slice(-4)}`
          : `OSM ${leafType === 'needleleaved' ? 'Conifer' : leafType === 'broadleaved' ? 'Deciduous' : 'Mixed'} Stand #${String(el.id).slice(-4)}`),
      subRegion,
      source: 'osm-overpass',
      coordinates: coords,
      centroid: [Number(centroidLat.toFixed(5)), Number(centroidLng.toFixed(5))],
      areaHectares: areaHa,
      leafType,
      hostComposition,
      geology: `${meta.geologySummary} (regional baseline)`,
      soilTexture:
        subRegion === 'ruhr-niederrhein' || subRegion === 'muensterland'
          ? 'braunerde'
          : 'acidic-slate-loam',
      soilPh: avgPh,
      elevationM: avgElev,
      slopeDeg: subRegion === 'ruhr-niederrhein' || subRegion === 'muensterland' ? 5 : 12,
      aspect: 'NE',
      valleyHumidityBonus:
        subRegion === 'bergisches-land' || subRegion === 'sauerland-siegerland' ? 0.84 : 0.72,
      isProtectedNSG: isNSG,
      nsgName: isNSG ? tags.name ?? 'OSM Nature Reserve (NSG)' : undefined,
      notes: isNSG
        ? 'Detected via live OpenStreetMap nature_reserve / protected_area tag. Verify local NSG signage.'
        : `Live OpenStreetMap polygon (${tags.leaf_type ?? 'mixed'} canopy) enriched with ${meta.shortName} soil & elevation baseline.`,
    });
  }

  return stands.slice(0, 30);
}
