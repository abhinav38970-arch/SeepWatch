import { useEffect, useRef } from "react";
import type { Bundle } from "./types";
import TimelineChart from "./TimelineChart";

type Props = {
  bundle: Bundle;
  selected: string | null;
  onClose: () => void;
};

function fmt(n: number | null | undefined, d = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(d);
}

function fmtRange(lo: number | null | undefined, hi: number | null | undefined, d = 0) {
  if (lo == null || hi == null || Number.isNaN(lo) || Number.isNaN(hi)) return "—";
  return `${lo.toFixed(d)} to ${hi.toFixed(d)}`;
}

function fmtBalance(n: number | null | undefined, d = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n > 0) return `${n.toFixed(d)} cubic ft/sec gain`;
  return `${Math.abs(n).toFixed(d)} cubic ft/sec loss`;
}

export default function DetailDrawer({ bundle, selected, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, selected]);

  if (selected === "evidence") {
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

    return (
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header>
          <div>
            <h3 id="drawer-title">Evidence &amp; Pre-Registered Evaluation</h3>
            <div className="watch-meta">
              Held-out central 80% range coverage{" "}
              {fmt((cov?.coverage_corrected ?? 0) * 100, 1)}% (2024 calib{" "}
              {fmt((cov?.calib_2024_raw ?? 0) * 100, 1)}%)
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose}>Close</button>
        </header>

        <p className="watch-meta" style={{ marginTop: 10 }}>
          Locked in <code>docs/EVALUATION_RULES.md</code> before scoring held-out 2025–2026.
          Train {bundle.evidence.train_rows.toLocaleString()} / test{" "}
          {bundle.evidence.test_rows.toLocaleString()} reach-horizon rows. Model mean MAE{" "}
          {fmt(dep?.model_mae, 1)} cubic ft/sec vs {dep?.best_baseline} {fmt(dep?.best_baseline_mae, 1)} cubic ft/sec.
          Overall error was {fmt((dep?.skill_vs_best ?? 0) * 100, 1)}% lower than persistence;
          days 5–7 were 7.7%, 8.9%, and 8.9% lower.
        </p>

        <h2 style={{ marginTop: 14, fontSize: "0.75rem", color: "var(--muted)" }}>
          PER-HORIZON SKILL · DEPLOYABLE MODE (95% BLOCK-BOOTSTRAP CI)
        </h2>
        <table className="evidence-table">
          <thead>
            <tr>
              <th>h</th>
              <th>vs persistence</th>
              <th>vs SJRRP</th>
              <th>vs flow-aware</th>
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
                    {fmt(s, 3)}
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

        {regimes.ramp && regimes.steady && (
          <>
            <h2 style={{ marginTop: 16, fontSize: "0.75rem", color: "var(--muted)" }}>
              REGIME SPLIT &amp; WHAT-IF MODE
            </h2>
            <div className="kv">
              <span>Ramp regime ({regimes.ramp.n_days} test days)</span>
              <span>
                mean skill {fmt((regimes.ramp.mean_skill ?? 0) * 100, 1)}% ({regimes.ramp.beats_count}/7 beats)
              </span>
              <span>Steady regime ({regimes.steady.n_days} test days)</span>
              <span>
                mean skill {fmt((regimes.steady.mean_skill ?? 0) * 100, 1)}% ({regimes.steady.beats_count}/7 beats)
              </span>
              {whatif?.overall && (
                <>
                  <span>What-if vs flow-aware</span>
                  <span>
                    +{fmt((whatif.overall.flow_aware?.mean_skill ?? 0) * 100, 1)}% (
                    {whatif.overall.flow_aware?.beats_count ?? 0}/7 ✓)
                  </span>
                  <span>What-if vs persistence</span>
                  <span>
                    {fmt((whatif.overall.persistence?.mean_skill ?? 0) * 100, 1)}% (
                    {whatif.overall.persistence?.beats_count ?? 0}/7 ✓)
                  </span>
                </>
              )}
            </div>
          </>
        )}

        {Object.keys(far).length > 0 && (
          <>
            <h2 style={{ marginTop: 14, fontSize: "0.75rem", color: "var(--muted)" }}>
              ANOMALY FLAG RATE (2016–2024 BASELINE)
            </h2>
            <table className="evidence-table">
              <thead>
                <tr>
                  <th>Reach</th>
                  <th>Persisted flags / 30d</th>
                  <th>Raw 1d / 30d</th>
                  <th>Months</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(far).map(([rid, r]) => (
                  <tr key={rid}>
                    <td>{rid}</td>
                    <td>{fmt(r.mean_flags_per_month, 2)}</td>
                    <td>{fmt(r.mean_raw_per_month, 2)}</td>
                    <td>{r.months}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {featImp.length > 0 && (
          <>
            <h2 style={{ marginTop: 14, fontSize: "0.75rem", color: "var(--muted)" }}>
              TOP LIGHTGBM DRIVERS (SPLIT GAIN)
            </h2>
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

        <h2 style={{ marginTop: 14, fontSize: "0.75rem", color: "var(--muted)" }}>HONEST LIMITS</h2>
        <ul style={{ paddingLeft: "1.1rem", color: "var(--muted)", fontSize: "0.8rem" }}>
          {bundle.provenance.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    );
  }

  const reach = bundle.reach_colors.find((r) => r.id === selected);
  const node = bundle.nodes_shortfall.find((n) => n.node_id === selected);
  const fc = selected ? bundle.reach_forecasts[selected] : undefined;
  const watch = bundle.watchlist.find((w) => w.reach_id === selected);
  const reachTimeline = selected
    ? bundle.timelines_by_reach?.[selected] ?? (selected === "R2A" ? bundle.timeline : undefined)
    : undefined;
  const reachFar = selected ? bundle.evidence.false_alarm_rate?.[selected] : undefined;

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header>
        <div>
          <h3 id="drawer-title">{reach?.name ?? node?.name ?? selected}</h3>
          <div className="watch-meta">
            {reach ? `Data basis: ${reach.label.replaceAll("_", " ")}` : node ? `Modeled downstream effect · ${node.provenance ?? "measured"}` : ""}
          </div>
        </div>
        <button ref={closeRef} type="button" onClick={onClose}>Close</button>
      </header>

      {reach && (
        <div className="kv">
          <span>Status</span>
          <span>{reach.status === "flagged" ? "Priority · unusual loss signal" : reach.status === "no_forecast" ? "No reliable forecast" : "Within expected range"}</span>
          {reach.reason && (
            <>
              <span>No-forecast reason</span>
              <span>{reach.reason.replaceAll("_", " ")} (~9 cubic ft/sec vs ±5% gauge noise)</span>
            </>
          )}
          {reach.status !== "no_forecast" && (
            <>
              <span>Forecast total (1–7 day mean)</span>
              <span>{fmtBalance(reach.forecast_loss_cfs ?? watch?.forecast_loss_cfs)}</span>
              <span>Normal expected total</span>
              <span>{fmtBalance(reach.normal_loss_cfs ?? watch?.normal_loss_cfs)}</span>
              <span>Unusual difference vs normal</span>
              <span>{`${fmt(Math.max(0, reach.excess_loss_cfs ?? watch?.excess_loss_cfs ?? 0))} cubic ft/sec`}</span>
            </>
          )}
          {watch && reach.status !== "no_forecast" && (
            <>
              <span>Recent observed balance</span>
              <span>{fmtBalance(watch.recent_loss_cfs)}</span>
              <span>Central 80% forecast range</span>
              <span>{fmtRange(Math.abs(watch.q90), Math.abs(watch.q10), 0)} cubic ft/sec loss</span>
            </>
          )}
          {reachFar && (
            <>
              <span>Baseline flag rate (2016–2024)</span>
              <span>{fmt(reachFar.mean_flags_per_month, 2)} flags per 30 days</span>
            </>
          )}
        </div>
      )}

      {reach && reachTimeline && reachTimeline.length > 0 && (
        <div style={{ margin: "0.75rem 0 1rem" }}>
          <h2 style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 6 }}>
            RECENT 120-DAY BALANCE &amp; EXPECTED BAND
          </h2>
          <div style={{ height: 165 }}>
            <TimelineChart data={reachTimeline} />
          </div>
        </div>
      )}

      {fc && (
        <>
          <h2 style={{ fontSize: "0.75rem", color: "var(--muted)" }}>FORECAST BY DAY (CUBIC FEET PER SECOND)</h2>
          <table className="evidence-table">
            <thead>
              <tr>
                <th>day</th>
                <th>q10</th>
                <th>q50</th>
                <th>q90</th>
                <th>normal</th>
              </tr>
            </thead>
            <tbody>
              {fc.map((r) => (
                <tr key={r.horizon}>
                  <td>+{r.horizon}d</td>
                  <td>{fmt(r.q10, 0)}</td>
                  <td>{fmt(r.q50, 0)}</td>
                  <td>{fmt(r.q90, 0)}</td>
                  <td>{fmt(r.normal_q50, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {node && (
        <div className="kv">
          <span>Friant release scenario</span>
          <span>{fmt(node.release_cfs ?? 395, 0)} cubic ft/sec</span>
          <span>Expected arrival (normal loss)</span>
          <span>{fmt(node.expected_arrival_cfs, 0)} cubic ft/sec</span>
          <span>Forecast arrival (median)</span>
          <span>{fmt(node.arrival_p50, 0)} cubic ft/sec</span>
          <span>Forecast arrival (80%)</span>
          <span>{fmtRange(node.arrival_p10, node.arrival_p90, 0)} cubic ft/sec</span>
          <span>Shortfall vs expected (median)</span>
          <span>{fmt(node.shortfall_p50, 0)} cubic ft/sec</span>
          <span>Shortfall (80% interval)</span>
          <span>{fmtRange(node.shortfall_p10, node.shortfall_p90, 0)} cubic ft/sec</span>
          <span>Upstream reaches</span>
          <span>{node.upstream_reaches.join(" → ")}</span>
        </div>
      )}

      {!reach && !node && (
        <p className="watch-meta">Select a reach or node on the map.</p>
      )}
    </div>
  );
}
