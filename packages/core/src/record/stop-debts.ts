import type { FactRecord } from '../uploads/placement-facts'

export const STOP_OWED_KIND = 'stop-owed'

export const STOP_PAID_KIND = 'stop-paid'

export const stopOwedKeyOf = (scope: string): string => `${STOP_OWED_KIND}:${scope}`

export const stopPaidKeyOf = (scope: string): string => `${STOP_PAID_KIND}:${scope}`

const scopeIn = (args: { key: string; kind: string }): string | undefined => {
  const prefix = `${args.kind}:`
  return args.key.startsWith(prefix) ? args.key.slice(prefix.length) : undefined
}

const owedScopeIn = (fact: FactRecord): string | undefined =>
  fact.kind === STOP_OWED_KIND ? scopeIn({ key: fact.key, kind: fact.kind }) : undefined

const paidScopeIn = (fact: FactRecord): string | undefined =>
  fact.kind === STOP_PAID_KIND ? scopeIn({ key: fact.key, kind: fact.kind }) : undefined

const settledIndexesOf = (facts: readonly FactRecord[]): Map<string, number> => {
  const indexes = new Map<string, number>()
  facts.forEach((fact, index) => {
    if (fact.type !== 'fact-recorded') return
    const scope = paidScopeIn(fact)
    if (scope !== undefined) indexes.set(scope, index)
  })
  return indexes
}

export const owedStopScopesOf = (facts: readonly FactRecord[]): readonly string[] => {
  const paid = settledIndexesOf(facts)
  const owed = new Map<string, number>()
  facts.forEach((fact, index) => {
    if (fact.type !== 'fact-recorded') return
    const scope = owedScopeIn(fact)
    if (scope !== undefined) owed.set(scope, index)
  })
  return [...owed]
    .filter(([scope, index]) => index > (paid.get(scope) ?? -1))
    .map(([scope]) => scope)
}
