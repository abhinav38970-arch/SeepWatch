import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
} from "recharts";
import type { TimelinePoint } from "./types";

export type TimelineRow = TimelinePoint;

type Props = {
  data?: TimelineRow[];
  rows?: TimelineRow[];
};

const MGD_PER_CFS = 0.646317;

function toPositiveLossMgd(cfs: number | null | undefined): number {
  if (cfs == null || Number.isNaN(cfs)) return 0;
  return Number((Math.max(0, -cfs) * MGD_PER_CFS).toFixed(1));
}

export default function TimelineChart({ data, rows }: Props) {
  const source = data ?? rows ?? [];
  const chartData = source
    .filter((d) => d.loss_cfs != null && d.q10 != null && d.q90 != null)
    .map((d) => {
      const boundA = toPositiveLossMgd(d.q10);
      const boundB = toPositiveLossMgd(d.q90);
      const lowMgd = Math.min(boundA, boundB);
      const highMgd = Math.max(boundA, boundB);
      const normalMgd = toPositiveLossMgd(d.q50);
      const actualMgd = toPositiveLossMgd(d.loss_cfs);
      return {
        ...d,
        actual_mgd: actualMgd,
        normal_mgd: normalMgd,
        band_mgd: [lowMgd, highMgd] as [number, number],
      };
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "6px 12px",
          fontSize: "10px",
          color: "#10231f",
          marginBottom: "2px",
          lineHeight: 1.3,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 3,
              borderRadius: 2,
              background: "#e04f26",
            }}
          />
          Actual Water Lost (Million gal/day)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#0d6e69", fontWeight: 600 }}>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 8,
              borderRadius: 2,
              background: "rgba(13, 110, 105, 0.2)",
              borderTop: "1.5px dashed #0d6e69",
            }}
          />
          Normal Expected Seepage
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#c93b1b", fontWeight: 600 }}>
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#e04f26",
            }}
          />
          Big Leak Alert Days
        </span>
      </div>

      <p
        style={{
          margin: "0 0 6px 0",
          fontSize: "10.5px",
          color: "#52645e",
          fontStyle: "italic",
          lineHeight: 1.35,
        }}
      >
        When the red line jumps above the normal shaded zone, the canal is leaking extra water.
      </p>

      <div style={{ flex: 1, minHeight: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: 2, bottom: 0 }}>
            <CartesianGrid stroke="#d8dacf" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#64746f", fontSize: 9 }}
              tickFormatter={(v) => String(v).slice(5)}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "#64746f", fontSize: 9 }}
              tickFormatter={(v) => `${v}M`}
              width={42}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                background: "#fffef9",
                border: "1px solid #d8dacf",
                borderRadius: 4,
                fontSize: 10.5,
              }}
              labelStyle={{ color: "#10231f", fontWeight: 700 }}
              formatter={(value: unknown, name: string) => {
                if (Array.isArray(value) && value.length === 2) {
                  return [
                    `${Number(value[0]).toFixed(1)} to ${Number(value[1]).toFixed(1)} M gal/day`,
                    "Normal Expected Seepage (Range)",
                  ];
                }
                if (typeof value === "number") {
                  return [`${value.toFixed(1)} M gal/day`, name];
                }
                return [String(value), name];
              }}
            />
            <Area
              type="monotone"
              dataKey="band_mgd"
              stroke="none"
              fill="#0d6e69"
              fillOpacity={0.18}
              name="Normal Expected Seepage (Range)"
            />
            <Line
              type="monotone"
              dataKey="normal_mgd"
              stroke="#0d6e69"
              strokeDasharray="4 3"
              dot={false}
              strokeWidth={1.6}
              name="Normal Expected Seepage"
            />
            <Line
              type="monotone"
              dataKey="actual_mgd"
              stroke="#e04f26"
              dot={false}
              strokeWidth={2.1}
              name="Actual Water Lost (Million gal/day)"
            />
            {chartData
              .filter((d) => d.anomaly && d.actual_mgd != null)
              .map((d) => (
                <ReferenceDot
                  key={d.date}
                  x={d.date}
                  y={d.actual_mgd}
                  r={4}
                  fill="#d92d20"
                  stroke="#fffef9"
                  strokeWidth={1}
                />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
