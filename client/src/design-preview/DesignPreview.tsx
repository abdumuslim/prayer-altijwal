// DEV-only design preview: numbered mock screens for the worship-gamification
// feature. Switch with the 1..8 NUMBER KEYS or ?design=N — no on-screen
// switcher (removed by user request so nothing overlaps the layout). Never
// bundled in production (lazy-loaded, DEV-gated in main.tsx).

import { useEffect, useState, type CSSProperties } from "react";
import { AdhkarChecklistSheet, AdhkarSheet, RawatibSheet, StatsSheet } from "./sheets";
import { Variant1, Variant2, Variant3, Variant4 } from "./variants";

const SCREENS = [
  { n: 1, title: "الزوايا الأربع + تسجيل في البطاقات", el: <Variant1 /> },
  { n: 2, title: "شريط اليوم (الهيرو كما هو)", el: <Variant2 /> },
  { n: 3, title: "تسجيل سياقي داخل الهيرو + الزوايا", el: <Variant3 /> },
  { n: 4, title: "بطاقة الإنجاز أسفل القائمة", el: <Variant4 /> },
  { n: 5, title: "قارئ الأذكار (منبثق)", el: <AdhkarSheet /> },
  { n: 6, title: "لوحة السجل والنقاط (منبثق)", el: <StatsSheet /> },
  { n: 7, title: "تفاصيل الرواتب (منبثق)", el: <RawatibSheet /> },
  { n: 8, title: "قائمة الأذكار (منبثق)", el: <AdhkarChecklistSheet /> },
];

export default function DesignPreview({ initial }: { initial: number }) {
  const [n, setN] = useState(() => (initial >= 1 && initial <= SCREENS.length ? initial : 1));
  const screen = SCREENS[n - 1];

  // Number keys 1..8 switch screens (kept in the URL for reload/share).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const next = Number(e.key);
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
