// The 13 calculation-method keys in display order, with a translator helper.
// Source of truth for keys: server prayer-engine/methods.ts (mirrored, not imported).

import type { MethodKey } from "@/types/api";
import type { StringKey } from "@/i18n/strings.en";
import type { TFunction } from "@/i18n/I18nProvider";

export const METHOD_KEYS: MethodKey[] = [
  "BaghdadYMA",
  "MWL",
  "ISNA",
  "Egyptian",
  "UmmAlQura",
  "Karachi",
  "Dubai",
  "Qatar",
  "Kuwait",
  "Singapore",
  "Diyanet",
  "Tehran",
  "Jafari",
];

/** Localized label for a method key, falling back to a server-supplied label. */
export function methodLabel(
  t: TFunction,
  key: string,
  fallback?: string,
): string {
  const sk = `method.${key}` as StringKey;
  const translated = t(sk);
  if (translated !== sk) return translated;
  return fallback ?? key;
}
