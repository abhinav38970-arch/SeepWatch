export const GALLONS_PER_CFS_DAY = 646_317;
export const ACRE_FEET_PER_CFS_DAY = 1.9835;

export function cfsToMgd(cfs: number | null | undefined): number | null {
  if (cfs == null || Number.isNaN(cfs)) return null;
  return (Math.abs(cfs) * GALLONS_PER_CFS_DAY) / 1_000_000;
}

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtMgd(
  cfs: number | null | undefined,
  digits = 0,
  unit = "M gal/day"
): string {
  const mgd = cfsToMgd(cfs);
  if (mgd == null) return "—";
  return `${fmtNumber(mgd, digits)} ${unit}`;
}

export function fmtMillionGallonsHeadline(
  cfs: number | null | undefined,
  digits = 0
): string {
  const mgd = cfsToMgd(cfs);
  if (mgd == null) return "—";
  return `${fmtNumber(mgd, digits)} Million Gallons`;
}

export const REACH_FRIENDLY_NAMES: Record<string, string> = {
  R2A: "Gravelly Ford to Chowchilla Canal",
  R1: "Friant Dam to Gravelly Ford Canal",
  R2B3: "Chowchilla to Dos Palos Canal",
  R4A: "Dos Palos to Merced (Washington Rd)",
};

export const NODE_FRIENDLY_NAMES: Record<string, string> = {
  GRF: "Gravelly Ford (Madera)",
  SJB: "Chowchilla Canal Split",
  SDP: "Dos Palos (Sack Dam)",
  SWA: "Washington Rd (Merced)",
};

export type ReachLeakPresentation = {
  id: string;
  friendlyName: string;
  statusBadge: string;
  severityLabel: string;
  dotEmoji: string;
  accentColor: string;
  bgColor: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
  plainExplanation: string;
  fieldAction: string;
  sortOrder: number;
};

export const REACH_PRESENTATION: Record<string, ReachLeakPresentation> = {
  R2A: {
    id: "R2A",
    friendlyName: "Gravelly Ford to Chowchilla Canal",
    statusBadge: "🔴 Major Leak — 48M gal/day wasted",
    severityLabel: "Major Leak",
    dotEmoji: "🔴",
    accentColor: "#dc2626",
    bgColor: "#fff1f0",
    borderColor: "#ef4444",
    badgeBg: "#fee2e2",
    badgeText: "#991b1b",
    plainExplanation:
      "Losing 110M gal/day total vs. 63M gal/day normal seepage — 48M gal/day is escaping above normal right upstream of Chowchilla farm turnouts.",
    fieldAction:
      "Send canal crew first: inspect unlined banks between Gravelly Ford (Madera) and Chowchilla Canal Split.",
    sortOrder: 1,
  },
  R1: {
    id: "R1",
    friendlyName: "Friant Dam to Gravelly Ford Canal",
    statusBadge: "🟠 Moderate Seepage — Within normal range",
    severityLabel: "Moderate Seepage",
    dotEmoji: "🟠",
    accentColor: "#d97706",
    bgColor: "#fffbeb",
    borderColor: "#f59e0b",
    badgeBg: "#fef3c7",
    badgeText: "#92400e",
    plainExplanation:
      "Natural gravel-bed absorption (~115M gal/day vs. 131M gal/day normal baseline) as water leaves Friant Dam. No abnormal leak spike.",
    fieldAction:
      "Routine watch only — seepage is within expected groundwater recharge levels.",
    sortOrder: 2,
  },
  R4A: {
    id: "R4A",
    friendlyName: "Dos Palos to Merced (Washington Rd)",
    statusBadge: "🟡 Minor Trickle — Low flow watch",
    severityLabel: "Minor Trickle",
    dotEmoji: "🟡",
    accentColor: "#ca8a04",
    bgColor: "#fefce8",
    borderColor: "#eab308",
    badgeBg: "#fef9c3",
    badgeText: "#854d0e",
    plainExplanation:
      "Small ~6M gal/day loss across this lower canal stretch — too small to indicate a pipe or bank break.",
    fieldAction:
      "Low-priority watch — re-check Leak Checkpoints when downstream irrigation demand rises.",
    sortOrder: 3,
  },
  R2B3: {
    id: "R2B3",
    friendlyName: "Chowchilla to Dos Palos Canal",
    statusBadge: "🟢 Healthy Flow — No water wasted",
    severityLabel: "Healthy Flow",
    dotEmoji: "🟢",
    accentColor: "#16a34a",
    bgColor: "#f0fdf4",
    borderColor: "#22c55e",
    badgeBg: "#dcfce7",
    badgeText: "#166534",
    plainExplanation:
      "Canal is holding water well (+16M gal/day local return flow) with zero excess water loss between Leak Checkpoints.",
    fieldAction:
      "No action needed — section is delivering expected water volume.",
    sortOrder: 4,
  },
};

export function friendlyReachName(
  id: string | null | undefined,
  fallback?: string | null
): string {
  if (!id) return fallback ?? "Canal Section";
  return REACH_FRIENDLY_NAMES[id] ?? fallback ?? id;
}

export function friendlyNodeName(
  id: string | null | undefined,
  fallback?: string | null
): string {
  if (!id) return fallback ?? "Leak Checkpoint";
  return NODE_FRIENDLY_NAMES[id] ?? fallback ?? id;
}
