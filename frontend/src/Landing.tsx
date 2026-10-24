import { useEffect, useRef, useState } from "react";
import type { Bundle } from "./types";
import { cfsToMgd } from "./plainUnits";
import "./landing.css";

function openDemo() {
  window.location.hash = "demo";
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function CountUp({ to, reduced, delay = 0 }: { to: number; reduced: boolean; delay?: number }) {
  const [value, setValue] = useState(reduced ? to : 0);
  const raf = useRef(0);

  useEffect(() => {
    if (reduced) {
      setValue(to);
      return;
    }
    const duration = 1600;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, Math.max(0, (t - start - delay) / duration));
      setValue(Math.round(to * (1 - Math.pow(1 - p, 4))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, reduced, delay]);

  return (
    <>
      {value}
      <span className="lp-m">M</span>
    </>
  );
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
  const reduced = usePrefersReducedMotion();
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

      <main className="lp-main">
        <h1 className="lp-hero lp-rise" style={{ ["--d" as string]: "0.1s" }}>
          Canals are leaking.
          <span className="lp-dim">Farms feel it first.</span>
        </h1>

        <div className="lp-stats lp-rise" style={{ ["--d" as string]: "0.35s" }}>
          <div className="lp-stat">
            <div className="lp-num lp-num-red" aria-label={`${wasted} million`}>
              <CountUp to={wasted} reduced={reduced} delay={300} />
            </div>
            <p className="lp-unit">gallons wasted every day</p>
          </div>
          <div className="lp-stat">
            <div className="lp-num lp-num-orange" aria-label={`${short} million`}>
              <CountUp to={short} reduced={reduced} delay={500} />
            </div>
            <p className="lp-unit">gallons short for farms</p>
          </div>
        </div>

        <div className="lp-visual lp-rise" style={{ ["--d" as string]: "0.6s" }}>
          <CanalFlow />
        </div>

        <button type="button" className="lp-cta lp-rise" style={{ ["--d" as string]: "0.85s" }} onClick={openDemo}>
          Open the leak map
        </button>
      </main>

      <p className="lp-foot">Tested on real San Joaquin River data. Demo map.</p>
    </div>
  );
}
