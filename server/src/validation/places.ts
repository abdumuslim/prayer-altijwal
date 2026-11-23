import { z } from "zod";

/**
 * Query schema for GET /api/places/masjids. Coerces numeric query strings.
 * `source=google` (the only accepted value) asks for a Google-only list; absent
 * keeps the merged resident + Google list.
 */
export const PlacesMasjidsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  source: z.literal("google").optional(),
});

export type PlacesMasjidsQueryInput = z.infer<typeof PlacesMasjidsQuery>;

/**
 * Query schema for GET /api/places/travel — the on-expand REAL travel time for
 * ONE masjid (the list itself renders a free estimate). `lat`/`lon` are the
 * user, `dlat`/`dlon` the masjid.
 */
export const PlacesTravelQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  dlat: z.coerce.number().min(-90).max(90),
  dlon: z.coerce.number().min(-180).max(180),
});

export type PlacesTravelQueryInput = z.infer<typeof PlacesTravelQuery>;

/**
 * Body schema for POST /api/places/masjids/contribute — a masjid the user knows
 * about that neither OpenStreetMap nor Google lists.
 *
 * `userLat`/`userLon` are the submitter's own position, used only for a sanity
 * check that the pin is somewhere they actually are. It is a guard against
 * mistakes, NOT a security control (a client can send whatever it likes) — the
 * real limit is the per-client daily cap.
 */
export const MasjidContributionBody = z.object({
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  userLat: z.number().min(-90).max(90),
  userLon: z.number().min(-180).max(180),
});

export type MasjidContributionInput = z.infer<typeof MasjidContributionBody>;

/**
 * One element of a Routes API computeRouteMatrix response (travel times for the
 * masjid list). Deliberately permissive: unroutable pairs come back WITHOUT a
 * duration, and Google may add fields at any time — only the shape we read is
 * validated, and the caller drops anything that isn't ROUTE_EXISTS.
 */
export const RouteMatrixElement = z.object({
  originIndex: z.number().int().nonnegative().default(0),
  destinationIndex: z.number().int().nonnegative().default(0),
  duration: z.string().optional(),
  condition: z.string().optional(),
});

export const RouteMatrixElements = z.array(RouteMatrixElement);
