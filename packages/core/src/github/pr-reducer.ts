import type { PrFoldChange, PrFoldResult, PrFoldState, PrUncertainty } from './pr-fold-state'
import { EPrState, type DerivedChecks, type PrObservation, type PullSample } from './pr-observation'

type PullObservation = Extract<PrObservation, { kind: 'pull' }>
type MergeabilityObservation = Extract<PrObservation, { kind: 'mergeability' }>

type FieldValues = readonly (number | string | null)[]

const STATE_RANK: Record<EPrState, string> = {
  [EPrState.Merged]: '3',
  [EPrState.Closed]: '2',
  [EPrState.Draft]: '1',
  [EPrState.Open]: '0',
}

function pullOrderKeyOf(sample: PullSample): readonly string[] {
  return [
    sample.pullUpdatedAt,
    STATE_RANK[sample.state],
    sample.mergedAt ?? '',
    sample.closedAt ?? '',
    sample.headSha,
    sample.baseBranch,
    sample.title,
  ]
}

function compareKeys(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? ''
    const b = right[index] ?? ''
    if (a === b) continue

    return a < b ? -1 : 1
  }

  return 0
}

export function comparePullSamples(args: { a: PullSample; b: PullSample }): number {
  return compareKeys(pullOrderKeyOf(args.a), pullOrderKeyOf(args.b))
}

function pullFieldsOf(state: PrFoldState | null): FieldValues | null {
  const pull = state?.pull
  if (pull === null || pull === undefined) return null

  return [
    pull.repoFullName,
    pull.prNumber,
    pull.title,
    pull.url,
    pull.state,
    pull.headBranch,
    pull.headSha,
    pull.headRepoFullName,
    pull.baseBranch,
  ]
}

function mergeabilityFieldsOf(state: PrFoldState | null): FieldValues | null {
  const sample = state?.mergeability
  if (sample === null || sample === undefined) return null

  return [
    sample.headSha,
    sample.baseBranch,
    sample.mergeable === null ? 'unknown' : String(sample.mergeable),
    sample.mergeClean === null ? 'unknown' : String(sample.mergeClean),
  ]
}

function checksFieldsOf(state: PrFoldState | null): FieldValues | null {
  const checks = state?.checks
  if (checks === null || checks === undefined) return null

  return [
    checks.headSha,
    checks.running,
    checks.passed,
    checks.failed,
    checks.ignored,
    checks.rollup,
  ]
}

function sameFields(left: FieldValues | null, right: FieldValues | null): boolean {
  if (left === null || right === null) return left === right

  return left.length === right.length && left.every((value, index) => value === right[index])
}

function changedBetween(args: {
  from: PrFoldState | null
  to: PrFoldState | null
}): PrFoldChange[] {
  const changed: PrFoldChange[] = []
  if (!sameFields(pullFieldsOf(args.from), pullFieldsOf(args.to))) changed.push('pull')
  if (!sameFields(mergeabilityFieldsOf(args.from), mergeabilityFieldsOf(args.to))) {
    changed.push('mergeability')
  }
  if (!sameFields(checksFieldsOf(args.from), checksFieldsOf(args.to))) changed.push('checks')

  return changed
}

export function uncertaintyOf(args: { state: PrFoldState | null }): PrUncertainty[] {
  const pull = args.state?.pull ?? null
  const mergeability = args.state?.mergeability ?? null
  const uncertainty: PrUncertainty[] = []

  if (pull === null) uncertainty.push('pull-absent')
  const mergeabilityKnown =
    pull !== null &&
    mergeability !== null &&
    mergeability.mergeable !== null &&
    mergeability.headSha === pull.headSha &&
    mergeability.baseBranch === pull.baseBranch
  if (!mergeabilityKnown) uncertainty.push('mergeability-unknown')
  if ((args.state?.checks ?? null) === null) uncertainty.push('checks-absent')

  return uncertainty
}

function applyPull(args: {
  observation: PullObservation
  state: PrFoldState | null
}): PrFoldState | null {
  const sample = args.observation.sample
  const previous = args.state?.pull ?? null
  if (previous !== null && comparePullSamples({ a: sample, b: previous }) <= 0) return args.state
  const headMoved =
    previous !== null &&
    (previous.headSha !== sample.headSha || previous.baseBranch !== sample.baseBranch)

  return {
    repoFullName: sample.repoFullName,
    prNumber: sample.prNumber,
    pull: { ...sample, source: args.observation.source },
    mergeability: headMoved ? null : (args.state?.mergeability ?? null),
    checks: headMoved ? null : (args.state?.checks ?? null),
    version: args.state?.version ?? 0,
  }
}

function applyMergeability(args: {
  observation: MergeabilityObservation
  state: PrFoldState | null
}): PrFoldState | null {
  const state = args.state
  const sample = args.observation.sample
  const pull = state?.pull ?? null
  if (state === null || pull === null) return state
  if (sample.headSha !== pull.headSha || sample.baseBranch !== pull.baseBranch) return state
  const stored = state.mergeability
  if (sample.mergeable === null) {
    return stored === null ? { ...state, mergeability: sample } : state
  }
  if (stored !== null && stored.mergeable !== null && sample.observedAt <= stored.observedAt) {
    return state
  }

  return { ...state, mergeability: sample }
}

export function applyPrObservation(args: {
  observation: PrObservation
  state: PrFoldState | null
}): PrFoldResult {
  const observation = args.observation
  const state =
    observation.kind === 'pull'
      ? applyPull({ observation, state: args.state })
      : applyMergeability({ observation, state: args.state })

  return {
    state,
    changed: changedBetween({ from: args.state, to: state }),
    uncertainty: uncertaintyOf({ state }),
  }
}

export function foldPrObservations(args: {
  observations: readonly PrObservation[]
  state: PrFoldState | null
}): PrFoldResult {
  const state = args.observations.reduce<PrFoldState | null>(
    (held, observation) => applyPrObservation({ observation, state: held }).state,
    args.state,
  )

  return {
    state,
    changed: changedBetween({ from: args.state, to: state }),
    uncertainty: uncertaintyOf({ state }),
  }
}

export function withDerivedChecks(args: {
  derived: DerivedChecks
  state: PrFoldState
}): PrFoldResult {
  const headSha = args.state.pull?.headSha ?? null
  const accepted =
    args.derived.headSha !== null &&
    args.derived.headSha === headSha &&
    args.derived.rollup !== null
  const state: PrFoldState = {
    ...args.state,
    checks:
      accepted && args.derived.headSha !== null
        ? {
            headSha: args.derived.headSha,
            running: args.derived.running,
            passed: args.derived.passed,
            failed: args.derived.failed,
            ignored: args.derived.ignored,
            rollup: args.derived.rollup,
          }
        : null,
  }

  return {
    state,
    changed: changedBetween({ from: args.state, to: state }),
    uncertainty: uncertaintyOf({ state }),
  }
}

export type { CheckIdentity } from './check-identity'
export {
  checkReconcileEffectsOf,
  checksIdentityOf,
  compareCheckAttempts,
  derivedChecksOf,
  latestCheckAttempts,
} from './check-identity'
