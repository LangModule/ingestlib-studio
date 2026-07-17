import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api/client";
import { BrandArt } from "./components/BrandArt";
import { StatusPopover } from "./components/StatusPopover";
import type { SetupStatus } from "./api/types";
import Library from "./routes/Library";
import Setup from "./routes/Setup";
import TryIt from "./routes/TryIt";

const NAV = [
  { to: "/", label: "Library" },
  { to: "/try", label: "Try it" },
  { to: "/ingest", label: "Ingest" },
  { to: "/playground", label: "Playground" },
  { to: "/settings", label: "Settings" },
];

function Shell({ status, children }: { status: SetupStatus; children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="wordmark text-sm font-semibold">
            ingestlib<span className="text-accent">·</span>studio
          </Link>
          <nav className="flex items-center gap-5">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`text-sm ${
                  location.pathname === item.to
                    ? "font-semibold text-ink"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <StatusPopover status={status} />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 text-center">
      <BrandArt />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-ink-soft">Coming in a later slice.</p>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.status().then(setStatus).catch((exc) => setError(String(exc)));
    // Keep the status dot honest: repoll the cheap local checks. Failures are
    // ignored so a transient hiccup cannot blank the whole app.
    const timer = setInterval(() => {
      api.status().then(setStatus).catch(() => undefined);
    }, 20_000);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div className="p-16 text-center text-sm text-fail">Backend unreachable: {error}</div>
    );
  }
  if (!status) return null;

  // Until setup completes, every path leads to the wizard. Finishing the
  // wizard reloads the page, so this component boots again with fresh status.
  if (!status.configured) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Shell status={status}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/try" element={<TryIt />} />
          <Route path="/ingest" element={<Placeholder title="Ingest" />} />
          <Route path="/playground" element={<Placeholder title="Playground" />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
          <Route path="/setup" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
