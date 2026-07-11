// RTL-aware slide-over sheet used by Settings / Search / Notifications.
// Anchors to the inline-end edge (right in LTR, left in RTL) and animates in.

import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function SlideOver({ open, onClose, title, icon, children }: SlideOverProps) {
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
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="animate-overlay-in absolute inset-0 bg-night/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "animate-panel-in relative ms-auto flex h-full w-full max-w-md flex-col",
          "border-s border-border-soft bg-night-2/95 shadow-2xl backdrop-blur-xl",
        )}
        style={{
          // Native edge-to-edge: keep the header/footer clear of the system bars.
          paddingTop: "var(--safe-area-inset-top, 0px)",
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-border-soft/70 px-5 py-4">
          {icon && (
            <span className="grid size-9 place-items-center rounded-xl bg-white/5 text-gold">
              {icon}
            </span>
          )}
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="ms-auto grid size-9 place-items-center rounded-xl text-ink-dim transition-colors hover:bg-white/5 hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="scrollbar-hide flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
