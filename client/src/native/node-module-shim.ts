// Browser shim for `node:module`, aliased in by the Vite reused-engine resolver
// (see vite.config.ts) so the reused prayer engine runs unchanged in the webview
// (hard rule 2 — never edit server/src/prayer-engine/**). The engine's astro.ts
// does `createRequire(import.meta.url)("astronomy-engine")` to load the ephemeris;
// here we resolve that one id to the bundled ESM build and reject anything else.
//
// Only reached from the native-only offline chunk; never in the web bundle.

import * as AstronomyEngine from "astronomy-engine";

type AE = typeof import("astronomy-engine");

// astronomy-engine's ESM build exposes named exports; some interop paths surface
// them under `.default`. Pick whichever object actually carries the API.
const ns = AstronomyEngine as unknown as AE & { default?: AE };
const engine: AE = ns.Observer ? ns : (ns.default ?? ns);

export function createRequire(from?: string | URL): (id: string) => unknown {
  void from; // part of Node's createRequire signature; the shim ignores it
  return (id: string): unknown => {
    if (id === "astronomy-engine") return engine;
    throw new Error(`node-module-shim: unexpected require(${JSON.stringify(id)})`);
  };
}
