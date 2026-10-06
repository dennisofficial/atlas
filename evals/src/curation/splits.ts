import type { EvalCase } from '../case'

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const MAX_HOLDOUT_FRACTION = 0.5
const BUCKETS = 100

export type SplitResult = {
  development: readonly EvalCase[]
  holdout: readonly EvalCase[]
}

function fnv1a(text: string): number {
  let hash = FNV_OFFSET_BASIS
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash
}

const byId = (a: EvalCase, b: EvalCase): number => a.id.localeCompare(b.id)

export function isHoldoutGroup({ group, holdoutFraction, seed }: { group: string; holdoutFraction: number; seed: number }): boolean {
  return fnv1a(`${seed}:${group}`) % BUCKETS < holdoutFraction * BUCKETS
}

export function splitCases({
  cases,
  holdoutFraction,
  seed,
}: {
  cases: readonly EvalCase[]
  holdoutFraction: number
  seed: number
}): SplitResult {
  if (!Number.isFinite(holdoutFraction) || holdoutFraction < 0 || holdoutFraction > MAX_HOLDOUT_FRACTION) {
    throw new Error(`holdoutFraction must be within [0, ${MAX_HOLDOUT_FRACTION}]`)
  }
  const groups = new Map<string, EvalCase[]>()
  for (const evalCase of cases) {
    const members = groups.get(evalCase.provenance.group) ?? []
    members.push(evalCase)
    groups.set(evalCase.provenance.group, members)
  }
  const development: EvalCase[] = []
  const holdout: EvalCase[] = []
  for (const group of [...groups.keys()].sort()) {
    const target = isHoldoutGroup({ group, holdoutFraction, seed }) ? holdout : development
    target.push(...(groups.get(group) ?? []))
  }
  return { development: development.sort(byId), holdout: holdout.sort(byId) }
}

export function splitCounts({ split }: { split: SplitResult }): {
  development: number
  holdout: number
  groups: { development: number; holdout: number }
} {
  const groupCount = (members: readonly EvalCase[]): number => new Set(members.map((member) => member.provenance.group)).size
  return {
    development: split.development.length,
    holdout: split.holdout.length,
    groups: { development: groupCount(split.development), holdout: groupCount(split.holdout) },
  }
}
