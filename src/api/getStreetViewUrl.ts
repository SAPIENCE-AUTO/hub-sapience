import { z } from 'zod';
import { createEndpoint } from '../../server/compat';

// Module-level in-memory cache — persists across requests within the same worker instance
const cache = new Map<string, { embedUrl: string; mode: 'streetview' | 'place' }>();

function normalizeKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

function placeUrl(address: string): string {
  return `https://www.google.com/maps/embed/v1/place?key=${process.env.ZITE_GOOGLE_MAPS_API_KEY}&q=${encodeURIComponent(address)}`;
}

function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/embed/v1/streetview?key=${process.env.ZITE_GOOGLE_MAPS_API_KEY}&location=${lat},${lng}&heading=210&pitch=10&fov=90`;
}

export default createEndpoint({
  description: 'Geocodes an address server-side and returns a Maps Embed API iframe URL (Street View or Place fallback)',
  inputSchema: z.object({
    address: z.string(),
  }),
  outputSchema: z.object({
    embedUrl: z.string(),
    mode: z.enum(['streetview', 'place']),
  }),
  execute: async ({ input }) => {
    const { address } = input;
    const key = normalizeKey(address);

    // Empty address — return place fallback with empty query
    if (!key) {
      return { embedUrl: placeUrl(''), mode: 'place' as const };
    }

    // Cache hit
    const cached = cache.get(key);
    if (cached) return cached;

    // Cache miss — call Geocoding API with the ORIGINAL address
    try {
      const geocodeRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.ZITE_GOOGLE_MAPS_API_KEY}`
      );
      const data = await geocodeRes.json() as {
        status: string;
        results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
      };

      if (
        data.status === 'OK' &&
        data.results?.length > 0 &&
        data.results[0].geometry?.location
      ) {
        const { lat, lng } = data.results[0].geometry.location;
        const result = { embedUrl: streetViewUrl(lat, lng), mode: 'streetview' as const };
        cache.set(key, result);
        return result;
      }

      // Geocoding returned non-OK or no results — fall back to place
      const fallback = { embedUrl: placeUrl(address), mode: 'place' as const };
      cache.set(key, fallback);
      return fallback;

    } catch {
      // Network error or JSON parse failure — fall back to place
      const fallback = { embedUrl: placeUrl(address), mode: 'place' as const };
      cache.set(key, fallback);
      return fallback;
    }
  },
});
