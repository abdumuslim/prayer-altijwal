import { haversineKm } from "../util/geo-distance.js";
import { normalizeVenueName } from "./venue-filter.js";
import type { Masjid } from "./google-places.js";

/**
 * Union of the resident dataset and a Google result, deduplicated (ADR-014).
 *
 * The two sources overlap heavily and disagree about spelling, so matching on
 * name alone is hopeless and matching on coordinates alone merges neighbouring
 * masjids in a dense quarter. The rule below uses distance as the primary
 * signal and the name only to widen it slightly.
 */

/** Below this, two records are the same building whatever they are called. */
const SAME_PLACE_KM = 0.04;
/** Up to this, they are the same only if their names agree on a real word. */
const SAME_NAME_KM = 0.12;

/** Words too common in masjid names to be evidence of identity on their own. */
const STOPWORDS = new Set(["مسجد", "جامع", "ال", "الجامع", "المسجد", "بن", "ابن", "ابو", "أبو"]);

function tokens(name: string): Set<string> {
  return new Set(
    normalizeVenueName(name)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^ال/, "")) // strip the definite article
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function shareASignificantWord(a: string, b: string): boolean {
  const ta = tokens(a);
  if (ta.size === 0) return false;
  for (const w of tokens(b)) if (ta.has(w)) return true;
  return false;
}

/** Do these two records describe the same masjid? */
export function isSameMasjid(a: Masjid, b: Masjid): boolean {
  const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
  if (km <= SAME_PLACE_KM) return true;
  if (km > SAME_NAME_KM) return false;
  return shareASignificantWord(a.name, b.name);
}

/**
 * Merge `extra` into `primary`, keeping one record per real masjid.
 *
 * `primary` wins on identity: it is the resident record, whose Arabic name came
 * from a local mapper or a user of this app and reads better than a
 * transliteration. Google's `id` is carried across when it is the only place ID
 * available, because the Maps deep link is more precise with one.
 */
export function mergeMasjids(primary: Masjid[], extra: Masjid[]): Masjid[] {
  const out = [...primary];

  for (const candidate of extra) {
    const match = out.findIndex((existing) => isSameMasjid(existing, candidate));
    if (match === -1) {
      out.push(candidate);
      continue;
    }
    const existing = out[match]!;
    // Keep the resident name, adopt the address and a real place ID if ours is
    // a synthetic osm:/usr: one.
    out[match] = {
      ...existing,
      address: existing.address ?? candidate.address,
      id: existing.id.startsWith("osm:") || existing.id.startsWith("usr:") ? candidate.id : existing.id,
    };
  }

  return out;
}
