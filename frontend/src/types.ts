export type Bundle = {
  meta: { asof: string; generated: string; version: string; mode_headline: string };
  pitch_scenario: string;
  pitch_key: string;
  headline: {
    excess_loss_7d_cfs: number;
    worst_node_shortfall: {
      node_id: string | null;
      name: string | null;
      p10: number | null;
      p50: number | null;
      p90: number | null;
    };
    skill_vs_best_baseline: number;
    best_baseline: string;
  };
  watchlist: Array<{
    reach_id: string;
    forecast_loss_cfs: number;
    recent_loss_cfs?: number | null;
    excess_loss_cfs: number;
    q10: number;
    q90: number;
    anomaly: boolean;
    label: string;
  }>;
  reach_colors: Array<{
    id: string;
    name: string;
    excess_loss_cfs: number | null;
    forecast_loss_cfs?: number;
    status: string;
    label: string;
    reason?: string;
  }>;
  nodes_shortfall: Array<{
    node_id: string;
    name: string;
    expected_arrival_cfs: number;
    arrival_p10: number;
    arrival_p50: number;
    arrival_p90: number;
    shortfall_p10: number;
    shortfall_p50: number;
    shortfall_p90: number;
    upstream_reaches: string[];
  }>;
  timeline: Array<{
    date: string;
    loss_cfs: number | null;
    q10: number;
    q50: number;
    q90: number;
    anomaly: boolean;
    flood: boolean;
  }>;
  reach_forecasts: Record<
    string,
    Array<{ horizon: number; q10: number; q50: number; q90: number }>
  >;
  alerts: string[];
  geometry: {
    reaches: Array<{
      id: string;
      name: string;
      coordinates: number[][];
      forecast: boolean;
      label: string;
    }>;
    nodes: Array<{ id: string; name: string; lon: number; lat: number }>;
    provenance: string;
  };
  evidence: {
    deployable: any;
    coverage: { coverage_raw: number; coverage_corrected: number; scale: number };
    pitch: any;
    train_rows: number;
    test_rows: number;
  };
  provenance: { labels: string; forecast: string; geometry: string; notes: string[] };
  gate: { passed: boolean };
};
