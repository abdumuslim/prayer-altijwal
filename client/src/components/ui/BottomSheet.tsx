// Bottom sheet for the worship tracker (rawatib / adhkar checklist / reader /
// stats). Same dialog behaviors as SlideOver (Escape closes, body scroll-lock,
// overlay click) in a bottom-anchored, rounded-top shell that matches the
// design-preview mock. SlideOver stays the side panel for Settings/Search.

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Small end-side chip next to the close button (e.g. a progress badge). */
  badge?: ReactNode;
  children: ReactNode;
}

export function BottomSheet({ open, onClose, title, badge, children }: BottomSheetProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="animate-overlay-in absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-panel-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-3xl border-x border-t border-border bg-night-2/95 backdrop-blur-xl"
        style={{
          // Native edge-to-edge: keep the sheet content above the gesture bar.
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="mx-auto mt-4 h-1 w-10 shrink-0 rounded-full bg-white/20" />
        <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-3">
          <span className="text-base font-bold text-gold">{title}</span>
          <div className="flex items-center gap-2">
            {badge}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="grid size-7 place-items-center rounded-lg bg-white/5 text-ink-dim transition-colors hover:bg-white/10 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-4 pb-6">{children}</div>
      </div>
    </div>
  );
}
