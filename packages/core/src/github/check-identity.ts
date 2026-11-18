import { ECheckOutcome, checksRollup, checksTally } from './checks'
import type { PrEffect } from './pr-fold-state'
import {
  ECheckSource,
  type CheckSample,
  type DerivedChecks,
  checkOutcomeOfSample,
} from './pr-observation'

export type CheckIdentity = {
  appSlug: string | null
  checkKey: string
  name: string
  outcome: ECheckOutcome
  source: ECheckSource
  sourceCreatedAt: string | null
  sourceId: string
}

const CHECK_GROUP_SEPARATOR = '\u0000'

export function checksIdentityOf(args: { sample: CheckSample }): CheckIdentity {
  const sample = args.sample
  if (sample.source === ECheckSource.Run) {
    return {
      appSlug: sample.appSlug,
      checkKey: `${ECheckSource.Run}:${sample.id}`,
      name: sample.name,
      outcome: checkOutcomeOfSample(sample),
      source: ECheckSource.Run,
      sourceCreatedAt: sample.completedAt ?? sample.startedAt ?? null,
      sourceId: String(sample.id),
    }
  }

  return {
    appSlug: null,
    checkKey: `${ECheckSource.Status}:${sample.context}`,
    name: sample.context,
    outcome: checkOutcomeOfSample(sample),
    source: ECheckSource.Status,
    sourceCreatedAt: sample.createdAt,
    sourceId: String(sample.id),
  }
}

function finalityOf(identity: CheckIdentity): number {
  return identity.outcome === ECheckOutcome.Running ? 0 : 1
}

export function compareCheckAttempts(args: { a: CheckIdentity; b: CheckIdentity }): number {
  if (args.a.source !== args.b.source) return args.a.checkKey < args.b.checkKey ? -1 : 1
  if (args.a.source === ECheckSource.Run) {
    const byId = Number(args.a.sourceId) - Number(args.b.sourceId)
    if (byId !== 0) return byId

    return finalityOf(args.a) - finalityOf(args.b)
  }
  const byCreatedAt = (args.a.sourceCreatedAt ?? '').localeCompare(args.b.sourceCreatedAt ?? '')
  if (byCreatedAt !== 0) return byCreatedAt

  return Number(args.a.sourceId) - Number(args.b.sourceId)
}

function checkGroupKeyOf(identity: CheckIdentity): string {
  return `${identity.name}${CHECK_GROUP_SEPARATOR}${identity.appSlug ?? ''}`
}

export function latestCheckAttempts(args: { attempts: readonly CheckIdentity[] }): CheckIdentity[] {
  const newest = new Map<string, CheckIdentity>()
  for (const attempt of args.attempts) {
    const key = checkGroupKeyOf(attempt)
    const held = newest.get(key)
    if (held === undefined || compareCheckAttempts({ a: attempt, b: held }) > 0) {
      newest.set(key, attempt)
    }
  }

  return [...newest.values()]
}

export function derivedChecksOf(args: {
  attempts: readonly CheckIdentity[]
  headSha: string | null
  requiredContexts: readonly string[]
}): DerivedChecks {
  const latest = latestCheckAttempts({ attempts: args.attempts })
  const outcomes = latest.map((attempt) => attempt.outcome)
  const tally = checksTally(outcomes)

  return {
    headSha: args.headSha,
    running: tally.running,
    passed: tally.passed,
    failed: tally.failed,
    ignored: tally.ignored,
    rollup: latest.length === 0 ? null : checksRollup(outcomes),
    requiredContexts: args.requiredContexts,
  }
}

export function checkReconcileEffectsOf(args: {
  attempts: readonly CheckIdentity[]
  headSha: string
  repoFullName: string
}): PrEffect[] {
  const keysByGroup = new Map<string, Set<string>>()
  for (const attempt of args.attempts) {
    const group = checkGroupKeyOf(attempt)
    const keys = keysByGroup.get(group) ?? new Set<string>()
    keys.add(attempt.checkKey)
    keysByGroup.set(group, keys)
  }
  const rerun = [...keysByGroup.values()].some((keys) => keys.size > 1)
  if (!rerun) return []

  return [{ kind: 'reconcile-checks', headSha: args.headSha, repoFullName: args.repoFullName }]
}
