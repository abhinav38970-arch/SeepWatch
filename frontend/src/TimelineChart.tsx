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
        <CartesianGrid stroke="#243049" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#93a0b8", fontSize: 10 }}
          tickFormatter={(v) => String(v).slice(5)}
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: "#93a0b8", fontSize: 10 }}
          width={44}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={{ background: "#121a2b", border: "1px solid #243049", borderRadius: 8 }}
          labelStyle={{ color: "#e8eefc", fontWeight: 600 }}
          formatter={(value: unknown, name: string) => {
            if (Array.isArray(value) && value.length === 2) {
              return [`${Number(value[0]).toFixed(1)} to ${Number(value[1]).toFixed(1)} cfs`, "q10–q90 band"];
            }
            if (typeof value === "number") {
              return [`${value.toFixed(1)} cfs`, name];
            }
            return [String(value), name];
          }}
        />
        <Area
          type="monotone"
          dataKey="band"
          stroke="none"
          fill="#3dd6c6"
          fillOpacity={0.22}
          name="q10–q90"
        />
        <Line
          type="monotone"
          dataKey="q50"
          stroke="#3dd6c6"
          dot={false}
          strokeWidth={1.5}
          name="expected (q50)"
        />
        <Line
          type="monotone"
          dataKey="loss_cfs"
          stroke="#e8eefc"
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
              fill="#f07178"
              stroke="none"
            />
          ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
