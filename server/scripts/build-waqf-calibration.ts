// Calibration + validation for the nationwide Iraqi profile.
//
// Reads the official ديوان الوقف السني per-governorate tables (the root
// `_waqf_*.json` files + the 19-June-2026 poster transcribed in
// iraq-governorates.test.ts), computes the engine's RAW (pre-offset) times at
// each governorate's own coordinates/elevation, and asks:
//
//   1. How well does the CURRENT flat `+5/+3/+2` offset reproduce the table?
//   2. How well does a per-(gov,prayer) CONSTANT offset reproduce it?
//      (in-sample AND leave-one-date-out — the honest generalization number)
//   3. Is there leftover SEASONAL structure (residual vs solar declination)
//      that a constant misses, i.e. would a declination term help?
//
// Validation first — the answers decide the runtime model before we wire it in.
// Run from server/:  npx tsx scripts/build-waqf-calibration.ts

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

// Canonical governorate geometry (live dataset coords + GeoNames elevation).
// Keyed by the names used in the _waqf_*.json files. Fallujah/Samarra are not in
// the quick-pick list; their coords come from the official poster transcription.
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
 * Waqf JSON is 12-hour without am/pm. Fajr/Sunrise are morning, Dhuhr is ~noon,
 * Asr/Maghrib/Isha are afternoon/evening (+12h). This also accepts already-24h
 * values (e.g. asr "15:51") via (h % 12) + 12.
 */
function toMinute(prayer: Prayer, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (prayer === "asr" || prayer === "maghrib" || prayer === "isha") {
    return ((h % 12) + 12) * 60 + m;
  }
  return h * 60 + m; // fajr/sunrise (am), dhuhr (~noon)
}

/**
 * The full-year archive is already 24h "HH:MM": parse directly, no 12h heuristic.
 * Strict — a malformed overlay correction or archive cell must fail loudly rather
 * than become NaN and silently poison the fit.
 */
const HHMM24 = /^([01]\d|2[0-3]):([0-5]\d)$/;
function parse24(hhmm: string): number {
  const mt = HHMM24.exec(hhmm);
  if (!mt) throw new Error(`parse24: malformed 24h HH:MM "${hhmm}"`);
  return Number(mt[1]) * 60 + Number(mt[2]);
}

/** Minutes-of-day back to "HH:MM" (24h) for readable diagnostics. */
function minToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
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

/** Cached engine RAW times per (gov,iso) — shared across the old + archive corpora. */
function cachedRaw(cache: Map<string, Raw>, gov: string, iso: string): Raw {
  const key = `${gov}|${iso}`;
  let raw = cache.get(key);
  if (!raw) {
    raw = rawForGov(GOV[gov], iso);
    cache.set(key, raw);
  }
  return raw;
}

function predictMinute(rawSec: number, offsetMin: number, rule: Rule): number {
  const minutes = rawSec / 60 + offsetMin;
  if (rule === "down") return Math.floor(minutes);
  if (rule === "up") return Math.ceil(minutes);
  return Math.round(minutes);
}

// ---- load the official corpus ------------------------------------------

interface WaqfDay { gregorian_date: string; locations: Record<string, Record<string, string>> }
interface Row { gov: string; iso: string; prayer: Prayer; official: number; rawSec: number; dec: number }

function loadWaqfFile(name: string): WaqfDay[] {
  return JSON.parse(readFileSync(resolve(ROOT, name), "utf8")) as WaqfDay[];
}

// Official poster for 19 June 2026 (24h), transcribed from iraq-governorates.test.ts.
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
const POSTER_0619_ISO = "2026-06-19"; // the poster above is fixed at source, not via oldCorpusCorrections

/** The original hand-transcribed corpus (12h _waqf_*.json + the 19-June poster). */
function buildOldRows(cache: Map<string, Raw>): Row[] {
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

  const rows: Row[] = [];
  for (const day of days) {
    const iso = gregToIso(day.gregorian_date);
    for (const [rawName, times] of Object.entries(day.locations)) {
      const gov = canonGov(rawName);
      if (!gov) continue;
      const raw = cachedRaw(cache, gov, iso);
      for (const prayer of PRAYERS) {
        const cap = (prayer[0].toUpperCase() + prayer.slice(1)) as keyof typeof times;
        const v = times[cap as string];
        if (!v) continue;
        rows.push({ gov, iso, prayer, official: toMinute(prayer, v), rawSec: raw.sec[prayer], dec: raw.dec });
      }
    }
  }
  return rows;
}

// ---- full-year OCR archive + adjudications overlay ---------------------
// A 366-day OCR archive (waqf-times-*.json) with per-date provenance. We ingest
// only the two GENUINELY-OFFICIAL provenances (facebook_current_period keyed at
// the date itself; facebook_previous_year keyed at the year it was actually
// printed for) — the generated_* rows are formula output and would be circular as
// ground truth, so they are skipped. An image-verified adjudications overlay
// (waqf-archive-adjudications.json) drops whole misprinted dates and corrects
// single OCR cells before ingestion.

const ARCHIVE_FILE = "waqf-times-2025-08-11-to-2026-08-11.json";
const ADJUDICATIONS_FILE = "waqf-archive-adjudications.json";

interface ArchiveSource {
  source_type:
    | "facebook_current_period"
    | "facebook_previous_year"
    | "generated_calibrated_formula"
    | "generated_official_exact";
  /** The Gregorian date the poster was actually printed for (== date for offset 0). */
  source_card_date: string;
  source_year_offset: number;
}
interface Archive {
  /** gov → ISO date → prayer → "HH:MM" (24h). */
  govs: Record<string, Record<string, Record<string, string>>>;
  /** ISO date → provenance. */
  sources: Record<string, ArchiveSource>;
}
interface Adjudications {
  excludedDates: Array<{ date: string; reason: string }>;
  corrections: Array<{ date: string; gov: string; prayer: string; value: string; basis: string }>;
  /** Single poster-misprinted cells with no trustworthy value: drop them so the
   *  calibrated formula (not a verbatim/corrected value) serves that cell. */
  excludedCells: Array<{ date: string; gov: string; prayer: string; reason: string }>;
  /** Re-verified 24h values that replace a transcription error in the OLD
   *  _waqf_*.json corpus (the 19-June poster is fixed in POSTER_0619 instead). */
  oldCorpusCorrections: Array<{ date: string; gov: string; prayer: string; value: string; basis: string }>;
}

interface OverlayCounts {
  excludedDates: Set<string>;
  /** Canonicalized `${gov}|${date}|${prayer}` for every excluded cell. */
  excludedCellKeys: Set<string>;
  corrections: number;
  excludedCells: number;
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(HERE, "../data", name), "utf8")) as T;
}

const PRAYER_SET = new Set<string>(PRAYERS);
/** Fail closed on a typo'd prayer field in the overlay. */
function assertPrayer(prayer: string, ctx: string): void {
  if (!PRAYER_SET.has(prayer)) {
    throw new Error(`adjudications: invalid prayer "${prayer}" in ${ctx} (expected one of ${PRAYERS.join(", ")})`);
  }
}

/**
 * Apply the adjudications overlay to the archive in place: collect the excluded
 * dates, patch corrected cells, then drop excluded cells (so they contribute
 * neither to the fit nor to waqf-exact.json → the formula serves them). Config
 * errors throw: a correction/excluded-cell for an excluded date, an unknown gov,
 * a non-archive date, or the same (date,gov,prayer) both corrected and excluded.
 */
function applyOverlay(archive: Archive, adj: Adjudications): OverlayCounts {
  const excludedDates = new Set(adj.excludedDates.map((e) => e.date));
  const correctedKeys = new Set<string>();
  for (const c of adj.corrections) {
    assertPrayer(c.prayer, `correction ${c.date} ${c.gov}`);
    const gov = canonGov(c.gov);
    if (!gov) throw new Error(`adjudications: unknown gov "${c.gov}" in correction ${c.date}`);
    const key = `${gov}|${c.date}|${c.prayer}`;
    if (correctedKeys.has(key)) throw new Error(`adjudications: duplicate correction ${c.date} ${gov} ${c.prayer} — config error`);
    if (excludedDates.has(c.date)) {
      throw new Error(`adjudications: correction for excluded date ${c.date} (${gov} ${c.prayer}) — config error`);
    }
    const cell = archive.govs[gov]?.[c.date];
    if (!cell) throw new Error(`adjudications: correction date ${c.date} not in archive for ${gov}`);
    cell[c.prayer] = c.value;
    correctedKeys.add(key);
  }
  const excludedCellKeys = new Set<string>();
  for (const ec of adj.excludedCells) {
    assertPrayer(ec.prayer, `excluded cell ${ec.date} ${ec.gov}`);
    const gov = canonGov(ec.gov);
    if (!gov) throw new Error(`adjudications: unknown gov "${ec.gov}" in excluded cell ${ec.date}`);
    const key = `${gov}|${ec.date}|${ec.prayer}`;
    if (excludedCellKeys.has(key)) throw new Error(`adjudications: duplicate excluded cell ${ec.date} ${gov} ${ec.prayer} — config error`);
    if (excludedDates.has(ec.date)) {
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
  return { excludedDates, excludedCellKeys, corrections: adj.corrections.length, excludedCells: adj.excludedCells.length };
}

/**
 * Apply re-verified old-corpus corrections to the assembled OLD rows in place,
 * matching by (gov, iso, prayer) and replacing `official` with the strict-parsed
 * 24h value. Config errors throw: an invalid prayer, a duplicate (date,gov,prayer),
 * a 2026-06-19 target (fix POSTER_0619 instead), an unknown gov, a (date,gov,prayer)
 * that is also excluded (date or cell), or one that matches no old-corpus row.
 */
function applyOldCorpusCorrections(oldRows: Row[], adj: Adjudications, overlay: OverlayCounts): number {
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
    if (overlay.excludedDates.has(oc.date)) {
      throw new Error(`oldCorpusCorrections: ${oc.date} is an excluded date — cannot also correct it (config error)`);
    }
    if (overlay.excludedCellKeys.has(key)) {
      throw new Error(`oldCorpusCorrections: ${oc.date} ${gov} ${oc.prayer} is also a cell-exclusion — config error`);
    }
    const row = oldRows.find((r) => r.gov === gov && r.iso === oc.date && r.prayer === oc.prayer);
    if (!row) throw new Error(`oldCorpusCorrections: ${oc.date} ${gov} ${oc.prayer} matches no old-corpus row`);
    row.official = parse24(oc.value);
  }
  return adj.oldCorpusCorrections.length;
}

/** Archive rows for the two official provenances; generated_* rows are skipped. */
function buildArchiveRows(cache: Map<string, Raw>, archive: Archive, excluded: Set<string>): Row[] {
  const rows: Row[] = [];
  for (const [date, meta] of Object.entries(archive.sources)) {
    if (excluded.has(date)) continue;
    let iso: string;
    if (meta.source_type === "facebook_current_period") iso = date;
    else if (meta.source_type === "facebook_previous_year") iso = meta.source_card_date;
    else continue; // generated_* → formula output; circular as ground truth
    for (const gov of GOV_NAMES) {
      const times = archive.govs[gov]?.[date];
      if (!times) continue;
      const raw = cachedRaw(cache, gov, iso);
      for (const prayer of PRAYERS) {
        const v = times[prayer];
        if (!v) continue;
        rows.push({ gov, iso, prayer, official: parse24(v), rawSec: raw.sec[prayer], dec: raw.dec });
      }
    }
  }
  return rows;
}

interface Conflict { iso: string; gov: string; prayer: Prayer; old: number; archive: number }

/**
 * Merge the old corpus with the archive, deduped by (gov, iso, prayer). The
 * archive value wins (native-resolution verified); a differing old-corpus value
 * that gets dropped is recorded as a conflict so it is never silently hidden.
 */
function mergeCorpus(oldRows: Row[], archiveRows: Row[]): { rows: Row[]; conflicts: Conflict[] } {
  const byKey = new Map<string, Row>();
  for (const r of archiveRows) byKey.set(`${r.gov}|${r.iso}|${r.prayer}`, r);
  const conflicts: Conflict[] = [];
  for (const r of oldRows) {
    const key = `${r.gov}|${r.iso}|${r.prayer}`;
    const winner = byKey.get(key);
    if (winner) {
      if (winner.official !== r.official) {
        conflicts.push({ iso: r.iso, gov: r.gov, prayer: r.prayer, old: r.official, archive: winner.official });
      }
    } else {
      byKey.set(key, r);
    }
  }
  return { rows: [...byKey.values()], conflicts };
}

// ---- fitting ------------------------------------------------------------

function bestConstant(rows: Row[], fixedRule?: Rule): { offset: number; rule: Rule; exact: number } {
  let best = { offset: 0, rule: "nearest" as Rule, exact: -1, mae: Infinity };
  for (const rule of fixedRule ? [fixedRule] : RULES) {
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

// Fixed per-prayer rounding (fajr floors, everything else nearest) — the simpler
// alternative to free per-(gov,prayer) rules.
const FIXED_RULE: Record<Prayer, Rule> = {
  fajr: "down", sunrise: "nearest", dhuhr: "nearest", asr: "nearest", maghrib: "nearest", isha: "nearest",
};

function pct(n: number, d: number): string {
  return `${((100 * n) / d).toFixed(1)}%`;
}

function main(): void {
  const rawCache = new Map<string, Raw>();
  const archive = loadJson<Archive>(ARCHIVE_FILE);
  const adj = loadJson<Adjudications>(ADJUDICATIONS_FILE);
  const overlay = applyOverlay(archive, adj);

  const oldRows = buildOldRows(rawCache);
  const oldCorrections = applyOldCorpusCorrections(oldRows, adj, overlay);
  const archiveRows = buildArchiveRows(rawCache, archive, overlay.excludedDates);
  const { rows: mergedRows, conflicts } = mergeCorpus(oldRows, archiveRows);

  // Exclusion safety net over BOTH corpora: the archive-side deletion (applyOverlay)
  // already drops archive rows, but an OLD-corpus row keyed at the same true date
  // would refill that hole after mergeCorpus (e.g. the June _waqf_gap transcription
  // of a defective poster). Old rows are keyed at their real date — exactly how the
  // overlay references them. Enforced invariant (Codex #3): a prev-year archive row
  // is re-keyed to its `source_card_date`, so an excluded prev-year date/cell is ALSO
  // mirrored to that source date here, in case the old corpus holds a row at it.
  // Expect 0 dropped until the overlay lists an old-corpus date/cell.
  const srcCardOf = (date: string): string | undefined => {
    const m = archive.sources[date];
    return m?.source_type === "facebook_previous_year" ? m.source_card_date : undefined;
  };
  const excludedDateFilter = new Set(overlay.excludedDates);
  for (const d of overlay.excludedDates) { const s = srcCardOf(d); if (s) excludedDateFilter.add(s); }
  const excludedCellFilter = new Set(overlay.excludedCellKeys);
  for (const ec of adj.excludedCells) {
    const s = srcCardOf(ec.date);
    if (s) excludedCellFilter.add(`${canonGov(ec.gov)}|${s}|${ec.prayer}`);
  }
  const rows = mergedRows.filter(
    (r) => !excludedDateFilter.has(r.iso) && !excludedCellFilter.has(`${r.gov}|${r.iso}|${r.prayer}`),
  );
  const droppedByFilter = mergedRows.length - rows.length;
  const dates = [...new Set(rows.map((r) => r.iso))].sort();

  const provCount = { current: 0, prevYear: 0, generated: 0 };
  for (const meta of Object.values(archive.sources)) {
    if (meta.source_type === "facebook_current_period") provCount.current++;
    else if (meta.source_type === "facebook_previous_year") provCount.prevYear++;
    else provCount.generated++;
  }
  console.log(`Archive: current-period ${provCount.current} · prev-year ${provCount.prevYear} (re-keyed to print year) · generated ${provCount.generated} skipped`);
  console.log(`overlay: ${overlay.excludedDates.size} dates excluded, ${overlay.corrections} cells corrected, ${overlay.excludedCells} cells excluded, ${oldCorrections} old-corpus cells corrected`);
  console.log(`Corpus: ${oldRows.length} old-corpus rows + ${archiveRows.length} archive rows → ${mergedRows.length} merged (− ${droppedByFilter} excluded both-corpora → ${rows.length}) · ${dates.length} dates · ${GOV_NAMES.length} govs`);
  console.log(`Dates: ${dates.join(", ")}\n`);

  console.log(`=== old-vs-archive conflicts (${conflicts.length}) — archive (native-res) wins ===`);
  const sortedConflicts = [...conflicts].sort(
    (a, b) => a.iso.localeCompare(b.iso) || a.gov.localeCompare(b.gov) || PRAYERS.indexOf(a.prayer) - PRAYERS.indexOf(b.prayer),
  );
  console.log(
    sortedConflicts.length
      ? sortedConflicts.map((c) => `  ${c.iso} ${c.gov.padEnd(10)} ${c.prayer.padEnd(8)} old=${minToHHMM(c.old)} archive=${minToHHMM(c.archive)}`).join("\n")
      : "  none",
  );
  console.log("");

  // ---- (1) baseline: current flat offsets ------------------------------
  const baseOff: Record<Prayer, number> = { fajr: 0, sunrise: 0, dhuhr: 5, asr: 3, maghrib: 2, isha: 0 };
  const baseRule: Record<Prayer, Rule> = { fajr: "down", sunrise: "nearest", dhuhr: "nearest", asr: "nearest", maghrib: "nearest", isha: "nearest" };
  console.log("=== (1) CURRENT flat model (+5/+3/+2, fajr floor) ===");
  {
    let exact = 0, w1 = 0;
    const perP: Record<Prayer, { e: number; n: number }> = Object.fromEntries(PRAYERS.map((p) => [p, { e: 0, n: 0 }])) as any;
    for (const r of rows) {
      const d = Math.abs(predictMinute(r.rawSec, baseOff[r.prayer], baseRule[r.prayer]) - r.official);
      if (d === 0) exact++;
      if (d <= 1) w1++;
      perP[r.prayer].n++; if (d === 0) perP[r.prayer].e++;
    }
    console.log(`overall exact ${pct(exact, rows.length)} · within±1 ${pct(w1, rows.length)}`);
    console.log("per-prayer exact: " + PRAYERS.map((p) => `${p} ${pct(perP[p].e, perP[p].n)}`).join("  "));
  }

  // ---- (2) per-(gov,prayer) constant: in-sample + leave-one-date-out ----
  console.log("\n=== (2) per-(gov,prayer) CONSTANT offset+rule ===");
  const byGP = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.gov}|${r.prayer}`;
    (byGP.get(k) ?? byGP.set(k, []).get(k)!).push(r);
  }

  let inExact = 0, inW1 = 0, looExact = 0, looW1 = 0;
  const looPerP: Record<Prayer, { e: number; w: number; n: number; max: number }> =
    Object.fromEntries(PRAYERS.map((p) => [p, { e: 0, w: 0, n: 0, max: 0 }])) as any;
  const govMax = new Map<string, number>();
  const bigErrors: string[] = [];

  for (const [k, gr] of byGP) {
    const [gov, prayer] = k.split("|") as [string, Prayer];
    // in-sample fit
    const fit = bestConstant(gr);
    for (const r of gr) {
      const d = Math.abs(predictMinute(r.rawSec, fit.offset, fit.rule) - r.official);
      if (d === 0) inExact++; if (d <= 1) inW1++;
    }
    // leave-one-date-out
    for (const held of gr) {
      const train = gr.filter((r) => r.iso !== held.iso);
      const f = bestConstant(train);
      const pred = predictMinute(held.rawSec, f.offset, f.rule);
      const d = Math.abs(pred - held.official);
      if (d === 0) { looExact++; looPerP[prayer].e++; }
      if (d <= 1) { looW1++; looPerP[prayer].w++; }
      looPerP[prayer].n++;
      looPerP[prayer].max = Math.max(looPerP[prayer].max, d);
      govMax.set(gov, Math.max(govMax.get(gov) ?? 0, d));
      if (d >= 4) bigErrors.push(`  ${held.iso} ${gov.padEnd(10)} ${prayer.padEnd(8)} official=${held.official} model=${pred} (Δ${pred - held.official})`);
    }
  }
  console.log(`in-sample exact ${pct(inExact, rows.length)} · within±1 ${pct(inW1, rows.length)}`);
  console.log(`leave-one-out exact ${pct(looExact, rows.length)} · within±1 ${pct(looW1, rows.length)}`);
  console.log("LOO per-prayer: " + PRAYERS.map((p) => `${p} ${pct(looPerP[p].e, looPerP[p].n)}(±1 ${pct(looPerP[p].w, looPerP[p].n)},max${looPerP[p].max})`).join("  "));
  console.log("LOO per-gov worst |err|: " + GOV_NAMES.map((g) => `${g}:${govMax.get(g) ?? 0}`).join("  "));

  // (2b) per-gov offset with FIXED per-prayer rounding (simpler) — LOO.
  let fixExact = 0, fixW1 = 0;
  for (const [k, gr] of byGP) {
    const [, prayer] = k.split("|") as [string, Prayer];
    for (const held of gr) {
      const train = gr.filter((r) => r.iso !== held.iso);
      const f = bestConstant(train, FIXED_RULE[prayer]);
      const d = Math.abs(predictMinute(held.rawSec, f.offset, f.rule) - held.official);
      if (d === 0) fixExact++; if (d <= 1) fixW1++;
    }
  }
  console.log(`(2b) FIXED-rounding per-gov offset — LOO exact ${pct(fixExact, rows.length)} · within±1 ${pct(fixW1, rows.length)}`);
  console.log("LOO |err|>=4 (model vs poster — likely poster typos where model is physically consistent):");
  console.log(bigErrors.length ? bigErrors.join("\n") : "  none");

  // (2c) outlier dump: in-sample cells off by >=2 under the free per-gov fit.
  console.log("\n=== outliers (|err|>=2, in-sample per-gov fit) — check for transcription typos ===");
  const out: string[] = [];
  for (const [k, gr] of byGP) {
    const [gov, prayer] = k.split("|") as [string, Prayer];
    const fit = bestConstant(gr);
    for (const r of gr) {
      const pred = predictMinute(r.rawSec, fit.offset, fit.rule);
      const d = pred - r.official;
      if (Math.abs(d) >= 2) out.push(`  ${r.iso} ${gov.padEnd(10)} ${prayer.padEnd(8)} official=${r.official} pred=${pred} (${d > 0 ? "+" : ""}${d})`);
    }
  }
  console.log(out.length ? out.join("\n") : "  none");

  // (2d) post-fit anomalies under the FINAL full fit (the deployed per-gov
  // table): every row with |official − prediction| ≥ 3 — likely poster typos or
  // missed OCR errors. Report-only; NOT auto-dropped (the adjudications overlay
  // is the human-verified place to exclude/correct these).
  // The same set becomes the `noRecycle` map in waqf-exact.json: these ≥3-min
  // cells are served verbatim on their own date but skipped by the recycle fallback.
  console.log("\n=== (2d) post-fit anomalies (|official − prediction| ≥ 3, final full fit) — report-only + noRecycle ===");
  const anomalies: string[] = [];
  const noRecycle: Record<string, Record<string, string[]>> = {};
  for (const [k, gr] of byGP) {
    const [gov, prayer] = k.split("|") as [string, Prayer];
    const fit = bestConstant(gr);
    for (const r of gr) {
      const pred = predictMinute(r.rawSec, fit.offset, fit.rule);
      const d = pred - r.official;
      if (Math.abs(d) >= 3) {
        anomalies.push(`  ${r.iso} ${gov.padEnd(10)} ${prayer.padEnd(8)} official=${minToHHMM(r.official)} pred=${minToHHMM(pred)} (${d > 0 ? "+" : ""}${d})`);
        ((noRecycle[gov] ??= {})[r.iso] ??= []).push(prayer);
      }
    }
  }
  console.log(anomalies.length ? anomalies.join("\n") : "  none");
  console.log(`${anomalies.length} anomalies ≥3 min (not auto-dropped) → noRecycle`);

  // ---- (3) seasonal diagnostics: residual vs declination ---------------
  // For each (gov,prayer): residual = official - rawMin. Fit a+b*dec by least
  // squares; report |b| (min per degree) and how much the constant misses.
  console.log("\n=== (3) seasonal structure (residual vs declination) ===");
  const slopes: { gp: string; b: number; spread: number }[] = [];
  for (const [k, gr] of byGP) {
    const xs = gr.map((r) => r.dec);
    const ys = gr.map((r) => r.official - r.rawSec / 60);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    const b = sxx > 0 ? sxy / sxx : 0;
    // residual spread after removing the best constant (= std around mean)
    const spread = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0) / n);
    slopes.push({ gp: k, b, spread });
  }
  slopes.sort((a, b) => Math.abs(b.b) - Math.abs(a.b));
  const declSpan = Math.max(...rows.map((r) => r.dec)) - Math.min(...rows.map((r) => r.dec));
  console.log(`declination span sampled: ${declSpan.toFixed(1)}°`);
  console.log("largest |slope| (min/°) — drift across full span shown in [] :");
  for (const s of slopes.slice(0, 10)) {
    console.log(`  ${s.gp.padEnd(20)} b=${s.b.toFixed(3)} min/°  [${(s.b * declSpan).toFixed(1)} min across span]  resid-σ=${s.spread.toFixed(2)}`);
  }
  // Explicit per-prayer verdict for maghrib + isha: worst declination-driven
  // drift over the sampled span. With the full-year corpus this is the number
  // that decides whether a constant offset stays the right model for these two.
  console.log("per-prayer verdict (worst gov drift across the full span):");
  for (const prayer of ["maghrib", "isha"] as Prayer[]) {
    let worst = { gov: "", drift: 0, b: 0 };
    for (const s of slopes) {
      if (s.gp.split("|")[1] !== prayer) continue;
      const drift = Math.abs(s.b * declSpan);
      if (drift > worst.drift) worst = { gov: s.gp.split("|")[0], drift, b: s.b };
    }
    const verdict = worst.drift < 1 ? "constant OK" : worst.drift < 2 ? "marginal" : "declination term worth it";
    console.log(`  ${prayer.padEnd(8)} max |drift| ${worst.drift.toFixed(2)} min across ${declSpan.toFixed(1)}° (worst ${worst.gov}, slope ${worst.b.toFixed(3)} min/°) → ${verdict}`);
  }

  // ---- EMIT committed artifacts ---------------------------------------
  // (a) iraq-waqf-calibration.json — per-(gov,prayer) {offset, rule}, FULL fit.
  const table = GOV_NAMES.map((gov) => {
    const offsets: Record<string, number> = {};
    const rules: Record<string, string> = {};
    for (const prayer of PRAYERS) {
      const gr = byGP.get(`${gov}|${prayer}`)!;
      const f = bestConstant(gr);
      offsets[prayer] = f.offset;
      rules[prayer] = f.rule;
    }
    return { name: gov, lat: GOV[gov].lat, lon: GOV[gov].lon, offsets, rules };
  });
  writeFileSync(
    resolve(HERE, "../data/iraq-waqf-calibration.json"),
    JSON.stringify({ note: "Per-governorate, per-prayer minute offset + rounding fit to the official ديوان الوقف السني table. Generated by scripts/build-waqf-calibration.ts — do not hand-edit.", govs: table }, null, 2) + "\n",
  );
  console.log("\n=== deployed per-gov table (offset/rule) ===");
  for (const t of table) {
    console.log(`  ${t.name.padEnd(10)} ` + PRAYERS.map((p) => `${p[0]}:${t.offsets[p]}/${t.rules[p][0]}`).join(" "));
  }

  // (b) waqf-exact.json — official numbers verbatim, for literal-0 override.
  const exact: Record<string, Record<string, Record<string, string>>> = {};
  for (const r of rows) {
    (exact[r.gov] ??= {})[r.iso] ??= {};
    exact[r.gov][r.iso][r.prayer] = `${String(Math.floor(r.official / 60)).padStart(2, "0")}:${String(r.official % 60).padStart(2, "0")}`;
  }
  // Stable, sorted noRecycle map (gov → date → prayers, in canonical order).
  const noRecycleSorted: Record<string, Record<string, string[]>> = {};
  for (const gov of Object.keys(noRecycle).sort()) {
    const byd: Record<string, string[]> = {};
    for (const iso of Object.keys(noRecycle[gov]).sort()) {
      byd[iso] = [...noRecycle[gov][iso]].sort((a, b) => PRAYERS.indexOf(a as Prayer) - PRAYERS.indexOf(b as Prayer));
    }
    noRecycleSorted[gov] = byd;
  }
  writeFileSync(
    resolve(HERE, "../data/waqf-exact.json"),
    JSON.stringify({
      note: "Official ديوان الوقف السني poster numbers (24h Asia/Baghdad), served verbatim for an exact (0-min) match on digitized dates. Generated by scripts/build-waqf-calibration.ts. `noRecycle` lists (gov → date → prayers) whose printed value deviated ≥3 min from the calibrated model on THAT date (one-day print oddities): served verbatim on their own date, but skipped by the year-recycle fallback so they never propagate to future same-days.",
      govs: exact,
      noRecycle: noRecycleSorted,
    }, null, 2) + "\n",
  );
  console.log(`\nwrote data/iraq-waqf-calibration.json (${table.length} govs) + data/waqf-exact.json (${Object.keys(exact).length} govs, ${dates.length} dates, ${anomalies.length} noRecycle cells)`);
}

main();
