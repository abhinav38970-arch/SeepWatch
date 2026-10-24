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

type Props = { data: TimelinePoint[] };

export default function TimelineChart({ data }: Props) {
  const chartData = data
    .filter((d) => d.loss_cfs != null && d.q10 != null && d.q90 != null)
    .map((d) => ({
      ...d,
      band: [d.q10, d.q90] as [number, number],
    }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#d8dacf" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#64746f", fontSize: 9 }}
          tickFormatter={(v) => String(v).slice(5)}
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: "#64746f", fontSize: 9 }}
          width={44}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={{ background: "#fffef9", border: "1px solid #d8dacf", borderRadius: 3, fontSize: 10 }}
          labelStyle={{ color: "#10231f", fontWeight: 600 }}
          formatter={(value: unknown, name: string) => {
            if (Array.isArray(value) && value.length === 2) {
              return [`${Number(value[0]).toFixed(1)} to ${Number(value[1]).toFixed(1)} cubic ft/sec`, "expected range"];
            }
            if (typeof value === "number") {
              return [`${value.toFixed(1)} cubic ft/sec`, name];
            }
            return [String(value), name];
          }}
        />
        <Area
          type="monotone"
          dataKey="band"
          stroke="none"
          fill="#0d6e69"
          fillOpacity={0.17}
          name="expected range"
        />
        <Line
          type="monotone"
          dataKey="q50"
          stroke="#0d6e69"
          dot={false}
          strokeWidth={1.5}
          name="expected midpoint"
        />
        <Line
          type="monotone"
          dataKey="loss_cfs"
          stroke="#10231f"
          dot={false}
          strokeWidth={1.8}
          name="observed balance"
        />
        {chartData
          .filter((d) => d.anomaly && d.loss_cfs != null)
          .map((d) => (
            <ReferenceDot
              key={d.date}
              x={d.date}
              y={d.loss_cfs as number}
              r={3.5}
              fill="#f16d3a"
              stroke="none"
            />
          ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
