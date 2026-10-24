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

type TimelineRow = TimelinePoint;

type Props = {
  data?: TimelineRow[];
  rows?: TimelineRow[];
};

const MGD_PER_CFS = 0.646317;
const DAYS_SHOWN = 120;

const RED = "#ff453a";
const GRAY_TEXT = "#8e8e93";

function toPositiveLossMgd(cfs: number | null | undefined): number {
  if (cfs == null || Number.isNaN(cfs)) return 0;
  return Number((Math.max(0, -cfs) * MGD_PER_CFS).toFixed(1));
}

type TipPayload = { payload?: { actual_mgd?: number; normal_mgd?: number } };

function DarkTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  payload?: TipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="sw-tip">
      <div className="sw-tip-date">{String(label)}</div>
      <div className="sw-tip-row">
        <i style={{ background: RED }} />
        Lost <b>{Math.round(row.actual_mgd ?? 0)}M</b>
      </div>
      <div className="sw-tip-row">
        <i style={{ background: "#8e8e93" }} />
        Normal <b>{Math.round(row.normal_mgd ?? 0)}M</b>
      </div>
    </div>
  );
}

export default function TimelineChart({ data, rows }: Props) {
  const source = data ?? rows ?? [];
  const chartData = source
    .filter((d) => d.loss_cfs != null && d.q10 != null && d.q90 != null)
    .slice(-DAYS_SHOWN)
    .map((d) => {
      const boundA = toPositiveLossMgd(d.q10);
      const boundB = toPositiveLossMgd(d.q90);
      return {
        ...d,
        actual_mgd: toPositiveLossMgd(d.loss_cfs),
        normal_mgd: toPositiveLossMgd(d.q50),
        band_mgd: [Math.min(boundA, boundB), Math.max(boundA, boundB)] as [number, number],
      };
    });

  return (
    <div className="sw-chart">
      <div className="sw-chart-legend">
        <span>
          <i className="sw-key-line" /> Water lost
        </span>
        <span>
          <i className="sw-key-band" /> Normal
        </span>
        <span>
          <i className="sw-key-dot" /> Alert
        </span>
      </div>
      <p className="sw-chart-caption">Red above gray means a leak.</p>

      <div className="sw-chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: GRAY_TEXT, fontSize: 9 }}
              tickFormatter={(v) => String(v).slice(5)}
              minTickGap={36}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: GRAY_TEXT, fontSize: 9 }}
              tickFormatter={(v) => `${v}M`}
              width={36}
              domain={["auto", "auto"]}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<DarkTooltip />}
              cursor={{ stroke: "rgba(255,255,255,0.18)", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="band_mgd"
              stroke="none"
              fill="#8e8e93"
              fillOpacity={0.22}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="actual_mgd"
              className="sw-line-glow"
              stroke={RED}
              dot={false}
              activeDot={{ r: 4, fill: RED, stroke: "#000", strokeWidth: 1 }}
              strokeWidth={2.2}
              isAnimationActive={false}
            />
            {chartData
              .filter((d) => d.anomaly)
              .map((d) => (
                <ReferenceDot
                  key={d.date}
                  x={d.date}
                  y={d.actual_mgd}
                  r={2.5}
                  fill={RED}
                  stroke="none"
                  className="sw-dot-glow"
                />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
