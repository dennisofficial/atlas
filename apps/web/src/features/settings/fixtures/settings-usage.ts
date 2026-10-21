export enum EUsageMetric {
  Tokens = 'tokens',
  Cost = 'cost',
}

export enum EUsageRange {
  Week = '7d',
  Fortnight = '14d',
  Month = '30d',
  Quarter = '90d',
}

export enum EUsageModel {
  Opus = 'Claude Opus',
  Sonnet = 'Claude Sonnet',
  Gpt5 = 'GPT-5',
  Gpt5Mini = 'GPT-5 mini',
}

export const RANGE_DAYS: Record<EUsageRange, number> = {
  [EUsageRange.Week]: 7,
  [EUsageRange.Fortnight]: 14,
  [EUsageRange.Month]: 30,
  [EUsageRange.Quarter]: 90,
}

const RANGE_SCALE: Record<EUsageRange, number> = {
  [EUsageRange.Week]: 1,
  [EUsageRange.Fortnight]: 2.03,
  [EUsageRange.Month]: 4.1,
  [EUsageRange.Quarter]: 11.8,
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TODAY_UTC = Date.UTC(2026, 9, 20)
const MS_PER_DAY = 86_400_000

export function dayLabel(daysAgo: number): string {
  const date = new Date(TODAY_UTC - daysAgo * MS_PER_DAY)
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

export type BubblePoint = {
  x: number
  hour: number
  tokens: number
  cost: number
}

function createSeededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hourActivity(hour: number): number {
  if (hour >= 1 && hour <= 6) return 0.12
  if (hour === 0 || hour === 7) return 0.3
  if (hour >= 8 && hour <= 10) return 0.55
  return 0.82
}

export function buildBubblePoints(range: EUsageRange): BubblePoint[] {
  const days = RANGE_DAYS[range]
  const random = createSeededRandom(2026_10_20)
  const points: BubblePoint[] = []
  for (let day = 0; day < days; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const roll = random()
      const weekendDamping = day % 7 === 2 || day % 7 === 3 ? 0.55 : 1
      if (roll > hourActivity(hour) * weekendDamping) continue
      const tokens = 0.15 + random() ** 2 * 9.4
      const cost = tokens * (3.6 + random() * 4.2)
      points.push({
        x: days - 1 - day,
        hour,
        tokens: Math.round(tokens * 100) / 100,
        cost: Math.round(cost * 100) / 100,
      })
    }
  }
  return points
}

export function buildDayTicks(range: EUsageRange): number[] {
  const days = RANGE_DAYS[range]
  const step = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15
  const ticks: number[] = []
  for (let x = days - 1; x >= 0; x -= step) ticks.push(x)
  return ticks.reverse()
}

type BreakdownEntry = { label: string; tokensMillions: number; cost: number }

const SURFACES: BreakdownEntry[] = [
  { label: 'Cloud', tokensMillions: 98.4, cost: 702.1 },
  { label: 'TUI', tokensMillions: 61.2, cost: 489.5 },
  { label: 'Serve', tokensMillions: 13.35, cost: 93.0 },
]

const MODELS: BreakdownEntry[] = [
  { label: EUsageModel.Opus, tokensMillions: 91.3, cost: 902.3 },
  { label: EUsageModel.Sonnet, tokensMillions: 52.6, cost: 261.4 },
  { label: EUsageModel.Gpt5, tokensMillions: 21.4, cost: 98.1 },
  { label: EUsageModel.Gpt5Mini, tokensMillions: 7.65, cost: 22.8 },
]

export function formatTokens(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}B`
  return `${millions.toFixed(2)}M`
}

export function formatCost(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export type SummaryEntry = { label: string; value: string }

export type UsageSummary = {
  total: string
  caption: string
  surfaces: SummaryEntry[]
  models: SummaryEntry[]
}

function summarize({
  entries,
  metric,
  scale,
}: {
  entries: BreakdownEntry[]
  metric: EUsageMetric
  scale: number
}): SummaryEntry[] {
  return entries.map((entry) => ({
    label: entry.label,
    value:
      metric === EUsageMetric.Tokens
        ? formatTokens(entry.tokensMillions * scale)
        : formatCost(entry.cost * scale),
  }))
}

export function buildSummary({
  metric,
  range,
}: {
  metric: EUsageMetric
  range: EUsageRange
}): UsageSummary {
  const scale = RANGE_SCALE[range]
  const days = RANGE_DAYS[range]
  const totalTokens = MODELS.reduce((sum, entry) => sum + entry.tokensMillions, 0) * scale
  const totalCost = MODELS.reduce((sum, entry) => sum + entry.cost, 0) * scale
  const isTokens = metric === EUsageMetric.Tokens
  return {
    total: isTokens ? formatTokens(totalTokens) : formatCost(totalCost),
    caption: `${isTokens ? 'total tokens' : 'total spend'} in the last ${days} days`,
    surfaces: summarize({ entries: SURFACES, metric, scale }),
    models: summarize({ entries: MODELS, metric, scale }),
  }
}
