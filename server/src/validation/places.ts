import { z } from "zod";

/** Query schema for GET /api/places/masjids. Coerces numeric query strings. */
export const PlacesMasjidsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export type PlacesMasjidsQueryInput = z.infer<typeof PlacesMasjidsQuery>;

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
