import type { TimingStats } from './results'

export type ConfusionCounts = { tp: number; fp: number; tn: number; fn: number }

export type ConfusionRow = { expectedPositive: boolean; predictedPositive: boolean }

export type PrecisionRecall = {
  precision: number | null
  recall: number | null
  f1: number | null
  fpr: number | null
}

export type RatioMetric = { value: number | null; numerator: number; denominator: number }

const ratioOrNull = ({ numerator, denominator }: { numerator: number; denominator: number }): number | null =>
  denominator === 0 ? null : numerator / denominator

export function confusionCounts({ rows }: { rows: readonly ConfusionRow[] }): ConfusionCounts {
  const counts: ConfusionCounts = { tp: 0, fp: 0, tn: 0, fn: 0 }
  for (const row of rows) {
    if (row.expectedPositive && row.predictedPositive) counts.tp += 1
    else if (!row.expectedPositive && row.predictedPositive) counts.fp += 1
    else if (!row.expectedPositive && !row.predictedPositive) counts.tn += 1
    else counts.fn += 1
  }
  return counts
}

export function precisionRecallF1({ counts }: { counts: ConfusionCounts }): PrecisionRecall {
  const precision = ratioOrNull({ numerator: counts.tp, denominator: counts.tp + counts.fp })
  const recall = ratioOrNull({ numerator: counts.tp, denominator: counts.tp + counts.fn })
  const fpr = ratioOrNull({ numerator: counts.fp, denominator: counts.fp + counts.tn })
  if (precision === null || recall === null) return { precision, recall, f1: null, fpr }
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { precision, recall, f1, fpr }
}

export function exactMatchAccuracy({ matches, total }: { matches: number; total: number }): RatioMetric {
  return { value: ratioOrNull({ numerator: matches, denominator: total }), numerator: matches, denominator: total }
}

export function meanScore({ values }: { values: readonly number[] }): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const nearestRank = ({ sorted, percentile }: { sorted: readonly number[]; percentile: number }): number | null => {
  const rank = Math.max(1, Math.ceil(percentile * sorted.length))
  return sorted[rank - 1] ?? null
}

export function timingStats({ samples }: { samples: readonly number[] }): TimingStats {
  if (samples.length === 0) return { p50: null, p95: null, samples: 0 }
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    p50: nearestRank({ sorted, percentile: 0.5 }),
    p95: nearestRank({ sorted, percentile: 0.95 }),
    samples: sorted.length,
  }
}

export function repeatFlipCount({
  rowsByCase,
}: {
  rowsByCase: ReadonlyMap<string, readonly { trialId: string; passed: boolean }[]>
}): number {
  let flips = 0
  for (const trials of rowsByCase.values()) {
    if (trials.length < 2) continue
    const outcomes = new Set(trials.map((trial) => trial.passed))
    if (outcomes.size > 1) flips += 1
  }
  return flips
}
