import type { Bundle } from "./types";

type Props = {
  bundle: Bundle;
  selected: string | null;
  onClose: () => void;
};

function fmt(n: number | null | undefined, d = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(d);
}

export default function DetailDrawer({ bundle, selected, onClose }: Props) {
  if (selected === "evidence") {
    const horizons = bundle.evidence.deployable?.horizons ?? {};
    const hs = Object.keys(horizons).sort((a, b) => Number(a) - Number(b));
    return (
      <div className="drawer">
        <header>
          <div>
            <h3>Evidence</h3>
            <div className="watch-meta">
              Pitch {bundle.pitch_scenario} · {bundle.pitch_key} · coverage{" "}
              {fmt((bundle.evidence.coverage?.coverage_raw ?? 0) * 100, 1)}%
            </div>
          </div>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="watch-meta" style={{ marginTop: 12 }}>
          Pre-registered rules in docs/EVALUATION_RULES.md. Headline skill uses deployable mode
          (future flow held constant). Train {bundle.evidence.train_rows} / test{" "}
          {bundle.evidence.test_rows} rows.
        </p>
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
              const cell = (k: string) => {
                const s = row[k]?.skill;
                const beat = row[k]?.beats;
                return (
                  <td className={beat ? "beat" : "miss"}>
                    {fmt(s, 3)}
                    {beat ? " ✓" : ""}
                  </td>
                );
              };
              return (
                <tr key={h}>
                  <td>{h}</td>
                  {cell("persistence")}
                  {cell("sjrrp")}
                  {cell("flow_aware")}
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2 style={{ marginTop: 16, fontSize: "0.78rem", color: "var(--muted)" }}>HONEST LIMITS</h2>
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

  return (
    <div className="drawer">
      <header>
        <div>
          <h3>{reach?.name ?? node?.name ?? selected}</h3>
          <div className="watch-meta">
            {reach ? `label: ${reach.label}` : node ? "node shortfall" : ""}
          </div>
        </div>
        <button onClick={onClose}>Close</button>
      </header>

      {reach && (
        <div className="kv">
          <span>Status</span>
          <span>{reach.status}</span>
          <span>Forecast loss (mean 1–7d)</span>
          <span>{fmt(reach.forecast_loss_cfs ?? watch?.forecast_loss_cfs)} cfs</span>
          <span>Excess vs recent</span>
          <span>{fmt(reach.excess_loss_cfs ?? watch?.excess_loss_cfs)} cfs</span>
          <span>Provenance</span>
          <span>{reach.label}</span>
        </div>
      )}

      {fc && (
        <>
          <h2 style={{ fontSize: "0.78rem", color: "var(--muted)" }}>FORECAST BY HORIZON</h2>
          <table className="evidence-table">
            <thead>
              <tr>
                <th>day</th>
                <th>q10</th>
                <th>q50</th>
                <th>q90</th>
              </tr>
            </thead>
            <tbody>
              {fc.map((r) => (
                <tr key={r.horizon}>
                  <td>+{r.horizon}</td>
                  <td>{fmt(r.q10, 0)}</td>
                  <td>{fmt(r.q50, 0)}</td>
                  <td>{fmt(r.q90, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {node && (
        <div className="kv">
          <span>Expected arrival</span>
          <span>{fmt(node.expected_arrival_cfs, 0)} cfs</span>
          <span>Forecast arrival (80%)</span>
          <span>
            {fmt(node.arrival_p10, 0)}–{fmt(node.arrival_p90, 0)} cfs
          </span>
          <span>Shortfall (80%)</span>
          <span>
            {fmt(node.shortfall_p10, 0)}–{fmt(node.shortfall_p90, 0)} cfs
          </span>
          <span>Upstream reaches</span>
          <span>{node.upstream_reaches.join(", ")}</span>
        </div>
      )}

      {!reach && !node && (
        <p className="watch-meta">Select a reach or node on the map.</p>
      )}
    </div>
  );
}
