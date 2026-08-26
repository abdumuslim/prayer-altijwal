// Top-level error boundary so a render error never shows a white screen.
// Strings are read from the dicts directly (boundary may be outside provider).

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ar } from "@/i18n/strings.ar";
import { en } from "@/i18n/strings.en";
import { recordError } from "@/lib/error-log";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Leave a trace in the local ring buffer (lib/error-log) instead of console
    // noise; the UI is unchanged, this just makes a render crash recoverable off
    // the device.
    recordError({
      kind: "error-boundary",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      extra: { componentStack: info.componentStack },
    });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const isArabic = document.documentElement.lang !== "en";
    const dict = isArabic ? ar : en;

    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card flex max-w-sm flex-col items-center gap-4 p-8 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-imminent/10 text-imminent">
            <AlertTriangle className="size-7" />
          </span>
          <h1 className="text-lg font-bold text-ink">{dict["error.title"]}</h1>
          <p className="text-sm text-ink-dim">{dict["error.boundary"]}</p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-xl bg-gradient-to-r from-emerald-deep to-emerald px-5 py-2.5 text-sm font-semibold text-night-2 transition hover:brightness-110"
          >
            {dict["error.reload"]}
          </button>
        </div>
      </div>
    );
  }
}
