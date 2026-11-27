import { createHash } from 'node:crypto'

export enum EJevLabelStratum {
  Nudged = 'nudged',
  NearMiss = 'near_miss',
  Random = 'random',
}

export const JEV_LABEL_STRATUM_ORDER: readonly EJevLabelStratum[] = [
  EJevLabelStratum.Nudged,
  EJevLabelStratum.NearMiss,
  EJevLabelStratum.Random,
]

export const JEV_LABEL_DEFAULT_NEAR_MISS = 20
export const JEV_LABEL_DEFAULT_RANDOM = 20
export const JEV_LABEL_DEFAULT_SEED = 'quality-maintain-jev'
export const JEV_LABEL_PROBABILITY_DIGITS = 6

export type JevLabelFrameRow = {
  generationId: string
  traceId: string
  scopeId: string
  policyId: string
  path: string | null
  verdict: string
  impact: string | null
  timestamp: string
}

export type JevLabelStratumSample = {
  row: JevLabelFrameRow
  stratum: EJevLabelStratum
  inclusionProbability: number
}

export class JevLabelSampleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JevLabelSampleError'
  }
}

export function stratumOf({ verdict }: { verdict: string }): EJevLabelStratum {
  if (verdict === 'nudged') return EJevLabelStratum.Nudged
  if (verdict === 'near_miss' || verdict === 'tracked_debt') return EJevLabelStratum.NearMiss
  return EJevLabelStratum.Random
}

export function stableRank({ seed, key }: { seed: string; key: string }): string {
  return createHash('sha256').update(`${seed}\u0000${key}`).digest('hex')
}

export function inclusionProbabilityOf({
  requested,
  available,
  traceScopeCount,
}: {
  requested: number
  available: number
  traceScopeCount: number
}): number {
  if (available <= 0) throw new JevLabelSampleError('inclusion probability needs one candidate')
  if (traceScopeCount <= 0)
    throw new JevLabelSampleError('inclusion probability needs at least one scope in the trace')
  const probability = Math.min(1, requested / available) / traceScopeCount
  const rounded = Number(probability.toFixed(JEV_LABEL_PROBABILITY_DIGITS))
  return rounded > 0 ? rounded : 10 ** -JEV_LABEL_PROBABILITY_DIGITS
}

const rowsByTrace = ({
  rows,
}: {
  rows: readonly JevLabelFrameRow[]
}): Map<string, JevLabelFrameRow[]> => {
  const grouped = new Map<string, JevLabelFrameRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.traceId) ?? []
    existing.push(row)
    grouped.set(row.traceId, existing)
  }
  return grouped
}

const lowestRanked = ({
  rows,
  seed,
}: {
  rows: readonly JevLabelFrameRow[]
  seed: string
}): JevLabelFrameRow => {
  let best = rows[0] as JevLabelFrameRow
  let bestRank = stableRank({ seed, key: best.scopeId })
  for (const row of rows.slice(1)) {
    const rank = stableRank({ seed, key: row.scopeId })
    if (rank < bestRank) {
      best = row
      bestRank = rank
    }
  }
  return best
}

export function selectJevLabelSample({
  rows,
  nearMiss = JEV_LABEL_DEFAULT_NEAR_MISS,
  random = JEV_LABEL_DEFAULT_RANDOM,
  seed = JEV_LABEL_DEFAULT_SEED,
}: {
  rows: readonly JevLabelFrameRow[]
  nearMiss?: number
  random?: number
  seed?: string
}): readonly JevLabelStratumSample[] {
  const budgets: Record<EJevLabelStratum, number> = {
    [EJevLabelStratum.Nudged]: Number.POSITIVE_INFINITY,
    [EJevLabelStratum.NearMiss]: nearMiss,
    [EJevLabelStratum.Random]: random,
  }
  const candidates = new Map<EJevLabelStratum, JevLabelFrameRow[]>([
    [EJevLabelStratum.Nudged, []],
    [EJevLabelStratum.NearMiss, []],
    [EJevLabelStratum.Random, []],
  ])
  for (const [traceId, traceRows] of rowsByTrace({ rows })) {
    const strata = new Set(traceRows.map((row) => stratumOf({ verdict: row.verdict })))
    const stratum = JEV_LABEL_STRATUM_ORDER.find((candidate) => strata.has(candidate))
    if (stratum === undefined) continue
    const inStratum = traceRows.filter((row) => stratumOf({ verdict: row.verdict }) === stratum)
    const chosen = lowestRanked({ rows: inStratum, seed })
    const entry: JevLabelFrameRow = {
      ...chosen,
      traceId,
    }
    candidates.get(stratum)?.push(entry)
  }

  const samples: JevLabelStratumSample[] = []
  for (const stratum of JEV_LABEL_STRATUM_ORDER) {
    const available = candidates.get(stratum) ?? []
    if (available.length === 0) continue
    const budget = Math.min(budgets[stratum], available.length)
    const ordered = [...available].sort((left, right) =>
      stableRank({ seed, key: left.traceId }) < stableRank({ seed, key: right.traceId }) ? -1 : 1,
    )
    for (const row of ordered.slice(0, budget)) {
      const traceScopeCount = rows.filter(
        (scopeRow) =>
          scopeRow.traceId === row.traceId && stratumOf({ verdict: scopeRow.verdict }) === stratum,
      ).length
      samples.push({
        row,
        stratum,
        inclusionProbability: inclusionProbabilityOf({
          requested: budgets[stratum],
          available: available.length,
          traceScopeCount,
        }),
      })
    }
  }
  return samples
}
