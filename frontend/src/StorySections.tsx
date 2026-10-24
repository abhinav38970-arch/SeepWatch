import { createElement } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";
import type { Bundle } from "./types";
import { ACRE_FEET_PER_CFS_DAY, cfsToMgd } from "./plainUnits";
import { CountUp, useReveal } from "./useReveal";
import ProofSection from "./ProofSection";
import "./story.css";

type RiseProps = {
  children?: ReactNode;
  delay?: number;
  className?: string;
  as?: ElementType;
};

function Rise({ children, delay = 0, className = "", as = "div" }: RiseProps) {
  const { ref, shown } = useReveal<HTMLElement>();
  return createElement(
    as,
    {
      ref,
      className: ["story-rise", shown ? "story-in" : "", className].filter(Boolean).join(" "),
      style: { "--sd": `${delay}s` } as CSSProperties,
    },
    children
  );
}

function Section({
  id,
  eyebrow,
  title,
  sub,
  children,
  label,
}: {
  id: string;
  eyebrow: string;
  title: string;
  sub?: string;
  children: ReactNode;
  label: string;
}) {
  return (
    <section className="story-section" id={id} aria-label={label}>
      <div className="story-inner">
        <Rise className="story-head">
          <p className="story-eyebrow">{eyebrow}</p>
          <h2 className="story-h2">{title}</h2>
          {sub ? <p className="story-sub">{sub}</p> : null}
        </Rise>
        {children}
      </div>
    </section>
  );
}

const STOPS = ["Friant Dam", "Madera", "Chowchilla", "Dos Palos / Merced"];

function WaterRibbon() {
  return (
    <svg
      className="story-ribbon"
      viewBox="0 0 1000 200"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="storyWater" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#64d2ff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#5ac8fa" stopOpacity="0.85" />
          <stop offset="1" stopColor="#5ac8fa" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id="storyLeak">
          <stop offset="0" stopColor="#ff453a" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ff453a" stopOpacity="0" />
        </radialGradient>
        <filter id="storyBlur" x="-10%" y="-60%" width="120%" height="220%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <clipPath id="storyReveal">
          <rect className="story-clip" x="0" y="0" width="1000" height="200" />
        </clipPath>
      </defs>

      <g clipPath="url(#storyReveal)">
        <path
          className="story-water-glow"
          filter="url(#storyBlur)"
          d="M40 54 H125 C250 54 250 66 375 66 C440 66 470 68 500 74 C540 82 580 80 625 80 C750 80 750 87 875 87 H960 V113 H875 C750 113 750 120 625 120 C580 120 540 118 500 126 C470 132 440 134 375 134 C250 134 250 146 125 146 H40 Z"
          fill="url(#storyWater)"
        />
        <path
          d="M40 54 H125 C250 54 250 66 375 66 C440 66 470 68 500 74 C540 82 580 80 625 80 C750 80 750 87 875 87 H960 V113 H875 C750 113 750 120 625 120 C580 120 540 118 500 126 C470 132 440 134 375 134 C250 134 250 146 125 146 H40 Z"
          fill="url(#storyWater)"
        />
        <path className="story-flow-line" d="M40 100 H960" />
      </g>

      <g className="story-leak">
        <circle cx="500" cy="100" r="80" fill="url(#storyLeak)" />
        <circle cx="500" cy="100" r="7" fill="#ff453a" />
        <circle className="story-ring" cx="500" cy="100" r="9" />
        <g fill="#ff6a5f">
          <circle className="story-drop story-drop-1" cx="488" cy="132" r="4" />
          <circle className="story-drop story-drop-2" cx="502" cy="132" r="3" />
          <circle className="story-drop story-drop-3" cx="514" cy="132" r="4.5" />
        </g>
      </g>

      {[125, 375, 625, 875].map((x, i) => (
        <circle
          key={x}
          className={`story-stop-dot${i === 3 ? " story-stop-dot-end" : ""}`}
          cx={x}
          cy="100"
          r="7"
        />
      ))}
    </svg>
  );
}

function Journey({ released, lost, short }: { released: number; lost: number; short: number }) {
  const { ref, shown } = useReveal<HTMLDivElement>({ threshold: 0.3 });
  const widths = [100, 78, 52, 34];

  return (
    <div ref={ref} className={`story-journey${shown ? " story-in" : ""}`}>
      <div
        className="story-wide"
        role="img"
        aria-label={`Water leaves Friant Dam at ${released} million gallons a day, loses ${lost} million extra on the way, and farms end up ${short} million short.`}
      >
        <div className="story-chips" aria-hidden="true">
          <div className="story-chip story-chip-white">
            <span className="story-chip-num">
              <CountUp to={released} suffix="M" />
            </span>
            <span className="story-chip-txt">gallons a day released</span>
          </div>
          <div className="story-chips-gap" />
          <div className="story-chip story-chip-orange">
            <span className="story-chip-num">
              <CountUp to={short} suffix="M" delay={700} />
            </span>
            <span className="story-chip-txt">short</span>
          </div>
        </div>

        <WaterRibbon />

        <div className="story-leakrow" aria-hidden="true">
          <div className="story-chip story-chip-red">
            <span className="story-chip-num">
              <CountUp to={lost} suffix="M" delay={400} />
            </span>
            <span className="story-chip-txt">lost extra</span>
          </div>
        </div>

        <ol className="story-names" aria-hidden="true">
          {STOPS.map((s, i) => (
            <li key={s} style={{ "--sd": `${0.3 + i * 0.35}s` } as CSSProperties}>
              {s}
            </li>
          ))}
        </ol>
      </div>

      <ol className="story-tall">
        {STOPS.map((s, i) => (
          <li key={s} className="story-tall-row" style={{ "--sd": `${0.2 + i * 0.35}s` } as CSSProperties}>
            <p className="story-tall-name">{s}</p>
            {i === 0 ? (
              <p className="story-tall-note story-tall-white">
                <CountUp to={released} suffix="M" /> gallons a day released
              </p>
            ) : null}
            <div className="story-bar-track">
              <div
                className={`story-bar${i === 2 ? " story-bar-red" : ""}${i === 3 ? " story-bar-orange" : ""}`}
                style={{ width: `${widths[i]}%` }}
              />
            </div>
            {i === 1 ? (
              <p className="story-tall-note story-tall-red">
                <CountUp to={lost} suffix="M" delay={300} /> lost extra
              </p>
            ) : null}
            {i === 3 ? (
              <p className="story-tall-note story-tall-orange">
                <CountUp to={short} suffix="M" delay={500} /> short
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatCard({
  tone,
  to,
  suffix,
  label,
  line,
  delay,
}: {
  tone: "red" | "orange" | "green";
  to: number;
  suffix: string;
  label: string;
  line: string;
  delay: number;
}) {
  return (
    <Rise delay={delay} as="article" className={`story-card story-card-${tone}`}>
      <div className="story-num">
        <CountUp to={to} suffix={suffix} delay={delay * 1000} />
      </div>
      <h3 className="story-card-label">{label}</h3>
      <p className="story-card-line">{line}</p>
    </Rise>
  );
}

function IconCount() {
  return (
    <svg viewBox="0 0 120 120" className="story-icon story-icon-blue" aria-hidden="true" focusable="false">
      <path pathLength={1} d="M10 44 H44" />
      <path pathLength={1} d="M34 34 L44 44 L34 54" />
      <path pathLength={1} d="M44 28 H76 V60 H44 Z" />
      <path pathLength={1} d="M76 76 H110" />
      <path pathLength={1} d="M100 66 L110 76 L100 86" />
      <path pathLength={1} d="M60 36 C54 46 52 50 60 54 C68 50 66 46 60 36 Z" />
      <path pathLength={1} d="M20 100 H100" />
    </svg>
  );
}

function IconSpot() {
  return (
    <svg viewBox="0 0 120 120" className="story-icon story-icon-red" aria-hidden="true" focusable="false">
      <path pathLength={1} d="M12 60 H44" />
      <path pathLength={1} d="M76 60 H108" />
      <circle pathLength={1} cx="60" cy="60" r="26" />
      <path pathLength={1} d="M79 79 L100 100" />
      <path pathLength={1} d="M60 46 C54 54 52 58 60 62 C68 58 66 54 60 46 Z" />
      <path pathLength={1} d="M60 86 V98" />
    </svg>
  );
}

function IconWarn() {
  return (
    <svg viewBox="0 0 120 120" className="story-icon story-icon-green" aria-hidden="true" focusable="false">
      <path pathLength={1} d="M60 20 C42 20 34 34 34 52 V70 L24 86 H96 L86 70 V52 C86 34 78 20 60 20 Z" />
      <path pathLength={1} d="M50 96 C52 104 68 104 70 96" />
      <path pathLength={1} d="M60 12 V20" />
      <path pathLength={1} d="M14 40 C10 50 10 60 14 70" />
      <path pathLength={1} d="M106 40 C110 50 110 60 106 70" />
    </svg>
  );
}

const STEPS = [
  { icon: <IconCount />, title: "Count water in and out", line: "We track every gallon along the canal." },
  { icon: <IconSpot />, title: "Spot the missing water", line: "If less comes out, we find where." },
  { icon: <IconWarn />, title: "Warn the farms early", line: "You get a week to plan." },
];

export default function StorySections({ bundle }: { bundle: Bundle }) {
  const releaseCfs = bundle.nodes_shortfall.find((n) => n.release_cfs != null)?.release_cfs ?? 395;
  const released = Math.round(cfsToMgd(releaseCfs) ?? 255);
  const lost = Math.round(cfsToMgd(bundle.headline.excess_loss_7d_cfs) ?? 48);
  const short = Math.round(cfsToMgd(bundle.headline.worst_node_shortfall.p50) ?? 31);
  const acreFeetWeek = Math.round(Math.abs(bundle.headline.excess_loss_7d_cfs) * ACRE_FEET_PER_CFS_DAY * 7);

  return (
    <div className="story">
      <Section
        id="story-journey"
        eyebrow="Where the water goes"
        title="Water goes in. Less comes out."
        sub="Some of it never reaches the farms."
        label="Where the water goes"
      >
        <Journey released={released} lost={lost} short={short} />
        <Rise delay={0.2}>
          <p className="story-fine">Line thickness is for show, not to scale.</p>
        </Rise>
      </Section>

      <Section
        id="story-why"
        eyebrow="Why it matters"
        title="Small leaks. Big numbers."
        sub="On the worst stretch of canal."
        label="Why it matters"
      >
        <div className="story-cards">
          <StatCard
            tone="red"
            to={lost}
            suffix="M"
            label="gallons wasted daily"
            line="Leaking out of the canal."
            delay={0}
          />
          <StatCard
            tone="orange"
            to={short}
            suffix="M"
            label="gallons short"
            line="Missing when farms need it."
            delay={0.15}
          />
          <StatCard
            tone="green"
            to={7}
            suffix=" days"
            label="warning ahead"
            line="We forecast a full week out."
            delay={0.3}
          />
        </div>
        <Rise delay={0.2}>
          <p className="story-fine">
            That is{" "}
            <strong className="story-fine-num">
              <CountUp to={acreFeetWeek} />
            </strong>{" "}
            acre-feet lost in a week. One acre-foot covers one acre, one foot deep.
          </p>
        </Rise>
      </Section>

      <Section
        id="story-how"
        eyebrow="How it works"
        title="Three simple steps."
        sub="Tested on real river data."
        label="How it works"
      >
        <ol className="story-steps">
          {STEPS.map((s, i) => (
            <StepItem key={s.title} index={i} {...s} />
          ))}
        </ol>
      </Section>

      <ProofSection bundle={bundle} />
    </div>
  );
}

function StepItem({
  index,
  icon,
  title,
  line,
}: {
  index: number;
  icon: ReactNode;
  title: string;
  line: string;
}) {
  const { ref, shown } = useReveal<HTMLLIElement>({ threshold: 0.35 });
  return (
    <li
      ref={ref}
      className={`story-step${shown ? " story-in" : ""}`}
      style={{ "--sd": `${index * 0.45}s` } as CSSProperties}
    >
      <div className="story-icon-wrap">{icon}</div>
      <span className="story-step-n">{index + 1}</span>
      <h3 className="story-step-title">{title}</h3>
      <p className="story-step-line">{line}</p>
    </li>
  );
}
