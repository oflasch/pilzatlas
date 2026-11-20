import type { HighResGeodataResponse } from '../types/foraging';

/**
 * Client wrapper for the Option 2 Express OpenGeodata.NRW WFS proxy (/api/nrw/geodata).
 * Fetches real surveyed Wald & Holz NRW Basis-DLM forest stands (Laubwald/Mischwald/Nadelwald),
 * Geologischer Dienst NRW FSK05 (1:5,000) soil/water polygons, and LANUV NRW NSG/NP/NWZ boundaries.
 */
export async function fetchHighResNRWStandsInBounds(
  bounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  },
  signal?: AbortSignal
): Promise<HighResGeodataResponse> {
  const params = new URLSearchParams({
    south: bounds.south.toFixed(5),
    west: bounds.west.toFixed(5),
    north: bounds.north.toFixed(5),
    east: bounds.east.toFixed(5),
  });

  const res = await fetch(`/api/nrw/geodata?${params.toString()}`, { signal });
  if (!res.ok) {
    let detail = `Geodaten-Proxy lieferte HTTP ${res.status}.`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) detail = errBody.error;
    } catch {
      // Ignore non-JSON body
    }
    throw new Error(detail);
  }

  return (await res.json()) as HighResGeodataResponse;
}
