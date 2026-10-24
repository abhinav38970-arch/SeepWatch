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
import type { Bundle } from "./types";

type Props = { data: Bundle["timeline"] };

export default function TimelineChart({ data }: Props) {
  const chartData = data.map((d) => ({
    ...d,
    bandTop: d.q90,
    bandSpan: d.q90 - d.q10,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#243049" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#93a0b8", fontSize: 10 }}
          tickFormatter={(v) => String(v).slice(5)}
          minTickGap={30}
        />
        <YAxis tick={{ fill: "#93a0b8", fontSize: 10 }} width={42} />
        <Tooltip
          contentStyle={{ background: "#121a2b", border: "1px solid #243049", borderRadius: 8 }}
          labelStyle={{ color: "#e8eefc" }}
        />
        {/* Stacked area trick: base at q10, span to q90 */}
        <Area type="monotone" dataKey="q10" stackId="band" stroke="none" fill="transparent" />
        <Area
          type="monotone"
          dataKey="bandSpan"
          stackId="band"
          stroke="none"
          fill="#3dd6c6"
          fillOpacity={0.18}
          name="q10–q90"
        />
        <Line type="monotone" dataKey="q50" stroke="#3dd6c6" dot={false} strokeWidth={1.5} name="q50" />
        <Line type="monotone" dataKey="loss_cfs" stroke="#e8eefc" dot={false} strokeWidth={1.8} name="observed loss" />
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
