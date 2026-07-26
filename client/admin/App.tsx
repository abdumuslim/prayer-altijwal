import { useCallback, useEffect, useState } from "react";
import { AdminApiError, api, setUnauthorizedHandler } from "./lib/api";
import { ROUTES, navigate, useRoute, type RouteId } from "./lib/route";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { Masjids } from "./pages/Masjids";
import { Cost } from "./pages/Cost";
import { Push } from "./pages/Push";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";
import { Button, cx } from "./components/ui";

type AuthState = "checking" | "out" | "in";

/** Pages arrive phase by phase; anything unbuilt shows an honest placeholder. */
const NAV: { id: RouteId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "masjids", label: "Masjids" },
  { id: "cost", label: "Cost" },
  { id: "push", label: "Push" },
  { id: "audience", label: "Audience" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
  { id: "play", label: "Play" },
];

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  // Fetched once after login so pages never hard-code the browser-visible
  // Maps Embed key (it is Embed-API-restricted and unmetered, but it still
  // belongs in one place: the server's config).
  const [embedKey, setEmbedKey] = useState<string | null>(null);
  const route = useRoute();

  // Any 401 anywhere drops straight back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setAuth("out"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then(() => !cancelled && setAuth("in"))
      .catch((err) => {
        if (cancelled) return;
        // A network failure is not a logout — but there is nothing to show
        // either, so the login screen is still the right landing place.
        setAuth(err instanceof AdminApiError && err.status === 401 ? "out" : "out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (auth !== "in") return;
    let cancelled = false;
    api
      .overview()
      .then((o) => !cancelled && setEmbedKey(o.embedKey))
      .catch(() => {
        /* the pages that need it degrade to a plain Maps link */
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAuth("out");
    }
  }, []);

  if (auth === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</div>
    );
  }
  if (auth === "out") return <Login onSuccess={() => setAuth("in")} />;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="text-sm font-semibold text-ink">Prayer Admin</span>
          <div className="scroll-x -mx-1 flex-1">
            <nav className="flex gap-1 px-1">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  aria-current={route === item.id ? "page" : undefined}
                  className={cx(
                    "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                    route === item.id
                      ? "bg-surface-2 font-medium text-ink"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <Page route={route} embedKey={embedKey} />
      </main>
    </div>
  );
}

function Page({ route, embedKey }: { route: RouteId; embedKey: string | null }) {
  switch (route) {
    case "overview":
      return <Overview />;
    case "masjids":
      return <Masjids embedKey={embedKey} />;
    case "cost":
      return <Cost />;
    case "push":
      return <Push />;
    case "logs":
      return <Logs />;
    case "settings":
      return <Settings />;
    default:
      return <NotBuiltYet route={route} />;
  }
}

function NotBuiltYet({ route }: { route: RouteId }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <p className="text-sm text-muted">
        The <span className="text-ink">{route}</span> page is not built yet.
      </p>
    </div>
  );
}

// Keeps the nav list and the route union from drifting apart.
if (NAV.length !== ROUTES.length) {
  throw new Error("admin nav is out of sync with ROUTES");
}
