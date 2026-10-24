import { useEffect, useMemo, useRef, useState } from "react";
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
  return `${fmt(Math.abs(cfs) * GALLONS_PER_CFS_DAY / 1_000_000, 0)}M gallons/day`;
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
  const acreFeetDay = excess * ACRE_FEET_PER_CFS_DAY;

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
          <h1>Flag unusual water loss before downstream <em>farm deliveries are affected.</em></h1>
          <p className="hero-lede">
            SeepWatch compares flow between paired gauges, learns the expected range,
            and prioritizes unusual loss signals for field review.
          </p>
          <button type="button" className="primary-cta" onClick={openDemo}>
            View corridor forecast demo <span aria-hidden="true">→</span>
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
            <span className="leak-pulse"><i /> Unusual loss signal</span>
          </div>
          <div className="visual-card">
            <span>Corridor forecast signal</span>
            <strong>{gallonsPerDay(excess)}</strong>
            <small>{fmt(excess)} cubic feet per second (cfs) · {fmt(acreFeetDay)} acre-feet/day</small>
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
            An unusual balance between two gauges may reflect seepage, operations,
            diversions, or gauge error. SeepWatch prioritizes the signal for review
            and estimates potential downstream effects without claiming a confirmed leak.
          </p>
        </div>

        <div className="impact-grid">
          <article className="impact-card alert-card">
            <span className="impact-icon">!</span>
            <p>Reach 2A unusual signal</p>
            <strong>{fmt(excess)} cfs</strong>
            <h3>{gallonsPerDay(excess)} above normal</h3>
            <small>Also about {fmt(acreFeetDay)} acre-feet per day. This is an unusual loss signal, not a confirmed leak.</small>
          </article>
          <article className="impact-card">
            <span className="impact-icon">≈</span>
            <p>Held-out forecast accuracy</p>
            <strong>0.9%</strong>
            <h3>lower error overall vs persistence</h3>
            <small>At days 5–7, error was 7.7%, 8.9%, and 8.9% lower. Held-out 2025–2026 SJRRP corridor evaluation.</small>
          </article>
          <article className="impact-card">
            <span className="impact-icon">↓</span>
            <p>Downstream effect</p>
            <strong>{fmt(shortfall.p50)} cfs</strong>
            <h3>median modeled shortfall at {shortfall.name}</h3>
            <small>Central 80% modeled range: {fmt(shortfall.p10)}–{fmt(shortfall.p90)} cfs.</small>
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
            Restoration Program (SJRRP) corridor—not district canals. Unexplained loss
            can include operations, diversions, seepage, or gauge error. The map is
            schematic, and forecasts and downstream effects are modeled.
          </p>
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
  const returnFocusRef = useRef<HTMLElement | null>(null);
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
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };
  const select = (id: string) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(id);
    setDrawerOpen(true);
  };

  return (
    <main className="demo">
      <header className="demo-header">
        <button type="button" className="back-button" onClick={closeDemo} aria-label="Back to overview">←</button>
        <div className="demo-brand">
          <span className="brand-mark">S</span>
          <div><strong>SeepWatch</strong><small>Corridor forecast demo</small></div>
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
            <strong>{gallonsPerDay(excess)}</strong>
            <p>{fmt(excess)} cfs · {fmt(excess * ACRE_FEET_PER_CFS_DAY)} acre-feet/day above normal</p>
          </article>
          <article>
            <span>Most affected location</span>
            <strong>{worst.name}</strong>
            <p>{fmt(worst.p50)} cfs median shortfall · central 80%: {fmt(worst.p10)}–{fmt(worst.p90)}</p>
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
              <div className="legend-row"><span className="swatch high" /> Priority · unusual loss signal</div>
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
            <div><span className="kicker">Priority checks</span><h2>Unusual loss watchlist</h2></div>
            <span>{bundle.reach_colors.length} routes</span>
          </div>
          <div className="watch-list">
            {bundle.reach_colors.map((reach, index) => {
              const item = bundle.watchlist.find((w) => w.reach_id === reach.id);
              const flagged = reach.status === "flagged";
              const noForecast = reach.status === "no_forecast" || reach.status === "flood_no_forecast";
              const forecast = Math.abs(reach.forecast_loss_cfs ?? item?.forecast_loss_cfs ?? 0);
              const normal = Math.abs(reach.normal_loss_cfs ?? item?.normal_loss_cfs ?? 0);
              const difference = Math.max(0, reach.excess_loss_cfs ?? item?.excess_loss_cfs ?? 0);
              return (
                <button
                  type="button"
                  key={reach.id}
                  className={`watch-card ${flagged ? "flagged" : ""} ${noForecast ? "restrained" : ""}`}
                  onClick={() => select(reach.id)}
                >
                  <span className="watch-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="watch-copy">
                    <strong>{reach.name.replace(/\s*\(.*/, "")} · {reach.id}</strong>
                    <small>{reach.label === "measured" ? "Measured gauge balance" : "Context / unexplained balance"}</small>
                  </span>
                  <span className="watch-reading">
                    <strong>{noForecast ? "No reliable forecast" : flagged ? `Priority · ${fmt(difference)} cfs unusual` : "Within expected range"}</strong>
                    <small>
                      {noForecast
                        ? "Signal is at the gauge noise floor"
                        : flagged
                          ? `Forecast loss ${fmt(forecast)} · normal ${fmt(normal)} · difference ${fmt(difference)} cfs`
                          : "No unusual loss signal"}
                    </small>
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
            <p>Red points mark repeated unusual readings. Shading is the central 80% range—the middle 80 of 100 modeled outcomes.</p>
          </div>

          <button type="button" className="evidence-row" onClick={() => select("evidence")}>
            <span><strong>How reliable is this?</strong><small>See held-out testing, assumptions, and limitations</small></span>
            <span>View evidence →</span>
          </button>
        </aside>
      </div>

      <div className="demo-honesty">
        <strong>What is real in this demo?</strong>
        <span>Validated on the SJRRP corridor—not district canals. Forecasts are modeled and geometry is schematic. Unexplained loss can include operations, diversions, seepage, or gauge error.</span>
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
