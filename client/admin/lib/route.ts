import { useEffect, useState } from "react";

/**
 * Hash routing. The server already serves the admin bundle for any /admin/*
 * path, but hashes keep navigation entirely client-side — no server route per
 * page, and no chance of a deep link 404ing after a deploy.
 */

export const ROUTES = [
  "overview",
  "masjids",
  "cost",
  "push",
  "audience",
  "logs",
  "settings",
  "play",
] as const;

export type RouteId = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: RouteId = "overview";

export function currentRoute(): RouteId {
  const id = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return (ROUTES as readonly string[]).includes(id) ? (id as RouteId) : DEFAULT_ROUTE;
}

export function navigate(id: RouteId): void {
  window.location.hash = `#/${id}`;
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
