// DEV-only design preview: numbered mock screens for the worship-gamification
// feature. Switch with the 1..8 NUMBER KEYS or ?design=N — no on-screen
// switcher (removed by user request so nothing overlaps the layout). Never
// bundled in production (lazy-loaded, DEV-gated in main.tsx).

import { useEffect, useState, type CSSProperties } from "react";
import { AdhkarChecklistSheet, AdhkarSheet, RawatibSheet, StatsSheet } from "./sheets";
import { Variant1, Variant2, Variant3, Variant4 } from "./variants";
import { V2Shell } from "./v2-shell";
import { AlarmOverlay } from "@/components/AlarmOverlay";

const SCREENS = [
  { n: 1, title: "الزوايا الأربع + تسجيل في البطاقات", el: <Variant1 /> },
  { n: 2, title: "شريط اليوم (الهيرو كما هو)", el: <Variant2 /> },
  { n: 3, title: "تسجيل سياقي داخل الهيرو + الزوايا", el: <Variant3 /> },
  { n: 4, title: "بطاقة الإنجاز أسفل القائمة", el: <Variant4 /> },
  { n: 5, title: "قارئ الأذكار (منبثق)", el: <AdhkarSheet /> },
  { n: 6, title: "لوحة السجل والنقاط (منبثق)", el: <StatsSheet /> },
  { n: 7, title: "تفاصيل الرواتب (منبثق)", el: <RawatibSheet /> },
  { n: 8, title: "قائمة الأذكار (منبثق)", el: <AdhkarChecklistSheet /> },
  // v2 redesign (docs/V2_REDESIGN_SPEC.md Phase 2). Key "0" opens 10; "-" opens 11.
  { n: 9, title: "هيكل v2: التبويبات الأربعة", el: <V2Shell /> },
  { n: 10, title: "v2 + معرض المظاهر (وزر T يبدّل)", el: <V2Shell themeChips /> },
  // The real AlarmOverlay under the active theme (T key cycles) — the alarm
  // screen is part of the theme design surface (user request 2026-07-12).
  { n: 11, title: "شاشة المنبّه حسب المظهر", el: <AlarmPreview /> },
];

/** Screen 11: the real AlarmOverlay, dismissible by the real swipe/tap-to-stop.
    Leave & re-enter the screen (any number key, then "-") to ring again. */
function AlarmPreview() {
  const [ringing, setRinging] = useState(true);
  if (!ringing) return <V2Shell />;
  return (
    <AlarmOverlay
      title="أذان المغرب"
      body="بقي 7 دقائق على أذان المغرب في بغداد"
      onStop={() => setRinging(false)}
    />
  );
}

export default function DesignPreview({ initial }: { initial: number }) {
  const [n, setN] = useState(() => (initial >= 1 && initial <= SCREENS.length ? initial : 1));
  const screen = SCREENS[n - 1];

  // Number keys switch screens ("0" → screen 10; kept in the URL for reload/share).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const next = e.key === "0" ? 10 : e.key === "-" ? 11 : Number(e.key);
      if (!Number.isInteger(next) || next < 1 || next > SCREENS.length) return;
      setN(next);
      const url = new URL(window.location.href);
      url.searchParams.set("design", String(next));
      window.history.replaceState(null, "", url);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="breath-driver mx-auto flex min-h-screen w-full max-w-xl flex-col gap-3 px-4 pb-4 pt-3"
      style={{ "--glow-period": "14s" } as CSSProperties}
    >
      {screen.el}
    </div>
  );
}
