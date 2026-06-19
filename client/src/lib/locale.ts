// Localized place names. Country names come from Intl.DisplayNames (every
// locale, no data to bundle); city names use the Arabic name from the geo
// dataset when available, falling back to the Latin name.

import type { Lang } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

const countryFormatters = new Map<Lang, Intl.DisplayNames>();

function countryFormatter(lang: Lang): Intl.DisplayNames | null {
  const cached = countryFormatters.get(lang);
  if (cached) return cached;
  try {
    const f = new Intl.DisplayNames([lang], { type: "region" });
    countryFormatters.set(lang, f);
    return f;
  } catch {
    return null;
  }
}

/** Localized country name from an ISO-3166 alpha-2 code (e.g. "IQ" → "العراق"). */
export function localizeCountry(code: string | null | undefined, lang: Lang): string {
  if (!code) return "";
  try {
    return countryFormatter(lang)?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** A city's display name for the active language (Arabic name in Arabic mode). */
export function cityDisplayName(
  name: string | null | undefined,
  nameAr: string | null | undefined,
  lang: Lang,
): string {
  if (lang === "ar" && nameAr) return nameAr;
  return name ?? nameAr ?? "";
}

/** Display name for a stored location. */
export function storedCityName(loc: StoredLocation, lang: Lang): string {
  return cityDisplayName(loc.city, loc.cityAr ?? null, lang);
}
