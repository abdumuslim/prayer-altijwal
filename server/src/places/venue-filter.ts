/**
 * Which "mosque"-tagged venues are NOT masjids for this app's purposes.
 *
 * Extracted from google-places.ts (ADR-014) because it is a business rule about
 * PLACE NAMES, not about Google: the resident OpenStreetMap dataset carries the
 * same venues under the same names, and applying one filter at both entry points
 * is the only way the two sources can't drift apart.
 */

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
export const EXCLUDED_VENUE_RE =
  /حسين[يى]?[ةه]|حسينيات|موكب|مواكب|مضيف|husayni+y?a|hussaini+y?a|husseini+y?a|hosseini+y?a/i;

/** Fold the spelling variants Iraqi place names actually arrive in. */
export function normalizeVenueName(name: string): string {
  return (
    name
      .normalize("NFC")
      // Strip Arabic diacritics (064B–0652), superscript alef (0670), tatweel (0640).
      .replace(/[ً-ْٰـ]/g, "")
      // Fold Persian letters onto their Arabic counterparts (Karbala names mix them).
      .replace(/ی/g, "ي")
      .replace(/ک/g, "ك")
  );
}

/** True when this venue name should be kept OUT of the masjid list. */
export function isExcludedVenue(name: string): boolean {
  return EXCLUDED_VENUE_RE.test(normalizeVenueName(name));
}
