import type { FactRecord } from '../uploads/placement-facts'

export const STOP_OWED_KIND = 'stop-owed'

export const STOP_PAID_KIND = 'stop-paid'

export const stopOwedKeyOf = (scope: string): string => `${STOP_OWED_KIND}:${scope}`

export const stopPaidKeyOf = (scope: string): string => `${STOP_PAID_KIND}:${scope}`

export type StopDebtMark = {
  kind: 'owed' | 'paid' | 'dispatched'
  scope: string
}

const scopeIn = (args: { key: string; kind: string }): string | undefined => {
  const prefix = `${args.kind}:`
  return args.key.startsWith(prefix) ? args.key.slice(prefix.length) : undefined
}

export const stopDebtMarkOf = (fact: FactRecord): StopDebtMark | undefined => {
  if (fact.type !== 'fact-recorded') return undefined
  if (fact.kind !== STOP_OWED_KIND && fact.kind !== STOP_PAID_KIND) return undefined
  const scope = scopeIn({ key: fact.key, kind: fact.kind })
  if (scope === undefined) return undefined
  return { kind: fact.kind === STOP_OWED_KIND ? 'owed' : 'paid', scope }
}

const latestIndexesOf = (args: {
  marks: readonly StopDebtMark[]
  kind: StopDebtMark['kind']
}): Map<string, number> => {
  const indexes = new Map<string, number>()
  args.marks.forEach((mark, index) => {
    if (mark.kind === args.kind) indexes.set(mark.scope, index)
  })
  return indexes
}

export const owedStopScopesOf = (marks: readonly StopDebtMark[]): readonly string[] => {
  const owed = latestIndexesOf({ marks, kind: 'owed' })
  const paid = latestIndexesOf({ marks, kind: 'paid' })
  const dispatched = latestIndexesOf({ marks, kind: 'dispatched' })
  return [...owed]
    .filter(
      ([scope, index]) => index > (paid.get(scope) ?? -1) && index > (dispatched.get(scope) ?? -1),
    )
    .map(([scope]) => scope)
}
