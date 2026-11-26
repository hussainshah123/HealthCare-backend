import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ReverseGeocodeResult {
  /** Street-level line, e.g. "12 Main Boulevard, Gulberg III". */
  line1: string;
  city: string | null;
}

const CACHE_LIMIT = 500;
const TIMEOUT_MS = 4000;

/**
 * Turns GPS coordinates into a readable address.
 *
 * Uses OpenStreetMap Nominatim by default (free, but limited to about one
 * request per second and not meant for heavy production traffic). Point
 * GEOCODER_URL at a compatible service (e.g. a self-hosted Nominatim or
 * LocationIQ) when traffic grows. Failures return null; callers always have a
 * manual-entry fallback.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);
  private readonly cache = new Map<string, ReverseGeocodeResult | null>();
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('GEOCODER_URL') ?? 'https://nominatim.openstreetmap.org';
    this.userAgent = config.get<string>('GEOCODER_USER_AGENT') ?? 'MediGo-backend/1.0';
  }

  async reverse(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
    // ~11 m grid, so nearby lookups share a cache entry.
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    let result: ReverseGeocodeResult | null = null;
    try {
      const url = new URL('/reverse', this.baseUrl);
      url.search = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
        zoom: '18',
        addressdetails: '1',
        'accept-language': 'en',
      }).toString();
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`geocoder returned ${res.status}`);
      result = toAddress((await res.json()) as NominatimReverse);
    } catch (error) {
      this.logger.warn(`Reverse geocoding failed: ${(error as Error).message}`);
      return null; // don't cache failures
    }

    if (this.cache.size >= CACHE_LIMIT) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, result);
    return result;
  }
}

/**
 * OSM data in Pakistan names the city in different fields: Lahore as county
 * "Lahore District", Karachi as city_district "Karachi District", Faisalabad as
 * city "Faisalabad City Tehsil", Islamabad as city "Islamabad". Small localities
 * ("Lyari Town", "Samsani Khui") show up as town/village, so those come last.
 */
function pakistaniCity(a: Record<string, string | undefined>): string | null {
  const clean = (v?: string) =>
    v?.replace(/\s+(City\s+Tehsil|Tehsil|District|Division)$/i, '').trim() || undefined;
  return (
    clean(a.county) ??
    clean(a.city_district) ??
    clean(a.city) ??
    clean(a.historical_division) ??
    a.town ??
    a.village ??
    null
  );
}

interface NominatimReverse {
  display_name?: string;
  address?: Record<string, string | undefined>;
}

function toAddress(body: NominatimReverse): ReverseGeocodeResult | null {
  const a = body.address;
  if (!a) return null;
  const city = a.country_code === 'pk' ? pakistaniCity(a) : (a.city ?? a.town ?? a.village ?? a.county ?? null);
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const area = a.neighbourhood ?? a.quarter ?? a.residential;
  const parts = [street, area].filter((p): p is string => !!p);
  // Add the wider area (e.g. "Gulberg") unless the smaller one already names it.
  const suburb = a.suburb;
  if (suburb && !parts.some((p) => p.includes(suburb))) parts.push(suburb);
  // Shop/restaurant names (`amenity`) are left out: they are what is nearby, not the person's address.
  let line1 = parts.join(', ');
  if (!line1 && body.display_name) {
    // Fall back to the first two parts of the full name.
    line1 = body.display_name.split(',').slice(0, 2).join(',').trim();
  }
  if (!line1) return null;
  return { line1: line1.slice(0, 200), city: city?.slice(0, 100) ?? null };
}
