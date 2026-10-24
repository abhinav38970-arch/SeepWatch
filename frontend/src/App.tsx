import { useEffect, useMemo, useState } from "react";
import type { Bundle } from "./types";
import MapView from "./MapView";
import TimelineChart from "./TimelineChart";
import DetailDrawer from "./DetailDrawer";

const PITCH_BLURB: Record<string, string> = {
  A: "Model beats best baseline on held-out years",
  B: "Mixed: wins at ramp / longer horizons",
  C: "Beats SJRRP curve; persistence still wins short-term",
  D: "ML does not beat persistence — transparent balance + shortfall engine",
};

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

/** Interval like "-12 to 8" so a negative lo never looks like "-12-8". */
function fmtRange(lo: number | null | undefined, hi: number | null | undefined, digits = 0): string {
  if (lo == null || hi == null || Number.isNaN(lo) || Number.isNaN(hi)) return "—";
  const a = lo.toFixed(digits);
  const b = hi.toFixed(digits);
  return `${a} to ${b}`;
}

function skillClass(s: number): string {
  if (s > 0.02) return "positive";
  if (s < -0.02) return "negative";
  return "neutral";
}

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    fetch("/api/bundle")
      .then(async (r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      })
      .then((b: Bundle) => setBundle(b))
      .catch((e) => setError(String(e)));
  }, []);

  const shortfallByNode = useMemo(() => {
    const m = new Map<string, Bundle["nodes_shortfall"][0]>();
    bundle?.nodes_shortfall.forEach((n) => m.set(n.node_id, n));
    return m;
  }, [bundle]);

  if (error) {
    return (
      <div className="error">
        Could not load SeepWatch bundle. Run <code>seepwatch-pipeline</code> then{" "}
        <code>seepwatch-api</code>.
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );
  }
  if (!bundle) return <div className="loading">Loading SeepWatch…</div>;

  const h = bundle.headline;
  const worst = h.worst_node_shortfall;
  const skillPct = (h.skill_vs_best_baseline * 100).toFixed(1);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>SeepWatch</h1>
          <div className="sub">
            Canal-loss forecast · SJRRP corridor · as of {bundle.meta.asof} · deployable mode
          </div>
        </div>
        <div className="badges">
          <span className="badge pitch">Pitch {bundle.pitch_scenario}</span>
          <span className="badge measured">labels measured</span>
          <span className="badge modeled">forecast modeled</span>
          <span className="badge schematic">map schematic</span>
        </div>
      </header>

      <section className="headline">
        <div className="metric neutral">
          <div className="label">Forecast excess loss (7d)</div>
          <div className="value">{fmt(h.excess_loss_7d_cfs, 0)} cfs</div>
          <div className="hint">Above recent loss across flagged reaches</div>
        </div>
        <div className={`metric ${ (worst.p50 ?? 0) > 5 ? "negative" : "neutral"}`}>
          <div className="label">Worst-node shortfall (80%)</div>
          <div className="value">{fmtRange(worst.p10, worst.p90, 0)} cfs</div>
          <div className="hint">
            {worst.name ?? "—"} · median {fmt(worst.p50, 0)} vs expected arrival
          </div>
        </div>
        <div className={`metric ${skillClass(h.skill_vs_best_baseline)}`}>
          <div className="label">Skill vs {h.best_baseline}</div>
          <div className="value">{skillPct}%</div>
          <div className="hint">{PITCH_BLURB[bundle.pitch_scenario] ?? bundle.pitch_key}</div>
        </div>
      </section>

      <div className="main">
        <div className="map-wrap">
          <MapView
            bundle={bundle}
            shortfallByNode={shortfallByNode}
            selected={selected}
            onSelectReach={(id) => {
              setSelected(id);
              setDrawerOpen(true);
            }}
            onSelectNode={(id) => {
              setSelected(id);
              setDrawerOpen(true);
            }}
          />
          <div className="map-legend">
            <div className="legend-row"><span className="swatch" style={{ background: "#f07178" }} /> High excess loss</div>
            <div className="legend-row"><span className="swatch" style={{ background: "#f0b429" }} /> Elevated</div>
            <div className="legend-row"><span className="swatch" style={{ background: "#3dd6c6" }} /> Near normal</div>
            <div className="legend-row"><span className="swatch" style={{ background: "#475569" }} /> No forecast / flood</div>
            <div className="legend-row"><span className="dot" style={{ background: "#c084fc" }} /> Node shortfall</div>
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <h2>Watchlist · top reaches</h2>
            {bundle.watchlist.map((w, i) => (
              <div
                key={w.reach_id}
                className={`watch-item ${w.anomaly ? "flagged" : ""} ${selected === w.reach_id ? "active" : ""}`}
                onClick={() => {
                  setSelected(w.reach_id);
                  setDrawerOpen(true);
                }}
              >
                <div className="watch-rank">{i + 1}</div>
                <div>
                  <div className="watch-title">{w.reach_id}</div>
                  <div className="watch-meta">
                    {w.label.replaceAll("_", " ")}
                    {w.anomaly ? " · flagged" : ""}
                  </div>
                </div>
                <div className="watch-val">
                  <div className="big">{fmt(w.forecast_loss_cfs, 0)} cfs</div>
                  <div className="small">excess {fmt(w.excess_loss_cfs, 1)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>Reach 2A · loss &amp; anomaly band</h2>
            <div className="chart-wrap">
              <TimelineChart data={bundle.timeline} />
            </div>
            <div className="chart-note">
              Shaded band = model q10–q90. Red marks = anomaly flags. Flood days excluded from training.
            </div>
          </div>

          <div className="panel" style={{ overflow: "auto" }}>
            <h2>Templated alerts</h2>
            {bundle.alerts.length === 0 && <div className="watch-meta">No alerts for this as-of date.</div>}
            {bundle.alerts.map((a, i) => (
              <div className="alert" key={i}>{a}</div>
            ))}
            <button
              type="button"
              className="evidence-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelected("evidence");
                setDrawerOpen(true);
              }}
            >
              Open evidence &amp; skill table
            </button>
          </div>
        </aside>
      </div>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="drawer-backdrop"
            aria-label="Close drawer"
            onClick={() => setDrawerOpen(false)}
          />
          <DetailDrawer
            bundle={bundle}
            selected={selected}
            onClose={() => setDrawerOpen(false)}
          />
        </>
      )}
    </div>
  );
}
