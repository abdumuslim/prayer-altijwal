import { z } from "zod";

/** Query schema for GET /api/places/masjids. Coerces numeric query strings. */
export const PlacesMasjidsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export type PlacesMasjidsQueryInput = z.infer<typeof PlacesMasjidsQuery>;
