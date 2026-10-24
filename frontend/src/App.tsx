import { useEffect, useMemo, useState } from "react";
import type { Bundle } from "./types";
import MapView from "./MapView";
import TimelineChart from "./TimelineChart";
import DetailDrawer from "./DetailDrawer";

const GALLONS_PER_CFS_DAY = 646_317;
const ACRE_FEET_PER_CFS_DAY = 1.9835;

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function gallonsPerDay(cfs: number | null | undefined): string {
  if (cfs == null) return "—";
  return `${fmt(Math.abs(cfs) * GALLONS_PER_CFS_DAY / 1_000_000, 0)} million gal/day`;
}

function openDemo() {
  window.location.hash = "demo";
}

function closeDemo() {
  history.pushState("", document.title, window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function Landing({ bundle }: { bundle: Bundle }) {
  const excess = bundle.headline.excess_loss_7d_cfs;
  const shortfall = bundle.headline.worst_node_shortfall;
  const acreFeetWeek = excess * ACRE_FEET_PER_CFS_DAY * 7;

  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Primary navigation">
        <a className="wordmark" href="#" aria-label="SeepWatch home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SeepWatch</span>
        </a>
        <span className="prototype-tag">Hackathon prototype</span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Water intelligence for the Central Valley</div>
          <h1>Find water loss<br />before it reaches<br /><em>the field.</em></h1>
          <p className="hero-lede">
            SeepWatch compares flow between gauges, learns what “normal” looks like,
            and flags unusual losses early—so water teams know where to look first.
          </p>
          <button type="button" className="primary-cta" onClick={openDemo}>
            View live demo <span aria-hidden="true">→</span>
          </button>
          <p className="cta-note">Interactive SJRRP corridor demonstration · no sign-in</p>
        </div>

        <div className="hero-visual" aria-label="Illustration of monitored water moving through a canal">
          <div className="sun-orbit" />
          <div className="valley-lines" />
          <div className="canal">
            <div className="canal-flow" />
            <span className="sensor sensor-a"><i /> Gauge A</span>
            <span className="sensor sensor-b"><i /> Gauge B</span>
            <span className="leak-pulse"><i /> Unusual loss detected</span>
          </div>
          <div className="visual-card">
            <span>Demonstration signal</span>
            <strong>{fmt(excess)} cubic ft/sec</strong>
            <small>above normal loss · about {gallonsPerDay(excess)}</small>
          </div>
        </div>
      </section>

      <section className="impact" aria-labelledby="impact-title">
        <div className="section-intro">
          <span className="section-number">01</span>
          <div>
            <p className="kicker">Why this matters</p>
            <h2 id="impact-title">Every missing drop has a destination.</h2>
          </div>
          <p>
            A loss between two gauges can mean less water downstream, delayed
            deliveries, and crews searching miles of channel. SeepWatch turns
            existing flow readings into a prioritized field check.
          </p>
        </div>

        <div className="impact-grid">
          <article className="impact-card alert-card">
            <span className="impact-icon">!</span>
            <p>Current demo flag</p>
            <strong>{fmt(excess)}</strong>
            <h3>cubic feet per second above normal</h3>
            <small>Equivalent to roughly {gallonsPerDay(excess)}.</small>
          </article>
          <article className="impact-card">
            <span className="impact-icon">≈</span>
            <p>One week at that rate</p>
            <strong>{fmt(acreFeetWeek)}</strong>
            <h3>acre-feet of water</h3>
            <small>About {fmt(acreFeetWeek * 325_851 / 1_000_000, 0)} million gallons.</small>
          </article>
          <article className="impact-card">
            <span className="impact-icon">↓</span>
            <p>Downstream effect</p>
            <strong>{fmt(shortfall.p50)}</strong>
            <h3>cubic feet per second below expected</h3>
            <small>Median modeled shortfall at {shortfall.name}.</small>
          </article>
        </div>
      </section>

      <section className="how-it-works" aria-labelledby="how-title">
        <div>
          <p className="kicker">Simple by design</p>
          <h2 id="how-title">From flow readings to a field-ready signal.</h2>
        </div>
        <ol>
          <li><span>1</span><div><strong>Measure</strong><p>Compare upstream and downstream gauges after accounting for travel time.</p></div></li>
          <li><span>2</span><div><strong>Learn</strong><p>Forecast each reach’s expected range using historical operating conditions.</p></div></li>
          <li><span>3</span><div><strong>Prioritize</strong><p>Highlight unusual loss and show which downstream locations may be affected.</p></div></li>
        </ol>
      </section>

      <section className="honesty">
        <span className="honesty-icon">✓</span>
        <div>
          <p className="kicker">Built for honest decisions</p>
          <h2>Measured here. Designed to travel.</h2>
          <p>
            Current validation uses public paired-gauge data from the San Joaquin River
            Restoration Program (SJRRP) corridor. We have not validated the model on all
            Central Valley irrigation canals. The demo map is schematic, forecasts and
            downstream effects are modeled, and broader canal use is illustrative until
            a district connects and validates its own gauge data.
          </p>
          <button type="button" className="text-link" onClick={openDemo}>Explore the labeled demo →</button>
        </div>
      </section>

      <footer>
        <span>SeepWatch</span>
        <span>Prototype · Not an operational decision system</span>
      </footer>
    </main>
  );
}

function Demo({ bundle }: { bundle: Bundle }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shortfallByNode = useMemo(() => {
    const values = new Map<string, Bundle["nodes_shortfall"][0]>();
    bundle.nodes_shortfall.forEach((node) => values.set(node.node_id, node));
    return values;
  }, [bundle]);
  const excess = bundle.headline.excess_loss_7d_cfs;
  const worst = bundle.headline.worst_node_shortfall;
  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelected(null);
  };
  const select = (id: string) => {
    setSelected(id);
    setDrawerOpen(true);
  };

  return (
    <main className="demo">
      <header className="demo-header">
        <button type="button" className="back-button" onClick={closeDemo} aria-label="Back to overview">←</button>
        <div className="demo-brand">
          <span className="brand-mark">S</span>
          <div><strong>SeepWatch</strong><small>Live corridor demo</small></div>
        </div>
        <div className="demo-status"><i /> Data through {bundle.meta.asof}</div>
        <button type="button" className="about-button" onClick={closeDemo}>About the problem</button>
      </header>

      <section className="demo-context">
        <div>
          <span className="demo-label">Demonstration · SJRRP corridor</span>
          <h1>Where should the water team look first?</h1>
          <p>Click a route or downstream location for a plain-language analysis.</p>
        </div>
        <div className="demo-metrics">
          <article className="signal">
            <span>Unusual loss signal</span>
            <strong>{fmt(excess)} <small>cubic ft/sec</small></strong>
            <p>≈ {gallonsPerDay(excess)} above expected</p>
          </article>
          <article>
            <span>Most affected location</span>
            <strong>{worst.name}</strong>
            <p>≈ {fmt(worst.p50)} cubic ft/sec below expected</p>
          </article>
          <article>
            <span>Forecast window</span>
            <strong>Next 7 days</strong>
            <p>Modeled range, updated from gauge data</p>
          </article>
        </div>
      </section>

      <div className="demo-workspace">
        <section className="map-panel">
          <div className="map-title">
            <div><span className="kicker">Interactive route view</span><strong>San Joaquin River conveyance corridor</strong></div>
            <span className="schematic-chip">Schematic geometry</span>
          </div>
          <div className="map-wrap">
            <MapView
              bundle={bundle}
              shortfallByNode={shortfallByNode}
              selected={selected}
              onSelectReach={select}
              onSelectNode={select}
            />
            <div className="map-hint">Select a colored route or labeled node</div>
            <div className="map-legend">
              <strong>Route condition</strong>
              <div className="legend-row"><span className="swatch high" /> Unusual loss detected</div>
              <div className="legend-row"><span className="swatch elevated" /> Elevated loss</div>
              <div className="legend-row"><span className="swatch normal" /> Within expected range</div>
              <div className="legend-row"><span className="swatch unavailable" /> No reliable forecast</div>
              <div className="legend-divider" />
              <div className="legend-row"><span className="dot affected" /> Downstream shortfall</div>
            </div>
          </div>
          <div className="map-disclaimer">
            <span>Measured</span> reach balances use SJRRP gauges · <span>Modeled</span> forecasts and downstream effects · map lines are schematic
          </div>
        </section>

        <aside className="analysis-panel">
          <div className="analysis-heading">
            <div><span className="kicker">Priority checks</span><h2>Leak detection watchlist</h2></div>
            <span>{bundle.watchlist.length} routes</span>
          </div>
          <div className="watch-list">
            {bundle.watchlist.map((item, index) => {
              const reach = bundle.reach_colors.find((r) => r.id === item.reach_id);
              const flagged = item.anomaly || item.excess_loss_cfs > 8;
              return (
                <button
                  type="button"
                  key={item.reach_id}
                  className={`watch-card ${flagged ? "flagged" : ""}`}
                  onClick={() => select(item.reach_id)}
                >
                  <span className="watch-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="watch-copy">
                    <strong>{reach?.name.replace(/\s*\(.*/, "") ?? item.reach_id}</strong>
                    <small>{item.label === "measured" ? "Measured gauge balance" : "Context / unexplained balance"}</small>
                  </span>
                  <span className="watch-reading">
                    <strong>{flagged ? `${fmt(Math.max(0, item.excess_loss_cfs))} above normal` : "Within range"}</strong>
                    <small>{flagged ? gallonsPerDay(item.excess_loss_cfs) : "No unusual loss signal"}</small>
                  </span>
                  <span className="watch-arrow">›</span>
                </button>
              );
            })}
          </div>

          <div className="trend-block">
            <div className="trend-title">
              <div><span className="kicker">Selected signal</span><h2>Reach 2A trend</h2></div>
              <div className="trend-key"><i /> observed <i /> expected range</div>
            </div>
            <div className="chart-wrap"><TimelineChart data={bundle.timeline} /></div>
            <p>Red points mark repeated unusual readings. Shading shows the model’s 80% expected range.</p>
          </div>

          <button type="button" className="evidence-row" onClick={() => select("evidence")}>
            <span><strong>How reliable is this?</strong><small>See held-out testing, assumptions, and limitations</small></span>
            <span>View evidence →</span>
          </button>
        </aside>
      </div>

      <div className="demo-honesty">
        <strong>What is real in this demo?</strong>
        <span>SJRRP gauge measurements and held-out evaluation are real. Forecasts are modeled; corridor geometry is schematic. This is not yet validated district-canal data.</span>
      </div>

      {drawerOpen && (
        <>
          <button type="button" className="drawer-backdrop" aria-label="Close analysis" onClick={closeDrawer} />
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

  if (error) return <div className="error"><strong>SeepWatch could not load its data.</strong><span>{error}</span></div>;
  if (!bundle) return <div className="loading"><span className="loading-mark">S</span><span>Loading water intelligence…</span></div>;
  return demoOpen ? <Demo bundle={bundle} /> : <Landing bundle={bundle} />;
}
