import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api/client";
import { StatusPopover } from "./components/StatusPopover";
import type { SetupStatus } from "./api/types";
import DocumentReview from "./routes/DocumentReview";
import Ingest from "./routes/Ingest";
import Library from "./routes/Library";
import Playground from "./routes/Playground";
import Settings from "./routes/Settings";
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
        <div className="flex w-full items-center justify-between px-10 py-3">
          <Link to="/" className="wordmark text-sm font-semibold">
            ingestlib<span className="text-accent">·</span>studio
          </Link>
          <nav className="flex items-center gap-5">
            {NAV.map((item) => {
              // A stored document is a Library child, so Library stays lit.
              const active =
                location.pathname === item.to ||
                (item.to === "/" && location.pathname.startsWith("/documents"));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`text-sm ${
                    active ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <StatusPopover status={status} />
          </nav>
        </div>
      </header>
      {children}
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
          <Route path="/documents/:docId" element={<DocumentReview />} />
          <Route path="/try" element={<TryIt />} />
          <Route path="/ingest" element={<Ingest />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/setup" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
