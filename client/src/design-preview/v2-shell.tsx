// DEV-only v2 shell mock (docs/V2_REDESIGN_SPEC.md Phase 2): the 4-tab app
// shell with all tabs mocked, navigable in-mock. Screen 9 shows it in the
// active theme; screen 10 adds a floating theme-chip row (plus the global
// dev `T` key) so every tab can be reviewed under every design language.
// All Arabic strings that are NEW here are drafts pending user approval.

import { useState, type ReactNode } from "react";
import {
  CalendarClock,
  ChartColumnBig,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  House,
  Settings2,
  Star,
  Trophy,
} from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { MockHero, MockNextEvent, MockPrayerGrid, MockTopBar } from "./shared";
import { PRAYERS, SCORE, WEEK } from "./mock";

type TabId = "home" | "times" | "reports" | "settings";

const TABS: { id: TabId; label: string; icon: typeof House }[] = [
  { id: "home", label: "الرئيسية", icon: House },
  { id: "times", label: "المواقيت", icon: CalendarClock },
  { id: "reports", label: "التقارير", icon: ChartColumnBig },
  { id: "settings", label: "الإعدادات", icon: Settings2 },
];

const THEME_IDS = ["night", "kashi", "glass", "material", "contrast"] as const;
/** Draft theme display names — NEEDS-USER-APPROVAL (spec §6). kashi is a
    brand-color exploration (lapis tilework identity), preview-only. */
const THEME_NAMES: Record<(typeof THEME_IDS)[number], string> = {
  night: "الليل",
  kashi: "كاشي",
  glass: "الزجاج",
  material: "ماتيريال",
  contrast: "تباين عالٍ",
};

export function V2Shell({ themeChips = false }: { themeChips?: boolean }) {
  const [tab, setTab] = useState<TabId>("home");
  const [, bump] = useState(0); // re-render after a theme chip changes <html data-theme>

  return (
    <div className="flex min-h-[calc(100dvh-28px)] flex-col gap-3">
      {themeChips && (
        <div className="flex items-center justify-center gap-1.5">
          {THEME_IDS.map((id) => {
            const active = (document.documentElement.dataset.theme ?? "night") === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  document.documentElement.dataset.theme = id;
                  bump((n) => n + 1);
                }}
                className={
                  "rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors " +
                  (active
                    ? "border-gold/60 bg-veil/[0.08] text-gold"
                    : "border-border-soft/60 bg-veil/[0.02] text-ink-dim")
                }
              >
                {THEME_NAMES[id]}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
        {tab === "home" && <HomeTab />}
        {tab === "times" && <TimesTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>

      <TabBarMock tab={tab} onTab={setTab} />
    </div>
  );
}

/* ── Tab bar (the per-theme signature — reads .tab-bar / .tab-item recipes) ── */

function TabBarMock({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  return (
    <nav className="tab-bar sticky bottom-0 z-40 -mx-4 mt-auto px-2 pt-1.5 pb-2" aria-label="التنقل">
      <div className="mx-auto grid w-full max-w-xl grid-cols-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className="tab-item flex min-h-14 items-center justify-center"
          >
            {/* The pill covers icon + label together (user-approved shape). */}
            <span className="tab-pill flex flex-col items-center justify-center gap-1 px-4 py-1.5">
              <Icon className="size-[19px]" strokeWidth={tab === id ? 2.4 : 2} />
              <span className="text-[11px] font-semibold leading-none">{label}</span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ── الرئيسية — hero + horizontal strip + next event ────────────────────── */

function HomeTab() {
  return (
    <>
      <MockTopBar />
      <MockHero corners={4} checkinRow scorePill />
      <PrayerStripMock />
      <MockNextEvent />
    </>
  );
}

/** 3×2 prayer grid replacing the 2-col list on Home (list → Times) — matches
    the real components/PrayerStrip.tsx (two rows, user-approved). */
function PrayerStripMock() {
  return (
    <section className="card grid grid-cols-3 gap-1 px-2 py-2">
      {PRAYERS.map((p) => (
        <div
          key={p.name}
          className={
            "flex flex-col items-center gap-1 rounded-xl py-2 " +
            (p.isNext ? "breath-glow bg-veil/[0.06]" : "")
          }
        >
          <span
            className={
              "text-[13px] font-semibold leading-none " +
              (p.isNext ? "text-gold" : p.passed ? "text-ink-faint" : "text-ink-dim")
            }
          >
            {p.label}
          </span>
          <span
            className={
              "tnum text-[15px] font-bold leading-none " +
              (p.passed && !p.isNext ? "text-ink-faint" : "text-ink")
            }
          >
            {p.time.replace(/ [صم]$/, "")}
          </span>
        </div>
      ))}
    </section>
  );
}

/* ── المواقيت — today list + month table ────────────────────────────────── */

const MONTH_ROWS = [
  { d: 10, h: 25, fajr: "3:33", sun: "5:04", dhuhr: "12:10", asr: "3:46", magh: "7:17", isha: "8:48", friday: false },
  { d: 11, h: 26, fajr: "3:34", sun: "5:05", dhuhr: "12:11", asr: "3:46", magh: "7:17", isha: "8:47", friday: false },
  { d: 12, h: 27, fajr: "3:35", sun: "5:06", dhuhr: "12:11", asr: "3:47", magh: "7:16", isha: "8:46", friday: false, today: true },
  { d: 13, h: 28, fajr: "3:36", sun: "5:06", dhuhr: "12:11", asr: "3:47", magh: "7:16", isha: "8:45", friday: false },
  { d: 14, h: 29, fajr: "3:37", sun: "5:07", dhuhr: "12:11", asr: "3:47", magh: "7:15", isha: "8:44", friday: false },
  { d: 15, h: 1, fajr: "3:38", sun: "5:08", dhuhr: "12:11", asr: "3:47", magh: "7:15", isha: "8:43", friday: false },
  { d: 16, h: 2, fajr: "3:39", sun: "5:08", dhuhr: "12:12", asr: "3:47", magh: "7:14", isha: "8:42", friday: false },
  { d: 17, h: 3, fajr: "3:40", sun: "5:09", dhuhr: "12:12", asr: "3:47", magh: "7:13", isha: "8:41", friday: true },
  { d: 18, h: 4, fajr: "3:41", sun: "5:10", dhuhr: "12:12", asr: "3:47", magh: "7:13", isha: "8:40", friday: false },
  { d: 19, h: 5, fajr: "3:42", sun: "5:10", dhuhr: "12:12", asr: "3:47", magh: "7:12", isha: "8:39", friday: false },
];

function TimesTab() {
  return (
    <>
      {/* Draft strings pending approval: «مواقيت اليوم» «الجدول الشهري» «هذا الشهر» */}
      <SectionTitle>مواقيت اليوم</SectionTitle>
      <MockPrayerGrid mode="icon" />

      <div className="mt-1 flex items-center justify-between">
        <SectionTitle>الجدول الشهري</SectionTitle>
        <div className="flex items-center gap-1">
          <MonthNavBtn>
            <ChevronRight className="size-4" />
          </MonthNavBtn>
          <span className="tnum rounded-full bg-veil/[0.05] px-3 py-1 text-[12px] font-bold text-ink">
            تموز 2026 · محرم 1448
          </span>
          <MonthNavBtn>
            <ChevronLeft className="size-4" />
          </MonthNavBtn>
        </div>
      </div>

      <section className="card overflow-hidden">
        <table className="w-full text-center text-[12px]">
          <thead>
            <tr className="text-ink-dim">
              {["اليوم", "هجري", "الفجر", "الشروق", "الظهر", "العصر", "المغرب", "العشاء"].map((h) => (
                <th key={h} className="border-b border-border-soft/60 px-1 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tnum">
            {MONTH_ROWS.map((r) => (
              <tr
                key={r.d}
                className={
                  r.today
                    ? "bg-gold/15 font-bold text-gold"
                    : r.friday
                      ? "bg-veil/[0.04] text-teal"
                      : "text-ink-dim"
                }
              >
                <td className="px-1 py-1.5 font-bold">{r.d}</td>
                <td className="px-1 py-1.5">{r.h}</td>
                <td className="px-1 py-1.5">{r.fajr}</td>
                <td className="px-1 py-1.5">{r.sun}</td>
                <td className="px-1 py-1.5">{r.dhuhr}</td>
                <td className="px-1 py-1.5">{r.asr}</td>
                <td className="px-1 py-1.5">{r.magh}</td>
                <td className="px-1 py-1.5">{r.isha}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function MonthNavBtn({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="grid size-8 place-items-center rounded-lg bg-veil/[0.05] text-ink-dim"
    >
      {children}
    </button>
  );
}

/* ── التقارير — today ring, trend, heatmap, per-prayer, lifetime ────────── */

const CATS = [
  { label: "الفرائض", got: 8, max: 15, streak: 4, color: "var(--color-gold)" },
  { label: "الرواتب", got: 2, max: 5, streak: 2, color: "var(--color-sky)" },
  { label: "الأذكار", got: 3, max: 7, streak: 6, color: "var(--color-teal)" },
  { label: "الضحى والقيام", got: 0, max: 2, streak: 0, color: "var(--color-amber)" },
];

// 62 deterministic day scores, oldest→newest (0 = nothing logged that day).
const HEAT = Array.from({ length: 62 }, (_, i) =>
  i % 9 === 4 ? 0 : ((i * 11 + 7) % 28) + 2,
);

const PER_PRAYER = [
  { label: "الفجر", masjid: 21, home: 28, missed: 6 },
  { label: "الظهر", masjid: 30, home: 24, missed: 1 },
  { label: "العصر", masjid: 27, home: 26, missed: 2 },
  { label: "المغرب", masjid: 41, home: 13, missed: 1 },
  { label: "العشاء", masjid: 38, home: 15, missed: 2 },
];

function ReportsTab() {
  return (
    <>
      {/* Draft strings pending approval: section titles below */}
      <section className="card flex items-center gap-4 p-4">
        <ProgressRing progress={SCORE.today / SCORE.max} size={92} stroke={8} color="var(--color-gold)">
          <div className="flex flex-col items-center leading-none">
            <span className="tnum text-2xl font-extrabold text-ink">{SCORE.today}</span>
            <span className="tnum text-[11px] text-ink-faint">/{SCORE.max}</span>
          </div>
        </ProgressRing>
        <div className="flex flex-1 flex-col gap-2">
          {CATS.map((c) => (
            <div key={c.label} className="flex items-center gap-2">
              <span className="w-24 text-[12px] font-semibold text-ink-dim">{c.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-veil/[0.08]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(c.got / c.max) * 100}%`, background: c.color }}
                />
              </div>
              <span className="tnum text-[11px] font-bold text-ink-dim">
                {c.got}/{c.max}
              </span>
              <span className="flex items-center gap-0.5 text-[11px] text-urgent">
                <Flame className="size-3" />
                <span className="tnum">{c.streak}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>التقدّم</SectionTitle>
          <div className="flex gap-1">
            {["أسبوع", "شهر", "أشهر"].map((t, i) => (
              <span
                key={t}
                className={
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold " +
                  (i === 0 ? "bg-gold/15 text-gold" : "bg-veil/[0.04] text-ink-faint")
                }
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-end justify-between gap-1.5">
          {WEEK.values.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-[54px] w-full items-end">
                <div
                  className={
                    "w-full rounded-t " + (i === 6 ? "bg-gold" : "bg-teal/50")
                  }
                  style={{ height: `${(v / 29) * 54}px` }}
                />
              </div>
              <span className="text-[10px] text-ink-faint">{WEEK.days[i]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <SectionTitle className="mb-3">آخر 62 يومًا</SectionTitle>
        <div className="grid grid-flow-col grid-rows-7 justify-center gap-[3px]">
          {HEAT.map((v, i) => (
            <span
              key={i}
              className="size-[13px] rounded-[3px]"
              style={{
                background:
                  v === 0
                    ? "color-mix(in srgb, var(--color-veil) 6%, transparent)"
                    : `color-mix(in srgb, var(--color-emerald) ${20 + (v / 29) * 80}%, transparent)`,
                outline: i === 61 ? "1.5px solid var(--color-gold)" : undefined,
              }}
            />
          ))}
        </div>
      </section>

      <section className="card p-4">
        <SectionTitle className="mb-1">سجل الصلوات (آخر 62 يومًا)</SectionTitle>
        <div className="mb-2 flex items-center gap-3 text-[10px] text-ink-faint">
          <LegendDot color="var(--color-gold)" label="مسجد" />
          <LegendDot color="var(--color-teal)" label="بيت" />
          <LegendDot color="var(--color-critical)" label="فائتة" />
        </div>
        <div className="flex flex-col gap-2">
          {PER_PRAYER.map((p) => {
            const total = p.masjid + p.home + p.missed;
            return (
              <div key={p.label} className="flex items-center gap-2">
                <span className="w-14 text-[12px] font-semibold text-ink-dim">{p.label}</span>
                <div className="flex h-3 flex-1 overflow-hidden rounded-full">
                  <span style={{ width: `${(p.masjid / total) * 100}%`, background: "var(--color-gold)" }} />
                  <span style={{ width: `${(p.home / total) * 100}%`, background: "var(--color-teal)" }} />
                  <span style={{ width: `${(p.missed / total) * 100}%`, background: "var(--color-critical)" }} />
                </div>
                <span className="tnum w-8 text-end text-[11px] font-bold text-ink-dim">
                  {p.masjid + p.home}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card grid grid-cols-4 divide-x divide-border-soft/40 p-3 text-center [direction:ltr]">
        {[
          { icon: <Star className="size-4 text-gold" />, v: "1240", l: "النقاط" },
          { icon: <Check className="size-4 text-emerald" />, v: "62", l: "يومًا" },
          { icon: <Flame className="size-4 text-urgent" />, v: "8", l: "أيام كاملة" },
          { icon: <Trophy className="size-4 text-gold" />, v: "27", l: "أفضل يوم" },
        ].map((s) => (
          <div key={s.l} className="flex flex-col items-center gap-0.5 [direction:rtl]">
            {s.icon}
            <span className="tnum text-lg font-extrabold text-ink">{s.v}</span>
            <span className="text-[10px] text-ink-faint">{s.l}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/* ── الإعدادات — theme gallery + font size + sections + about ───────────── */

function SettingsTab() {
  const active = (document.documentElement.dataset.theme ?? "night") as (typeof THEME_IDS)[number];
  return (
    <>
      <SectionTitle>المظهر</SectionTitle>
      <section className="grid grid-cols-2 gap-2">
        {THEME_IDS.map((id) => (
          <div
            key={id}
            className={
              "card flex flex-col gap-2 p-3 " + (active === id ? "outline outline-2 outline-gold/70" : "")
            }
          >
            <ThemeSwatch id={id} />
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-ink">{THEME_NAMES[id]}</span>
              {active === id && <Check className="size-4 text-gold" />}
            </div>
          </div>
        ))}
      </section>

      <SectionTitle className="mt-1">حجم الخط</SectionTitle>
      <section className="card flex gap-1 p-1.5">
        {["عادي", "كبير", "أكبر"].map((s, i) => (
          <span
            key={s}
            className={
              "flex-1 rounded-xl py-2 text-center text-[13px] font-semibold " +
              (i === 0 ? "bg-gold/15 text-gold" : "text-ink-dim")
            }
          >
            {s}
          </span>
        ))}
      </section>

      {["المزايا الإضافية", "التنبيهات والمنبّهات", "مدة الإقامة"].map((t) => (
        <section key={t} className="card flex items-center justify-between px-3.5 py-3">
          <span className="text-[14px] font-bold text-ink">{t}</span>
          <ChevronLeft className="size-4 text-ink-faint" />
        </section>
      ))}

      <section className="card flex items-center justify-between px-3.5 py-3">
        <span className="text-[13px] text-ink-dim">الإصدار</span>
        <span className="tnum text-[13px] font-bold text-ink">2.0.0</span>
      </section>
    </>
  );
}

/** Mini scene+card+accents preview inside a theme gallery card. */
function ThemeSwatch({ id }: { id: (typeof THEME_IDS)[number] }) {
  const scenes: Record<string, { bg: string; card: string; border: string; dots: string[] }> = {
    night: {
      bg: "linear-gradient(160deg,#06231f,#04181a)",
      card: "rgba(14,58,54,0.7)",
      border: "rgba(22,80,74,0.8)",
      dots: ["#f5c451", "#2dd4bf", "#34d399"],
    },
    kashi: {
      bg: "linear-gradient(160deg,#0b1533,#060d24)",
      card: "rgba(22,41,92,0.7)",
      border: "rgba(35,64,124,0.8)",
      dots: ["#e0a458", "#45d5c8", "#3ddc97"],
    },
    glass: {
      bg: "linear-gradient(160deg,#eef4f9,#d6e3ee)",
      card: "rgba(255,255,255,0.6)",
      border: "rgba(255,255,255,0.9)",
      dots: ["#b97b12", "#0d9488", "#059669"],
    },
    material: {
      bg: "#f4f8f6",
      card: "#ffffff",
      border: "#e0e9e6",
      dots: ["#7a5900", "#00696b", "#1b6b50"],
    },
    contrast: {
      bg: "#000000",
      card: "#0d0d0d",
      border: "#6e807c",
      dots: ["#ffd54a", "#5eead4", "#6ee7b7"],
    },
  };
  const s = scenes[id];
  return (
    <div className="h-16 overflow-hidden rounded-xl p-2" style={{ background: s.bg }}>
      <div
        className="flex h-full flex-col justify-between rounded-lg p-1.5"
        style={{ background: s.card, border: `1px solid ${s.border}` }}
      >
        <span className="block h-1.5 w-1/2 rounded-full" style={{ background: s.dots[0] }} />
        <span className="flex gap-1">
          {s.dots.map((d) => (
            <span key={d} className="size-2 rounded-full" style={{ background: d }} />
          ))}
        </span>
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={"text-[13px] font-bold text-ink-dim " + className}>{children}</h2>
  );
}
