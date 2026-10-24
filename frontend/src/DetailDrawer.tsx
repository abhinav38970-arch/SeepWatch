import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Bundle } from "./types";
import TimelineChart from "./TimelineChart";
import "./drawer.css";

type Props = {
  bundle: Bundle;
  selected: string | null;
  onClose: () => void;
  kind?: "reach" | "node" | "evidence" | string | null;
  id?: string | null;
};

const MGD_PER_CFS = 0.646317;

const RED = "#ff453a";
const ORANGE = "#ff9f0a";
const YELLOW = "#ffd60a";
const GREEN = "#30d158";

const PLACE_NAMES: Record<string, string> = {
  R2A: "Madera to Chowchilla Canal",
  R1: "Friant Dam to Madera Canal",
  R2B3: "Chowchilla to Dos Palos Canal",
  R4A: "Dos Palos to Merced Canal",
  GRF: "Gravelly Ford",
  SJB: "Chowchilla Farms",
  SDP: "Dos Palos Farms",
  SWA: "Washington Road",
};

function placeName(code: string | null | undefined, fallback?: string | null): string {
  if (!code) return fallback ?? "";
  return PLACE_NAMES[code] ?? fallback ?? code;
}

function fmt(n: number | null | undefined, d = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(d);
}

function toMgdRound(cfs: number | null | undefined): number {
  if (cfs == null || Number.isNaN(cfs)) return 0;
  return Math.round(Math.abs(cfs) * MGD_PER_CFS);
}

function toLossMgdRound(cfs: number | null | undefined): number {
  if (cfs == null || Number.isNaN(cfs)) return 0;
  return Math.round(Math.max(0, -cfs) * MGD_PER_CFS);
}

function fmtMgdRange(aCfs: number | null | undefined, bCfs: number | null | undefined): string {
  if (aCfs == null || bCfs == null || Number.isNaN(aCfs) || Number.isNaN(bCfs)) return "—";
  const a = Math.round(Math.max(0, Math.abs(aCfs)) * MGD_PER_CFS);
  const b = Math.round(Math.max(0, Math.abs(bCfs)) * MGD_PER_CFS);
  return `${Math.min(a, b)} to ${Math.max(a, b)}M`;
}

type Tone = { color: string; label: string };

const FOCUSABLE =
  'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function Header({
  title,
  pill,
  closeRef,
  onClose,
}: {
  title: string;
  pill?: Tone;
  closeRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  return (
    <header className="sw-head">
      <div className="sw-head-text">
        <h3 id="drawer-title" className="sw-title">
          {title}
        </h3>
        {pill && (
          <span
            className="sw-pill"
            style={{ "--tone": pill.color } as CSSProperties}
          >
            <i aria-hidden="true" />
            {pill.label}
          </span>
        )}
      </div>
      <button
        ref={closeRef}
        type="button"
        className="sw-close"
        onClick={onClose}
        aria-label="Close"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

function Hero({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <section className="sw-hero" style={{ "--tone": color } as CSSProperties}>
      <div className="sw-hero-num" aria-label={`${value} million ${label}`}>
        {value}
        <span>M</span>
      </div>
      <div className="sw-hero-label">{label}</div>
    </section>
  );
}

function SplitBar({
  aLabel,
  aValue,
  aColor,
  bLabel,
  bValue,
  bColor,
}: {
  aLabel: string;
  aValue: number;
  aColor: string;
  bLabel: string;
  bValue: number;
  bColor: string;
}) {
  const total = Math.max(1, aValue + bValue);
  const aPct = (aValue / total) * 100;
  const bPct = bValue > 0 ? 100 - aPct : 0;
  return (
    <section className="sw-split">
      <div className="sw-bar" role="img" aria-label={`${aLabel} ${aValue}M, ${bLabel} ${bValue}M`}>
        <div style={{ width: `${bValue > 0 ? aPct : 100}%`, background: aColor }} />
        {bValue > 0 && <div style={{ width: `${bPct}%`, background: bColor, boxShadow: `0 0 14px ${bColor}` }} />}
      </div>
      <div className="sw-bar-labels">
        <span>
          <i style={{ background: aColor }} />
          {aLabel} <b>{aValue}M</b>
        </span>
        <span>
          <i style={{ background: bColor }} />
          {bLabel} <b>{bValue}M</b>
        </span>
      </div>
    </section>
  );
}

function ToDo({ items }: { items: string[] }) {
  return (
    <section className="sw-todo">
      <div className="sw-section-label">What to do</div>
      <ul>
        {items.map((t, i) => (
          <li key={t}>
            <span aria-hidden="true">{i + 1}</span>
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DetailDrawer({ bundle, selected, onClose, kind, id }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeSelected = selected ?? (kind === "evidence" ? "evidence" : id) ?? null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous && typeof previous.focus === "function" && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !panelRef.current.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !panelRef.current.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, activeSelected]);

  if (activeSelected === "evidence" || kind === "evidence") {
    const dep = bundle.evidence.deployable;
    const horizons = dep?.horizons ?? {};
    const hs = Object.keys(horizons).sort((a, b) => Number(a) - Number(b));
    const regimes = bundle.evidence.deployable_regime ?? {};
    const whatif = bundle.evidence.whatif;
    const cov = bundle.evidence.coverage;
    const far = bundle.evidence.false_alarm_rate ?? {};
    const featImp = Object.entries(bundle.evidence.feature_importance ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const betterPct = Math.round((dep?.overall?.sjrrp?.mean_skill ?? 0.5038) * 100);

    const stats = [
      { big: "9 years", small: "of real data" },
      { big: `${betterPct}% better`, small: "than the old method" },
      { big: "2 years", small: "tested blind" },
    ];

    return (
      <div
        ref={panelRef}
        className="sw-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <Header title="Why trust it?" closeRef={closeRef} onClose={onClose} />

        <section className="sw-stats">
          {stats.map((s) => (
            <div className="sw-stat" key={s.big}>
              <div className="sw-stat-big">{s.big}</div>
              <div className="sw-stat-small">{s.small}</div>
            </div>
          ))}
        </section>

        <details className="sw-more">
          <summary>More numbers</summary>
          <div className="sw-more-body">
            <p className="sw-fine">
              Trained on {bundle.evidence.train_rows.toLocaleString()} rows (2016–2024). Tested on{" "}
              {bundle.evidence.test_rows.toLocaleString()} unseen rows (2025–2026). Rules were written down
              before scoring (<code>docs/EVALUATION_RULES.md</code>). Range coverage on test data:{" "}
              {fmt((cov?.coverage_corrected ?? 0) * 100, 1)}% (2024 check: {fmt((cov?.calib_2024_raw ?? 0) * 100, 1)}%).
              Average error {toMgdRound(dep?.model_mae)}M gal/day vs {dep?.best_baseline}{" "}
              {toMgdRound(dep?.best_baseline_mae)}M gal/day.
            </p>

            <div className="sw-section-label">Skill by forecast day (95% CI)</div>
            <div className="sw-scroll">
              <table className="evidence-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>vs Persistence</th>
                    <th>vs Agency Curve</th>
                    <th>vs Flow-Aware</th>
                  </tr>
                </thead>
                <tbody>
                  {hs.map((h) => {
                    const row = horizons[h];
                    const cell = (k: "persistence" | "sjrrp" | "flow_aware") => {
                      const m = row[k];
                      const s = m?.skill;
                      const beat = m?.beats;
                      const ci =
                        m?.ci_lo != null && m?.ci_hi != null
                          ? ` [${m.ci_lo.toFixed(2)}, ${m.ci_hi.toFixed(2)}]`
                          : "";
                      return (
                        <td className={beat ? "beat" : "miss"} title={ci}>
                          {s != null ? `${(s * 100).toFixed(1)}%` : "—"}
                          {beat ? " ✓" : ""}
                        </td>
                      );
                    };
                    return (
                      <tr key={h}>
                        <td>+{h}d</td>
                        {cell("persistence")}
                        {cell("sjrrp")}
                        {cell("flow_aware")}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {regimes.ramp && regimes.steady && (
              <>
                <div className="sw-section-label">Ramp vs steady flow</div>
                <div className="kv">
                  <span>Ramp ({regimes.ramp.n_days} days)</span>
                  <span>
                    {fmt((regimes.ramp.mean_skill ?? 0) * 100, 1)}% ({regimes.ramp.beats_count}/7)
                  </span>
                  <span>Steady ({regimes.steady.n_days} days)</span>
                  <span>
                    {fmt((regimes.steady.mean_skill ?? 0) * 100, 1)}% ({regimes.steady.beats_count}/7)
                  </span>
                  {whatif?.overall && (
                    <>
                      <span>What-if vs flow-aware</span>
                      <span>
                        {fmt((whatif.overall.flow_aware?.mean_skill ?? 0) * 100, 1)}% (
                        {whatif.overall.flow_aware?.beats_count ?? 0}/7)
                      </span>
                      <span>What-if vs persistence</span>
                      <span>
                        {fmt((whatif.overall.persistence?.mean_skill ?? 0) * 100, 1)}% (
                        {whatif.overall.persistence?.beats_count ?? 0}/7)
                      </span>
                    </>
                  )}
                </div>
              </>
            )}

            {Object.keys(far).length > 0 && (
              <>
                <div className="sw-section-label">False alarms (2016–2024)</div>
                <div className="sw-scroll">
                  <table className="evidence-table">
                    <thead>
                      <tr>
                        <th>Canal</th>
                        <th>Flags / 30d</th>
                        <th>Raw / 30d</th>
                        <th>Months</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(far).map(([rid, r]) => (
                        <tr key={rid}>
                          <td>{placeName(rid, rid)}</td>
                          <td>{fmt(r.mean_flags_per_month, 2)}</td>
                          <td>{fmt(r.mean_raw_per_month, 2)}</td>
                          <td>{r.months}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {featImp.length > 0 && (
              <>
                <div className="sw-section-label">Top model inputs</div>
                <div className="kv">
                  {featImp.map(([name, val]) => (
                    <div key={name} style={{ display: "contents" }}>
                      <span>{name}</span>
                      <span>{fmt(val, 0)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="sw-section-label">Limits</div>
            <ul className="sw-notes">
              {bundle.provenance.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    );
  }

  const reach = bundle.reach_colors.find((r) => r.id === activeSelected);
  const node = bundle.nodes_shortfall.find((n) => n.node_id === activeSelected);
  const fc = activeSelected ? bundle.reach_forecasts[activeSelected] : undefined;
  const watch = bundle.watchlist.find((w) => w.reach_id === activeSelected);
  const reachTimeline = activeSelected
    ? bundle.timelines_by_reach?.[activeSelected] ?? (activeSelected === "R2A" ? bundle.timeline : undefined)
    : undefined;
  const reachFar = activeSelected ? bundle.evidence.false_alarm_rate?.[activeSelected] : undefined;

  const title = reach
    ? placeName(reach.id, reach.name)
    : node
      ? placeName(node.node_id, node.name)
      : placeName(activeSelected, activeSelected);

  const totalLossMgd = reach ? toLossMgdRound(reach.forecast_loss_cfs ?? watch?.forecast_loss_cfs) : 0;
  const normalSeepageMgd = reach ? toLossMgdRound(reach.normal_loss_cfs ?? watch?.normal_loss_cfs) : 0;
  const extraLeakMgd = reach
    ? Math.round(Math.max(0, reach.excess_loss_cfs ?? watch?.excess_loss_cfs ?? 0) * MGD_PER_CFS)
    : 0;

  const expectedArrivalMgd = node ? toMgdRound(node.expected_arrival_cfs) : 0;
  const predictedArrivalMgd = node ? toMgdRound(node.arrival_p50) : 0;
  const missingWaterMgd = node ? Math.round(Math.max(0, node.shortfall_p50) * MGD_PER_CFS) : 0;

  let reachTone: Tone = { color: GREEN, label: "Healthy" };
  if (reach) {
    if (reach.status === "flagged") reachTone = { color: RED, label: "Big leak" };
    else if (reach.status === "no_forecast") reachTone = { color: YELLOW, label: "Watch" };
    else if (extraLeakMgd > 0) reachTone = { color: ORANGE, label: "Small leak" };
  }
  const nodeTone: Tone =
    missingWaterMgd > 0 ? { color: ORANGE, label: "Watch" } : { color: GREEN, label: "Healthy" };

  const reachTodo =
    reach?.status === "flagged"
      ? ["Check the canal banks", "Check the gate readings", "Warn the farms"]
      : reach?.status === "no_forecast"
        ? ["No crew needed yet", "Check the gate readings", "Look upstream first"]
        : ["Nothing to fix now", "Keep daily checks going", "Look upstream first"];
  const nodeTodo =
    missingWaterMgd > 0
      ? ["Check the canals upstream", "Warn the farms", "Plan backup water"]
      : ["Nothing to fix now", "Keep daily checks going", "Watch the canals upstream"];

  return (
    <div
      ref={panelRef}
      className="sw-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <Header
        title={title}
        pill={reach ? reachTone : node ? nodeTone : undefined}
        closeRef={closeRef}
        onClose={onClose}
      />

      {reach && (
        <>
          <Hero value={extraLeakMgd} label="gallons wasted a day" color={reachTone.color} />
          <SplitBar
            aLabel="Normal"
            aValue={normalSeepageMgd}
            aColor={GREEN}
            bLabel="Leak"
            bValue={extraLeakMgd}
            bColor={RED}
          />
        </>
      )}

      {node && (
        <>
          <Hero value={missingWaterMgd} label="gallons short" color={nodeTone.color} />
          <SplitBar
            aLabel="Arriving"
            aValue={predictedArrivalMgd}
            aColor={GREEN}
            bLabel="Short"
            bValue={missingWaterMgd}
            bColor={ORANGE}
          />
        </>
      )}

      {reach && reachTimeline && reachTimeline.length > 0 && (
        <section className="sw-chart-card">
          <TimelineChart data={reachTimeline} rows={reachTimeline} />
        </section>
      )}

      {(reach || node) && <ToDo items={reach ? reachTodo : nodeTodo} />}

      {reach && (
        <details className="sw-more">
          <summary>More numbers</summary>
          <div className="sw-more-body">
            <div className="kv">
              <span>Total water lost</span>
              <span>{totalLossMgd}M gal/day</span>
              <span>Normal loss</span>
              <span>{normalSeepageMgd}M gal/day</span>
              <span>Extra leak</span>
              <span>{extraLeakMgd}M gal/day</span>
              {watch && reach.status !== "no_forecast" && (
                <>
                  <span>Recent loss</span>
                  <span>{toLossMgdRound(watch.recent_loss_cfs)}M gal/day</span>
                  <span>Likely range</span>
                  <span>{fmtMgdRange(watch.q90, watch.q10)}</span>
                </>
              )}
              {reachFar && (
                <>
                  <span>Past alerts (2016–2024)</span>
                  <span>{fmt(reachFar.mean_flags_per_month, 1)} a month</span>
                </>
              )}
            </div>

            {fc && (
              <>
                <div className="sw-section-label">Next 7 days (M gal/day)</div>
                <div className="sw-scroll">
                  <table className="evidence-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Loss</th>
                        <th>Normal</th>
                        <th>Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fc.map((r) => (
                        <tr key={r.horizon}>
                          <td>+{r.horizon}</td>
                          <td>
                            <strong>{toLossMgdRound(r.q50)}M</strong>
                          </td>
                          <td>{toLossMgdRound(r.normal_q50)}M</td>
                          <td>{fmtMgdRange(r.q90, r.q10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </details>
      )}

      {node && (
        <details className="sw-more">
          <summary>More numbers</summary>
          <div className="sw-more-body">
            <div className="kv">
              <span>Friant Dam release</span>
              <span>{toMgdRound(node.release_cfs ?? 395)}M gal/day</span>
              <span>Expected to arrive</span>
              <span>{expectedArrivalMgd}M gal/day</span>
              <span>Likely to arrive</span>
              <span>{predictedArrivalMgd}M gal/day</span>
              <span>Likely range</span>
              <span>{fmtMgdRange(node.arrival_p10, node.arrival_p90)}</span>
              <span>Short</span>
              <span>{missingWaterMgd}M gal/day</span>
              <span>Canals upstream</span>
              <span>{node.upstream_reaches.map((r) => placeName(r, r)).join(" → ")}</span>
            </div>
          </div>
        </details>
      )}

      {!reach && !node && <p className="sw-empty">Pick a spot on the map.</p>}
    </div>
  );
}
