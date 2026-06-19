// build-cities.mjs — generate server/data/cities15000.json from the GeoNames
// `cities15000` extract (every city >= 15 000 population + all capitals; ~33k rows).
//
// Source: https://download.geonames.org/export/dump/cities15000.zip  (CC-BY 4.0).
//
// Pipeline:
//   1. Reuse server/data/_raw/cities15000.txt if present.
//   2. Else reuse server/data/_raw/cities15000.zip if present (inflate in-process).
//   3. Else download the zip via global fetch (Node 22) and inflate it.
// The zip holds a single DEFLATE entry, so we read its local file header and
// zlib.inflateRawSync it — no third-party dependency.
//
// Regenerate:  npm run build:cities      (from server/)
//
// Output: server/data/cities15000.json — a JSON array of COMPACT objects to keep
// the bundled file small. Compact-key schema (one object per city):
//   n    name           (string)  display name (may be non-ASCII / Arabic)
//   a    asciiname      (string)  ASCII transliteration (search fallback)
//   lat  latitude       (number)
//   lon  longitude      (number)
//   cc   countryCode    (string)  ISO-3166 alpha-2
//   adm1 admin1 code    (string)  first-level admin division code
//   pop  population     (number)
//   tz   timezone       (string)  IANA tz id
//   ele  elevation|dem  (number|null)  meters; elevation, else dem, else null
//   alt  alt names      (string, optional)  comma-joined Latin-script GeoNames
//        alternatenames deduped against n/a — lets English exonyms (e.g. "Mecca"
//        for Makkah, "Cairo" for Al Qahirah) match in search. Non-Latin scripts
//        are dropped (the native form already lives in `n`) to keep the file small.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAW_DIR = path.resolve(__dirname, "../data/_raw");
const RAW_TXT = path.join(RAW_DIR, "cities15000.txt");
const RAW_ZIP = path.join(RAW_DIR, "cities15000.zip");
const OUT_JSON = path.resolve(__dirname, "../data/cities15000.json");
const DOWNLOAD_URL = "https://download.geonames.org/export/dump/cities15000.zip";

// GeoNames `geoname` TSV column indexes (0-based).
const COL = {
  name: 1,
  asciiname: 2,
  alternatenames: 3,
  latitude: 4,
  longitude: 5,
  countryCode: 8,
  admin1: 10,
  population: 14,
  elevation: 15,
  dem: 16,
  timezone: 17,
};

// Basic Latin + Latin-1/Extended-A letters, spaces, hyphens, apostrophes, dots.
// Used to keep only Latin-script alternate names (English/European exonyms).
const LATIN_ALT = /^[ -~À-ſ]+$/;

/** Latin-script GeoNames alternate names, deduped against name/asciiname. */
function latinAltNames(altField, name, asciiname) {
  if (!altField) return "";
  const seen = new Set([name.toLowerCase(), asciiname.toLowerCase()]);
  const out = [];
  for (const raw of altField.split(",")) {
    const t = raw.trim();
    if (!t || !LATIN_ALT.test(t)) continue;
    const lc = t.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(t);
  }
  return out.join(",");
}

/** Inflate the single DEFLATE entry of a GeoNames zip buffer into a string. */
function extractTxtFromZip(zipBuf) {
  // Local file header signature: 0x04034b50 (little-endian) at offset 0.
  const sig = zipBuf.readUInt32LE(0);
  if (sig !== 0x04034b50) {
    throw new Error(`Unexpected zip signature 0x${sig.toString(16)}`);
  }
  const compMethod = zipBuf.readUInt16LE(8); // 8 = DEFLATE, 0 = stored
  const compSize = zipBuf.readUInt32LE(18);
  const nameLen = zipBuf.readUInt16LE(26);
  const extraLen = zipBuf.readUInt16LE(28);
  const dataStart = 30 + nameLen + extraLen;
  const data = zipBuf.subarray(dataStart, dataStart + compSize);
  const out = compMethod === 0 ? data : zlib.inflateRawSync(data);
  return out.toString("utf8");
}

async function loadRawText() {
  if (fs.existsSync(RAW_TXT)) {
    console.log(`Using existing TXT: ${RAW_TXT}`);
    return fs.readFileSync(RAW_TXT, "utf8");
  }
  if (fs.existsSync(RAW_ZIP)) {
    console.log(`Inflating existing ZIP: ${RAW_ZIP}`);
    return extractTxtFromZip(fs.readFileSync(RAW_ZIP));
  }
  console.log(`Downloading ${DOWNLOAD_URL} ...`);
  const res = await fetch(DOWNLOAD_URL);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const zipBuf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(RAW_ZIP, zipBuf);
  console.log(`Saved zip to ${RAW_ZIP}`);
  return extractTxtFromZip(zipBuf);
}

function parseElevation(elevation, dem) {
  if (elevation !== "") return Number(elevation);
  if (dem !== "") return Number(dem);
  return null;
}

function toCity(cols) {
  const n = cols[COL.name];
  const a = cols[COL.asciiname];
  const alt = latinAltNames(cols[COL.alternatenames], n, a);
  const city = {
    n,
    a,
    lat: Number(cols[COL.latitude]),
    lon: Number(cols[COL.longitude]),
    cc: cols[COL.countryCode],
    adm1: cols[COL.admin1],
    pop: Number(cols[COL.population]),
    tz: cols[COL.timezone],
    ele: parseElevation(cols[COL.elevation], cols[COL.dem]),
  };
  if (alt) city.alt = alt;
  return city;
}

async function main() {
  const text = await loadRawText();
  const cities = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const cols = line.split("\t");
    if (cols.length < 18) continue; // skip malformed rows
    cities.push(toCity(cols));
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(cities));
  console.log(`Wrote ${cities.length} cities -> ${OUT_JSON}`);
}

main().catch((err) => {
  console.error("build-cities failed:", err);
  process.exit(1);
});
