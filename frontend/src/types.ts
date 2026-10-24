export type TimelinePoint = {
  date: string;
  loss_cfs: number | null;
  q10: number;
  q50: number;
  q90: number;
  excess_loss_cfs?: number;
  anomaly: boolean;
  flood: boolean;
};

export type HorizonMetric = {
  mae_model?: number;
  mae_baseline?: number;
  skill: number;
  ci_lo?: number;
  ci_hi?: number;
  beats: boolean;
  n?: number;
};

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
    normal_loss_cfs?: number;
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
    normal_loss_cfs?: number;
    status: string;
    label: string;
    reason?: string;
  }>;
  nodes_shortfall: Array<{
    node_id: string;
    name: string;
    release_cfs?: number;
    expected_arrival_cfs: number;
    arrival_p10: number;
    arrival_p50: number;
    arrival_p90: number;
    shortfall_p10: number;
    shortfall_p50: number;
    shortfall_p90: number;
    upstream_reaches: string[];
    provenance?: string;
  }>;
  timeline: TimelinePoint[];
  timelines_by_reach?: Record<string, TimelinePoint[]>;
  reach_forecasts: Record<
    string,
    Array<{ horizon: number; q10: number; q50: number; q90: number; normal_q50?: number }>
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
    deployable: {
      horizons: Record<
        string,
        {
          n: number;
          persistence: HorizonMetric;
          sjrrp: HorizonMetric;
          flow_aware: HorizonMetric;
        }
      >;
      overall: Record<
        string,
        { beats_count: number; beats: boolean; mean_skill: number; mean_mae?: number }
      >;
      best_baseline: string;
      best_baseline_mae: number;
      model_mae: number;
      skill_vs_best: number;
    };
    deployable_regime?: Record<
      string,
      {
        n_days: number;
        n_rows: number;
        beats_count: number;
        beats: boolean;
        mean_skill: number;
        horizons: Record<string, HorizonMetric>;
      }
    >;
    whatif?: {
      horizons?: Record<
        string,
        {
          n: number;
          persistence: HorizonMetric;
          sjrrp: HorizonMetric;
          flow_aware: HorizonMetric;
        }
      >;
      overall?: Record<
        string,
        { beats_count: number; beats: boolean; mean_skill: number; mean_mae?: number }
      >;
      skill_vs_best?: number;
    };
    coverage: {
      coverage_raw: number;
      coverage_corrected: number;
      calib_2024_raw?: number | null;
      calib_2024_corrected?: number | null;
      scale: number;
    };
    feature_importance?: Record<string, number>;
    false_alarm_rate?: Record<
      string,
      {
        mean_flags_per_month: number;
        mean_raw_per_month: number;
        total_flags?: number;
        total_days?: number;
        months: number;
      }
    >;
    pitch: {
      pitch_scenario: string;
      pitch_key: string;
      best_baseline: string;
      skill_vs_best_baseline: number;
      skill_vs_sjrrp?: number;
      skill_vs_flow_aware?: number;
      ramp_n_days: number;
      long_horizon_beats: number;
      overall_beats: Record<string, boolean>;
    };
    train_rows: number;
    test_rows: number;
  };
  provenance: { labels: string; forecast: string; geometry: string; notes: string[] };
  gate: { passed: boolean };
};
