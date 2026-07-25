// Add-a-masjid form (docs/DECISIONS.md ADR-014). The pin is always the user's
// CURRENT position — the case this exists for is "I'm standing at a masjid the
// app doesn't list", which needs no map picker and no dragging.
//
// The hint about not copying from Google Maps is load-bearing, not decoration:
// the resident dataset may only hold data we are licensed to keep, and a user's
// own knowledge is. Copying Google's listings into it would poison exactly the
// thing this feature exists to build.

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { contributeMasjid } from "@/lib/api";
import { ApiRequestError } from "@/lib/api";
import { rememberMyMasjid } from "@/lib/my-masjids";

const MAX_NAME = 80;

interface AddMasjidSheetProps {
  lat: number;
  lon: number;
  onClose: () => void;
  /** Called after a successful submission so the list can repaint with it. */
  onAdded: () => void;
}

export function AddMasjidSheet({ lat, lon, onClose, onAdded }: AddMasjidSheetProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length >= 2 && !busy;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await contributeMasjid({ name: trimmed, lat, lon, userLat: lat, userLon: lon });
      rememberMyMasjid(trimmed, lat, lon);
      onAdded();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 429
          ? t("masjid.addLimit")
          : t("masjid.addError"),
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border-soft/60 bg-veil/[0.03] p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-ink">{t("masjid.addTitle")}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("masjid.addCancel")}
          className="press hit-target grid size-7 place-items-center rounded-lg text-ink-faint"
        >
          <X className="size-4" />
        </button>
      </div>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
        placeholder={t("masjid.addName")}
        aria-label={t("masjid.addName")}
        maxLength={MAX_NAME}
        className="w-full rounded-lg border border-border-soft bg-transparent px-3 py-2 text-[13px] text-ink outline-none focus-visible:border-teal"
      />

      <p className="text-[11px] leading-4 text-ink-faint">{t("masjid.addHint")}</p>

      {error && <p className="text-[11px] text-imminent/90">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="press hit-target flex flex-1 items-center justify-center gap-1.5 rounded-full border border-emerald/30 bg-emerald/[0.07] px-3 py-1.5 text-[12px] font-semibold text-emerald transition-colors hover:bg-emerald/[0.12] disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {t("masjid.addSubmit")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="press hit-target flex-1 rounded-full border border-border-soft px-3 py-1.5 text-[12px] font-semibold text-ink-dim"
        >
          {t("masjid.addCancel")}
        </button>
      </div>
    </div>
  );
}
