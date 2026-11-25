export const WILSON_Z = 1.959963984540054

export type JevRealMetricRow = {
  error: string | null
  inclusionProbability: number
  expected: { notify: boolean }
  actual: { notify: boolean } | null
}

export type JevRealSummary = {
  status: 'complete' | 'incomplete'
  items: number
  scored: number
  errors: number
  nudges: number
  expectedNudges: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  trueNegatives: number
  precision: number | null
  precisionLowerBound: number | null
  weightedPrecision: number | null
  weightedRecall: number | null
  recallWeight: number
}

export function wilsonLowerBound({
  successes,
  total,
  z = WILSON_Z,
}: {
  successes: number
  total: number
  z?: number
}): number | null {
  if (total <= 0) return null
  if (!Number.isFinite(successes) || successes < 0 || successes > total)
    throw new Error(`wilson bound needs 0 <= successes <= total, got ${successes} of ${total}`)
  const proportion = successes / total
  const zSquared = z * z
  const denominator = 1 + zSquared / total
  const centre = proportion + zSquared / (2 * total)
  const margin =
    z * Math.sqrt((proportion * (1 - proportion)) / total + zSquared / (4 * total * total))
  return Math.max(0, (centre - margin) / denominator)
}

const weightOf = ({ row }: { row: JevRealMetricRow }): number => 1 / row.inclusionProbability

export function summarizeJevReal({ rows }: { rows: readonly JevRealMetricRow[] }): JevRealSummary {
  const scored = rows.filter((row) => row.error === null && row.actual !== null)
  const counts = {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    trueNegatives: 0,
    recallWeight: 0,
    truePositiveWeight: 0,
    predictedWeight: 0,
    nudges: 0,
    expectedNudges: 0,
  }
  for (const row of scored) {
    const predicted = row.actual?.notify ?? false
    const labelled = row.expected.notify
    if (predicted) {
      counts.nudges += 1
      counts.predictedWeight += weightOf({ row })
    }
    if (labelled) counts.expectedNudges += 1
    if (predicted && labelled) {
      counts.truePositives += 1
      counts.truePositiveWeight += weightOf({ row })
    }
    if (predicted && !labelled) counts.falsePositives += 1
    if (!predicted && labelled) counts.falseNegatives += 1
    if (!predicted && !labelled) counts.trueNegatives += 1
    if (labelled) counts.recallWeight += weightOf({ row })
  }
  const predictedNudges = counts.truePositives + counts.falsePositives
  const errors = rows.length - scored.length
  return {
    status: errors === 0 ? 'complete' : 'incomplete',
    items: rows.length,
    scored: scored.length,
    errors,
    nudges: counts.nudges,
    expectedNudges: counts.expectedNudges,
    truePositives: counts.truePositives,
    falsePositives: counts.falsePositives,
    falseNegatives: counts.falseNegatives,
    trueNegatives: counts.trueNegatives,
    precision: predictedNudges === 0 ? null : counts.truePositives / predictedNudges,
    precisionLowerBound: wilsonLowerBound({
      successes: counts.truePositives,
      total: predictedNudges,
    }),
    weightedPrecision:
      counts.predictedWeight === 0 ? null : counts.truePositiveWeight / counts.predictedWeight,
    weightedRecall:
      counts.recallWeight === 0 ? null : counts.truePositiveWeight / counts.recallWeight,
    recallWeight: counts.recallWeight,
  }
}

const ratioText = (value: number | null): string =>
  value === null ? 'undefined' : value.toFixed(3)

export function formatJevRealText({ summary }: { summary: JevRealSummary }): string {
  return [
    `status: ${summary.status}`,
    `items: ${summary.items} scored: ${summary.scored} errors: ${summary.errors}`,
    `nudges: ${summary.nudges} (labelled nudge: ${summary.expectedNudges})`,
    `tp: ${summary.truePositives} fp: ${summary.falsePositives} fn: ${summary.falseNegatives} tn: ${summary.trueNegatives}`,
    `precision: ${ratioText(summary.precision)} wilson95 lower: ${ratioText(summary.precisionLowerBound)}`,
    `weighted precision: ${ratioText(summary.weightedPrecision)}`,
    `weighted recall: ${ratioText(summary.weightedRecall)} (weight ${summary.recallWeight.toFixed(2)})`,
  ].join('\n')
}
