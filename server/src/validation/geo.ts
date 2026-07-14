import { z } from "zod";

/** Query schema for GET /api/geo/reverse. Coerces numeric query strings. */
export const GeoReverseQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export type GeoReverseQueryInput = z.infer<typeof GeoReverseQuery>;

/** Query schema for GET /api/geo/search. */
export const GeoSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  lang: z.enum(["ar", "en"]).default("ar"),
});

export type GeoSearchQueryInput = z.infer<typeof GeoSearchQuery>;

/** Query schema for GET /api/geo/declination. Coerces numeric query strings. */
export const GeoDeclinationQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export type GeoDeclinationQueryInput = z.infer<typeof GeoDeclinationQuery>;

/** Query schema for GET /api/geo/governorates (a country's admin-1 capitals). */
export const GeoGovernoratesQuery = z.object({
  country: z.string().trim().length(2),
});

export type GeoGovernoratesQueryInput = z.infer<typeof GeoGovernoratesQuery>;
