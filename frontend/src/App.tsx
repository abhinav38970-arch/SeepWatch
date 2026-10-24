import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Bundle } from "./types";
import MapView from "./MapView";
import DetailDrawer from "./DetailDrawer";
import { cfsToMgd, fmtNumber } from "./plainUnits";
import Landing from "./Landing";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

const FARM_NAMES: Record<string, string> = {
  SJB: "Chowchilla farms",
  GRF: "Madera farms",
  SDP: "Dos Palos farms",
  SWA: "Merced farms",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(
    () => prefersReducedMotion() || typeof IntersectionObserver === "undefined"
  );
  useEffect(() => {
    const node = ref.current;
    if (shown || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);
  return [ref, shown] as const;
}

function useCountUp(target: number, active: boolean, duration = 1100) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, duration]);
  return Math.round(value);
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 3 - ((v - min) / span) * (h - 6);
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = points[points.length - 1];
  return (
    <svg
      className="canal-spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={{ color }}
    >
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.4" fill="currentColor" />
    </svg>
  );
}

type TodoItem = { key: string; title: string; reason: string; color: string };

function buildTodo(bundle: Bundle): TodoItem[] {
  const items: TodoItem[] = [];
  bundle.reach_colors
    .filter((r) => r.status === "flagged" && DEMO_CANALS[r.id])
    .forEach((r) =>
      items.push({ key: r.id, title: DEMO_CANALS[r.id].title, reason: "Check the banks", color: "var(--red)" })
    );
  const worst = [...bundle.nodes_shortfall]
    .filter((n) => n.shortfall_p50 > 0)
    .sort((a, b) => b.shortfall_p50 - a.shortfall_p50)[0];
  if (worst) {
    items.push({
      key: worst.node_id,
      title: FARM_NAMES[worst.node_id] ?? "Farms downstream",
      reason: "Water is running short",
      color: "var(--orange)",
    });
  }
  const calmCopy: Record<string, string> = {
    R1: "Big loss, but normal",
    R4A: "Small loss, check later",
    R2B3: "Looking good",
  };
  const calm = ["R1", "R4A", "R2B3"];
  calm.forEach((id) => {
    if (!DEMO_CANALS[id] || items.some((i) => i.key === id)) return;
    items.push({
      key: id,
      title: DEMO_CANALS[id].title,
      reason: calmCopy[id],
      color: DEMO_CANALS[id].color,
    });
  });
  return items.slice(0, 3);
}

function Outlook({
  bundle,
  wastedMgd,
  shortMgd,
}: {
  bundle: Bundle;
  wastedMgd: number;
  shortMgd: number;
}) {
  const [ref, shown] = useReveal<HTMLElement>();
  const wasted = useCountUp(wastedMgd, shown);
  const short = useCountUp(shortMgd, shown);

  const leakId =
    bundle.reach_colors.find((r) => r.status === "flagged")?.id ?? "R2A";
  const forecast = bundle.reach_forecasts[leakId] ?? [];
  const asof = new Date(`${bundle.meta.asof}T00:00:00Z`);
  const data = forecast.slice(0, 7).map((f) => {
    const dayIdx = (asof.getUTCDay() + f.horizon) % 7;
    return {
      day: Number.isNaN(asof.getTime()) ? `Day ${f.horizon}` : DAY_NAMES[dayIdx],
      lost: Math.round(cfsToMgd(f.q50) ?? 0),
      normal: Math.round(cfsToMgd(f.normal_q50) ?? 0),
    };
  });
  const farmNode = bundle.nodes_shortfall.find(
    (n) => n.node_id === bundle.headline.worst_node_shortfall.node_id
  );
  const farmName =
    FARM_NAMES[bundle.headline.worst_node_shortfall.node_id ?? ""] ?? "Farms downstream";
  const farmShort = (farmNode?.shortfall_p50 ?? bundle.headline.worst_node_shortfall.p50 ?? 0) > 0;

  return (
    <section ref={ref} className={`reveal outlook${shown ? " is-in" : ""}`} aria-labelledby="outlook-title">
      <p className="section-kicker">Looking ahead</p>
      <h2 id="outlook-title" className="section-title">
        Next 7 days
      </h2>
      <p className="section-sub">
        {DEMO_CANALS[leakId]?.title ?? "The leaking canal"} keeps losing more than normal.
      </p>

      <div className="outlook-chart" role="img" aria-label="Chart of water lost each day for the next 7 days, compared to a normal day">
        {data.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="demo-lost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff453a" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#ff453a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#86868b", fontSize: 12 }} />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#86868b", fontSize: 12 }}
                tickFormatter={(v: number) => `${v}M`}
                domain={[0, (max: number) => Math.ceil(max / 20) * 20 + 20]}
              />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.2)" }}
                contentStyle={{ background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#f5f5f7" }}
                labelStyle={{ color: "#a1a1a6" }}
                formatter={(v: number, name: string) => [`${v}M a day`, name === "lost" ? "Lost" : "Normal day"]}
              />
              <Line type="monotone" dataKey="normal" stroke="#a1a1a6" strokeDasharray="5 5" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area
                type="monotone"
                dataKey="lost"
                stroke="#ff453a"
                strokeWidth={2.5}
                fill="url(#demo-lost)"
                dot={{ r: 3, fill: "#ff453a", strokeWidth: 0 }}
                isAnimationActive={shown && !prefersReducedMotion()}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <div className="chart-legend" aria-hidden="true">
          <span><i style={{ background: "var(--red)" }} /> Water lost</span>
          <span><i className="dash" /> Normal day</span>
        </div>
      </div>

      <div className="big-numbers">
        <div className="big-num" style={{ "--c": "var(--red)" } as CSSProperties}>
          <strong>{fmtNumber(wasted)}M</strong>
          <span>extra wasted a day</span>
        </div>
        <div className="big-num" style={{ "--c": "var(--orange)" } as CSSProperties}>
          <strong>{fmtNumber(short)}M</strong>
          <span>short for farms</span>
        </div>
        <div
          className="big-num big-place"
          style={{ "--c": farmShort ? "var(--orange)" : "var(--green)" } as CSSProperties}
        >
          <strong>{farmName}</strong>
          <span>{farmShort ? "Running short" : "Getting enough"}</span>
        </div>
      </div>
    </section>
  );
}

function TodoFirst({ items }: { items: TodoItem[] }) {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`reveal todo${shown ? " is-in" : ""}`} aria-labelledby="todo-title">
      <p className="section-kicker">Your move</p>
      <h2 id="todo-title" className="section-title">
        What to do first
      </h2>
      <ol className="todo-list">
        {items.map((item, i) => (
          <li
            key={item.key}
            className="todo-item"
            style={{ "--c": item.color, "--i": i } as CSSProperties}
          >
            <span className="todo-num" aria-hidden="true">{i + 1}</span>
            <i className="canal-dot" aria-hidden="true" />
            <div>
              <strong>{item.title}</strong>
              <span>{item.reason}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

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
  const todo = useMemo(() => buildTodo(bundle), [bundle]);

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

  const cardInfo = (reach: Bundle["reach_colors"][0]) => {
    const forecast = reach.forecast_loss_cfs;
    const normal = reach.normal_loss_cfs;
    const isGain = forecast != null && forecast > 0;
    let note = "";
    if (isGain) note = "Gain, no loss";
    else if (reach.id === "R2A") note = `Total lost ${fmtNumber(cfsToMgd(forecast))}M a day`;
    else if (reach.id === "R1") note = `Normal loss ${fmtNumber(cfsToMgd(forecast))}M a day`;
    else note = `Small loss ${fmtNumber(cfsToMgd(forecast))}M a day`;

    let fill = 0;
    if (!isGain && forecast != null && normal != null && normal !== 0) {
      fill = Math.max(0.04, Math.min(1, Math.abs(forecast / normal) / 2));
    }
    const series = (bundle.timelines_by_reach?.[reach.id] ?? [])
      .map((p) => p.loss_cfs)
      .filter((v): v is number => v != null)
      .slice(-30)
      .map((v) => -v);
    return { note, fill, isGain, series };
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
            const info = cardInfo(reach);
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
                <span className="canal-note">{info.note}</span>
                <Sparkline values={info.series} color={meta.color} />
                <span className="canal-bar" aria-hidden="true">
                  <b style={{ width: `${Math.round(info.fill * 100)}%` }} />
                  {!info.isGain && <u />}
                </span>
              </button>
            );
          })}
        </aside>
      </div>

      <Outlook bundle={bundle} wastedMgd={wastedMgd} shortMgd={shortMgd} />
      <TodoFirst items={todo} />

      <footer className="demo-foot">
        <span>Real San Joaquin River data. Demo map.</span>
        <button type="button" className="demo-how" onClick={() => select("evidence")}>
          How we know
        </button>
      </footer>

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
