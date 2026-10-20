export enum EUsageMetric {
  Tokens = "tokens",
  Cost = "cost",
}

export enum EUsageRange {
  Week = "7d",
  Fortnight = "14d",
  Month = "30d",
  Quarter = "90d",
}

export enum EUsageModel {
  Opus = "Claude Opus",
  Sonnet = "Claude Sonnet",
  Gpt5 = "GPT-5",
  Gpt5Mini = "GPT-5 mini",
}

export const RANGE_DAYS: Record<EUsageRange, number> = {
  [EUsageRange.Week]: 7,
  [EUsageRange.Fortnight]: 14,
  [EUsageRange.Month]: 30,
  [EUsageRange.Quarter]: 90,
};

const RANGE_SCALE: Record<EUsageRange, number> = {
  [EUsageRange.Week]: 1,
  [EUsageRange.Fortnight]: 2.03,
  [EUsageRange.Month]: 4.1,
  [EUsageRange.Quarter]: 11.8,
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TODAY_UTC = Date.UTC(2026, 9, 20);
const MS_PER_DAY = 86_400_000;

export function dayLabel(daysAgo: number): string {
  const date = new Date(TODAY_UTC - daysAgo * MS_PER_DAY);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export type BubblePoint = {
  x: number;
  hour: number;
  tokens: number;
  cost: number;
};

function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hourActivity(hour: number): number {
  if (hour >= 1 && hour <= 6) return 0.12;
  if (hour === 0 || hour === 7) return 0.3;
  if (hour >= 8 && hour <= 10) return 0.55;
  return 0.82;
}

export function buildBubblePoints(range: EUsageRange): BubblePoint[] {
  const days = RANGE_DAYS[range];
  const random = createSeededRandom(2026_10_20);
  const points: BubblePoint[] = [];
  for (let day = 0; day < days; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const roll = random();
      const weekendDamping = day % 7 === 2 || day % 7 === 3 ? 0.55 : 1;
      if (roll > hourActivity(hour) * weekendDamping) continue;
      const tokens = 0.15 + random() ** 2 * 9.4;
      const cost = tokens * (3.6 + random() * 4.2);
      points.push({
        x: days - 1 - day,
        hour,
        tokens: Math.round(tokens * 100) / 100,
        cost: Math.round(cost * 100) / 100,
      });
    }
  }
  return points;
}

export function buildDayTicks(range: EUsageRange): number[] {
  const days = RANGE_DAYS[range];
  const step = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;
  const ticks: number[] = [];
  for (let x = days - 1; x >= 0; x -= step) ticks.push(x);
  return ticks.reverse();
}

type BreakdownEntry = { label: string; tokensMillions: number; cost: number };

const SURFACES: BreakdownEntry[] = [
  { label: "Cloud", tokensMillions: 98.4, cost: 702.1 },
  { label: "TUI", tokensMillions: 61.2, cost: 489.5 },
  { label: "Serve", tokensMillions: 13.35, cost: 93.0 },
];

const MODELS: BreakdownEntry[] = [
  { label: EUsageModel.Opus, tokensMillions: 91.3, cost: 902.3 },
  { label: EUsageModel.Sonnet, tokensMillions: 52.6, cost: 261.4 },
  { label: EUsageModel.Gpt5, tokensMillions: 21.4, cost: 98.1 },
  { label: EUsageModel.Gpt5Mini, tokensMillions: 7.65, cost: 22.8 },
];

export function formatTokens(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}B`;
  return `${millions.toFixed(2)}M`;
}

export function formatCost(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type SummaryEntry = { label: string; value: string };

export type UsageSummary = {
  total: string;
  caption: string;
  surfaces: SummaryEntry[];
  models: SummaryEntry[];
};

function summarize({
  entries,
  metric,
  scale,
}: {
  entries: BreakdownEntry[];
  metric: EUsageMetric;
  scale: number;
}): SummaryEntry[] {
  return entries.map((entry) => ({
    label: entry.label,
    value:
      metric === EUsageMetric.Tokens
        ? formatTokens(entry.tokensMillions * scale)
        : formatCost(entry.cost * scale),
  }));
}

export function buildSummary({
  metric,
  range,
}: {
  metric: EUsageMetric;
  range: EUsageRange;
}): UsageSummary {
  const scale = RANGE_SCALE[range];
  const days = RANGE_DAYS[range];
  const totalTokens = MODELS.reduce((sum, entry) => sum + entry.tokensMillions, 0) * scale;
  const totalCost = MODELS.reduce((sum, entry) => sum + entry.cost, 0) * scale;
  const isTokens = metric === EUsageMetric.Tokens;
  return {
    total: isTokens ? formatTokens(totalTokens) : formatCost(totalCost),
    caption: `${isTokens ? "total tokens" : "total spend"} in the last ${days} days`,
    surfaces: summarize({ entries: SURFACES, metric, scale }),
    models: summarize({ entries: MODELS, metric, scale }),
  };
}

export type ThreadSpend = {
  id: string;
  title: string;
  repo: string;
  model: EUsageModel;
  spend: number;
  tokensMillions: number;
  minutesAgo: number;
};

export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export const RECENT_THREAD_SPEND: ThreadSpend[] = [
  { id: "t-9f31", title: "fix flaky ws reconnect", repo: "dltech/atlas", model: EUsageModel.Opus, spend: 12.84, tokensMillions: 2.9, minutesAgo: 6 },
  { id: "t-9e07", title: "rs-crm: ticket PDF export", repo: "dltech/rs-crm", model: EUsageModel.Sonnet, spend: 3.41, tokensMillions: 1.2, minutesAgo: 47 },
  { id: "t-9d88", title: "review PR #1270 lifecycle rebuild", repo: "dltech/atlas", model: EUsageModel.Gpt5, spend: 2.17, tokensMillions: 0.7, minutesAgo: 95 },
  { id: "t-9c52", title: "storybook settings mockups", repo: "dltech/atlas", model: EUsageModel.Opus, spend: 18.6, tokensMillions: 4.1, minutesAgo: 180 },
  { id: "t-9b14", title: "rename sandbox snapshot flags", repo: "dltech/atlas", model: EUsageModel.Gpt5Mini, spend: 0.26, tokensMillions: 0.4, minutesAgo: 305 },
  { id: "t-9a60", title: "triage nightly canary failure", repo: "dltech/comp-v3", model: EUsageModel.Sonnet, spend: 1.93, tokensMillions: 0.9, minutesAgo: 480 },
  { id: "t-99f2", title: "draft migration for pending invites", repo: "dltech/rs-crm", model: EUsageModel.Opus, spend: 7.05, tokensMillions: 1.6, minutesAgo: 640 },
];

export const ALL_THREAD_SPEND: ThreadSpend[] = [
  ...RECENT_THREAD_SPEND,
  { id: "t-98a1", title: "tui: shimmer ticker perf pass", repo: "dltech/atlas", model: EUsageModel.Opus, spend: 24.7, tokensMillions: 5.8, minutesAgo: 1_020 },
  { id: "t-9733", title: "serve: reconnect backoff tests", repo: "dltech/atlas", model: EUsageModel.Sonnet, spend: 4.22, tokensMillions: 1.5, minutesAgo: 1_700 },
  { id: "t-9610", title: "explain bun isolated linker", repo: "dltech/atlas", model: EUsageModel.Gpt5Mini, spend: 0.09, tokensMillions: 0.1, minutesAgo: 2_900 },
  { id: "t-9544", title: "web: cloud thread list virtualization", repo: "dltech/atlas", model: EUsageModel.Opus, spend: 31.15, tokensMillions: 7.2, minutesAgo: 4_300 },
];

export type DailySpend = {
  label: string;
  byModel: { model: EUsageModel; spend: number }[];
};

const DAILY_COSTS: [number, number, number, number][] = [
  [188.4, 38.2, 14.6, 3.4],
  [141.2, 41.5, 17.3, 3.9],
  [96.7, 29.1, 11.2, 2.6],
  [152.9, 44.6, 16.4, 3.7],
  [118.1, 36.8, 13.9, 3.1],
  [74.3, 28.4, 10.8, 2.4],
  [130.7, 42.8, 13.9, 3.7],
];

export const DAILY_SPEND: DailySpend[] = DAILY_COSTS.map(([opus, sonnet, gpt5, mini], index) => ({
  label: dayLabel(index),
  byModel: [
    { model: EUsageModel.Opus, spend: opus },
    { model: EUsageModel.Sonnet, spend: sonnet },
    { model: EUsageModel.Gpt5, spend: gpt5 },
    { model: EUsageModel.Gpt5Mini, spend: mini },
  ],
}));

export type SandboxRow = {
  id: string;
  title: string;
  repo: string;
  size: string;
  last24h: string;
  cost: string;
  runningFor?: string;
  pausedAgo?: string;
};

export const RUNNING_SANDBOXES: SandboxRow[] = [
  { id: "sb-41", title: "fix flaky ws reconnect", repo: "dltech/atlas", size: "standard-4", last24h: "6h13m", cost: "$2.06", runningFor: "5m" },
  { id: "sb-42", title: "rs-crm: ticket PDF export", repo: "dltech/rs-crm", size: "standard-2", last24h: "3h02m", cost: "$0.77", runningFor: "1h 42m" },
  { id: "sb-43", title: "storybook settings mockups", repo: "dltech/atlas", size: "standard-8", last24h: "2h40m", cost: "$1.88", runningFor: "38m" },
];

export const PAUSED_SANDBOXES: SandboxRow[] = [
  { id: "sb-37", title: "triage nightly canary failure", repo: "dltech/comp-v3", size: "standard-2", last24h: "1h11m", cost: "$0.28", pausedAgo: "12m ago" },
  { id: "sb-35", title: "draft migration for pending invites", repo: "dltech/rs-crm", size: "standard-4", last24h: "4h27m", cost: "$1.49", pausedAgo: "2h ago" },
];
