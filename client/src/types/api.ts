// API response contracts. The client talks to the backend over HTTP ONLY —
// nothing here is imported from the server or prayer-engine. These interfaces
// mirror the contract in docs/PRAYER_TIMES_API.md.

export type Lang = "ar" | "en";
export type AsrMadhab = "Standard" | "Hanafi";

export type PrayerName =
  | "fajr"
  | "sunrise"
  | "dhuhr"
  | "asr"
  | "maghrib"
  | "isha";

/** The 10 tracked Islamic event keys (see PRAYER_TIMES_API.md). */
export type EventKey =
  | "islamicNewYear"
  | "ashura"
  | "mawlid"
  | "israMiraj"
  | "midShaban"
  | "ramadanStart"
  | "laylatAlQadr"
  | "eidAlFitr"
  | "arafah"
  | "eidAlAdha";

/** The 13 calculation-method preset keys (see prayer-engine/methods.ts). */
export type MethodKey =
  | "MWL"
  | "ISNA"
  | "Egyptian"
  | "UmmAlQura"
  | "Karachi"
  | "Dubai"
  | "Qatar"
  | "Kuwait"
  | "Singapore"
  | "Diyanet"
  | "Tehran"
  | "Jafari"
  | "BaghdadYMA";

export interface LocationInfo {
  city: string | null;
  country: string | null;
  tz: string;
  lat: number;
  lon: number;
  elevation: number | null;
}

export interface MethodInfo {
  key: string;
  label: string;
  asr: AsrMadhab;
  auto: boolean;
  baghdadCalibrated: boolean;
}

export interface PrayerEntry {
  name: PrayerName;
  label: string;
  time: string;
  timestamp: number | null;
  isPassed: boolean;
  isNext: boolean;
  countdown: string | null;
}

export interface NextPrayer {
  name: string;
  label: string;
  time: string;
  timestamp: number;
  countdown: string | null;
  tomorrow: boolean;
}

export interface NextEvent {
  key: string;
  name: string;
  isToday: boolean;
  daysLeft: number;
}

/** A Sunnah time window as absolute epoch ms (Duha forenoon / last-third-of-night). */
export interface SunnahWindow {
  start: number;
  end: number;
}

export interface PrayerTimesResponse {
  location: LocationInfo;
  method: MethodInfo;
  date: string;
  lang: Lang;
  now: number;
  prayers: PrayerEntry[];
  nextPrayer: NextPrayer | null;
  hijriDate: string;
  nextEvent: NextEvent | null;
  tomorrowFajr: number | null;
  /** Yesterday's Isha — anchors the pre-Fajr ring interval (Isha→Fajr across midnight). */
  yesterdayIsha: number | null;
  /** Forenoon Duha window (sunrise+15 → dhuhr−15); the soonest one whose end is still future. */
  duhaWindow: SunnahWindow | null;
  /** Last third of the night (qiyam) window; the soonest one whose end is still future. */
  qiyamWindow: SunnahWindow | null;
}

/** One row of the monthly table (GET /api/prayer-times/month — display-only). */
export interface MonthDayRow {
  date: string;
  hijriDay: number;
  hijriMonth: string;
  hijriYear: number;
  isFriday: boolean;
  times: Record<PrayerName, string>;
}

export interface MonthTimesResponse {
  month: string;
  location: LocationInfo;
  method: MethodInfo;
  lang: Lang;
  days: MonthDayRow[];
}

export interface ReverseGeoResponse {
  city: string | null;
  /** Arabic-script city name when known. */
  cityAr: string | null;
  country: string | null;
  admin1: string | null;
  tz: string;
  elevation: number | null;
  method: string;
}

export interface CityResult {
  name: string;
  /** Arabic-script name when known; null otherwise. */
  nameAr: string | null;
  country: string | null;
  admin1: string | null;
  tz: string;
  lat: number;
  lon: number;
  elevation: number | null;
  population: number | null;
}

export interface CitySearchResponse {
  results: CityResult[];
}

/** One governorate (admin-1 capital) of a country. Shape matches CityResult. */
export type GovernorateResult = CityResult;

export interface GovernoratesResponse {
  governorates: GovernorateResult[];
}

export interface DeclinationResponse {
  /** Magnetic declination in degrees, positive east of true north (WMM). */
  declinationDeg: number;
}

/** One nearby mosque from the Places proxy (docs/QIBLA_MASJID_SPEC.md §6a). */
export interface Masjid {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
}

export interface MasjidsResponse {
  /** False ⇒ no key configured server-side — hide the whole section. */
  enabled: boolean;
  masjids: Masjid[];
  /** Present (true) only when the upstream lookup failed — show the error state. */
  degraded?: boolean;
}

export interface VapidKeyResponse {
  publicKey: string;
}

export interface PushSubscribeBody {
  subscription: PushSubscriptionJSON;
  lat: number;
  lon: number;
  tz: string;
  country: string | null;
  method: string;
  asr: AsrMadhab;
  lang: Lang;
}

/** When a reminder fires: at the prayer time, or N minutes before / after. */
export type AlertTiming = "at_time" | "before" | "after";

/** How a reminder presents: a quiet notification, or a full-screen alarm. */
export type AlertKind = "notification" | "alarm";

/**
 * What a reminder rule can fire on: the five fard plus the sunnah/adhkar anchors
 * (duha = window start, qiyam = last-third start, morning/evening adhkar). Kept
 * separate from PrayerName so sunrise stays out and the display code is explicit.
 */
export type AlertTarget =
  | "fajr"
  | "dhuhr"
  | "asr"
  | "maghrib"
  | "isha"
  | "duha"
  | "qiyam"
  | "adhkar_morning"
  | "adhkar_evening";

/** A single reminder rule belonging to a device (push endpoint). */
export interface PrayerAlert {
  id: number;
  endpoint: string;
  timing: AlertTiming;
  minutes: number | null;
  prayers: AlertTarget[];
  kind: AlertKind;
}

/** Body for creating/updating a reminder rule. */
export interface AlertInput {
  endpoint: string;
  timing: AlertTiming;
  minutes: number | null;
  prayers: AlertTarget[];
  kind: AlertKind;
}

export interface AlertsResponse {
  alerts: PrayerAlert[];
}

export interface ApiError {
  error: string;
}
