// Sheet mocks: 5 — the adhkar reader (tap-to-count), 6 — the stats/records
// panel. Rendered over a dimmed Variant 1 background.

import { Check, ChevronLeft, Circle, Flame, Lock, Star, Trophy } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { cn } from "@/lib/utils";
import { SCORE, WEEK } from "./mock";
import { SheetShell, SKY, TEAL } from "./shared";
import { Variant3 } from "./variants";

/* ── 5 · Adhkar reader ──────────────────────────────────────────────────── */

const DONE_DHIKR = ["أَسْتَغْفِرُ الله ×3", "اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَام…"];
const UPCOMING_DHIKR = [
  "الْحَمْدُ لِلَّهِ ×33",
  "اللهُ أَكْبَرُ ×33",
  "لَا إِلَهَ إِلَّا اللهُ وَحْدَهُ لَا شَرِيكَ لَهُ… ×1",
  "آيَةُ الكُرْسِيِّ ×1",
  "المُعَوِّذَات ×1",
];

export function AdhkarSheet() {
  return (
    <>
      <div className="pointer-events-none opacity-60" aria-hidden="true">
        <Variant3 />
      </div>
      <SheetShell
        title="أذكار بعد الصلاة · العصر"
        badge={<span className="tnum rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-bold text-teal">2/7</span>}
      >
        <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-veil/[0.08]">
          <div className="h-full rounded-full" style={{ width: "29%", background: TEAL }} />
        </div>

        <div className="mb-2 flex flex-col gap-1">
          {DONE_DHIKR.map((d) => (
            <div key={d} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-[13px] text-ink-faint">
              <Check className="size-3.5 shrink-0 text-teal" />
              <span className="truncate font-serif-ar">{d}</span>
            </div>
          ))}
        </div>

        {/* current dhikr — the whole card is the tap target */}
        <button
          type="button"
          className="mb-2 flex w-full flex-col items-center gap-3 rounded-2xl border border-teal/40 bg-teal/[0.06] p-4"
        >
          <span className="font-serif-ar text-2xl leading-relaxed text-ink">سُبْحَانَ اللَّهِ</span>
          <ProgressRing progress={12 / 33} size={88} stroke={6} color={TEAL}>
            <span className="flex flex-col items-center leading-none">
              <span className="tnum text-2xl font-extrabold text-teal">12</span>
              <span className="tnum text-[11px] text-ink-dim">/33</span>
            </span>
          </ProgressRing>
          <span className="text-[11px] leading-none text-ink-faint">اضغط في أي مكان للعدّ</span>
        </button>

        <div className="flex flex-col gap-1">
          {UPCOMING_DHIKR.map((d) => (
            <div key={d} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-[13px] text-ink-dim opacity-70">
              <span className="size-1.5 shrink-0 rounded-full bg-veil/25" />
              <span className="truncate font-serif-ar">{d}</span>
            </div>
          ))}
        </div>

        <p className="mt-3 flex items-center justify-center gap-1 text-[11px] font-semibold text-gold">
          <Star className="size-3.5" fill="currentColor" />
          +1 نقطة عند إتمام الأذكار
        </p>
      </SheetShell>
    </>
  );
}

/* ── 6 · Stats / records panel ──────────────────────────────────────────── */

const BREAKDOWN = [
  { label: "الفرائض", got: 5, max: 15, color: "var(--color-gold)" },
  { label: "الرواتب", got: 2, max: 5, color: SKY },
  { label: "الأذكار", got: 3, max: 7, color: "var(--color-teal)" },
  { label: "الضحى والقيام", got: 1, max: 2, color: "var(--color-amber)" },
];

export function StatsSheet() {
  const max = Math.max(...WEEK.values);
  return (
    <>
      <div className="pointer-events-none opacity-60" aria-hidden="true">
        <Variant3 />
      </div>
      <SheetShell title="سجل العبادة">
        <div className="mb-4 flex items-center justify-around">
          <ProgressRing progress={SCORE.today / SCORE.max} size={104} stroke={8} color="var(--color-gold)">
            <span className="flex flex-col items-center leading-none">
              <span className="tnum text-3xl font-extrabold text-gold">{SCORE.today}</span>
              <span className="tnum text-[11px] text-ink-dim">من {SCORE.max}</span>
            </span>
          </ProgressRing>
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-bold text-urgent">
              <Flame className="size-4" />
              <span className="tnum">{SCORE.streak}</span> أيام متتالية
            </span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-ink-dim">
              <Trophy className="size-4 text-gold" />
              أفضل يوم: <span className="tnum text-ink">{SCORE.best}</span>
            </span>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-2">
          {BREAKDOWN.map((b) => (
            <div key={b.label} className="flex items-center gap-2 text-[12px] font-semibold leading-none">
              <span className="w-24 shrink-0 text-ink-dim">{b.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-veil/[0.08]">
                <div className="h-full rounded-full" style={{ width: `${(b.got / b.max) * 100}%`, background: b.color }} />
              </div>
              <span className="tnum w-9 text-end" style={{ color: b.color }}>
                {b.got}/{b.max}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-end justify-between gap-1.5 px-1" style={{ height: 72 }}>
          {WEEK.values.map((v, i) => {
            const today = i === WEEK.values.length - 1;
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-1 self-end">
                <div
                  className={cn("w-full rounded-t", today ? "bg-gold" : "bg-teal/40")}
                  style={{ height: Math.max(6, (v / max) * 54) }}
                />
                <span className={cn("text-[10px] leading-none", today ? "font-bold text-gold" : "text-ink-faint")}>
                  {WEEK.days[i]}
                </span>
              </div>
            );
          })}
        </div>
      </SheetShell>
    </>
  );
}

/* ── 7 · Rawatib detail sheet (opened from the bottom-right corner ring) ── */

const RAWATIB_ROWS = [
  { label: "قبل الفجر", rakaat: 2, state: "done" as const },
  { label: "قبل الظهر", rakaat: 4, state: "done" as const },
  { label: "بعد الظهر", rakaat: 2, state: "open" as const },
  { label: "بعد المغرب", rakaat: 2, state: "locked" as const },
  { label: "بعد العشاء", rakaat: 2, state: "locked" as const },
];

export function RawatibSheet() {
  return (
    <>
      <div className="pointer-events-none opacity-60" aria-hidden="true">
        <Variant3 />
      </div>
      <SheetShell
        title="السنن الرواتب"
        badge={
          <span className="tnum rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: SKY, background: "rgba(56,189,248,0.12)" }}>
            6/12 ركعة
          </span>
        }
      >
        <div className="flex flex-col gap-1.5">
          {RAWATIB_ROWS.map((r) => (
            <button
              key={r.label}
              type="button"
              disabled={r.state === "locked"}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start",
                r.state === "done" && "border-transparent bg-veil/[0.05]",
                r.state === "open" && "border-dashed border-warning/50 bg-veil/[0.02]",
                r.state === "locked" && "border-border-soft/50 bg-veil/[0.01] opacity-45",
              )}
            >
              {r.state === "done" ? (
                <Check className="size-5 shrink-0" style={{ color: SKY }} />
              ) : r.state === "open" ? (
                <Circle className="size-5 shrink-0 text-warning/70" />
              ) : (
                <Lock className="size-4 shrink-0 text-ink-faint" />
              )}
              <span className={cn("flex-1 text-[15px] font-semibold", r.state === "done" ? "text-ink" : "text-ink-dim")}>
                {r.label}
              </span>
              <span className="tnum rounded-full bg-veil/5 px-2 py-0.5 text-[11px] font-bold text-ink-dim">
                {r.rakaat} ركعة
              </span>
              {r.state === "done" && (
                <span className="tnum text-[11px] font-bold" style={{ color: SKY }}>+1</span>
              )}
            </button>
          ))}
        </div>
        <p className="mt-3 flex items-center justify-center gap-1 text-[11px] font-semibold text-ink-dim">
          <Star className="size-3.5 text-gold" fill="var(--color-gold)" />
          +1 نقطة لكل موضع · تُفتح المواضع بعد أذان صلاتها
        </p>
      </SheetShell>
    </>
  );
}

/* ── 8 · Adhkar checklist sheet (opened from the bottom-left corner ring) ─ */

const ADHKAR_ROWS = [
  { label: "أذكار الصباح", note: "من الفجر إلى العصر", state: "done" as const },
  { label: "أذكار المساء", note: "من العصر إلى الفجر", state: "open" as const },
  { label: "بعد الفجر", note: null, state: "done" as const },
  { label: "بعد الظهر", note: null, state: "done" as const },
  { label: "بعد العصر", note: null, state: "open" as const },
  { label: "بعد المغرب", note: null, state: "locked" as const },
  { label: "بعد العشاء", note: null, state: "locked" as const },
];

export function AdhkarChecklistSheet() {
  return (
    <>
      <div className="pointer-events-none opacity-60" aria-hidden="true">
        <Variant3 />
      </div>
      <SheetShell
        title="أذكار اليوم"
        badge={<span className="tnum rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-bold text-teal">3/7</span>}
      >
        <div className="flex flex-col gap-1.5">
          {ADHKAR_ROWS.map((r, i) => (
            <button
              key={r.label}
              type="button"
              disabled={r.state === "locked"}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-start",
                i === 2 && "mt-1.5", // visual group break: daily pair vs after-prayer five
                r.state === "done" && "border-transparent bg-veil/[0.05]",
                r.state === "open" && "border-teal/40 bg-teal/[0.04]",
                r.state === "locked" && "border-border-soft/50 bg-veil/[0.01] opacity-45",
              )}
            >
              {r.state === "done" ? (
                <Check className="size-5 shrink-0 text-teal" />
              ) : r.state === "open" ? (
                <Circle className="size-5 shrink-0 text-teal/70" />
              ) : (
                <Lock className="size-4 shrink-0 text-ink-faint" />
              )}
              <span className="flex flex-1 flex-col items-start gap-0.5">
                <span className={cn("text-[15px] font-semibold leading-none", r.state === "done" ? "text-ink" : "text-ink-dim")}>
                  {r.label}
                </span>
                {r.note && <span className="text-[10.5px] leading-none text-ink-faint">{r.note}</span>}
              </span>
              {r.state === "done" ? (
                <span className="tnum text-[11px] font-bold text-teal">+1</span>
              ) : r.state === "open" ? (
                <span className="flex items-center gap-0.5 text-[11px] font-bold text-teal">
                  ابدأ
                  <ChevronLeft className="size-3.5" />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </SheetShell>
    </>
  );
}
