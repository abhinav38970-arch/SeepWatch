import type { Bundle } from "./types";
import { cfsToMgd } from "./plainUnits";
import StorySections from "./StorySections";
import { CountUp, Reveal } from "./useReveal";
import "./landing.css";

function openDemo() {
  window.location.hash = "demo";
}

function CanalFlow() {
  return (
    <svg
      className="lp-flow"
      viewBox="0 0 1000 240"
      role="img"
      aria-label="Water flows from Friant Dam, leaks out of the canal, and reaches Chowchilla farms with less water."
    >
      <defs>
        <linearGradient id="lpWaterIn" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#64d2ff" stopOpacity="0.15" />
          <stop offset="0.35" stopColor="#64d2ff" />
          <stop offset="1" stopColor="#5ac8fa" />
        </linearGradient>
        <linearGradient id="lpWaterOut" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#5ac8fa" stopOpacity="0.75" />
          <stop offset="1" stopColor="#30d158" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="lpLeakGlow">
          <stop offset="0" stopColor="#ff453a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff453a" stopOpacity="0" />
        </radialGradient>
        <filter id="lpBlur" x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <path className="lp-rail" d="M40 100 H500" />
      <path className="lp-rail" d="M540 100 H960" />

      <path d="M40 100 H500" stroke="url(#lpWaterIn)" strokeWidth="10" strokeLinecap="round" fill="none" opacity="0.35" filter="url(#lpBlur)" />
      <path className="lp-water lp-water-in" d="M40 100 H500" stroke="url(#lpWaterIn)" />
      <path d="M540 100 H960" stroke="url(#lpWaterOut)" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.3" filter="url(#lpBlur)" />
      <path className="lp-water lp-water-out" d="M540 100 H960" stroke="url(#lpWaterOut)" />

      <circle cx="520" cy="100" r="64" fill="url(#lpLeakGlow)" className="lp-leak-glow" />
      <circle cx="520" cy="100" r="9" className="lp-ring lp-ring-a" />
      <circle cx="520" cy="100" r="9" className="lp-ring lp-ring-b" />
      <circle cx="520" cy="100" r="6" fill="#ff453a" className="lp-leak-dot" />

      <g className="lp-drops" fill="#ff6a5f">
        <circle cx="514" cy="108" r="3.2" className="lp-drop lp-drop-1" />
        <circle cx="523" cy="108" r="2.6" className="lp-drop lp-drop-2" />
        <circle cx="519" cy="108" r="3.6" className="lp-drop lp-drop-3" />
        <circle cx="527" cy="108" r="2.2" className="lp-drop lp-drop-4" />
      </g>

      <circle cx="40" cy="100" r="5" fill="#fff" />
      <circle cx="960" cy="100" r="5" fill="#fff" />

      <text x="40" y="146" className="lp-label">Friant Dam</text>
      <text x="520" y="222" textAnchor="middle" className="lp-label lp-label-red">Leak</text>
      <text x="960" y="146" textAnchor="end" className="lp-label">Chowchilla farms</text>
    </svg>
  );
}

export default function Landing({ bundle }: { bundle: Bundle }) {
  const wasted = Math.round(cfsToMgd(bundle.headline.excess_loss_7d_cfs) ?? 48);
  const short = Math.round(cfsToMgd(bundle.headline.worst_node_shortfall.p50) ?? 31);

  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="lp-wordmark" href="#" aria-label="SeepWatch home">
          SeepWatch
        </a>
        <button type="button" className="lp-pill" onClick={openDemo}>
          See the map
        </button>
      </header>

      <main className="lp-main lp-hero-screen">
        <h1 className="lp-hero lp-rise" style={{ ["--d" as string]: "0.1s" }}>
          Canals are leaking.
          <span className="lp-dim">Farms feel it first.</span>
        </h1>

        <div className="lp-stats lp-rise" style={{ ["--d" as string]: "0.35s" }}>
          <div className="lp-stat">
            <div className="lp-num lp-num-red">
              <CountUp to={wasted} suffix="M" delay={300} />
            </div>
            <p className="lp-unit">gallons wasted every day</p>
            <p className="lp-note">from one canal stretch</p>
          </div>
          <div className="lp-stat">
            <div className="lp-num lp-num-orange">
              <CountUp to={short} suffix="M" delay={500} />
            </div>
            <p className="lp-unit">gallons short for farms</p>
            <p className="lp-note">at Chowchilla farms</p>
          </div>
        </div>

        <div className="lp-visual lp-rise" style={{ ["--d" as string]: "0.6s" }}>
          <CanalFlow />
        </div>

        <button type="button" className="lp-cta lp-rise" style={{ ["--d" as string]: "0.85s" }} onClick={openDemo}>
          Open the leak map
        </button>

        <div className="lp-scroll lp-rise" style={{ ["--d" as string]: "1.2s" }} aria-hidden="true">
          <span>Scroll</span>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </main>

      <StorySections bundle={bundle} />

      <section className="lp-section lp-final">
        <Reveal as="h2" className="lp-h2 lp-final-h">
          See it on the map.
        </Reveal>
        <Reveal delay={0.15}>
          <button type="button" className="lp-cta" onClick={openDemo}>
            Open the leak map
          </button>
        </Reveal>
      </section>

      <p className="lp-foot">Tested on real San Joaquin River data. Demo map.</p>
    </div>
  );
}
