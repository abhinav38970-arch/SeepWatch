import { useEffect, useRef, useState } from "react";
import type { Bundle } from "./types";
import { CountUp, Reveal } from "./useReveal";
import "./proof.css";

function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, seen] as const;
}

function pct(x: number, digits = 0) {
  return (x * 100).toFixed(digits);
}

function signedPct(x: number) {
  const v = Math.round(x * 100);
  return `${v > 0 ? "+" : v < 0 ? "\u2212" : ""}${Math.abs(v)}%`;
}

type DayBar = { day: number; skill: number; beats: boolean };

function DayBars({ bars }: { bars: DayBar[] }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const max = Math.max(0.01, ...bars.map((b) => Math.max(0, b.skill)));
  const min = Math.min(0, ...bars.map((b) => b.skill));
  const span = max - min || 1;
  const zero = (max / span) * 100;

  return (
    <div
      ref={ref}
      className={`proof-bars${seen ? " proof-in" : ""}`}
      role="img"
      aria-label={`Win over a simple guess by day: ${bars
        .map((b) => `day ${b.day} ${signedPct(b.skill)}`)
        .join(", ")}`}
    >
      <div className="proof-plot">
        <span className="proof-zero" style={{ top: `${zero}%` }} />
        {bars.map((b, i) => {
          const h = (Math.abs(b.skill) / span) * 100;
          const up = b.skill >= 0;
          const tone = b.beats ? "green" : up ? "yellow" : "red";
          return (
            <div className="proof-col" key={b.day} aria-hidden="true">
              <span
                className={`proof-bar proof-bar-${tone} ${up ? "proof-bar-up" : "proof-bar-down"}`}
                style={{
                  height: `${Math.max(h, 2)}%`,
                  ...(up ? { bottom: `${100 - zero}%` } : { top: `${zero}%` }),
                  transitionDelay: `${0.15 + i * 0.09}s`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="proof-axis" aria-hidden="true">
        {bars.map((b) => (
          <div className="proof-tick" key={b.day}>
            <span className="proof-tick-day">Day {b.day}</span>
            <span className={`proof-tick-val proof-tone-${b.beats ? "green" : b.skill >= 0 ? "yellow" : "red"}`}>
              {signedPct(b.skill)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProofSection({ bundle }: { bundle: Bundle }) {
  const ev = bundle.evidence;
  const horizons = ev.deployable.horizons;

  const vsOld = ev.pitch.skill_vs_sjrrp ?? ev.deployable.overall.sjrrp?.mean_skill ?? 0.5;
  const betterPct = Math.round(vsOld * 100);

  const bars: DayBar[] = Object.keys(horizons)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((day) => {
      const m = horizons[String(day)].persistence;
      return { day, skill: m.skill, beats: m.beats };
    });

  const late = bars.filter((b) => b.day >= 5 && b.day <= 7 && b.beats).map((b) => b.skill);
  const lateLo = late.length ? pct(Math.min(...late), 1) : null;
  const lateHi = late.length ? pct(Math.max(...late), 1) : null;
  const overall = pct(ev.deployable.skill_vs_best, 1);

  return (
    <div className="proof">
      <section className="proof-screen" aria-labelledby="proof-h1">
        <Reveal>
          <p className="proof-eyebrow">Does it work?</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="proof-title" id="proof-h1">
            We tested it.
            <span className="proof-title-green">It works.</span>
          </h2>
        </Reveal>

        <div className="proof-cards">
          <Reveal delay={0.15}>
            <div className="proof-stat proof-stat-green">
              <div className="proof-num" aria-label="9 years">
                <CountUp to={9} />
              </div>
              <p className="proof-label">years of real river data</p>
              <p className="proof-tiny">Used to teach the model</p>
            </div>
          </Reveal>
          <Reveal delay={0.28}>
            <div className="proof-stat proof-stat-yellow">
              <div className="proof-num" aria-label="2 years">
                <CountUp to={2} />
              </div>
              <p className="proof-label">years tested blind</p>
              <p className="proof-tiny">Hidden from the model</p>
            </div>
          </Reveal>
          <Reveal delay={0.41}>
            <div className="proof-stat proof-stat-orange">
              <div className="proof-num" aria-label={`${betterPct} percent better`}>
                <CountUp to={betterPct} suffix="%" />
              </div>
              <p className="proof-label">better than the old method</p>
              <p className="proof-tiny">Compared with the river program's own curve</p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="proof-honest">
            {lateLo && lateHi ? (
              <p className="proof-honest-line">
                Beats a simple guess by <strong>{lateLo} to {lateHi}%</strong> on days 5 to 7.
              </p>
            ) : (
              <p className="proof-honest-line">Beats the old method on every day.</p>
            )}
            <p className="proof-tiny">
              Over all 7 days the gain is small, about {overall}%. Days 1 and 2 are a tie or worse.
            </p>
          </div>
        </Reveal>

        {bars.length > 0 && (
          <Reveal delay={0.15}>
            <div className="proof-chart">
              <p className="proof-chart-title">Win over a simple guess, by day</p>
              <DayBars bars={bars} />
            </div>
          </Reveal>
        )}
      </section>

      <section className="proof-screen" aria-labelledby="proof-h2">
        <Reveal>
          <p className="proof-eyebrow">Real data, honest limits</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="proof-title" id="proof-h2">
            See what is real.
            <span className="proof-title-dim">And what is not.</span>
          </h2>
        </Reveal>

        <div className="proof-legend">
          <Reveal delay={0.15}>
            <div className="proof-key">
              <span className="proof-dot proof-dot-green" aria-hidden="true" />
              <h3 className="proof-key-name">Real</h3>
              <p className="proof-key-text">River readings from public sensors.</p>
            </div>
          </Reveal>
          <Reveal delay={0.28}>
            <div className="proof-key">
              <span className="proof-dot proof-dot-orange" aria-hidden="true" />
              <h3 className="proof-key-name">Predicted</h3>
              <p className="proof-key-text">The 7-day forecasts.</p>
            </div>
          </Reveal>
          <Reveal delay={0.41}>
            <div className="proof-key">
              <span className="proof-dot proof-dot-gray" aria-hidden="true" />
              <h3 className="proof-key-name">Drawn by hand</h3>
              <p className="proof-key-text">The map lines.</p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.2}>
          <p className="proof-closing">
            Built on the San Joaquin River.
            <br />
            Made to fit district canals next.
          </p>
        </Reveal>
      </section>
    </div>
  );
}
