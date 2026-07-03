// Shared building blocks for the DEV-only design preview. Deliberately mock —
// hardcoded Arabic strings + frozen data — these exist only to compare layout
// options; the real implementation follows the picked design.

import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  BookOpenText,
  Check as CheckIcon,
  ChevronDown,
  Flame,
  Home,
  MoonStar,
  Settings2,
  Sparkles,
  Star,
  SunMedium,
  X,
} from "lucide-react";
import { MosqueIcon } from "@/components/ui/MosqueIcon";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { SatelliteRing } from "@/components/SatelliteRing";
import { IqamaBar } from "@/components/IqamaBar";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { proximityStyle } from "@/components/ui/proximity";
import { cn } from "@/lib/utils";
import {
  ADHKAR,
  DUHA,
  HERO,
  IQAMA,
  NOW,
  PRAYERS,
  QIYAM,
  RAWATIB,
  SCORE,
  type CheckinState,
  type MockPrayer,
} from "./mock";

export const SKY = "#38bdf8"; // rawatib accent (proposed new token)
export const TEAL = "var(--color-teal)"; // adhkar accent

/* ── Check-in tones ─────────────────────────────────────────────────────── */

interface Tone {
  icon: ElementType;
  /** Tooltip text shown transiently on tap (label + points). */
  tooltip: string;
  cls: string;
}

export const TONES: Record<Exclude<CheckinState, null>, Tone> = {
  masjid: { icon: MosqueIcon, tooltip: "في المسجد +3", cls: "border-gold/60 bg-gold/10 text-gold" },
  home: { icon: Home, tooltip: "في البيت +2", cls: "border-teal/60 bg-teal/10 text-teal" },
  missed: { icon: X, tooltip: "فائتة −1", cls: "border-critical/50 bg-critical/10 text-critical" },
};

/** Transient tooltip bubble (auto-hides ~2.5s in the real build — static here). */
function MockTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "absolute z-30 whitespace-nowrap rounded-lg border border-border bg-night px-2 py-1",
        "text-[11px] font-bold leading-none text-ink shadow-xl",
        className,
      )}
    >
      {text}
    </span>
  );
}

/** The 3 state choices as icon-only round buttons (hero row + card popover). */
export function CheckinIconTrio({ size = "md" }: { size?: "sm" | "md" }) {
  const btn = size === "md" ? "size-10" : "size-8";
  const icon = size === "md" ? "size-5" : "size-4";
  return (
    <div className={cn("flex items-center justify-center", size === "md" ? "gap-3" : "gap-1.5")}>
      {(["masjid", "home", "missed"] as const).map((k) => {
        const tone = TONES[k];
        const Icon = tone.icon;
        return (
          <button
            key={k}
            type="button"
            aria-label={tone.tooltip}
            className={cn("grid place-items-center rounded-full border", btn, tone.cls)}
          >
            <Icon className={icon} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The after-time check-in icon on a prayer card: colored state icon when
 * marked, subtle hollow circle when unmarked. Static demos: `showPopover`
 * renders the 3-icon popover open, `showTooltip` the transient bubble.
 */
function CheckinIcon({
  state,
  showPopover,
  showTooltip,
}: {
  state: CheckinState;
  showPopover?: boolean;
  showTooltip?: boolean;
}) {
  const tone = state ? TONES[state] : null;
  const Icon = tone?.icon;
  return (
    <span className="relative inline-flex">
      {tone && Icon ? (
        <button
          type="button"
          aria-label={tone.tooltip}
          className={cn("grid size-6 place-items-center rounded-full border", tone.cls)}
        >
          <Icon className="size-3.5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="سجّل الصلاة"
          className="size-6 rounded-full border-2 border-dashed border-warning/60"
        />
      )}
      {showTooltip && tone && (
        <MockTooltip text={tone.tooltip} className="-top-9 left-1/2 -translate-x-1/2" />
      )}
      {showPopover && (
        <span className="card absolute -top-12 left-0 z-30 flex items-center rounded-xl px-1.5 py-1.5">
          <CheckinIconTrio size="sm" />
        </span>
      )}
    </span>
  );
}

/* ── Score pill (opens the stats sheet) ─────────────────────────────────── */

export function ScorePill({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-gold/30 bg-white/[0.04] px-2 py-1 leading-none",
        className,
      )}
    >
      <Star className="size-3.5 text-gold" fill="currentColor" />
      <span className="tnum text-[13px] font-extrabold text-gold">{SCORE.today}</span>
      <span className="h-3 w-px bg-white/15" />
      <Flame className="size-3.5 text-urgent" />
      <span className="tnum text-[13px] font-bold text-urgent">{SCORE.streak}</span>
    </button>
  );
}

/* ── Mock top bar (copy of TopBar with frozen strings) ──────────────────── */

export function MockTopBar() {
  return (
    <header className="card grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 justify-self-start">
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-ink-dim"
        >
          <Settings2 className="size-4" />
        </button>
        <span className="tnum shrink-0 text-2xl font-bold text-ink">3:53 م</span>
      </div>
      <button type="button" className="group flex min-w-0 flex-col items-center justify-self-center rounded-lg px-2 py-1 leading-tight">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-lg font-semibold text-ink">بغداد</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-dim" />
        </span>
      </button>
      <div className="flex min-w-0 flex-col items-center justify-self-end leading-tight">
        <span className="truncate text-base font-bold text-gold">18 محرم 1448</span>
        <span className="truncate text-sm text-ink-dim">3 تموز 2026</span>
      </div>
    </header>
  );
}

/* ── Bottom-corner mini widget (rawatib / adhkar) ───────────────────────── */

interface MiniCornerProps {
  label: string;
  caption: string;
  color: string;
  side: "left" | "right";
  progress: number;
  active?: boolean;
  /** Fully done → solid colour-filled disc + a nice check mark. */
  complete?: boolean;
  children: ReactNode;
  /** distance from the card bottom (px class) — variants tune it */
  bottomClass?: string;
}

export function MiniCorner({ label, caption, color, side, progress, active, complete, children, bottomClass = "bottom-9" }: MiniCornerProps) {
  return (
    <div
      className={cn(
        "absolute z-10 flex w-20 flex-col items-center gap-1.5",
        bottomClass,
        side === "right" ? "right-1" : "left-1",
        !active && !complete && "opacity-60",
      )}
    >
      {/* title on TOP (user note) — same reading order as the top satellites */}
      <span className="text-[11px] font-bold leading-none" style={{ color }}>
        {label}
      </span>
      {complete ? (
        <div
          className="satellite-glow grid size-[58px] place-items-center rounded-full"
          style={{ background: color, "--sat": color } as CSSProperties}
        >
          <CheckIcon className="size-8 text-white" strokeWidth={4} />
        </div>
      ) : (
        <div
          className={cn("grid place-items-center rounded-full", active && "satellite-glow")}
          style={active ? ({ "--sat": color } as CSSProperties) : undefined}
        >
          <ProgressRing progress={progress} size={58} stroke={5} color={active ? color : "rgba(255,255,255,0.2)"}>
            {children}
          </ProgressRing>
        </div>
      )}
      <span className="max-w-20 truncate whitespace-nowrap text-[10px] font-bold leading-none" style={{ color }}>
        {caption}
      </span>
    </div>
  );
}

export function RawatibCorner({ bottomClass }: { bottomClass?: string }) {
  return (
    <MiniCorner
      label="الرواتب"
      caption={RAWATIB.nextLabel}
      color={SKY}
      side="right"
      progress={RAWATIB.done / RAWATIB.total}
      active
      bottomClass={bottomClass}
    >
      <span className="tnum text-[13px] font-extrabold leading-none" style={{ color: SKY }}>
        {RAWATIB.done}/{RAWATIB.total}
      </span>
    </MiniCorner>
  );
}

export function AdhkarCorner({ bottomClass }: { bottomClass?: string }) {
  return (
    <MiniCorner
      label="الأذكار"
      caption={ADHKAR.pendingLabel}
      color={TEAL}
      side="left"
      progress={ADHKAR.progress}
      active
      bottomClass={bottomClass}
    >
      {/* whole-day pair (morning/evening) as text; arc moves per dhikr item */}
      <span className="tnum text-[13px] font-extrabold leading-none" style={{ color: TEAL }}>
        {ADHKAR.dailyDone}/{ADHKAR.dailyTotal}
      </span>
    </MiniCorner>
  );
}

/* ── Mock hero (copy of NextPrayerCountdown with pluggable extras) ──────── */

interface MockHeroProps {
  /** 4 = Duha/Qiyam on top + Rawatib/Adhkar on bottom; 2 = top satellites only. */
  corners: 2 | 4;
  /** Show the contextual check-in row inside the hero (variant 3). */
  checkinRow?: boolean;
  /** Score pill pinned to the hero's top-end corner (variants 1 & 3). */
  scorePill?: boolean;
}

export function MockHero({ corners, checkinRow, scorePill }: MockHeroProps) {
  const style = proximityStyle("safe");
  return (
    <section className="card arabesque relative overflow-hidden p-4 sm:p-5">
      <div
        className="halo-breath pointer-events-none absolute -top-24 left-1/2 h-80 w-80 rounded-full blur-3xl"
        style={{ background: style.ring }}
        aria-hidden="true"
      />

      {scorePill && <ScorePill className="absolute end-2.5 top-2.5 z-20" />}

      {/* nudged down 24px vs the live app so the score pill owns the top corner
          and the satellites align with the ring's upper arc */}
      <div className="pointer-events-none absolute inset-0 translate-y-6" aria-hidden="true">
        {/* Duha shown DONE for the demo: solid amber disc + check ("fully did → fill") */}
        <SatelliteRing icon={SunMedium} label="الضحى" state={DUHA} color="var(--color-amber)" side="right" now={NOW} lang="ar" done />
        <SatelliteRing icon={MoonStar} label="القيام" state={QIYAM} color="var(--color-indigo)" side="left" now={NOW} lang="ar" />
      </div>
      {corners === 4 && (
        <>
          <RawatibCorner bottomClass={checkinRow ? "bottom-[138px]" : "bottom-16"} />
          <AdhkarCorner bottomClass={checkinRow ? "bottom-[138px]" : "bottom-16"} />
        </>
      )}

      <div className="relative flex flex-col items-center gap-2.5">
        <div className="flex items-center justify-center gap-2 text-center">
          <span className={cn("text-base font-semibold", style.text)}>المتبقي للأذان</span>
        </div>

        <ProgressRing progress={HERO.ringProgress} size={192} stroke={10} color={style.ring}>
          <div className="flex h-[58%] flex-col items-center justify-between text-center">
            <span className="text-2xl font-bold leading-none text-gold">{HERO.nextLabel}</span>
            <span className={cn("tnum text-[1.85rem] font-extrabold leading-none tracking-tight", style.text)}>
              {HERO.countdown}
            </span>
            <span className="text-base leading-none text-ink-dim">{HERO.clock}</span>
          </div>
        </ProgressRing>

        {/* Narrower iqama bar when bottom corners exist, so they never collide. */}
        <div className={cn("flex w-full justify-center", corners === 4 && "max-w-[200px] self-center")}>
          <IqamaBar state={IQAMA} now={NOW} />
        </div>

        {checkinRow && (
          <div className="w-full max-w-[280px] rounded-xl border border-border-soft bg-white/[0.03] px-2.5 py-2">
            <p className="mb-2 text-center text-[12px] font-semibold leading-none text-ink-dim">
              أين صلّيت العصر؟
            </p>
            <CheckinIconTrio size="md" />
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Mock prayer grid ───────────────────────────────────────────────────── */

export type GridMode = "plain" | "icon";

function MockCard({ p, mode }: { p: MockPrayer; mode: GridMode }) {
  const style = proximityStyle("safe");
  // Check-in icon shows only for fard prayers whose adhan already passed.
  const showIcon = mode === "icon" && p.checkin !== undefined && p.passed;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-5 transition-colors",
        p.isNext
          ? cn("breath-glow border-transparent bg-white/[0.06]", style.border)
          : "border-border-soft/60 bg-white/[0.02]",
        p.passed && !p.isNext && p.checkin === undefined && "opacity-45",
      )}
      style={p.isNext ? ({ "--prox": style.ring } as CSSProperties) : undefined}
    >
      {/* start: name, with the check-in icon right after it (user note) */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("truncate text-lg font-semibold leading-snug", p.isNext ? "text-ink" : "text-ink/90")}>
          {p.label}
        </span>
        {showIcon && (
          <CheckinIcon
            state={p.checkin ?? null}
            showPopover={p.name === "asr"}
            showTooltip={p.name === "fajr"}
          />
        )}
      </div>

      {/* end: time (stacked with countdown when upcoming) */}
      <div className="flex shrink-0 flex-col items-center gap-0.5 leading-tight">
        <span className="tnum text-sm text-ink-dim">{p.time}</span>
        {p.countdown && (
          <span className={cn("tnum text-[0.84rem] font-semibold leading-none", p.isNext ? style.text : "text-ink-dim")}>
            {p.countdown}
          </span>
        )}
      </div>
    </div>
  );
}

export function MockPrayerGrid({ mode }: { mode: GridMode }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PRAYERS.map((p) => (
        <MockCard key={p.name} p={p} mode={mode} />
      ))}
    </div>
  );
}

/* ── Mock next-event card ───────────────────────────────────────────────── */

export function MockNextEvent() {
  return (
    <section className="card grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-3">
      <span className="justify-self-start text-sm text-ink-dim">الحدث القادم</span>
      <span className="justify-self-center text-base font-bold text-gold">المولد النبوي</span>
      <div className="flex flex-col items-center justify-self-end leading-tight">
        <span className="tnum text-sm font-semibold text-ink">12 ربيع الأول</span>
        <span className="tnum rounded-full bg-white/5 px-2 text-[11px] text-ink-dim">بعد 52 يوم</span>
      </div>
    </section>
  );
}

/* ── V2: day strip · V4: tracker card (kept for reference variants) ─────── */

const DOT_STATE: Record<string, string> = {
  masjid: "border-gold/60 bg-gold/15 text-gold",
  home: "border-teal/60 bg-teal/15 text-teal",
  missed: "border-critical/50 bg-critical/15 text-critical",
  action: "border-dashed border-warning/70 text-warning",
  future: "border-border-soft text-ink-faint",
};

function dotState(p: MockPrayer): string {
  if (p.checkin) return DOT_STATE[p.checkin];
  if (p.checkin === null) return DOT_STATE.action;
  return DOT_STATE.future;
}

export function DayStrip({ popover }: { popover?: boolean }) {
  const fard = PRAYERS.filter((p) => p.name !== "sunrise");
  return (
    <section className="card relative flex items-center gap-1.5 px-3 py-2">
      <div className="flex items-center gap-1">
        {fard.map((p) => {
          const Icon = PRAYER_ICONS[p.name];
          return (
            <span key={p.name} className="relative">
              <button
                type="button"
                aria-label={p.label}
                className={cn("grid size-7 place-items-center rounded-full border", dotState(p))}
              >
                <Icon className="size-3.5" />
              </button>
              {popover && p.name === "asr" && (
                <span className="card absolute -top-12 left-0 z-20 flex items-center rounded-xl px-1.5 py-1.5">
                  <CheckinIconTrio size="sm" />
                </span>
              )}
            </span>
          );
        })}
      </div>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-white/10" />
      <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color: SKY }}>
        <Sparkles className="size-3.5" />
        <span className="tnum">{RAWATIB.done}/{RAWATIB.total}</span>
      </span>
      <span className="flex items-center gap-1 text-[11px] font-bold text-teal">
        <BookOpenText className="size-3.5" />
        <span className="tnum">{ADHKAR.done}/{ADHKAR.total}</span>
      </span>
      <ScorePill className="ms-auto border-0 bg-transparent px-0" />
    </section>
  );
}

export function TrackerCard() {
  const fard = PRAYERS.filter((p) => p.name !== "sunrise");
  return (
    <section className="card flex flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gold">إنجاز اليوم</span>
        <ScorePill />
      </div>
      <div className="flex gap-1">
        {fard.map((p) => {
          const Icon = PRAYER_ICONS[p.name];
          return (
            <button
              key={p.name}
              type="button"
              className={cn("flex h-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border leading-none", dotState(p))}
            >
              <Icon className="size-4" />
              <span className="text-[9.5px] font-semibold">{p.checkin === null ? "سجّل" : p.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-[11px] font-bold leading-none">
        <span className="flex items-center gap-1" style={{ color: SKY }}>
          <Sparkles className="size-3.5" />
          الرواتب
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full" style={{ width: `${(RAWATIB.done / RAWATIB.total) * 100}%`, background: SKY }} />
        </div>
        <span className="tnum" style={{ color: SKY }}>{RAWATIB.done}/{RAWATIB.total}</span>
        <span className="mx-0.5 h-4 w-px bg-white/10" />
        <span className="flex items-center gap-1 text-teal">
          <BookOpenText className="size-3.5" />
          <span className="tnum">{ADHKAR.done}/{ADHKAR.total}</span>
        </span>
        <span className="flex items-center gap-1 text-amber">
          <SunMedium className="size-3.5" />
          ضحى ✓
        </span>
      </div>
    </section>
  );
}

/* ── Bottom-sheet shell (adhkar reader / stats / rawatib / checklist) ───── */

export function SheetShell({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-xl rounded-t-3xl border-x border-t border-border bg-night-2/95 p-4 pb-6 backdrop-blur-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-bold text-gold">{title}</span>
          <div className="flex items-center gap-2">
            {badge}
            <button type="button" aria-label="إغلاق" className="grid size-7 place-items-center rounded-lg bg-white/5 text-ink-dim">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </>
  );
}
