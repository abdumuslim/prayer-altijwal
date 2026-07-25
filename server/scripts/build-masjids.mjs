// build-masjids.mjs — generate server/data/masjids-iq.json, the RESIDENT masjid
// dataset for Iraq, from OpenStreetMap via the Overpass API.
//
// WHY this dataset exists (docs/DECISIONS.md ADR-014): the nearest-masjid feature
// used to buy every answer from Google, and Google's terms forbid keeping that
// content for more than 30 days — so a permanent local index legally cannot be
// built from it. OpenStreetMap's data is licensed for exactly this (ODbL), so it
// becomes the free floor under the feature: it answers offline, it answers when
// the monthly budget is spent, and in well-mapped areas it answers first.
//
// Source: https://overpass-api.de/api/interpreter   (data © OpenStreetMap
// contributors, licensed ODbL — the attribution is REQUIRED and is rendered in
// the app under the masjid list).
//
// Pipeline:
//   1. Reuse server/data/_raw/masjids-iq.osm.json if present (offline reruns).
//   2. Else query Overpass, falling back to the Kumi mirror.
//
// Regenerate:  npm run build:masjids      (from server/)
//
// Output: server/data/masjids-iq.json — a JSON array of COMPACT objects:
//   n    name       (string)  Arabic when OSM has name:ar, else name, else «مسجد»
//   lat  latitude   (number)  6 dp; ways/relations use their centre
//   lon  longitude  (number)
//   oid  osm id     (string)  e.g. "n123", "w456" — stable identity for dedupe
//
// NOTE: venue filtering (husseiniya / mawkib / mudhif) is deliberately NOT done
// here. It happens at load time in places/resident-index.ts using the SAME
// filter the Google path uses, so the two sources can never drift apart.

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAW_DIR = path.resolve(__dirname, "../data/_raw");
const RAW_JSON = path.join(RAW_DIR, "masjids-iq.osm.json");
const OUT_JSON = path.resolve(__dirname, "../data/masjids-iq.json");

// Several public instances, because any one of them is often congested. The
// script rotates across them per attempt and caches each completed tile, so a
// rerun costs only the tiles that are still missing.
const ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

// OSM asks every automated client to identify itself; without this the public
// instance answers 406 at the web-server layer, before Overpass sees the query.
const USER_AGENT =
  "prayer.altijwal.com masjid-dataset-builder/1.0 (+https://prayer.altijwal.com)";

// Bounding box covering Iraq, queried as a GRID of tiles.
//
// Two reasons not to use `area["ISO3166-1"="IQ"]`: resolving an area is the
// expensive half of such a query (the public instance times out on it), and a
// bbox is actually BETTER for this feature — it keeps masjids just across the
// border, which are exactly the right answer for someone in a border town.
const BBOX = { south: 28.9, west: 38.6, north: 37.5, east: 48.9 };
// Small tiles on purpose: the public instances are frequently congested, and a
// light query either succeeds quickly or fails cheaply. Each completed tile is
// cached to disk, so a rerun resumes instead of starting over.
const TILE_ROWS = 8;
const TILE_COLS = 8;

const FETCH_TIMEOUT_MS = 180_000;
const RETRIES_PER_TILE = 4;
/** Overpass asks for a gap between queries; be a good citizen. */
const TILE_DELAY_MS = 1_500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tiles() {
  const out = [];
  const dLat = (BBOX.north - BBOX.south) / TILE_ROWS;
  const dLon = (BBOX.east - BBOX.west) / TILE_COLS;
  for (let r = 0; r < TILE_ROWS; r++) {
    for (let c = 0; c < TILE_COLS; c++) {
      out.push({
        south: BBOX.south + r * dLat,
        north: BBOX.south + (r + 1) * dLat,
        west: BBOX.west + c * dLon,
        east: BBOX.west + (c + 1) * dLon,
      });
    }
  }
  return out;
}

function queryFor(t) {
  const bbox = `${t.south.toFixed(4)},${t.west.toFixed(4)},${t.north.toFixed(4)},${t.east.toFixed(4)}`;
  return `[out:json][timeout:180];nwr["amenity"="place_of_worship"]["religion"="muslim"](${bbox});out tags center;`;
}

async function postQuery(endpoint, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }).toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // A congested instance answers 200 with an HTML error page.
    if (!text.startsWith("{")) throw new Error("non-JSON response (server busy)");
    const json = JSON.parse(text);
    if (!Array.isArray(json.elements)) throw new Error("no elements[] in response");
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Divide a tile into four. A quarter of the area is a quarter of the work. */
function quarters(t) {
  const midLat = (t.south + t.north) / 2;
  const midLon = (t.west + t.east) / 2;
  return [
    { south: t.south, north: midLat, west: t.west, east: midLon },
    { south: t.south, north: midLat, west: midLon, east: t.east },
    { south: midLat, north: t.north, west: t.west, east: midLon },
    { south: midLat, north: t.north, west: midLon, east: t.east },
  ];
}

/** How many times a stubborn tile may be subdivided (4^2 = 16 sub-tiles). */
const MAX_SPLIT_DEPTH = 2;

let tileDir;

/**
 * Fetch one tile, subdividing it if the servers refuse it outright.
 *
 * A timeout on a dense tile (Baghdad, Mosul) is about the AMOUNT of data, not
 * about congestion, so retrying the same query forever never converges — but a
 * quarter of it usually succeeds first try. Every level caches, so the work is
 * never repeated across runs.
 */
async function fetchTile(tile, label, cacheKey, depth = 0) {
  const cachePath = path.join(tileDir, `${cacheKey}.json`);
  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    console.log(`  ${label}: ${cached.length} elements (cached)`);
    return cached;
  }

  for (let attempt = 1; attempt <= RETRIES_PER_TILE; attempt++) {
    // Alternate endpoints across attempts so one busy mirror doesn't stall us.
    const endpoint = ENDPOINTS[(depth + attempt - 1) % ENDPOINTS.length];
    try {
      const json = await postQuery(endpoint, queryFor(tile));
      fs.writeFileSync(cachePath, JSON.stringify(json.elements));
      console.log(`  ${label}: ${json.elements.length} elements`);
      await sleep(TILE_DELAY_MS);
      return json.elements;
    } catch (err) {
      console.warn(`  ${label} attempt ${attempt} failed: ${err.message}`);
      if (attempt < RETRIES_PER_TILE) await sleep(TILE_DELAY_MS * attempt * 3);
    }
  }

  if (depth >= MAX_SPLIT_DEPTH) {
    throw new Error(
      `${label} still failing after subdividing to depth ${depth}. Completed ` +
        `work is cached in ${tileDir} — rerun later; Overpass congestion clears.`,
    );
  }

  console.log(`  ${label}: too heavy — splitting into quarters`);
  const out = [];
  const subs = quarters(tile);
  for (const [j, sub] of subs.entries()) {
    out.push(...(await fetchTile(sub, `${label}.${j + 1}`, `${cacheKey}-${j}`, depth + 1)));
  }
  // Cache the combined result so a rerun skips this whole branch.
  fs.writeFileSync(cachePath, JSON.stringify(out));
  return out;
}

async function fetchOverpass() {
  const all = [];
  const grid = tiles();
  tileDir = path.join(RAW_DIR, "masjid-tiles");
  fs.mkdirSync(tileDir, { recursive: true });

  for (const [i, tile] of grid.entries()) {
    all.push(...(await fetchTile(tile, `tile ${i + 1}/${grid.length}`, String(i))));
  }

  return { elements: all };
}

function coordsOf(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

const TYPE_PREFIX = { node: "n", way: "w", relation: "r" };

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

async function main() {
  let raw;
  if (fs.existsSync(RAW_JSON)) {
    console.log(`Reusing cached Overpass response at ${RAW_JSON}`);
    raw = JSON.parse(fs.readFileSync(RAW_JSON, "utf8"));
  } else {
    raw = await fetchOverpass();
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(RAW_JSON, JSON.stringify(raw));
    console.log(`Cached the raw response at ${RAW_JSON}`);
  }

  const seen = new Set();
  const rows = [];
  let unnamed = 0;

  for (const el of raw.elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const prefix = TYPE_PREFIX[el.type];
    if (!prefix) continue;

    const oid = `${prefix}${el.id}`;
    if (seen.has(oid)) continue;
    seen.add(oid);

    const tags = el.tags ?? {};
    // Arabic first — the UI is Arabic-only, and an Arabic name is what a user
    // recognises. An unnamed mosque is still the right answer to "where is the
    // nearest one", so it is kept under a generic label rather than dropped.
    const name = tags["name:ar"] || tags.name || "مسجد";
    if (!tags["name:ar"] && !tags.name) unnamed++;

    rows.push({ n: name, lat: round6(coords.lat), lon: round6(coords.lon), oid });
  }

  rows.sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  fs.writeFileSync(OUT_JSON, JSON.stringify(rows));

  const bytes = fs.statSync(OUT_JSON).size;
  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`  masjids : ${rows.length}`);
  console.log(`  unnamed : ${unnamed} (kept, labelled «مسجد»)`);
  console.log(`  size    : ${(bytes / 1024).toFixed(0)} KiB`);
  console.log(`\nData © OpenStreetMap contributors, ODbL — attribution is required in the UI.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
