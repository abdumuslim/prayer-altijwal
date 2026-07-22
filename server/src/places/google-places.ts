import { childLogger } from "../logger.js";

const log = childLogger("places");

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const TIMEOUT_MS = 5000;
const RADIUS_M = 5000;
const MAX_RESULTS = 10;
// Field mask keeps the paid SKU minimal — request ONLY what the client renders.
const FIELD_MASK = "places.id,places.displayName,places.location,places.shortFormattedAddress";

/** Public masjid shape served by /api/places/masjids. */
export interface Masjid {
  id: string;
  /** Display name — Arabic when Google has it (languageCode=ar), else as-is. */
  name: string;
  lat: number;
  lon: number;
  address: string | null;
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Non-mosque Shia service venues are excluded from the masjid list BY NAME
 *  (user rule, 2026-07-19): Google tags them with type "mosque" in Iraq, so the
 *  `includedTypes` filter alone cannot drop them. Excluded word forms
 *  (live-verified against Karbala city-centre results):
 *   - حسينية / حسينيه / حسينيات / حسينة (colloquial, no ya) + Persian-script
 *     spellings (حسینیه — FARSI YEH ی/KAF ک are normalized to Arabic first)
 *     + Latin transliterations; combined venues («مسجد وحسينية …») drop too.
 *   - موكب / مواكب (procession-service stations) and مضيف (serving halls).
 *  NOT matched (kept, verified): «جامع الإمام الحسين», «مسجد الحسيني»,
 *  «مرقد الامام الحسين عليه السلام» — Hussein-NAMED prayer sites are mosques. */
const EXCLUDED_VENUE_RE =
  /حسين[يى]?[ةه]|حسينيات|موكب|مواكب|مضيف|husayni+y?a|hussaini+y?a|husseini+y?a|hosseini+y?a/i;

function isExcludedVenue(name: string): boolean {
  const normalized = name
    .normalize("NFC")
    // Strip Arabic diacritics (064B–0652), superscript alef (0670), tatweel (0640).
    .replace(/[ً-ْٰـ]/g, "")
    // Fold Persian letters onto their Arabic counterparts (Karbala names mix them).
    .replace(/ی/g, "ي")
    .replace(/ک/g, "ك");
  return EXCLUDED_VENUE_RE.test(normalized);
}

/** Defensive mapping of one upstream place; null when required fields are absent. */
function mapPlace(v: unknown): Masjid | null {
  const p = obj(v);
  const id = str(p.id);
  const name = str(obj(p.displayName).text);
  const location = obj(p.location);
  const lat = num(location.latitude);
  const lon = num(location.longitude);
  if (id === "" || name === "" || lat === null || lon === null) return null;
  const address = str(p.shortFormattedAddress);
  return { id, name, lat, lon, address: address === "" ? null : address };
}

/**
 * Nearest mosques around a point via Google Places API (New) Nearby Search,
 * ranked by distance within a 5 km circle. Never throws: returns `null` on any
 * upstream failure (network, timeout, non-OK, bad JSON) so the route can tell
 * "degraded — don't cache" apart from a genuine empty result (`[]`).
 */
export async function searchNearbyMasjids(
  lat: number,
  lon: number,
  apiKey: string,
): Promise<Masjid[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ["mosque"],
        maxResultCount: MAX_RESULTS,
        rankPreference: "DISTANCE",
        languageCode: "ar",
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lon }, radius: RADIUS_M },
        },
      }),
    });
    if (!res.ok) {
      log.warn("places non-ok response", { status: res.status });
      return null;
    }
    const body = obj(await res.json());
    // Places (New) omits the `places` field entirely when nothing matches.
    if (!Array.isArray(body.places)) return [];
    return body.places
      .map(mapPlace)
      .filter((m): m is Masjid => m !== null)
      .filter((m) => !isExcludedVenue(m.name));
  } catch (err) {
    log.warn("places search failed", err instanceof Error ? err : new Error(String(err)));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
