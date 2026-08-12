// Integrity sweep of the OCR'd Iraqi Waqf prayer-times archive
// (server/data/waqf-times-2025-08-11-to-2026-08-11.json) BEFORE it is ingested
// as calibration ground truth. Every suspicious cell is flagged so each flag can
// be adjudicated afterwards against the source poster JPG.
//
// Engine geometry / RAW-time helpers are copied from build-waqf-calibration.ts so
// the residual check speaks the same language as the calibrator.
// Read-only apart from writing _archive_report.json at the repo root.
// Run from server/:  npx tsx scripts/analyze-waqf-archive.ts

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  makeSunContext,
  riseSet,
  transit,
  depressionEvent,
  descendToAltitude,
  sunDeclination,
} from "../src/prayer-engine/astro.js";
import { asrAltitude, shadowFactorFor } from "../src/prayer-engine/asr.js";
import { zonedMidnightUtc } from "../src/prayer-engine/timezone.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../.."); // repo root (server/scripts -> server -> root)
const TZ = "Asia/Baghdad"; // fixed UTC+3, no DST
const FAJR_ANGLE = 18;
const ISHA_ANGLE = 17;

type Prayer = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";
const PRAYERS: Prayer[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
const RULES = ["down", "nearest", "up"] as const;
type Rule = (typeof RULES)[number];

// Canonical governorate geometry (live dataset coords + GeoNames elevation) —
// copied verbatim from build-waqf-calibration.ts. Keyed by the archive gov names.
interface Geo {
  lat: number;
  lon: number;
  ele: number;
}
const GOV: Record<string, Geo> = {
  Baghdad: { lat: 33.34058, lon: 44.40088, ele: 41 },
  Basra: { lat: 30.50852, lon: 47.7804, ele: 4 },
  Hillah: { lat: 32.46367, lon: 44.41963, ele: 33 },
  Diwaniyah: { lat: 31.99289, lon: 44.92552, ele: 25 },
  Ramadi: { lat: 33.42056, lon: 43.30778, ele: 53 },
  Samawah: { lat: 31.33198, lon: 45.2944, ele: 15 },
  Amarah: { lat: 31.83561, lon: 47.14483, ele: 10 },
  Fallujah: { lat: 33.35, lon: 43.7858, ele: 45 },
  Kut: { lat: 32.5128, lon: 45.81817, ele: 22 },
  Mosul: { lat: 36.335, lon: 43.11889, ele: 228 },
  Nasiriyah: { lat: 31.05799, lon: 46.25726, ele: 7 },
  Baqubah: { lat: 33.75403, lon: 44.60518, ele: 48 },
  Tikrit: { lat: 34.61581, lon: 43.67861, ele: 112 },
  Samarra: { lat: 34.1983, lon: 43.8742, ele: 80 },
  Kirkuk: { lat: 35.46806, lon: 44.39222, ele: 346 },
};
const GOV_NAMES = Object.keys(GOV);
// _waqf files sometimes spell Hilla/Hillah differently; normalize to canonical.
const ALIAS: Record<string, string> = { Hilla: "Hillah" };
function canonGov(name: string): string | null {
  const n = ALIAS[name] ?? name;
  return n in GOV ? n : null;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ---- time parsing -------------------------------------------------------

/** "21 December 2025" -> "2025-12-21". */
function gregToIso(s: string): string {
  const [d, mon, y] = s.trim().split(/\s+/);
  const m = MONTHS[mon.toLowerCase()];
  if (!m) throw new Error(`bad month in "${s}"`);
  return `${y}-${String(m).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
}

/**
 * Old _waqf_*.json corpus is 12-hour without am/pm. Fajr/Sunrise/Dhuhr are
 * morning/noon, Asr/Maghrib/Isha are afternoon/evening (+12h). Also accepts
 * already-24h afternoon values via (h % 12) + 12.
 */
function toMinute(prayer: Prayer, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (prayer === "asr" || prayer === "maghrib" || prayer === "isha") {
    return ((h % 12) + 12) * 60 + m;
  }
  return h * 60 + m; // fajr/sunrise (am), dhuhr (~noon)
}

/** Strict 24-hour HH:MM -> minutes-of-day, or null if it doesn't parse. */
const HHMM24 = /^([01]\d|2[0-3]):([0-5]\d)$/;
function strictMinute(hhmm: string): number | null {
  const mt = HHMM24.exec(hhmm);
  if (!mt) return null;
  return Number(mt[1]) * 60 + Number(mt[2]);
}

/** minutes-of-day -> "HH:MM" (rounds; wraps minutes into 0..59). */
function fmt(min: number): string {
  const m = Math.round(min);
  const hh = Math.floor(m / 60);
  const mm = ((m % 60) + 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Raw seconds-of-day in Baghdad (fixed UTC+3) for an instant. */
function secondsOfDay(instant: Date): number {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return Number(map.hour) * 3600 + Number(map.minute) * 60 + Number(map.second);
}

interface Raw { sec: Record<Prayer, number>; dec: number }

/** Engine RAW times (no offset/rounding) at a governorate, for a civil date. */
function rawForGov(geo: Geo, iso: string): Raw {
  const [y, m, d] = iso.split("-").map(Number);
  const coords = { latitude: geo.lat, longitude: geo.lon };
  const anchor = zonedMidnightUtc(new Date(Date.UTC(y, m - 1, d, 9, 0, 0)), TZ);
  const ctx = makeSunContext(coords, geo.ele, anchor);
  const sunrise = riseSet(ctx, +1)!;
  const maghrib = riseSet(ctx, -1)!;
  const dhuhr = transit(ctx);
  const dec = sunDeclination(ctx, dhuhr);
  const asr = descendToAltitude(ctx, asrAltitude(coords.latitude, dec, shadowFactorFor("Standard")), dhuhr)!;
  const fajr = depressionEvent(ctx, +1, FAJR_ANGLE)!;
  const isha = depressionEvent(ctx, -1, ISHA_ANGLE, maghrib)!;
  return {
    dec,
    sec: {
      fajr: secondsOfDay(fajr), sunrise: secondsOfDay(sunrise), dhuhr: secondsOfDay(dhuhr),
      asr: secondsOfDay(asr), maghrib: secondsOfDay(maghrib), isha: secondsOfDay(isha),
    },
  };
}

function predictMinute(rawSec: number, offsetMin: number, rule: Rule): number {
  const minutes = rawSec / 60 + offsetMin;
  if (rule === "down") return Math.floor(minutes);
  if (rule === "up") return Math.ceil(minutes);
  return Math.round(minutes);
}

// ---- fitting (copied from build-waqf-calibration.ts) --------------------

interface FitRow { official: number; rawSec: number }

function bestConstant(rows: FitRow[]): { offset: number; rule: Rule; exact: number } {
  let best = { offset: 0, rule: "nearest" as Rule, exact: -1, mae: Infinity };
  for (const rule of RULES) {
    for (let off = -15; off <= 15; off++) {
      let exact = 0, mae = 0;
      for (const r of rows) {
        const e = Math.abs(predictMinute(r.rawSec, off, rule) - r.official);
        if (e === 0) exact++;
        mae += e;
      }
      if (exact > best.exact || (exact === best.exact && mae < best.mae)) {
        best = { offset: off, rule, exact, mae };
      }
    }
  }
  return { offset: best.offset, rule: best.rule, exact: best.exact };
}

// ---- old official corpus (for the crosscheck, §6) ----------------------

interface WaqfDay { gregorian_date: string; locations: Record<string, Record<string, string>> }
function loadWaqfFile(name: string): WaqfDay[] {
  return JSON.parse(readFileSync(resolve(ROOT, name), "utf8")) as WaqfDay[];
}

// Official poster for 19 June 2026 (24h), transcribed from
// iraq-governorates.test.ts — copied verbatim from build-waqf-calibration.ts.
const POSTER_0619: Record<string, [string, string, string, string, string, string]> = {
  Baghdad: ["03:10", "04:52", "12:09", "15:51", "19:18", "20:51"],
  Basra: ["03:09", "04:46", "11:55", "15:30", "18:56", "20:25"],
  Hillah: ["03:14", "04:54", "12:09", "15:48", "19:15", "20:47"],
  Diwaniyah: ["03:14", "04:54", "12:07", "15:45", "19:12", "20:43"],
  Ramadi: ["03:14", "04:56", "12:14", "15:56", "19:23", "20:56"],
  Samawah: ["03:16", "04:54", "12:05", "15:42", "19:08", "20:39"],
  Amarah: ["03:06", "04:45", "11:58", "15:36", "19:02", "20:33"],
  Fallujah: ["03:12", "04:54", "12:11", "15:53", "19:20", "20:54"],
  Kut: ["03:08", "04:49", "12:03", "15:43", "19:10", "20:42"],
  Mosul: ["02:59", "04:47", "12:14", "16:03", "19:33", "21:11"],
  Nasiriyah: ["03:13", "04:51", "12:01", "15:38", "19:04", "20:34"],
  Baqubah: ["03:07", "04:50", "12:08", "15:51", "19:18", "20:52"],
  Tikrit: ["03:06", "04:50", "12:12", "15:57", "19:25", "21:00"],
  Samarra: ["03:08", "04:51", "12:11", "15:55", "19:23", "20:57"],
  Kirkuk: ["02:59", "04:43", "12:09", "15:56", "19:26", "21:02"],
};
const POSTER_0619_ISO = "2026-06-19"; // fixed at source (POSTER_0619), never via oldCorpusCorrections

interface OldCell { gov: string; iso: string; prayer: Prayer; oldMin: number }
function oldCorpusCells(): OldCell[] {
  const days: WaqfDay[] = [
    ...loadWaqfFile("_waqf_dec.json"),
    ...loadWaqfFile("_waqf_jan.json"),
    ...loadWaqfFile("_waqf_febmar.json"),
    ...loadWaqfFile("_waqf_gap.json"),
    ...loadWaqfFile("_waqf_summer.json"),
    {
      gregorian_date: "19 June 2026",
      locations: Object.fromEntries(
        Object.entries(POSTER_0619).map(([g, arr]) => [
          g,
          { Fajr: arr[0], Sunrise: arr[1], Dhuhr: arr[2], Asr: arr[3], Maghrib: arr[4], Isha: arr[5] },
        ]),
      ),
    },
  ];
  const out: OldCell[] = [];
  for (const day of days) {
    const iso = gregToIso(day.gregorian_date);
    for (const [rawName, times] of Object.entries(day.locations)) {
      const gov = canonGov(rawName);
      if (!gov) continue;
      for (const prayer of PRAYERS) {
        const cap = prayer[0].toUpperCase() + prayer.slice(1);
        const v = times[cap];
        if (!v) continue;
        out.push({ gov, iso, prayer, oldMin: toMinute(prayer, v) });
      }
    }
  }
  return out;
}

// ---- archive shape ------------------------------------------------------

interface SourceMeta {
  filename: string;
  source_type: string;
  source_card_date: string;
  source_year_offset: number;
}
interface Archive {
  range: { start: string; end: string; dates: number };
  prayers: string[];
  locations: string[];
  sources: Record<string, SourceMeta>;
  govs: Record<string, Record<string, Record<string, string>>>;
}

// ---- adjudications overlay (same semantics as build-waqf-calibration.ts) ----

interface Adjudications {
  excludedDates: Array<{ date: string; reason: string }>;
  corrections: Array<{ date: string; gov: string; prayer: string; value: string; basis: string }>;
  /** Single poster-misprinted cells with no trustworthy value: removed so every
   *  check treats them as holes (the calibrated formula serves them). */
  excludedCells: Array<{ date: string; gov: string; prayer: string; reason: string }>;
  /** Re-verified 24h values that replace a transcription error in the OLD
   *  _waqf_*.json corpus (the 19-June poster is fixed in POSTER_0619 instead). */
  oldCorpusCorrections: Array<{ date: string; gov: string; prayer: string; value: string; basis: string }>;
}

const PRAYER_SET = new Set<string>(PRAYERS);
/** Fail closed on a typo'd prayer field in the overlay. */
function assertPrayer(prayer: string, ctx: string): void {
  if (!PRAYER_SET.has(prayer)) {
    throw new Error(`adjudications: invalid prayer "${prayer}" in ${ctx} (expected one of ${PRAYERS.join(", ")})`);
  }
}

interface OverlayResult {
  excluded: number;
  corrected: number;
  cellsExcluded: number;
  excludedDateSet: Set<string>;
  /** Canonicalized `${gov}|${date}|${prayer}` for every excluded cell. */
  excludedCellKeys: Set<string>;
}

/**
 * Apply the image-verified adjudications overlay to the archive IN PLACE, with the
 * same semantics the calibrator uses: corrections replace a cell's stored value
 * before any check runs; excluded cells are removed (a poster-misprinted single
 * cell becomes a hole); excluded dates become missing/null everywhere (all their
 * cells are removed, so every check — the continuity series included — treats them
 * as holes). Config errors throw: an invalid prayer, a duplicate (date,gov,prayer),
 * a correction/excluded-cell for an excluded date, an unknown gov, a non-archive
 * date, a cell excluded that removes nothing, or the same (date,gov,prayer) both
 * corrected and cell-excluded. The check logic downstream is untouched.
 */
function applyOverlay(archive: Archive, adj: Adjudications): OverlayResult {
  const excluded = new Set(adj.excludedDates.map((e) => e.date));
  const correctedKeys = new Set<string>();
  let corrected = 0;
  for (const c of adj.corrections) {
    assertPrayer(c.prayer, `correction ${c.date} ${c.gov}`);
    const gov = canonGov(c.gov);
    if (!gov) throw new Error(`adjudications: unknown gov "${c.gov}" in correction ${c.date}`);
    const key = `${gov}|${c.date}|${c.prayer}`;
    if (correctedKeys.has(key)) throw new Error(`adjudications: duplicate correction ${c.date} ${gov} ${c.prayer} — config error`);
    if (excluded.has(c.date)) {
      throw new Error(`adjudications: correction for excluded date ${c.date} (${gov} ${c.prayer}) — config error`);
    }
    const cell = archive.govs[gov]?.[c.date];
    if (!cell) throw new Error(`adjudications: correction date ${c.date} not in archive for ${gov}`);
    cell[c.prayer] = c.value;
    correctedKeys.add(key);
    corrected++;
  }
  const excludedCellKeys = new Set<string>();
  for (const ec of adj.excludedCells) {
    assertPrayer(ec.prayer, `excluded cell ${ec.date} ${ec.gov}`);
    const gov = canonGov(ec.gov);
    if (!gov) throw new Error(`adjudications: unknown gov "${ec.gov}" in excluded cell ${ec.date}`);
    const key = `${gov}|${ec.date}|${ec.prayer}`;
    if (excludedCellKeys.has(key)) throw new Error(`adjudications: duplicate excluded cell ${ec.date} ${gov} ${ec.prayer} — config error`);
    if (excluded.has(ec.date)) {
      throw new Error(`adjudications: excluded cell for already-excluded date ${ec.date} (${gov} ${ec.prayer}) — redundant, config error`);
    }
    if (correctedKeys.has(key)) {
      throw new Error(`adjudications: ${ec.date} ${gov} ${ec.prayer} is both corrected and cell-excluded — config error`);
    }
    const cell = archive.govs[gov]?.[ec.date];
    if (!cell) throw new Error(`adjudications: excluded-cell date ${ec.date} not in archive for ${gov}`);
    if (!(ec.prayer in cell)) {
      throw new Error(`adjudications: excluded cell ${ec.date} ${gov} ${ec.prayer} removes nothing (prayer absent) — config error`);
    }
    delete cell[ec.prayer];
    excludedCellKeys.add(key);
  }
  for (const date of excluded) {
    for (const gov of GOV_NAMES) {
      if (archive.govs[gov]) delete archive.govs[gov][date];
    }
  }
  return { excluded: excluded.size, corrected, cellsExcluded: adj.excludedCells.length, excludedDateSet: excluded, excludedCellKeys };
}

/**
 * Apply re-verified old-corpus corrections to the assembled OLD cells in place,
 * matching by (gov, iso, prayer) and replacing `oldMin` with the strict-parsed 24h
 * value (so the §6 crosscheck compares against the corrected value). Config errors
 * throw: an invalid prayer, a duplicate (date,gov,prayer), a 2026-06-19 target (fix
 * POSTER_0619 instead), an unknown gov, a (date,gov,prayer) also excluded (date or
 * cell), one that matches no old-corpus cell, or a malformed value.
 */
function applyOldCorpusCorrections(oldCells: OldCell[], adj: Adjudications, overlay: OverlayResult): number {
  const seen = new Set<string>();
  for (const oc of adj.oldCorpusCorrections) {
    assertPrayer(oc.prayer, `oldCorpusCorrection ${oc.date} ${oc.gov}`);
    if (oc.date === POSTER_0619_ISO) {
      throw new Error(`oldCorpusCorrections: ${oc.date} is the 19-June poster — fix POSTER_0619 at source, not here`);
    }
    const gov = canonGov(oc.gov);
    if (!gov) throw new Error(`oldCorpusCorrections: unknown gov "${oc.gov}" in ${oc.date}`);
    const key = `${gov}|${oc.date}|${oc.prayer}`;
    if (seen.has(key)) throw new Error(`oldCorpusCorrections: duplicate ${oc.date} ${gov} ${oc.prayer} — config error`);
    seen.add(key);
    if (overlay.excludedDateSet.has(oc.date)) {
      throw new Error(`oldCorpusCorrections: ${oc.date} is an excluded date — cannot also correct it (config error)`);
    }
    if (overlay.excludedCellKeys.has(key)) {
      throw new Error(`oldCorpusCorrections: ${oc.date} ${gov} ${oc.prayer} is also a cell-exclusion — config error`);
    }
    const cell = oldCells.find((c) => c.gov === gov && c.iso === oc.date && c.prayer === oc.prayer);
    if (!cell) throw new Error(`oldCorpusCorrections: ${oc.date} ${gov} ${oc.prayer} matches no old-corpus cell`);
    const min = strictMinute(oc.value);
    if (min === null) throw new Error(`oldCorpusCorrections: malformed 24h value "${oc.value}" for ${oc.date} ${gov} ${oc.prayer}`);
    cell.oldMin = min;
  }
  return adj.oldCorpusCorrections.length;
}

// ---- flags --------------------------------------------------------------

interface Flag {
  check: string;
  date: string;
  gov: string | null;
  prayer: Prayer | null;
  value: string | number | null;
  detail: string;
  provenance: string | null;
  image: string | null;
}

// ---- date helpers -------------------------------------------------------

function isoRange(start: string, end: string): string[] {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const t1 = Date.UTC(ye, me - 1, de);
  const out: string[] = [];
  for (let t = Date.UTC(ys, ms - 1, ds); t <= t1; t += 86400000) {
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function isoToDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

// ---- main ---------------------------------------------------------------

function main(): void {
  const archive = JSON.parse(
    readFileSync(resolve(HERE, "../data/waqf-times-2025-08-11-to-2026-08-11.json"), "utf8"),
  ) as Archive;
  const adj = JSON.parse(
    readFileSync(resolve(HERE, "../data/waqf-archive-adjudications.json"), "utf8"),
  ) as Adjudications;
  const overlay = applyOverlay(archive, adj);
  // Assemble the old corpus early so its overlay corrections are counted up front;
  // the §6 crosscheck reuses this already-corrected list.
  const oldCells = oldCorpusCells();
  const oldCorrections = applyOldCorpusCorrections(oldCells, adj, overlay);
  console.log(`overlay: ${overlay.excluded} dates excluded, ${overlay.corrected} cells corrected, ${overlay.cellsExcluded} cells excluded, ${oldCorrections} old-corpus cells corrected`);

  const dateList = isoRange(archive.range.start, archive.range.end);
  const flags: Flag[] = [];
  const prov = (date: string): string | null => archive.sources[date]?.source_type ?? null;
  const img = (date: string): string | null => archive.sources[date]?.filename ?? null;

  // Memoized RAW engine times per (gov, iso) — every check that needs them shares
  // this cache (~15 govs × (366 dates + a few source-card dates)).
  const rawCache = new Map<string, Raw>();
  const getRaw = (gov: string, iso: string): Raw => {
    const key = `${gov}|${iso}`;
    let r = rawCache.get(key);
    if (!r) { r = rawForGov(GOV[gov], iso); rawCache.set(key, r); }
    return r;
  };

  // parsed[gov][iso][prayer] = minutes-of-day, or null when missing/malformed.
  const parsed: Record<string, Record<string, Partial<Record<Prayer, number | null>>>> = {};

  // ---- (1) format / completeness --------------------------------------
  for (const gov of GOV_NAMES) {
    parsed[gov] = {};
    const govData = archive.govs[gov];
    if (!govData) {
      flags.push({ check: "format", date: archive.range.start, gov, prayer: null, value: null, detail: "governorate entirely absent from archive.govs", provenance: null, image: null });
      continue;
    }
    for (const date of dateList) {
      parsed[gov][date] = {};
      const cell = govData[date];
      if (!cell) {
        flags.push({ check: "format", date, gov, prayer: null, value: null, detail: "missing date for this governorate", provenance: prov(date), image: img(date) });
        for (const prayer of PRAYERS) parsed[gov][date][prayer] = null;
        continue;
      }
      for (const prayer of PRAYERS) {
        const v = cell[prayer];
        if (v === undefined || v === null) {
          flags.push({ check: "format", date, gov, prayer, value: null, detail: "missing prayer value", provenance: prov(date), image: img(date) });
          parsed[gov][date][prayer] = null;
          continue;
        }
        const min = strictMinute(v);
        if (min === null) {
          flags.push({ check: "format", date, gov, prayer, value: v, detail: `malformed 24h HH:MM: "${v}"`, provenance: prov(date), image: img(date) });
          parsed[gov][date][prayer] = null;
        } else {
          parsed[gov][date][prayer] = min;
        }
      }
    }
  }

  // ---- (2) range plausibility -----------------------------------------
  const WINDOW: Record<Prayer, [number, number]> = {
    fajr: [2 * 60 + 30, 5 * 60 + 40],
    sunrise: [4 * 60 + 30, 7 * 60 + 40],
    dhuhr: [11 * 60 + 40, 12 * 60 + 40],
    asr: [13 * 60 + 50, 16 * 60 + 40],
    maghrib: [16 * 60 + 40, 19 * 60 + 45],
    isha: [18 * 60 + 0, 21 * 60 + 40],
  };
  for (const gov of GOV_NAMES) {
    for (const date of dateList) {
      for (const prayer of PRAYERS) {
        const v = parsed[gov]?.[date]?.[prayer];
        if (v == null) continue;
        const [lo, hi] = WINDOW[prayer];
        if (v < lo || v > hi) {
          flags.push({ check: "range", date, gov, prayer, value: v, detail: `${fmt(v)} outside plausible ${fmt(lo)}–${fmt(hi)}`, provenance: prov(date), image: img(date) });
        }
      }
    }
  }

  // ---- (3) continuity (neighbour-mean / end extrapolation) ------------
  let softContinuityCount = 0;
  for (const gov of GOV_NAMES) {
    for (const prayer of PRAYERS) {
      const series = dateList.map((d) => parsed[gov]?.[d]?.[prayer] ?? null);
      const n = series.length;
      for (let i = 0; i < n; i++) {
        const x = series[i];
        if (x == null) continue;
        let expected: number | null = null;
        if (i > 0 && i < n - 1) {
          const p = series[i - 1], q = series[i + 1];
          if (p != null && q != null) expected = (p + q) / 2;
        } else if (i === 0) {
          const a = series[1], b = series[2];
          if (a != null && b != null) expected = 2 * a - b; // forward extrapolation
        } else {
          const a = series[n - 2], b = series[n - 3];
          if (a != null && b != null) expected = 2 * a - b; // backward extrapolation
        }
        if (expected == null) continue;
        const resid = x - expected;
        const ar = Math.abs(resid);
        if (ar >= 2) {
          const date = dateList[i];
          flags.push({ check: "continuity", date, gov, prayer, value: x, detail: `${fmt(x)} vs neighbour-expected ${expected.toFixed(1)}min (resid ${resid >= 0 ? "+" : ""}${resid.toFixed(1)})`, provenance: prov(date), image: img(date) });
        } else if (ar >= 1.5) {
          softContinuityCount++;
        }
      }
    }
  }

  // ---- (4) card duplicates (all 90 cells identical, ≥3 days apart) -----
  // Signature = the 15×6 raw stored strings in a fixed order; "?" marks a hole so
  // two cards match only when they agree cell-for-cell (holes included).
  const sigOf = new Map<string, string[]>(); // signature -> dates
  for (const date of dateList) {
    const parts: string[] = [];
    for (const gov of GOV_NAMES) {
      const cell = archive.govs[gov]?.[date];
      for (const prayer of PRAYERS) parts.push(cell?.[prayer] ?? "?");
    }
    const sig = parts.join("|");
    (sigOf.get(sig) ?? sigOf.set(sig, []).get(sig)!).push(date);
  }
  for (const dates of sigOf.values()) {
    if (dates.length < 2) continue;
    for (let a = 0; a < dates.length; a++) {
      for (let b = a + 1; b < dates.length; b++) {
        const da = dates[a], db = dates[b];
        if (Math.abs(isoToDays(db) - isoToDays(da)) < 3) continue;
        flags.push({ check: "card-duplicate", date: da, gov: null, prayer: null, value: null, detail: `all 90 cells identical to ${db}; images ${img(da) ?? "?"} == ${img(db) ?? "?"}`, provenance: prov(da), image: img(da) });
      }
    }
  }

  // ---- (5) engine residuals -------------------------------------------
  // Fit a per-(gov,prayer) constant on facebook_current_period cells only, then
  // score every date against that fit (previous-year raw uses the source card date).
  const fitMap = new Map<string, { offset: number; rule: Rule }>();
  const fitStat: Record<Prayer, { n: number; exact: number; within1: number; max: number }> =
    Object.fromEntries(PRAYERS.map((p) => [p, { n: 0, exact: 0, within1: 0, max: 0 }])) as Record<Prayer, { n: number; exact: number; within1: number; max: number }>;

  for (const gov of GOV_NAMES) {
    for (const prayer of PRAYERS) {
      const fitRows: FitRow[] = [];
      for (const date of dateList) {
        if (prov(date) !== "facebook_current_period") continue;
        const v = parsed[gov]?.[date]?.[prayer];
        if (v == null) continue;
        fitRows.push({ official: v, rawSec: getRaw(gov, date).sec[prayer] });
      }
      const fit = fitRows.length ? bestConstant(fitRows) : { offset: 0, rule: "nearest" as Rule, exact: 0 };
      fitMap.set(`${gov}|${prayer}`, { offset: fit.offset, rule: fit.rule });

      for (const date of dateList) {
        const v = parsed[gov]?.[date]?.[prayer];
        if (v == null) continue;
        const p = prov(date);
        const effIso = p === "facebook_previous_year" ? archive.sources[date].source_card_date : date;
        const rawSec = getRaw(gov, effIso).sec[prayer];
        const pred = predictMinute(rawSec, fit.offset, fit.rule);
        const resid = v - pred;
        const ar = Math.abs(resid);
        if (p === "facebook_current_period") {
          const s = fitStat[prayer];
          s.n++;
          if (resid === 0) s.exact++;
          if (ar <= 1) s.within1++;
          if (ar > s.max) s.max = ar;
        }
        if (ar >= 2) {
          flags.push({ check: "engine-resid", date, gov, prayer, value: v, detail: `${fmt(v)} vs engine ${fmt(pred)} (resid ${resid >= 0 ? "+" : ""}${resid}; fit ${fit.offset >= 0 ? "+" : ""}${fit.offset}/${fit.rule})`, provenance: p, image: img(date) });
        }
      }
    }
  }

  // ---- (6) old-corpus crosscheck (oldCells assembled + corrected up front) ----
  // Excluded dates/cells are holes on the archive side (their cells were removed by
  // applyOverlay) — skip those (iso,gov,prayer) combos: they are not comparable.
  // Also skip `facebook_previous_year` dates (Codex #2): parsed[gov][iso] there holds
  // the PREVIOUS year's card, so comparing it to the old corpus's own-year value is
  // meaningless — count these as not-comparable rather than flagging false mismatches.
  let oldCorpusOverlapCells = 0;
  let prevYearSkipped = 0;
  for (const c of oldCells) {
    if (c.iso < archive.range.start || c.iso > archive.range.end) continue;
    if (prov(c.iso) === "facebook_previous_year") { prevYearSkipped++; continue; }
    if (overlay.excludedDateSet.has(c.iso) || overlay.excludedCellKeys.has(`${c.gov}|${c.iso}|${c.prayer}`)) continue;
    const v = parsed[c.gov]?.[c.iso]?.[c.prayer];
    if (v == null) continue;
    oldCorpusOverlapCells++;
    if (v !== c.oldMin) {
      flags.push({ check: "old-corpus-mismatch", date: c.iso, gov: c.gov, prayer: c.prayer, value: v, detail: `archive ${fmt(v)} vs official corpus ${fmt(c.oldMin)} (Δ${v - c.oldMin})`, provenance: prov(c.iso), image: img(c.iso) });
    }
  }

  // ---- (7) year-drift measurement (previous-year cells only) ----------
  const drift: Record<Prayer, { sum: number; max: number; ge075: number; n: number }> =
    Object.fromEntries(PRAYERS.map((p) => [p, { sum: 0, max: 0, ge075: 0, n: 0 }])) as Record<Prayer, { sum: number; max: number; ge075: number; n: number }>;
  let prevYearDates = 0;
  for (const date of dateList) {
    if (prov(date) !== "facebook_previous_year") continue;
    prevYearDates++;
    const cardDate = archive.sources[date].source_card_date;
    for (const gov of GOV_NAMES) {
      const rt = getRaw(gov, date);
      const rc = getRaw(gov, cardDate);
      for (const prayer of PRAYERS) {
        const d = Math.abs(rt.sec[prayer] / 60 - rc.sec[prayer] / 60);
        const s = drift[prayer];
        s.sum += d;
        s.n++;
        if (d > s.max) s.max = d;
        if (d >= 0.75) s.ge075++;
      }
    }
  }

  // ---- report artifact -------------------------------------------------
  const flagCounts: Record<string, number> = {};
  for (const f of flags) flagCounts[f.check] = (flagCounts[f.check] ?? 0) + 1;

  const perPrayerFit = Object.fromEntries(
    PRAYERS.map((p) => {
      const s = fitStat[p];
      return [p, {
        n: s.n,
        exactPct: s.n ? (100 * s.exact) / s.n : 0,
        within1Pct: s.n ? (100 * s.within1) / s.n : 0,
        maxAbsResid: s.max,
      }];
    }),
  );

  const yearDrift = {
    prevYearDates,
    perPrayer: Object.fromEntries(
      PRAYERS.map((p) => {
        const s = drift[p];
        return [p, {
          meanAbs: s.n ? s.sum / s.n : 0,
          maxAbs: s.max,
          countGE075: s.ge075,
          n: s.n,
        }];
      }),
    ),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    flags,
    summary: {
      flagCounts,
      perPrayerFit,
      softContinuityCount,
      yearDrift,
      oldCorpusOverlapCells,
      oldCorpusPrevYearSkipped: prevYearSkipped,
    },
  };
  writeFileSync(resolve(ROOT, "_archive_report.json"), JSON.stringify(report, null, 2) + "\n");

  // ---- console summary -------------------------------------------------
  console.log(`Archive: ${dateList.length} dates (${archive.range.start} → ${archive.range.end}) × ${GOV_NAMES.length} govs · ${flags.length} flags`);
  console.log("\n=== flag counts by check ===");
  const checkOrder = ["format", "range", "continuity", "card-duplicate", "engine-resid", "old-corpus-mismatch"];
  for (const c of checkOrder) console.log(`  ${c.padEnd(20)} ${flagCounts[c] ?? 0}`);

  console.log("\n=== flags (date gov prayer value  detail  [provenance] image) ===");
  if (!flags.length) {
    console.log("  none");
  } else {
    for (const f of flags) {
      const valStr = typeof f.value === "number" ? fmt(f.value) : (f.value ?? "-");
      console.log(`  ${f.date}  ${(f.gov ?? "-").padEnd(10)} ${(f.prayer ?? "-").padEnd(8)} ${String(valStr).padEnd(6)} ${f.detail}  [${f.provenance ?? "-"}] ${f.image ?? "-"}`);
    }
  }

  console.log("\n=== per-prayer engine fit (facebook_current_period cells only) ===");
  console.log(`  ${"prayer".padEnd(8)} ${"n".padEnd(6)} ${"exact".padEnd(8)} ${"±1".padEnd(8)} max|resid|`);
  for (const p of PRAYERS) {
    const s = perPrayerFit[p] as { n: number; exactPct: number; within1Pct: number; maxAbsResid: number };
    console.log(`  ${p.padEnd(8)} ${String(s.n).padEnd(6)} ${(s.exactPct.toFixed(1) + "%").padEnd(8)} ${(s.within1Pct.toFixed(1) + "%").padEnd(8)} ${s.maxAbsResid}`);
  }

  console.log(`\n=== year-drift (raw engine target vs source-card date · ${prevYearDates} previous-year dates) ===`);
  console.log(`  ${"prayer".padEnd(8)} ${"meanAbs".padEnd(10)} ${"maxAbs".padEnd(10)} count|drift|≥0.75min`);
  for (const p of PRAYERS) {
    const s = yearDrift.perPrayer[p] as { meanAbs: number; maxAbs: number; countGE075: number; n: number };
    console.log(`  ${p.padEnd(8)} ${(s.meanAbs.toFixed(2) + "m").padEnd(10)} ${(s.maxAbs.toFixed(2) + "m").padEnd(10)} ${s.countGE075} / ${s.n}`);
  }

  console.log(`\nsoft continuity (1.5≤|resid|<2, not flagged): ${softContinuityCount}`);
  console.log(`old-corpus overlap cells compared: ${oldCorpusOverlapCells} (skipped ${prevYearSkipped} prev-year, not comparable)`);
  console.log(`\nwrote ${resolve(ROOT, "_archive_report.json")}`);
}

main();
