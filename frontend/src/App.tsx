import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Bundle } from "./types";
import MapView from "./MapView";
import DetailDrawer from "./DetailDrawer";
import { cfsToMgd, fmtNumber } from "./plainUnits";
import Landing from "./Landing";

function closeDemo() {
  history.pushState("", document.title, window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const DEMO_CANALS: Record<string, { title: string; color: string; word: string }> = {
  R2A: { title: "Madera to Chowchilla", color: "var(--red)", word: "" },
  R1: { title: "Friant to Madera", color: "var(--orange)", word: "Normal" },
  R4A: { title: "Dos Palos to Merced", color: "var(--yellow)", word: "Small" },
  R2B3: { title: "Chowchilla to Dos Palos", color: "var(--green)", word: "OK" },
};
const DEMO_ORDER = ["R2A", "R1", "R4A", "R2B3"];

function Demo({ bundle }: { bundle: Bundle }) {
  const [selected, setSelected] = useState<string | null>(() => {
    const saved = window.sessionStorage.getItem("seepwatch_initial_select");
    if (saved) {
      window.sessionStorage.removeItem("seepwatch_initial_select");
      return saved;
    }
    return null;
  });
  const [drawerOpen, setDrawerOpen] = useState<boolean>(() => selected != null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const shortfallByNode = useMemo(() => {
    const values = new Map<string, Bundle["nodes_shortfall"][0]>();
    bundle.nodes_shortfall.forEach((node) => values.set(node.node_id, node));
    return values;
  }, [bundle]);

  const canals = useMemo(
    () =>
      DEMO_ORDER.map((id) => bundle.reach_colors.find((r) => r.id === id)).filter(
        (r): r is Bundle["reach_colors"][0] => r != null
      ),
    [bundle]
  );

  const wastedMgd = Math.round(cfsToMgd(bundle.headline.excess_loss_7d_cfs) ?? 48);
  const shortMgd = Math.round(cfsToMgd(bundle.headline.worst_node_shortfall.p50) ?? 31);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelected(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  const select = (id: string) => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(id);
    setDrawerOpen(true);
  };

  return (
    <main className="demo">
      <header className="demo-top">
        <button
          type="button"
          className="demo-back"
          onClick={closeDemo}
          aria-label="Back to home"
        >
          ← Back
        </button>
        <span className="demo-wordmark">SeepWatch</span>
        <span aria-hidden="true" />
      </header>

      <section className="demo-stats" aria-label="Today at a glance">
        <div className="stat-chip stat-red">
          <strong>{fmtNumber(wastedMgd)}M</strong>
          <span>gallons wasted a day</span>
        </div>
        <div className="stat-chip stat-orange">
          <strong>{fmtNumber(shortMgd)}M</strong>
          <span>gallons short for farms</span>
        </div>
        <div className="stat-chip stat-plain">
          <strong>{canals.length}</strong>
          <span>canals</span>
        </div>
      </section>

      <div className="demo-grid">
        <section className="demo-map" aria-label="Canal map">
          <MapView
            bundle={bundle}
            shortfallByNode={shortfallByNode}
            selected={selected}
            onSelectReach={select}
            onSelectNode={select}
          />
        </section>

        <aside className="demo-list" aria-label="Canals">
          {canals.map((reach) => {
            const meta = DEMO_CANALS[reach.id];
            const status =
              reach.id === "R2A" ? `${fmtNumber(wastedMgd)}M wasted` : meta.word;
            const isSelected = selected === reach.id;
            return (
              <button
                type="button"
                key={reach.id}
                className={`canal-card${isSelected ? " is-selected" : ""}`}
                style={{ "--c": meta.color } as CSSProperties}
                aria-pressed={isSelected}
                onClick={() => select(reach.id)}
              >
                <i className="canal-dot" aria-hidden="true" />
                <span className="canal-title">{meta.title}</span>
                <strong className="canal-status">{status}</strong>
              </button>
            );
          })}
          <button type="button" className="demo-how" onClick={() => select("evidence")}>
            How we know
          </button>
        </aside>
      </div>

      <footer className="demo-foot">Real San Joaquin River data. Demo map.</footer>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="drawer-backdrop"
            aria-label="Close"
            onClick={closeDrawer}
          />
          <DetailDrawer bundle={bundle} selected={selected} onClose={closeDrawer} />
        </>
      )}
    </main>
  );
}

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(window.location.hash === "#demo");

  useEffect(() => {
    fetch("/api/bundle")
      .then(async (response) => {
        if (!response.ok) throw new Error(`API ${response.status}`);
        return response.json();
      })
      .then((data: Bundle) => setBundle(data))
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    const syncRoute = () => setDemoOpen(window.location.hash === "#demo");
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  if (error) {
    return (
      <div className="error">
        <strong>SeepWatch could not load its canal leak data.</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div className="loading">
        <span className="loading-mark">S</span>
        <span>Loading Central Valley canal leak monitor…</span>
      </div>
    );
  }
  return demoOpen ? <Demo bundle={bundle} /> : <Landing bundle={bundle} />;
}
